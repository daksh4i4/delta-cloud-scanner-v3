import asyncio
import json
import math
import os
import time
import traceback
from pathlib import Path
from typing import Any

import httpx
import websockets
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse


# ============================================================
# CONFIG
# ============================================================

BASE = os.getenv(
    "DELTA_BASE_URL",
    "https://api.india.delta.exchange"
).rstrip("/")

WS_URL = os.getenv(
    "DELTA_WS_URL",
    "wss://public-socket.india.delta.exchange"
)

TG = os.getenv("TELEGRAM_BOT_TOKEN", "")
CHAT = os.getenv("TELEGRAM_CHAT_ID", "")

INTERVAL = max(
    30,
    int(os.getenv("SCAN_INTERVAL_SECONDS", "60"))
)

BATCH_SIZE = max(
    2,
    int(os.getenv("SCAN_BATCH_SIZE", "8"))
)

HTTP_TIMEOUT = float(
    os.getenv("HTTP_TIMEOUT_SECONDS", "15")
)

CANDLE_COUNT = max(
    80,
    int(os.getenv("CANDLE_COUNT", "120"))
)

ROOT = Path(__file__).resolve().parent


# ============================================================
# FASTAPI
# ============================================================

app = FastAPI(
    title="Delta Cloud Scanner V3",
    version="3.2"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# TIMEFRAMES
# ============================================================

TIMEFRAMES = {
    "1m": 60,
    "3m": 180,
    "5m": 300,
    "15m": 900,
    "30m": 1800,
    "1h": 3600,
    "2h": 7200,
    "4h": 14400,
    "6h": 21600,
    "12h": 43200,
    "1d": 86400,
    "1w": 604800,
    "1M": 2592000,
}


# ============================================================
# DEFAULT SETTINGS
# ============================================================

DEFAULT = {
    "wave_tf": "15m",
    "tide_tf": "1h",

    "wave_ema": [5, 13, 26],
    "tide_ema": [5, 13, 26],
    "tide_filter_ema": [9, 20],

    "rsi_period": 14,
    "rsi_buy": 50,
    "rsi_sell": 50,

    "macd_fast": 12,
    "macd_slow": 26,
    "macd_signal": 9,

    "stoch_period": 14,
    "stoch_k": 3,
    "stoch_d": 3,

    "volume_sma": 20,

    "buy_score": 75,
    "sell_score": 25,

    "sr_lookback": 80,
    "sr_pivot": 3,

    "min_rr": 1.5,
    "sl_buffer_pct": 0.15,

    "min_volume_ratio": 1.0,
    "min_signal_confirmations": 7,
}

settings = dict(DEFAULT)


# ============================================================
# GLOBAL STATE
# ============================================================

markets: dict[str, dict[str, Any]] = {}

clients: set[WebSocket] = set()

previous_signals: dict[str, str] = {}

last_scan = 0.0
scan_running = False

ws_ok = False

markets_ready = asyncio.Event()

last_ws_broadcast = 0.0

http_client: httpx.AsyncClient | None = None
telegram_client: httpx.AsyncClient | None = None

last_error = ""

scanner_task: asyncio.Task | None = None
websocket_task: asyncio.Task | None = None


# ============================================================
# HTTP TIMEOUT
# ============================================================

def http_timeout():

    return httpx.Timeout(
        connect=5.0,
        read=HTTP_TIMEOUT,
        write=HTTP_TIMEOUT,
        pool=5.0
    )


# ============================================================
# HELPERS
# ============================================================

def num(v, default=0.0):

    try:

        if v is None:
            return default

        x = float(v)

        if math.isfinite(x):
            return x

        return default

    except Exception:

        return default


def tf_seconds(tf):

    return TIMEFRAMES.get(
        str(tf),
        900
    )


# ============================================================
# INDICATORS
# ============================================================

def ema_series(values, period):

    try:
        p = int(period)

    except Exception:
        return []

    if p <= 0 or len(values) < p:
        return []

    out = [None] * len(values)

    cur = sum(values[:p]) / p

    out[p - 1] = cur

    k = 2 / (p + 1)

    for i in range(p, len(values)):

        cur = (
            (values[i] - cur) * k
            + cur
        )

        out[i] = cur

    return out


def ema(values, period):

    s = ema_series(
        values,
        period
    )

    return s[-1] if s else None


def sma(values, period):

    try:
        p = int(period)

    except Exception:
        return None

    if p <= 0 or len(values) < p:
        return None

    return sum(values[-p:]) / p


def rsi(values, period):

    try:
        p = int(period)

    except Exception:
        return 50.0

    if p <= 0 or len(values) <= p:
        return 50.0

    gains = []
    losses = []

    for i in range(1, len(values)):

        d = values[i] - values[i - 1]

        gains.append(max(d, 0))
        losses.append(max(-d, 0))

    ag = sum(gains[:p]) / p
    al = sum(losses[:p]) / p

    for i in range(p, len(gains)):

        ag = (
            (ag * (p - 1))
            + gains[i]
        ) / p

        al = (
            (al * (p - 1))
            + losses[i]
        ) / p

    if al == 0:

        return (
            100.0
            if ag
            else 50.0
        )

    rs = ag / al

    return 100 - 100 / (1 + rs)


def macd(
    values,
    fast,
    slow,
    signal
):

    try:

        f = int(fast)
        s = int(slow)
        sig = int(signal)

    except Exception:

        return 0.0, 0.0

    if min(f, s, sig) <= 0:
        return 0.0, 0.0

    if len(values) < s + sig:
        return 0.0, 0.0

    fs = ema_series(
        values,
        f
    )

    ss = ema_series(
        values,
        s
    )

    mv = []

    for i in range(len(values)):

        if (
            fs[i] is not None
            and ss[i] is not None
        ):

            mv.append(
                fs[i] - ss[i]
            )

    if len(mv) < sig:
        return 0.0, 0.0

    ml = mv[-1]

    sl = ema(
        mv,
        sig
    )

    return (
        ml,
        sl if sl is not None else 0.0
    )


def stochastic(
    highs,
    lows,
    closes,
    period,
    k_smooth,
    d_smooth
):

    try:

        p = int(period)
        ks = int(k_smooth)
        ds = int(d_smooth)

    except Exception:

        return 50.0, 50.0

    if min(p, ks, ds) <= 0:
        return 50.0, 50.0

    if len(closes) < p:
        return 50.0, 50.0

    raw = []

    for i in range(
        p - 1,
        len(closes)
    ):

        hi = max(
            highs[
                i - p + 1:
                i + 1
            ]
        )

        lo = min(
            lows[
                i - p + 1:
                i + 1
            ]
        )

        if hi == lo:

            value = 50.0

        else:

            value = (
                (closes[i] - lo)
                / (hi - lo)
                * 100
            )

        raw.append(value)

    kv = []

    for i in range(
        ks - 1,
        len(raw)
    ):

        kv.append(
            sum(
                raw[
                    i - ks + 1:
                    i + 1
                ]
            ) / ks
        )

    if not kv:
        return 50.0, 50.0

    k = kv[-1]

    if len(kv) >= ds:

        d = sum(
            kv[-ds:]
        ) / ds

    else:

        d = k

    return k, d


# ============================================================
# HEIKIN ASHI
# ============================================================

def heikin_ashi(candles):

    if not candles:
        return []

    out = []

    ha_open = None
    ha_close = None

    for c in sorted(
        candles,
        key=lambda x:
            num(x.get("time"))
    ):

        o = num(c.get("open"))
        h = num(c.get("high"))
        l = num(c.get("low"))
        cl = num(c.get("close"))

        hc = (
            o + h + l + cl
        ) / 4

        if ha_open is None:

            ho = (
                o + cl
            ) / 2

        else:

            ho = (
                ha_open
                + ha_close
            ) / 2

        hh = max(
            h,
            ho,
            hc
        )

        hl = min(
            l,
            ho,
            hc
        )

        out.append({
            "open": ho,
            "high": hh,
            "low": hl,
            "close": hc,
        })

        ha_open = ho
        ha_close = hc

    return out


# ============================================================
# SUPPORT / RESISTANCE
# ============================================================

def pivot_levels(
    candles,
    lookback,
    pivot
):

    try:

        lb = int(lookback)
        p = int(pivot)

    except Exception:

        return []

    data = (
        candles[-lb:]
        if len(candles) > lb
        else candles[:]
    )

    if len(data) < 2 * p + 1:
        return []

    lows = []
    highs = []

    for i in range(
        p,
        len(data) - p
    ):

        lo = num(
            data[i].get("low")
        )

        hi = num(
            data[i].get("high")
        )

        low_window = [
            num(x.get("low"))
            for x in data[
                i - p:
                i + p + 1
            ]
        ]

        high_window = [
            num(x.get("high"))
            for x in data[
                i - p:
                i + p + 1
            ]
        ]

        if lo == min(low_window):
            lows.append(lo)

        if hi == max(high_window):
            highs.append(hi)

    return lows, highs


def sr_levels(
    candles,
    price
):

    piv = pivot_levels(
        candles,
        settings["sr_lookback"],
        settings["sr_pivot"]
    )

    if not piv:

        return {
            "s1": None,
            "s2": None,
            "r1": None,
            "r2": None,
        }

    lows, highs = piv

    supports = sorted(
        {
            x
            for x in lows
            if x < price
        },
        reverse=True
    )

    resistances = sorted(
        {
            x
            for x in highs
            if x > price
        }
    )

    return {

        "s1":
            supports[0]
            if len(supports) > 0
            else None,

        "s2":
            supports[1]
            if len(supports) > 1
            else None,

        "r1":
            resistances[0]
            if len(resistances) > 0
            else None,

        "r2":
            resistances[1]
            if len(resistances) > 1
            else None,
    }


# ============================================================
# CANDLE ANALYSIS
# ============================================================

def analyze(candles):

    if (
        not candles
        or len(candles) < 40
    ):

        return None

    candles = sorted(
        candles,
        key=lambda x:
            num(x.get("time"))
    )

    closes = [
        num(x.get("close"))
        for x in candles
    ]

    highs = [
        num(x.get("high"))
        for x in candles
    ]

    lows = [
        num(x.get("low"))
        for x in candles
    ]

    volumes = [
        num(
            x.get("volume")
            or x.get("turnover")
            or 0
        )
        for x in candles
    ]

    we = settings["wave_ema"]

    e1 = ema(
        closes,
        we[0]
    )

    e2 = ema(
        closes,
        we[1]
    )

    e3 = ema(
        closes,
        we[2]
    )

    ml, ms = macd(
        closes,
        settings["macd_fast"],
        settings["macd_slow"],
        settings["macd_signal"]
    )

    sk, sd = stochastic(
        highs,
        lows,
        closes,
        settings["stoch_period"],
        settings["stoch_k"],
        settings["stoch_d"]
    )

    return {

        "ema5": e1,

        "ema13": e2,

        "ema26": e3,

        "rsi":
            rsi(
                closes,
                settings["rsi_period"]
            ),

        "macd": ml,

        "macd_signal": ms,

        "stoch_k": sk,

        "stoch_d": sd,

        "volume":
            volumes[-1],

        "volume_sma":
            sma(
                volumes,
                settings["volume_sma"]
            ),

        "close":
            closes[-1],
    }


# ============================================================
# HTTP
# ============================================================

async def get_json(
    path,
    params=None
):

    global http_client

    if http_client is None:

        http_client = httpx.AsyncClient(
            timeout=http_timeout(),
            limits=httpx.Limits(
                max_connections=12,
                max_keepalive_connections=6
            )
        )

    last_exc = None

    for attempt in range(3):

        try:

            r = await http_client.get(
                BASE + path,
                params=params,
                headers={
                    "Accept":
                        "application/json"
                }
            )

            r.raise_for_status()

            return r.json()

        except (
            httpx.TimeoutException,
            httpx.NetworkError,
            httpx.RemoteProtocolError
        ) as exc:

            last_exc = exc

            if attempt < 2:

                await asyncio.sleep(
                    0.5 * (attempt + 1)
                )

        except Exception:

            raise

    raise last_exc or RuntimeError(
        "HTTP request failed"
    )


# ============================================================
# CANDLES
# ============================================================

async def candles(
    symbol,
    timeframe,
    count=CANDLE_COUNT
):

    end = int(
        time.time()
    )

    start = (
        end
        - tf_seconds(timeframe)
        * count
    )

    data = await get_json(
        "/v2/history/candles",
        {
            "resolution":
                timeframe,

            "symbol":
                symbol,

            "start":
                start,

            "end":
                end,
        }
    )

    result = data.get(
        "result",
        []
    )

    if not isinstance(
        result,
        list
    ):

        return []

    return result


# ============================================================
# LOAD MARKETS
# ============================================================

async def load_markets():

    global markets
    global last_error

    print(
        "Loading Delta perpetual markets..."
    )

    try:

        data = await get_json(
            "/v2/tickers"
        )

        if not isinstance(
            data,
            dict
        ):

            raise RuntimeError(
                f"Invalid ticker response: {data}"
            )

        result = (
            data.get("result")
            or []
        )

        if not isinstance(
            result,
            list
        ):

            raise RuntimeError(
                "Ticker result is not a list"
            )

        print(
            f"Delta returned "
            f"{len(result)} ticker records."
        )

        old_markets = markets

        new = {}

        for t in result:

            if not isinstance(
                t,
                dict
            ):

                continue

            contract_type = str(
                t.get("contract_type")
                or t.get("product_type")
                or ""
            ).lower()

            symbol = str(
                t.get("symbol")
                or ""
            ).strip()

            if not symbol:
                continue

            if (
                contract_type
                and contract_type
                != "perpetual_futures"
            ):

                continue

            if symbol.startswith(
                "C-"
            ):

                continue

            if symbol.startswith(
                "P-"
            ):

                continue

            old = old_markets.get(
                symbol,
                {}
            )

            price = num(
                t.get("close")
                or t.get("mark_price")
                or t.get("spot_price")
                or t.get("last_price")
                or t.get("ltp")
                or old.get("price")
            )

            change = num(
                t.get("ltp_change_24h")
                or t.get("price_change_24h")
                or t.get("change_24h")
            )

            volume = num(
                t.get("turnover_usd")
                or t.get("turnover")
                or t.get("volume")
                or t.get("volume_24h")
            )

            oi = num(
                t.get("oi_value_usd")
                or t.get("oi_value")
                or t.get("oi")
                or t.get("open_interest")
            )

            new[symbol] = {

                "symbol":
                    symbol,

                "price":
                    price,

                "change":
                    change,

                "volume":
                    volume,

                "oi":
                    oi,

                "indicators":
                    old.get(
                        "indicators"
                    ),

                "live_volume":
                    old.get(
                        "live_volume"
                    ),
            }

        if not new:

            sample = result[:3]

            print(
                "NO PERPETUALS FOUND."
            )

            print(
                "Ticker samples:",
                json.dumps(
                    sample,
                    default=str
                )[:2000]
            )

            raise RuntimeError(
                "Delta returned tickers but "
                "no perpetual futures were detected."
            )

        markets = new

        markets_ready.set()

        last_error = ""

        print(
            f"Loaded {len(markets)} "
            f"perpetual markets from Delta."
        )

        await broadcast()

    except Exception as e:

        last_error = (
            f"load_markets: "
            f"{type(e).__name__}: {e}"
        )

        print(
            "MARKET LOAD ERROR:",
            last_error
        )

        traceback.print_exc()


# ============================================================
# TELEGRAM
# ============================================================

async def telegram(message):

    if not TG or not CHAT:

        return

    global telegram_client

    if telegram_client is None:

        telegram_client = httpx.AsyncClient(
            timeout=10,
            limits=httpx.Limits(
                max_connections=2,
                max_keepalive_connections=2
            )
        )

    try:

        r = await telegram_client.post(
            f"https://api.telegram.org/bot{TG}/sendMessage",
            json={
                "chat_id":
                    CHAT,

                "text":
                    message,

                "parse_mode":
                    "HTML",

                "disable_web_page_preview":
                    True,
            }
        )

        if r.status_code >= 400:

            print(
                "Telegram:",
                r.status_code,
                r.text[:300]
            )

    except Exception as e:

        print(
            "Telegram error:",
            e
        )


# ============================================================
# TRADE PLAN
# ============================================================

def near(
    a,
    b,
    tolerance=0.0025
):

    if (
        a is None
        or b is None
        or b == 0
    ):

        return False

    return (
        abs(a - b)
        / abs(b)
        <= tolerance
    )


def trade_plan(
    direction,
    price,
    sr,
    wave,
    tide
):

    if direction == "BUY":

        supports = [
            x
            for x in (
                sr["s1"],
                sr["s2"]
            )
            if x is not None
            and x < price
        ]

        resistances = [
            x
            for x in (
                sr["r1"],
                sr["r2"]
            )
            if x is not None
            and x > price
        ]

        if supports:

            sl_base = max(
                supports
            )

        else:

            sl_base = (
                price
                * (
                    1
                    - settings[
                        "sl_buffer_pct"
                    ] / 100
                )
            )

        sl = (
            sl_base
            * (
                1
                - settings[
                    "sl_buffer_pct"
                ] / 100
            )
        )

        risk = price - sl

        if risk <= 0:

            return {
                "entry":
                    price,
                "sl":
                    None,
                "tp1":
                    None,
                "tp2":
                    None,
                "rr":
                    0,
            }

        if resistances:

            target = max(
                resistances
            )

            rr = (
                target - price
            ) / risk

        else:

            target = (
                price
                + risk
                * settings["min_rr"]
            )

            rr = settings[
                "min_rr"
            ]

        tp1 = (
            price + risk
        )

        return {

            "entry":
                price,

            "sl":
                sl,

            "tp1":
                tp1,

            "tp2":
                target,

            "rr":
                rr,
        }

    # ========================================================
    # SELL
    # ========================================================

    supports = [
        x
        for x in (
            sr["s1"],
            sr["s2"]
        )
        if x is not None
        and x < price
    ]

    resistances = [
        x
        for x in (
            sr["r1"],
            sr["r2"]
        )
        if x is not None
        and x > price
    ]

    if resistances:

        sl_base = min(
            resistances
        )

    else:

        sl_base = (
            price
            * (
                1
                + settings[
                    "sl_buffer_pct"
                ] / 100
            )
        )

    sl = (
        sl_base
        * (
            1
            + settings[
                "sl_buffer_pct"
            ] / 100
        )
    )

    risk = sl - price

    if risk <= 0:

        return {
            "entry":
                price,
            "sl":
                None,
            "tp1":
                None,
            "tp2":
                None,
            "rr":
                0,
        }

    if supports:

        target = min(
            supports
        )

        rr = (
            price - target
        ) / risk

    else:

        target = (
            price
            - risk
            * settings["min_rr"]
        )

        rr = settings[
            "min_rr"
        ]

    tp1 = (
        price - risk
    )

    return {

        "entry":
            price,

        "sl":
            sl,

        "tp1":
            tp1,

        "tp2":
            target,

        "rr":
            rr,
    }


# ============================================================
# SYMBOL ANALYSIS
# ============================================================

async def analyze_symbol(
    symbol
):

    try:

        wave_tf = settings[
            "wave_tf"
        ]

        tide_tf = settings[
            "tide_tf"
        ]

        wc, tc = await asyncio.gather(

            candles(
                symbol,
                wave_tf
            ),

            candles(
                symbol,
                tide_tf
            )
        )

        wave = analyze(
            wc
        )

        tide = analyze(
            tc
        )

        if not wave or not tide:

            return None

        price = (
            markets
            .get(symbol, {})
            .get("price")
            or wave["close"]
        )

        sr = sr_levels(
            wc,
            price
        )

        ha = heikin_ashi(
            tc
        )

        ha_last = (
            ha[-1]
            if ha
            else {}
        )

        ha_prev = (
            ha[-2]
            if len(ha) > 1
            else ha_last
        )

        ha_bull = (

            ha_last.get(
                "close",
                0
            )
            >
            ha_last.get(
                "open",
                0
            )

            and

            ha_last.get(
                "close",
                0
            )
            >=
            ha_prev.get(
                "close",
                0
            )
        )

        ha_bear = (

            ha_last.get(
                "close",
                0
            )
            <
            ha_last.get(
                "open",
                0
            )

            and

            ha_last.get(
                "close",
                0
            )
            <=
            ha_prev.get(
                "close",
                0
            )
        )

        tfc = [
            num(
                x.get("close")
            )
            for x in tc
        ]

        f1 = ema(
            tfc,
            settings[
                "tide_filter_ema"
            ][0]
        )

        f2 = ema(
            tfc,
            settings[
                "tide_filter_ema"
            ][1]
        )

        wave_bull = (

            wave["ema5"]
            is not None

            and

            wave["ema13"]
            is not None

            and

            wave["ema26"]
            is not None

            and

            wave["ema5"]
            >
            wave["ema13"]
            >
            wave["ema26"]
        )

        wave_bear = (

            wave["ema5"]
            is not None

            and

            wave["ema13"]
            is not None

            and

            wave["ema26"]
            is not None

            and

            wave["ema5"]
            <
            wave["ema13"]
            <
            wave["ema26"]
        )

        tide_bull = (

            tide["ema5"]
            is not None

            and

            tide["ema13"]
            is not None

            and

            tide["ema26"]
            is not None

            and

            tide["ema5"]
            >
            tide["ema13"]
            >
            tide["ema26"]

            and

            f1 is not None

            and

            f2 is not None

            and

            f1 > f2
        )

        tide_bear = (

            tide["ema5"]
            is not None

            and

            tide["ema13"]
            is not None

            and

            tide["ema26"]
            is not None

            and

            tide["ema5"]
            <
            tide["ema13"]
            <
            tide["ema26"]

            and

            f1 is not None

            and

            f2 is not None

            and

            f1 < f2
        )

        macd_bull = (
            wave["macd"]
            >
            wave["macd_signal"]
        )

        macd_bear = (
            wave["macd"]
            <
            wave["macd_signal"]
        )

        stoch_bull = (
            wave["stoch_k"]
            >
            wave["stoch_d"]
        )

        stoch_bear = (
            wave["stoch_k"]
            <
            wave["stoch_d"]
        )

        if wave["volume_sma"]:

            volume_ratio = (
                wave["volume"]
                /
                wave["volume_sma"]
            )

        else:

            volume_ratio = 0

        vol_ok = (
            volume_ratio
            >=
            settings[
                "min_volume_ratio"
            ]
        )

        buy_sr = (

            (
                sr["s1"] is not None
                and price > sr["s1"]
            )

            or

            (
                sr["r1"] is not None
                and near(
                    price,
                    sr["r1"]
                )
            )
        )

        sell_sr = (

            (
                sr["r1"] is not None
                and price < sr["r1"]
            )

            or

            (
                sr["s1"] is not None
                and near(
                    price,
                    sr["s1"]
                )
            )
        )

        buy_checks = [

            wave_bull,

            tide_bull,

            ha_bull,

            wave["rsi"]
            >
            settings[
                "rsi_buy"
            ],

            macd_bull,

            stoch_bull,

            vol_ok,

            buy_sr,
        ]

        sell_checks = [

            wave_bear,

            tide_bear,

            ha_bear,

            wave["rsi"]
            <
            settings[
                "rsi_sell"
            ],

            macd_bear,

            stoch_bear,

            vol_ok,

            sell_sr,
        ]

        buy_conf = sum(
            bool(x)
            for x in buy_checks
        )

        sell_conf = sum(
            bool(x)
            for x in sell_checks
        )

        score = 50

        score += (
            12
            if wave_bull
            else -12
            if wave_bear
            else 0
        )

        score += (
            12
            if tide_bull
            else -12
            if tide_bear
            else 0
        )

        score += (
            8
            if ha_bull
            else -8
            if ha_bear
            else 0
        )

        score += (
            8
            if wave["rsi"]
            >
            settings[
                "rsi_buy"
            ]

            else -8

            if wave["rsi"]
            <
            settings[
                "rsi_sell"
            ]

            else 0
        )

        score += (
            10
            if macd_bull
            else -10
            if macd_bear
            else 0
        )

        score += (
            6
            if stoch_bull
            else -6
            if stoch_bear
            else 0
        )

        score += (
            5
            if vol_ok
            else -5
        )

        score += (

            5

            if (
                buy_sr
                and score >= 50
            )

            else -5

            if sell_sr

            else 0
        )

        score = max(
            0,
            min(
                100,
                round(score)
            )
        )

        buy_plan = trade_plan(
            "BUY",
            price,
            sr,
            wave,
            tide
        )

        sell_plan = trade_plan(
            "SELL",
            price,
            sr,
            wave,
            tide
        )

        buy_ok = (

            buy_conf
            >=
            settings[
                "min_signal_confirmations"
            ]

            and

            score
            >=
            settings[
                "buy_score"
            ]

            and

            buy_plan["rr"]
            >=
            settings[
                "min_rr"
            ]
        )

        sell_ok = (

            sell_conf
            >=
            settings[
                "min_signal_confirmations"
            ]

            and

            score
            <=
            settings[
                "sell_score"
            ]

            and

            sell_plan["rr"]
            >=
            settings[
                "min_rr"
            ]
        )

        if buy_ok:

            signal = "BUY"

        elif sell_ok:

            signal = "SELL"

        else:

            signal = "NEUTRAL"

        plan = (

            buy_plan
            if signal == "BUY"

            else sell_plan
            if signal == "SELL"

            else None
        )

        return {

            "wave":
                wave,

            "tide":
                tide,

            "tide9":
                f1,

            "tide20":
                f2,

            "ha": {

                "open":
                    ha_last.get(
                        "open"
                    ),

                "close":
                    ha_last.get(
                        "close"
                    ),

                "bull":
                    ha_bull,

                "bear":
                    ha_bear,
            },

            "sr":
                sr,

            "score":
                score,

            "buy_confirmations":
                buy_conf,

            "sell_confirmations":
                sell_conf,

            "volume_ratio":
                volume_ratio,

            "signal":
                signal,

            "plan":
                plan,

            "buy_plan":
                buy_plan,

            "sell_plan":
                sell_plan,

            "updated":
                time.time(),
        }

    except Exception as e:

        print(
            "CALC ERROR",
            symbol,
            str(e)
        )

        return None


# ============================================================
# BATCH PROCESSING
# ============================================================

async def process_batch(
    symbols
):

    results = {}

    for i in range(
        0,
        len(symbols),
        BATCH_SIZE
    ):

        batch = symbols[
            i:
            i + BATCH_SIZE
        ]

        vals = await asyncio.gather(

            *(
                analyze_symbol(
                    s
                )
                for s in batch
            ),

            return_exceptions=True
        )

        for symbol, result in zip(
            batch,
            vals
        ):

            if isinstance(
                result,
                Exception
            ):

                print(
                    "BATCH ERROR",
                    symbol,
                    result
                )

            elif result is not None:

                results[
                    symbol
                ] = result

        await asyncio.sleep(
            0.15
        )

    return results


# ============================================================
# FORMATTING
# ============================================================

def fmt_price(x):

    if x is None:
        return "—"

    try:

        x = float(x)

    except Exception:

        return "—"

    if x == 0:
        return "0"

    return f"{x:.10g}"


# ============================================================
# TELEGRAM SIGNAL
# ============================================================

async def send_signal(
    symbol,
    result
):

    sig = result[
        "signal"
    ]

    if sig not in (
        "BUY",
        "SELL"
    ):

        return

    if (
        previous_signals.get(
            symbol
        )
        == sig
    ):

        return

    m = markets.get(
        symbol,
        {}
    )

    w = result[
        "wave"
    ]

    p = result[
        "plan"
    ] or {}

    sr = result[
        "sr"
    ]

    emoji = (
        "🟢"
        if sig == "BUY"
        else "🔴"
    )

    confirmations = (

        result[
            "buy_confirmations"
        ]

        if sig == "BUY"

        else result[
            "sell_confirmations"
        ]
    )

    ha_text = (

        "Bullish"

        if result[
            "ha"
        ]["bull"]

        else "Bearish"

        if result[
            "ha"
        ]["bear"]

        else "Neutral"
    )

    rr_value = num(
        p.get("rr")
    )

    msg = (

        f"{emoji} "
        f"<b>HIGH QUALITY {sig}</b>\n\n"

        f"🪙 <b>{symbol}</b>\n"

        f"💰 Price: "
        f"<b>{fmt_price(m.get('price'))}</b>\n"

        f"⭐ Score: "
        f"<b>{result['score']}/100</b>\n"

        f"✅ Confirmations: "
        f"<b>{confirmations}/8</b>\n"

        f"⚖️ R:R: "
        f"<b>1:{rr_value:.2f}</b>\n\n"

        f"🌊 Wave: "
        f"<b>{settings['wave_tf']}</b>\n"

        f"🌊 Tide: "
        f"<b>{settings['tide_tf']}</b>\n"

        f"🕯️ Heikin-Ashi: "
        f"<b>{ha_text}</b>\n\n"

        f"🎯 Entry: "
        f"{fmt_price(p.get('entry'))}\n"

        f"🛑 SL: "
        f"{fmt_price(p.get('sl'))}\n"

        f"💚 TP1: "
        f"{fmt_price(p.get('tp1'))}\n"

        f"🏆 TP2: "
        f"{fmt_price(p.get('tp2'))}\n\n"

        f"🟩 S1: "
        f"{fmt_price(sr.get('s1'))} | "

        f"S2: "
        f"{fmt_price(sr.get('s2'))}\n"

        f"🟥 R1: "
        f"{fmt_price(sr.get('r1'))} | "

        f"R2: "
        f"{fmt_price(sr.get('r2'))}\n\n"

        f"📊 RSI: "
        f"{w['rsi']:.2f}\n"

        f"📉 MACD: "
        f"{w['macd']:.6g} / "
        f"{w['macd_signal']:.6g}\n"

        f"📈 Stoch: "
        f"{w['stoch_k']:.2f} / "
        f"{w['stoch_d']:.2f}\n"

        f"📦 Volume: "
        f"{result['volume_ratio']:.2f}x"
    )

    await telegram(
        msg
    )


# ============================================================
# SCANNER
# ============================================================

async def scan():

    global last_scan
    global scan_running
    global last_error

    if scan_running:

        print(
            "Previous scan still running."
        )

        return

    scan_running = True

    started = time.time()

    try:

        await load_markets()

        symbols = list(
            markets.keys()
        )

        if not symbols:

            raise RuntimeError(
                "No perpetual markets loaded."
            )

        await broadcast()

        print(
            f"Starting indicator scan "
            f"for {len(symbols)} markets..."
        )

        results = await process_batch(
            symbols
        )

        ranked = sorted(
            results,
            key=lambda symbol:
                results[symbol].get(
                    "score",
                    0
                ),
            reverse=True
        )

        for rank, symbol in enumerate(
            ranked,
            1
        ):

            results[
                symbol
            ][
                "score_rank"
            ] = rank

            if symbol in markets:

                markets[
                    symbol
                ][
                    "indicators"
                ] = results[
                    symbol
                ]

        for symbol, result in results.items():

            await send_signal(
                symbol,
                result
            )

            previous_signals[
                symbol
            ] = result[
                "signal"
            ]

        last_scan = time.time()

        last_error = ""

        elapsed = (
            time.time()
            - started
        )

        buys = sum(
            1
            for r in results.values()
            if r.get("signal")
            == "BUY"
        )

        sells = sum(
            1
            for r in results.values()
            if r.get("signal")
            == "SELL"
        )

        print(
            f"SCAN COMPLETE: "
            f"{len(results)}/{len(symbols)} "
            f"in {elapsed:.1f}s | "
            f"BUY={buys} "
            f"SELL={sells}"
        )

        await broadcast()

    except Exception as exc:

        last_error = (
            f"scan: "
            f"{type(exc).__name__}: "
            f"{exc}"
        )

        print(
            "SCAN ERROR:",
            repr(exc)
        )

        traceback.print_exc()

        await broadcast()

    finally:

        scan_running = False


# ============================================================
# SCANNER LOOP
# ============================================================

async def scanner_loop():

    print(
        "Scanner loop started."
    )

    await asyncio.sleep(
        2
    )

    while True:

        started = time.time()

        try:

            await scan()

        except asyncio.CancelledError:

            raise

        except Exception as e:

            print(
                "SCANNER LOOP:",
                repr(e)
            )

        elapsed = (
            time.time()
            - started
        )

        await asyncio.sleep(
            max(
                5,
                INTERVAL - elapsed
            )
        )


# ============================================================
# DELTA WEBSOCKET
# ============================================================

async def websocket_loop():

    global ws_ok
    global last_ws_broadcast
    global last_error

    print(
        "Delta WebSocket loop started."
    )

    while True:

        try:

            await markets_ready.wait()

            symbols = list(
                markets.keys()
            )

            if not symbols:

                await asyncio.sleep(
                    2
                )

                continue

            print(
                f"Connecting Delta public "
                f"WebSocket for "
                f"{len(symbols)} symbols..."
            )

            async with websockets.connect(

                WS_URL,

                ping_interval=20,

                ping_timeout=20,

                close_timeout=5,

                max_size=4_000_000,
            ) as ws:

                ws_ok = True

                print(
                    "Delta public WebSocket connected."
                )

                for start in range(
                    0,
                    len(symbols),
                    100
                ):

                    chunk = symbols[
                        start:
                        start + 100
                    ]

                    payload = {

                        "type":
                            "subscribe",

                        "payload": {

                            "channels": [

                                {

                                    "name":
                                        "ticker",

                                    "symbols":
                                        chunk
                                }
                            ]
                        }
                    }

                    await ws.send(
                        json.dumps(
                            payload
                        )
                    )

                    await asyncio.sleep(
                        0.1
                    )

                print(
                    f"Subscribed to "
                    f"{len(symbols)} "
                    f"perpetual tickers."
                )

                async for raw in ws:

                    try:

                        message = json.loads(
                            raw
                        )

                        if not isinstance(
                            message,
                            dict
                        ):

                            continue

                        message_type = (
                            message.get(
                                "type"
                            )
                        )

                        if message_type in {

                            "heartbeat",

                            "subscriptions",

                            "pong",
                        }:

                            continue

                        records = []

                        d = message.get(
                            "d"
                        )

                        if isinstance(
                            d,
                            list
                        ):

                            records.extend(
                                d
                            )

                        elif isinstance(
                            d,
                            dict
                        ):

                            records.append(
                                d
                            )

                        data = message.get(
                            "data"
                        )

                        if isinstance(
                            data,
                            list
                        ):

                            records.extend(
                                data
                            )

                        elif isinstance(
                            data,
                            dict
                        ):

                            records.append(
                                data
                            )

                        result = message.get(
                            "result"
                        )

                        if isinstance(
                            result,
                            list
                        ):

                            records.extend(
                                result
                            )

                        elif isinstance(
                            result,
                            dict
                        ):

                            records.append(
                                result
                            )

                        if (
                            message.get("sy")
                            or
                            message.get("symbol")
                        ):

                            records.append(
                                message
                            )

                        for data in records:

                            if not isinstance(
                                data,
                                dict
                            ):

                                continue

                            symbol = str(

                                data.get("sy")
                                or
                                data.get("s")
                                or
                                data.get("symbol")
                                or
                                ""
                            )

                            if symbol.startswith(
                                "MARK:"
                            ):

                                symbol = (
                                    symbol[5:]
                                )

                            if symbol not in markets:

                                continue

                            price = (

                                data.get("p")
                                or
                                data.get("close")
                                or
                                data.get("c")
                                or
                                data.get("mark_price")
                                or
                                data.get("spot_price")
                            )

                            if price is not None:

                                markets[
                                    symbol
                                ][
                                    "price"
                                ] = num(

                                    price,

                                    markets[
                                        symbol
                                    ].get(
                                        "price",
                                        0
                                    )
                                )

                            change = (

                                data.get(
                                    "ltp_change_24h"
                                )

                                or

                                data.get(
                                    "price_change_24h"
                                )
                            )

                            if change is not None:

                                markets[
                                    symbol
                                ][
                                    "change"
                                ] = num(
                                    change
                                )

                            volume = (

                                data.get("v")

                                or

                                data.get(
                                    "turnover"
                                )

                                or

                                data.get(
                                    "turnover_usd"
                                )
                            )

                            if volume is not None:

                                markets[
                                    symbol
                                ][
                                    "live_volume"
                                ] = num(
                                    volume
                                )

                        now = time.time()

                        if (
                            now
                            - last_ws_broadcast
                            >= 2
                        ):

                            last_ws_broadcast = now

                            await broadcast()

                    except Exception as exc:

                        print(
                            "WS PARSE ERROR:",
                            repr(exc)
                        )

                        continue

        except asyncio.CancelledError:

            raise

        except Exception as exc:

            ws_ok = False

            last_error = (
                f"websocket: "
                f"{type(exc).__name__}: "
                f"{exc}"
            )

            print(
                "WS RECONNECT:",
                repr(exc)
            )

            await asyncio.sleep(
                5
            )


# ============================================================
# SNAPSHOT
# ============================================================

def snapshot():

    rows = list(
        markets.values()
    )

    rows.sort(
        key=lambda x:
            x.get(
                "volume",
                0
            ),
        reverse=True
    )

    for i, m in enumerate(
        rows,
        1
    ):

        m[
            "volume_rank"
        ] = i

    return {

        "status": {

            "ws_connected":
                ws_ok,

            "last_scan":
                last_scan,

            "coins":
                len(rows),

            "scan_running":
                scan_running,

            "error":
                last_error,
        },

        "settings":
            settings,

        "markets":
            rows,
    }


# ============================================================
# BROADCAST
# ============================================================

async def broadcast():

    if not clients:

        return

    try:

        msg = json.dumps(
            snapshot(),
            separators=(
                ",",
                ":"
            )
        )

    except Exception as exc:

        print(
            "SNAPSHOT ERROR:",
            exc
        )

        return

    dead = []

    for c in list(
        clients
    ):

        try:

            await c.send_text(
                msg
            )

        except Exception:

            dead.append(
                c
            )

    for c in dead:

        clients.discard(
            c
        )


# ============================================================
# RENDER-SAFE BACKGROUND START
# ============================================================

async def delayed_background_start():

    global scanner_task
    global websocket_task

    # --------------------------------------------------------
    # IMPORTANT:
    # Allow Uvicorn/Render to bind the port FIRST.
    # --------------------------------------------------------

    print(
        "Waiting 3 seconds before "
        "starting Delta background workers..."
    )

    await asyncio.sleep(
        3
    )

    print(
        "Starting Delta scanner workers..."
    )

    scanner_task = asyncio.create_task(
        scanner_loop()
    )

    websocket_task = asyncio.create_task(
        websocket_loop()
    )

    print(
        "Delta scanner workers started."
    )


# ============================================================
# STARTUP
# ============================================================

@app.on_event("startup")
async def startup():

    global http_client

    print(
        "========================================"
    )

    print(
        "Delta Cloud Scanner V3.2 starting..."
    )

    print(
        "========================================"
    )

    # --------------------------------------------------------
    # Create HTTP client only.
    # Do NOT perform Delta API requests here.
    # --------------------------------------------------------

    http_client = httpx.AsyncClient(

        timeout=http_timeout(),

        limits=httpx.Limits(

            max_connections=12,

            max_keepalive_connections=6
        )
    )

    # --------------------------------------------------------
    # Start workers in background.
    # FastAPI can finish startup immediately.
    # --------------------------------------------------------

    asyncio.create_task(
        delayed_background_start()
    )

    print(
        "FastAPI startup complete."
    )

    print(
        "Server is ready to accept connections."
    )


# ============================================================
# SHUTDOWN
# ============================================================

@app.on_event("shutdown")
async def shutdown():

    global http_client
    global telegram_client

    print(
        "Shutting down Delta Cloud Scanner..."
    )

    # --------------------------------------------------------
    # Cancel background workers.
    # --------------------------------------------------------

    for task in (
        scanner_task,
        websocket_task,
    ):

        if task is not None:

            task.cancel()

    # --------------------------------------------------------
    # Close HTTP client.
    # --------------------------------------------------------

    if http_client:

        try:

            await http_client.aclose()

        except Exception:

            pass

        http_client = None

    # --------------------------------------------------------
    # Close Telegram client.
    # --------------------------------------------------------

    if telegram_client:

        try:

            await telegram_client.aclose()

        except Exception:

            pass

        telegram_client = None

    print(
        "Shutdown complete."
    )


# ============================================================
# ROUTES
# ============================================================

@app.get("/")
async def root():

    index = (
        ROOT
        / "frontend"
        / "index.html"
    )

    if index.exists():

        return FileResponse(
            index
        )

    return {
        "ok": True,
        "service":
            "Delta Cloud Scanner V3.2",
        "message":
            "Backend is running."
    }


@app.head("/")
async def root_head():

    return None


# ============================================================
# SIMPLE RENDER HEALTH / PING
# ============================================================

@app.get("/api/ping")
async def ping():

    return {

        "ok":
            True,

        "service":
            "Delta Cloud Scanner V3.2",

        "message":
            "Server is running",

        "timestamp":
            time.time(),
    }


@app.get("/api/health")
async def health():

    return {

        "ok":
            True,

        "ws_connected":
            ws_ok,

        "markets":
            len(markets),

        "last_scan":
            last_scan,

        "scan_running":
            scan_running,

        "error":
            last_error,
    }


@app.get("/api/status")
async def status():

    return snapshot()


# ============================================================
# SETTINGS
# ============================================================

@app.put("/api/settings")
async def update_settings(
    new_settings: dict
):

    global settings

    # --------------------------------------------------------
    # Timeframes
    # --------------------------------------------------------

    if (
        new_settings.get(
            "wave_tf"
        )
        in TIMEFRAMES
    ):

        settings[
            "wave_tf"
        ] = new_settings[
            "wave_tf"
        ]

    if (
        new_settings.get(
            "tide_tf"
        )
        in TIMEFRAMES
    ):

        settings[
            "tide_tf"
        ] = new_settings[
            "tide_tf"
        ]

    # --------------------------------------------------------
    # Numeric settings
    # --------------------------------------------------------

    numeric = [

        "rsi_period",

        "rsi_buy",

        "rsi_sell",

        "macd_fast",

        "macd_slow",

        "macd_signal",

        "stoch_period",

        "stoch_k",

        "stoch_d",

        "volume_sma",

        "buy_score",

        "sell_score",

        "sr_lookback",

        "sr_pivot",

        "min_volume_ratio",

        "min_signal_confirmations",
    ]

    for key in numeric:

        if key not in new_settings:

            continue

        try:

            value = float(
                new_settings[key]
            )

            if value <= 0:

                continue

            if key == (
                "min_volume_ratio"
            ):

                settings[
                    key
                ] = value

            else:

                settings[
                    key
                ] = int(
                    value
                )

        except Exception:

            pass

    # --------------------------------------------------------
    # Minimum RR
    # --------------------------------------------------------

    if "min_rr" in new_settings:

        try:

            v = float(
                new_settings[
                    "min_rr"
                ]
            )

            if 0.5 <= v <= 10:

                settings[
                    "min_rr"
                ] = v

        except Exception:

            pass

    # --------------------------------------------------------
    # SL buffer
    # --------------------------------------------------------

    if (
        "sl_buffer_pct"
        in new_settings
    ):

        try:

            v = float(
                new_settings[
                    "sl_buffer_pct"
                ]
            )

            if 0 <= v <= 5:

                settings[
                    "sl_buffer_pct"
                ] = v

        except Exception:

            pass

    # --------------------------------------------------------
    # EMA arrays
    # --------------------------------------------------------

    for key, length in (

        ("wave_ema", 3),

        ("tide_ema", 3),

        ("tide_filter_ema", 2),
    ):

        v = new_settings.get(
            key
        )

        if (

            isinstance(
                v,
                list
            )

            and

            len(v) == length
        ):

            try:

                a = [
                    int(x)
                    for x in v
                ]

                if all(
                    x > 0
                    for x in a
                ):

                    settings[
                        key
                    ] = a

            except Exception:

                pass

    print(
        "Settings updated:",
        settings
    )

    # --------------------------------------------------------
    # Trigger a scan in background.
    # Don't block API response.
    # --------------------------------------------------------

    asyncio.create_task(
        scan()
    )

    return {

        "ok":
            True,

        "settings":
            settings
    }


# ============================================================
# FRONTEND WEBSOCKET
# ============================================================

@app.websocket("/ws")
async def ws_endpoint(
    websocket: WebSocket
):

    await websocket.accept()

    clients.add(
        websocket
    )

    try:

        # Send initial snapshot immediately.
        await websocket.send_text(
            json.dumps(
                snapshot(),
                separators=(
                    ",",
                    ":"
                )
            )
        )

        while True:

            await websocket.receive_text()

    except WebSocketDisconnect:

        pass

    except Exception as exc:

        print(
            "Frontend WS disconnected:",
            repr(exc)
        )

    finally:

        clients.discard(
            websocket
        )
