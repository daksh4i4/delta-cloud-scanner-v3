import asyncio
import json
import math
import os
import time
from pathlib import Path
from typing import Any

import httpx
import websockets
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

BASE = os.getenv("DELTA_BASE_URL", "https://api.india.delta.exchange").rstrip("/")
WS_URL = os.getenv("DELTA_WS_URL", "wss://socket.india.delta.exchange")
TG = os.getenv("TELEGRAM_BOT_TOKEN", "")
CHAT = os.getenv("TELEGRAM_CHAT_ID", "")

INTERVAL = max(30, int(os.getenv("SCAN_INTERVAL_SECONDS", "60")))
BATCH_SIZE = max(2, int(os.getenv("SCAN_BATCH_SIZE", "5")))
HTTP_TIMEOUT = float(os.getenv("HTTP_TIMEOUT_SECONDS", "20"))
CANDLE_COUNT = max(80, int(os.getenv("CANDLE_COUNT", "120")))

ROOT = Path(__file__).resolve().parent.parent
app = FastAPI(title="Delta Cloud Scanner V3", version="3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

TIMEFRAMES = {
    "1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800,
    "1h": 3600, "2h": 7200, "4h": 14400, "6h": 21600,
    "12h": 43200, "1d": 86400, "1w": 604800, "1M": 2592000,
}

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

markets: dict[str, dict[str, Any]] = {}
clients: set[WebSocket] = set()
previous_signals: dict[str, str] = {}
last_scan = 0.0
scan_running = False
ws_ok = False
http_client: httpx.AsyncClient | None = None
telegram_client: httpx.AsyncClient | None = None


def num(v, default=0.0):
    try:
        if v is None:
            return default
        x = float(v)
        return x if math.isfinite(x) else default
    except Exception:
        return default


def tf_seconds(tf):
    return TIMEFRAMES.get(str(tf), 900)


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
        cur = (values[i] - cur) * k + cur
        out[i] = cur
    return out


def ema(values, period):
    s = ema_series(values, period)
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
    gains, losses = [], []
    for i in range(1, len(values)):
        d = values[i] - values[i - 1]
        gains.append(max(d, 0))
        losses.append(max(-d, 0))
    ag = sum(gains[:p]) / p
    al = sum(losses[:p]) / p
    for i in range(p, len(gains)):
        ag = ((ag * (p - 1)) + gains[i]) / p
        al = ((al * (p - 1)) + losses[i]) / p
    if al == 0:
        return 100.0 if ag else 50.0
    rs = ag / al
    return 100 - 100 / (1 + rs)


def macd(values, fast, slow, signal):
    try:
        f, s, sig = int(fast), int(slow), int(signal)
    except Exception:
        return 0.0, 0.0
    if min(f, s, sig) <= 0 or len(values) < s + sig:
        return 0.0, 0.0
    fs, ss = ema_series(values, f), ema_series(values, s)
    mv = [
        fs[i] - ss[i] for i in range(len(values))
        if fs[i] is not None and ss[i] is not None
    ]
    if len(mv) < sig:
        return 0.0, 0.0
    ml = mv[-1]
    sl = ema(mv, sig)
    return ml, sl if sl is not None else 0.0


def stochastic(highs, lows, closes, period, k_smooth, d_smooth):
    try:
        p, ks, ds = int(period), int(k_smooth), int(d_smooth)
    except Exception:
        return 50.0, 50.0
    if min(p, ks, ds) <= 0 or len(closes) < p:
        return 50.0, 50.0
    raw = []
    for i in range(p - 1, len(closes)):
        hi = max(highs[i-p+1:i+1])
        lo = min(lows[i-p+1:i+1])
        raw.append(50.0 if hi == lo else (closes[i] - lo) / (hi - lo) * 100)
    kv = []
    for i in range(ks - 1, len(raw)):
        kv.append(sum(raw[i-ks+1:i+1]) / ks)
    if not kv:
        return 50.0, 50.0
    k = kv[-1]
    d = sum(kv[-ds:]) / ds if len(kv) >= ds else k
    return k, d


def heikin_ashi(candles):
    if not candles:
        return []
    out = []
    ha_open = ha_close = None
    for c in sorted(candles, key=lambda x: num(x.get("time"))):
        o, h, l, cl = map(num, (c.get("open"), c.get("high"), c.get("low"), c.get("close")))
        hc = (o + h + l + cl) / 4
        if ha_open is None:
            ho = (o + cl) / 2
        else:
            ho = (ha_open + ha_close) / 2
        hh = max(h, ho, hc)
        hl = min(l, ho, hc)
        out.append({"open": ho, "high": hh, "low": hl, "close": hc})
        ha_open, ha_close = ho, hc
    return out


def pivot_levels(candles, lookback, pivot):
    """Confirmed local swing supports/resistances from the Wave timeframe."""
    try:
        lb, p = int(lookback), int(pivot)
    except Exception:
        return []
    data = candles[-lb:] if len(candles) > lb else candles[:]
    if len(data) < 2 * p + 1:
        return []
    lows, highs = [], []
    for i in range(p, len(data) - p):
        lo = num(data[i].get("low"))
        hi = num(data[i].get("high"))
        if lo == min(num(x.get("low")) for x in data[i-p:i+p+1]):
            lows.append(lo)
        if hi == max(num(x.get("high")) for x in data[i-p:i+p+1]):
            highs.append(hi)
    return lows, highs


def sr_levels(candles, price):
    piv = pivot_levels(candles, settings["sr_lookback"], settings["sr_pivot"])
    if not piv:
        return {"s1": None, "s2": None, "r1": None, "r2": None}
    lows, highs = piv
    supports = sorted({x for x in lows if x < price}, reverse=True)
    resistances = sorted({x for x in highs if x > price})
    return {
        "s1": supports[0] if len(supports) > 0 else None,
        "s2": supports[1] if len(supports) > 1 else None,
        "r1": resistances[0] if len(resistances) > 0 else None,
        "r2": resistances[1] if len(resistances) > 1 else None,
    }


def analyze(candles):
    if not candles or len(candles) < 40:
        return None
    candles = sorted(candles, key=lambda x: num(x.get("time")))
    closes = [num(x.get("close")) for x in candles]
    highs = [num(x.get("high")) for x in candles]
    lows = [num(x.get("low")) for x in candles]
    volumes = [num(x.get("volume") or x.get("turnover") or 0) for x in candles]

    we = settings["wave_ema"]
    e1, e2, e3 = [ema(closes, p) for p in we]
    ml, ms = macd(closes, settings["macd_fast"], settings["macd_slow"], settings["macd_signal"])
    sk, sd = stochastic(highs, lows, closes, settings["stoch_period"], settings["stoch_k"], settings["stoch_d"])
    return {
        "ema5": e1, "ema13": e2, "ema26": e3,
        "rsi": rsi(closes, settings["rsi_period"]),
        "macd": ml, "macd_signal": ms,
        "stoch_k": sk, "stoch_d": sd,
        "volume": volumes[-1],
        "volume_sma": sma(volumes, settings["volume_sma"]),
        "close": closes[-1],
    }


async def get_json(path, params=None):
    global http_client
    if http_client is None:
        http_client = httpx.AsyncClient(
            timeout=HTTP_TIMEOUT,
            limits=httpx.Limits(max_connections=12, max_keepalive_connections=6),
        )
    r = await http_client.get(BASE + path, params=params)
    r.raise_for_status()
    return r.json()


async def candles(symbol, timeframe, count=CANDLE_COUNT):
    end = int(time.time())
    start = end - tf_seconds(timeframe) * count
    data = await get_json("/v2/history/candles", {
        "resolution": timeframe, "symbol": symbol, "start": start, "end": end
    })
    result = data.get("result", [])
    return result if isinstance(result, list) else []


async def load_markets():
    global markets
    data = await get_json("/v2/tickers", {"contract_types": "perpetual_futures"})
    result = data.get("result", [])
    new = {}
    for t in result:
        symbol = t.get("symbol")
        if not symbol:
            continue
        old = markets.get(symbol, {})
        new[symbol] = {
            "symbol": symbol,
            "price": num(t.get("close") or t.get("mark_price") or old.get("price")),
            "change": num(t.get("ltp_change_24h")),
            "volume": num(t.get("turnover_usd") or t.get("turnover")),
            "oi": num(t.get("oi_value_usd") or t.get("oi")),
            "indicators": old.get("indicators"),
        }
    markets = new


async def telegram(message):
    if not TG or not CHAT:
        return
    global telegram_client
    if telegram_client is None:
        telegram_client = httpx.AsyncClient(timeout=10, limits=httpx.Limits(max_connections=2))
    try:
        r = await telegram_client.post(
            f"https://api.telegram.org/bot{TG}/sendMessage",
            json={"chat_id": CHAT, "text": message, "parse_mode": "HTML", "disable_web_page_preview": True},
        )
        if r.status_code >= 400:
            print("Telegram:", r.status_code, r.text[:300])
    except Exception as e:
        print("Telegram error:", e)


def near(a, b, tolerance=0.0025):
    if a is None or b is None or b == 0:
        return False
    return abs(a-b) / abs(b) <= tolerance


def trade_plan(direction, price, sr, wave, tide):
    if direction == "BUY":
        supports = [x for x in (sr["s1"], sr["s2"]) if x is not None and x < price]
        resistances = [x for x in (sr["r1"], sr["r2"]) if x is not None and x > price]
        sl_base = max(supports) if supports else price * (1 - settings["sl_buffer_pct"]/100)
        sl = sl_base * (1 - settings["sl_buffer_pct"]/100)
        target = max(resistances) if resistances else price + (price - sl) * settings["min_rr"]
        risk = price - sl
        rr = (target - price) / risk if risk > 0 else 0
        tp1 = price + risk * max(1.0, min(settings["min_rr"], 1.0))
        return {"entry": price, "sl": sl, "tp1": tp1, "tp2": target, "rr": rr}
    supports = [x for x in (sr["s1"], sr["s2"]) if x is not None and x < price]
    resistances = [x for x in (sr["r1"], sr["r2"]) if x is not None and x > price]
    sl_base = min(resistances) if resistances else price * (1 + settings["sl_buffer_pct"]/100)
    sl = sl_base * (1 + settings["sl_buffer_pct"]/100)
    target = min(supports) if supports else price - (sl - price) * settings["min_rr"]
    risk = sl - price
    rr = (price - target) / risk if risk > 0 else 0
    tp1 = price - risk * max(1.0, min(settings["min_rr"], 1.0))
    return {"entry": price, "sl": sl, "tp1": tp1, "tp2": target, "rr": rr}


async def analyze_symbol(symbol):
    try:
        wave_tf, tide_tf = settings["wave_tf"], settings["tide_tf"]
        wc, tc = await asyncio.gather(candles(symbol, wave_tf), candles(symbol, tide_tf))
        wave, tide = analyze(wc), analyze(tc)
        if not wave or not tide:
            return None

        price = markets.get(symbol, {}).get("price") or wave["close"]
        sr = sr_levels(wc, price)
        ha = heikin_ashi(tc)
        ha_last = ha[-1] if ha else {}
        ha_prev = ha[-2] if len(ha) > 1 else ha_last
        ha_bull = ha_last.get("close", 0) > ha_last.get("open", 0) and ha_last.get("close", 0) >= ha_prev.get("close", 0)
        ha_bear = ha_last.get("close", 0) < ha_last.get("open", 0) and ha_last.get("close", 0) <= ha_prev.get("close", 0)

        tfc = [num(x.get("close")) for x in tc]
        f1 = ema(tfc, settings["tide_filter_ema"][0])
        f2 = ema(tfc, settings["tide_filter_ema"][1])

        wave_bull = wave["ema5"] > wave["ema13"] > wave["ema26"]
        wave_bear = wave["ema5"] < wave["ema13"] < wave["ema26"]
        tide_bull = tide["ema5"] > tide["ema13"] > tide["ema26"] and f1 is not None and f2 is not None and f1 > f2
        tide_bear = tide["ema5"] < tide["ema13"] < tide["ema26"] and f1 is not None and f2 is not None and f1 < f2
        macd_bull, macd_bear = wave["macd"] > wave["macd_signal"], wave["macd"] < wave["macd_signal"]
        stoch_bull, stoch_bear = wave["stoch_k"] > wave["stoch_d"], wave["stoch_k"] < wave["stoch_d"]
        volume_ratio = wave["volume"] / wave["volume_sma"] if wave["volume_sma"] else 0
        vol_ok = volume_ratio >= settings["min_volume_ratio"]

        # S/R confirmation: BUY above S1 and preferably with room to R1/R2;
        # SELL below R1 and preferably with room to S1/S2.
        buy_sr = (sr["s1"] is not None and price > sr["s1"]) or (sr["r1"] is not None and near(price, sr["r1"]))
        sell_sr = (sr["r1"] is not None and price < sr["r1"]) or (sr["s1"] is not None and near(price, sr["s1"]))

        buy_checks = [
            wave_bull, tide_bull, ha_bull, wave["rsi"] > settings["rsi_buy"],
            macd_bull, stoch_bull, vol_ok, buy_sr
        ]
        sell_checks = [
            wave_bear, tide_bear, ha_bear, wave["rsi"] < settings["rsi_sell"],
            macd_bear, stoch_bear, vol_ok, sell_sr
        ]
        buy_conf = sum(bool(x) for x in buy_checks)
        sell_conf = sum(bool(x) for x in sell_checks)

        score = 50
        score += 12 if wave_bull else -12 if wave_bear else 0
        score += 12 if tide_bull else -12 if tide_bear else 0
        score += 8 if ha_bull else -8 if ha_bear else 0
        score += 8 if wave["rsi"] > settings["rsi_buy"] else -8 if wave["rsi"] < settings["rsi_sell"] else 0
        score += 10 if macd_bull else -10 if macd_bear else 0
        score += 6 if stoch_bull else -6 if stoch_bear else 0
        score += 5 if vol_ok else -5
        score += 5 if (buy_sr and score >= 50) else -5 if sell_sr else 0
        score = max(0, min(100, round(score)))

        buy_plan = trade_plan("BUY", price, sr, wave, tide)
        sell_plan = trade_plan("SELL", price, sr, wave, tide)

        buy_ok = (
            buy_conf >= settings["min_signal_confirmations"]
            and score >= settings["buy_score"]
            and buy_plan["rr"] >= settings["min_rr"]
        )
        sell_ok = (
            sell_conf >= settings["min_signal_confirmations"]
            and score <= settings["sell_score"]
            and sell_plan["rr"] >= settings["min_rr"]
        )

        signal = "BUY" if buy_ok else "SELL" if sell_ok else "NEUTRAL"
        plan = buy_plan if signal == "BUY" else sell_plan if signal == "SELL" else None

        return {
            "wave": wave, "tide": tide, "tide9": f1, "tide20": f2,
            "ha": {"open": ha_last.get("open"), "close": ha_last.get("close"),
                   "bull": ha_bull, "bear": ha_bear},
            "sr": sr, "score": score,
            "buy_confirmations": buy_conf, "sell_confirmations": sell_conf,
            "volume_ratio": volume_ratio,
            "signal": signal, "plan": plan,
            "buy_plan": buy_plan, "sell_plan": sell_plan,
            "updated": time.time(),
        }
    except Exception as e:
        print("calc", symbol, str(e))
        return None


async def process_batch(symbols):
    results = {}
    for i in range(0, len(symbols), BATCH_SIZE):
        batch = symbols[i:i+BATCH_SIZE]
        vals = await asyncio.gather(*(analyze_symbol(s) for s in batch), return_exceptions=True)
        for symbol, result in zip(batch, vals):
            if isinstance(result, Exception):
                print("batch error", symbol, result)
            elif result is not None:
                results[symbol] = result
        await asyncio.sleep(0.15)
    return results


def fmt_price(x):
    if x is None:
        return "—"
    x = float(x)
    if x == 0:
        return "0"
    return f"{x:.10g}"


async def send_signal(symbol, result):
    sig = result["signal"]
    if sig not in ("BUY", "SELL") or previous_signals.get(symbol) == sig:
        return
    m = markets.get(symbol, {})
    w = result["wave"]
    p = result["plan"] or {}
    sr = result["sr"]
    emoji = "🟢" if sig == "BUY" else "🔴"
    msg = (
        f"{emoji} <b>HIGH QUALITY {sig}</b>\n\n"
        f"🪙 <b>{symbol}</b>\n"
        f"💰 Price: <b>{fmt_price(m.get('price'))}</b>\n"
        f"⭐ Score: <b>{result['score']}/100</b>\n"
        f"✅ Confirmations: <b>{result['buy_confirmations'] if sig=='BUY' else result['sell_confirmations']}/8</b>\n"
        f"⚖️ R:R: <b>1:{p.get('rr', 0):.2f}</b>\n\n"
        f"🌊 Wave: <b>{settings['wave_tf']}</b>\n"
        f"🌊 Tide: <b>{settings['tide_tf']}</b>\n"
        f"🕯️ Heikin-Ashi: <b>{'Bullish' if result['ha']['bull'] else 'Bearish' if result['ha']['bear'] else 'Neutral'}</b>\n\n"
        f"🎯 Entry: {fmt_price(p.get('entry'))}\n"
        f"🛑 SL: {fmt_price(p.get('sl'))}\n"
        f"💚 TP1: {fmt_price(p.get('tp1'))}\n"
        f"🏆 TP2: {fmt_price(p.get('tp2'))}\n\n"
        f"🟩 S1: {fmt_price(sr.get('s1'))} | S2: {fmt_price(sr.get('s2'))}\n"
        f"🟥 R1: {fmt_price(sr.get('r1'))} | R2: {fmt_price(sr.get('r2'))}\n\n"
        f"📊 RSI: {w['rsi']:.2f}\n"
        f"📉 MACD: {w['macd']:.6g} / {w['macd_signal']:.6g}\n"
        f"📈 Stoch: {w['stoch_k']:.2f} / {w['stoch_d']:.2f}\n"
        f"📦 Volume: {result['volume_ratio']:.2f}x"
    )
    await telegram(msg)


async def scan():
    global last_scan, scan_running
    if scan_running:
        return
    scan_running = True
    started = time.time()
    try:
        await load_markets()
        symbols = list(markets)
        results = await process_batch(symbols)
        ranked = sorted(results, key=lambda s: results[s]["score"], reverse=True)
        for rank, symbol in enumerate(ranked, 1):
            results[symbol]["score_rank"] = rank
            markets[symbol]["indicators"] = results[symbol]
        for symbol, result in results.items():
            await send_signal(symbol, result)
            previous_signals[symbol] = result["signal"]
        last_scan = time.time()
        print(f"Scan complete: {len(results)}/{len(symbols)} in {time.time()-started:.1f}s")
        await broadcast()
    except Exception as e:
        print("scan:", e)
    finally:
        scan_running = False


async def scanner_loop():
    await asyncio.sleep(3)
    while True:
        started = time.time()
        try:
            await scan()
        except Exception as e:
            print("scanner:", e)
        await asyncio.sleep(max(5, INTERVAL - (time.time() - started)))


async def websocket_loop():
    global ws_ok
    while True:
        try:
            print("Connecting Delta WebSocket...")
            async with websockets.connect(
                WS_URL, ping_interval=20, ping_timeout=20, close_timeout=5, max_size=2_000_000
            ) as ws:
                ws_ok = True
                await ws.send(json.dumps({
                    "type": "subscribe",
                    "payload": {"channels": [{"name": "v2/ticker", "symbols": ["all"]}]}
                }))
                print("Delta WebSocket connected.")
                async for raw in ws:
                    try:
                        d = json.loads(raw)
                        d = d.get("data") or d.get("result")
                        if not isinstance(d, dict):
                            continue
                        symbol = d.get("symbol")
                        if symbol not in markets:
                            continue
                        price = d.get("close") or d.get("mark_price")
                        if price is not None:
                            markets[symbol]["price"] = num(price, markets[symbol].get("price", 0))
                    except Exception:
                        pass
        except Exception as e:
            ws_ok = False
            print("WS reconnect:", e)
            await asyncio.sleep(5)


def snapshot():
    rows = list(markets.values())
    rows.sort(key=lambda x: x.get("volume", 0), reverse=True)
    for i, m in enumerate(rows, 1):
        m["volume_rank"] = i
    return {
        "status": {"ws_connected": ws_ok, "last_scan": last_scan, "coins": len(rows), "scan_running": scan_running},
        "settings": settings,
        "markets": rows,
    }


async def broadcast():
    if not clients:
        return
    msg = json.dumps(snapshot(), separators=(",", ":"))
    dead = []
    for c in list(clients):
        try:
            await c.send_text(msg)
        except Exception:
            dead.append(c)
    for c in dead:
        clients.discard(c)


@app.on_event("startup")
async def startup():
    global http_client
    http_client = httpx.AsyncClient(
        timeout=HTTP_TIMEOUT,
        limits=httpx.Limits(max_connections=12, max_keepalive_connections=6),
    )
    asyncio.create_task(scanner_loop())
    asyncio.create_task(websocket_loop())
    print("Delta Cloud Scanner V3 started.")


@app.on_event("shutdown")
async def shutdown():
    global http_client, telegram_client
    if http_client:
        await http_client.aclose()
        http_client = None
    if telegram_client:
        await telegram_client.aclose()
        telegram_client = None


@app.get("/")
async def root():
    return FileResponse(ROOT / "frontend" / "index.html")


@app.get("/api/status")
async def status():
    return snapshot()


@app.put("/api/settings")
async def update_settings(new_settings: dict):
    global settings
    if new_settings.get("wave_tf") in TIMEFRAMES:
        settings["wave_tf"] = new_settings["wave_tf"]
    if new_settings.get("tide_tf") in TIMEFRAMES:
        settings["tide_tf"] = new_settings["tide_tf"]

    numeric = [
        "rsi_period","rsi_buy","rsi_sell","macd_fast","macd_slow","macd_signal",
        "stoch_period","stoch_k","stoch_d","volume_sma","buy_score","sell_score",
        "sr_lookback","sr_pivot","min_volume_ratio","min_signal_confirmations",
    ]
    for key in numeric:
        if key not in new_settings:
            continue
        try:
            value = float(new_settings[key])
            if value > 0:
                settings[key] = int(value) if key not in ("min_volume_ratio",) else value
        except Exception:
            pass

    if "min_rr" in new_settings:
        try:
            v = float(new_settings["min_rr"])
            if 0.5 <= v <= 10:
                settings["min_rr"] = v
        except Exception:
            pass

    if "sl_buffer_pct" in new_settings:
        try:
            v = float(new_settings["sl_buffer_pct"])
            if 0 <= v <= 5:
                settings["sl_buffer_pct"] = v
        except Exception:
            pass

    for key, length in (("wave_ema",3),("tide_ema",3),("tide_filter_ema",2)):
        v = new_settings.get(key)
        if isinstance(v, list) and len(v) == length:
            try:
                a = [int(x) for x in v]
                if all(x > 0 for x in a):
                    settings[key] = a
            except Exception:
                pass

    print("Settings updated:", settings)
    asyncio.create_task(scan())
    return {"ok": True, "settings": settings}


@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    await websocket.accept()
    clients.add(websocket)
    try:
        await websocket.send_text(json.dumps(snapshot(), separators=(",", ":")))
        while True:
            await websocket.receive_text()
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        clients.discard(websocket)
