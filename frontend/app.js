const $ = id => document.getElementById(id);

const TF = [
  "1m","3m","5m","15m","30m",
  "1h","2h","4h","6h","12h",
  "1d","1w","1M"
];

const defs = [
  ["wave_tf","Wave TF","select"],
  ["tide_tf","Tide TF","select"],

  ["we1","Wave EMA 1","number"],
  ["we2","Wave EMA 2","number"],
  ["we3","Wave EMA 3","number"],

  ["te1","Tide EMA 1","number"],
  ["te2","Tide EMA 2","number"],
  ["te3","Tide EMA 3","number"],

  ["fe1","Tide Filter EMA 1","number"],
  ["fe2","Tide Filter EMA 2","number"],

  ["rp","RSI Period","number"],
  ["rb","RSI BUY","number"],
  ["rs","RSI SELL","number"],

  ["mf","MACD Fast","number"],
  ["ms","MACD Slow","number"],
  ["mg","MACD Signal","number"],

  ["sp","Stoch Period","number"],
  ["sk","Stoch K Smooth","number"],
  ["sd","Stoch D Smooth","number"],

  ["vs","Volume SMA","number"],

  ["bs","BUY Score","number"],
  ["ss","SELL Score","number"],

  ["srl","S/R Lookback","number"],
  ["srp","S/R Pivot","number"],

  ["rr","Minimum R:R","number"],
  ["slb","SL Buffer %","number"],
  ["mvr","Min Volume Ratio","number"],
  ["mc","Min Confirmations","number"]
];

for (const d of defs) {

  const label = document.createElement("label");
  label.textContent = d[1];

  const input = document.createElement(
    d[2] === "select" ? "select" : "input"
  );

  input.id = d[0];

  if (d[2] === "number") {
    input.type = "number";
  }

  if (d[0] === "rr") {
    input.step = "0.1";
  }

  if (d[0] === "slb") {
    input.step = "0.05";
  }

  if (d[0] === "mvr") {
    input.step = "0.1";
  }

  if (d[2] === "select") {

    TF.forEach(t => {

      const option = document.createElement("option");

      option.value = t;
      option.textContent = t;

      input.appendChild(option);
    });
  }

  label.appendChild(input);

  $("settings").appendChild(label);
}


/* ============================================================
   SETTINGS
============================================================ */

function fill(s) {

  if (!s) return;

  $("wave_tf").value = s.wave_tf ?? "15m";
  $("tide_tf").value = s.tide_tf ?? "1h";

  ["we1","we2","we3"].forEach((id,i) => {
    $(id).value = s.wave_ema?.[i] ?? "";
  });

  ["te1","te2","te3"].forEach((id,i) => {
    $(id).value = s.tide_ema?.[i] ?? "";
  });

  ["fe1","fe2"].forEach((id,i) => {
    $(id).value = s.tide_filter_ema?.[i] ?? "";
  });

  $("rp").value = s.rsi_period ?? "";
  $("rb").value = s.rsi_buy ?? "";
  $("rs").value = s.rsi_sell ?? "";

  $("mf").value = s.macd_fast ?? "";
  $("ms").value = s.macd_slow ?? "";
  $("mg").value = s.macd_signal ?? "";

  $("sp").value = s.stoch_period ?? "";
  $("sk").value = s.stoch_k ?? "";
  $("sd").value = s.stoch_d ?? "";

  $("vs").value = s.volume_sma ?? "";

  $("bs").value = s.buy_score ?? "";
  $("ss").value = s.sell_score ?? "";

  $("srl").value = s.sr_lookback ?? "";
  $("srp").value = s.sr_pivot ?? "";

  $("rr").value = s.min_rr ?? "";
  $("slb").value = s.sl_buffer_pct ?? "";
  $("mvr").value = s.min_volume_ratio ?? "";
  $("mc").value = s.min_signal_confirmations ?? "";
}


const n = id => Number($(id).value);


/* ============================================================
   SAVE SETTINGS
============================================================ */

async function save() {

  const s = {

    wave_tf: $("wave_tf").value,
    tide_tf: $("tide_tf").value,

    wave_ema: [
      n("we1"),
      n("we2"),
      n("we3")
    ],

    tide_ema: [
      n("te1"),
      n("te2"),
      n("te3")
    ],

    tide_filter_ema: [
      n("fe1"),
      n("fe2")
    ],

    rsi_period: n("rp"),
    rsi_buy: n("rb"),
    rsi_sell: n("rs"),

    macd_fast: n("mf"),
    macd_slow: n("ms"),
    macd_signal: n("mg"),

    stoch_period: n("sp"),
    stoch_k: n("sk"),
    stoch_d: n("sd"),

    volume_sma: n("vs"),

    buy_score: n("bs"),
    sell_score: n("ss"),

    sr_lookback: n("srl"),
    sr_pivot: n("srp"),

    min_rr: n("rr"),
    sl_buffer_pct: n("slb"),
    min_volume_ratio: n("mvr"),
    min_signal_confirmations: n("mc")
  };

  try {

    const r = await fetch(
      "/api/settings",
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(s)
      }
    );

    const j = await r.json();

    if (!r.ok) {
      throw new Error(
        j.error || "Server rejected settings"
      );
    }

    fill(j.settings);

    $("msg").textContent =
      "✅ Saved. New scan started.";

    setTimeout(() => {
      $("msg").textContent = "";
    }, 3000);

  } catch (e) {

    console.error(e);

    $("msg").textContent =
      "❌ Save failed: " + e.message;
  }
}


/* ============================================================
   FORMATTING
============================================================ */

function f(x, d = 6) {

  if (
    x === null ||
    x === undefined ||
    x === "" ||
    !Number.isFinite(Number(x))
  ) {
    return "—";
  }

  const v = Number(x);

  if (v === 0) {
    return "—";
  }

  return v.toLocaleString(
    undefined,
    {
      maximumFractionDigits: d
    }
  );
}


function fPrice(x) {

  if (
    x === null ||
    x === undefined ||
    !Number.isFinite(Number(x))
  ) {
    return "—";
  }

  const v = Number(x);

  if (v === 0) {
    return "—";
  }

  return v.toLocaleString(
    undefined,
    {
      maximumFractionDigits: 10
    }
  );
}


function fPct(x) {

  if (
    x === null ||
    x === undefined ||
    !Number.isFinite(Number(x))
  ) {
    return "—";
  }

  return (
    Number(x).toLocaleString(
      undefined,
      {
        maximumFractionDigits: 2
      }
    ) + "%"
  );
}


function sigClass(s) {

  if (s === "BUY") return "buy";

  if (s === "SELL") return "sell";

  return "neutral";
}


function signalEmoji(s) {

  if (s === "BUY") return "🟢";

  if (s === "SELL") return "🔴";

  return "⚪";
}


function haText(ha) {

  if (!ha) return "—";

  if (ha.bull) {
    return "▲ Bull";
  }

  if (ha.bear) {
    return "▼ Bear";
  }

  return "—";
}


/* ============================================================
   SEARCH / FILTER
============================================================ */

let currentFilter = "ALL";
let currentSearch = "";


function setFilter(filter) {

  currentFilter = filter;

  document.querySelectorAll(
    ".signal-filter"
  ).forEach(btn => {

    btn.classList.toggle(
      "active",
      btn.dataset.filter === filter
    );

  });

  renderLast();
}


function applySearch(value) {

  currentSearch =
    String(value || "")
      .trim()
      .toUpperCase();

  renderLast();
}


/* ============================================================
   SAFE S/R
============================================================ */

function safeSR(value) {

  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(Number(value))
  ) {
    return null;
  }

  const v = Number(value);

  if (v <= 0) {
    return null;
  }

  return v;
}


/* ============================================================
   RENDER
============================================================ */

let lastJSON = null;


function render(j) {

  if (!j) return;

  lastJSON = j;

  const status = j.status || {};
  const settings = j.settings || {};
  const allMarkets = Array.isArray(j.markets)
    ? j.markets
    : [];

  $("coins").textContent =
    status.coins ?? allMarkets.length;

  $("scan").textContent =
    status.last_scan
      ? new Date(
          status.last_scan * 1000
        ).toLocaleTimeString()
      : "—";

  $("wave").textContent =
    settings.wave_tf || "—";

  $("tide").textContent =
    settings.tide_tf || "—";

  $("dot").className =
    "dot " +
    (
      status.ws_connected
        ? "ok"
        : ""
    );

  $("st").textContent =
    status.ws_connected
      ? "Delta WS connected"
      : "Reconnecting";

  renderMarkets(
    allMarkets,
    settings
  );
}


/* ============================================================
   MARKET TABLE
============================================================ */

function renderMarkets(
  marketsList,
  settings
) {

  let rows = [
    ...marketsList
  ];

  /* Search */

  if (currentSearch) {

    rows = rows.filter(m =>
      String(
        m.symbol || ""
      )
      .toUpperCase()
      .includes(currentSearch)
    );
  }


  /* Signal filter */

  if (currentFilter !== "ALL") {

    rows = rows.filter(m => {

      const signal =
        m.indicators?.signal ||
        "NEUTRAL";

      return signal === currentFilter;
    });
  }


  /* Score sorting */

  rows.sort(
    (a,b) =>
      (
        b.indicators?.score ?? -1
      )
      -
      (
        a.indicators?.score ?? -1
      )
  );


  $("rows").innerHTML =
    rows.map(
      (m,i) => {

        const x =
          m.indicators || {};

        const w =
          x.wave || {};

        const t =
          x.tide || {};

        const ha =
          x.ha || {};

        const sr =
          x.sr || {};

        const p =
          x.plan || {};

        const signal =
          x.signal || "NEUTRAL";


        /* ----------------------------------------------------
           IMPORTANT FIX:
           MACD/STOCHASTIC ARE INSIDE x.wave
        ---------------------------------------------------- */

        const macdValue =
          w.macd;

        const macdSignal =
          w.macd_signal;

        const stochK =
          w.stoch_k;

        const stochD =
          w.stoch_d;


        /* ----------------------------------------------------
           Confirmations
        ---------------------------------------------------- */

        const conf =
          signal === "BUY"
            ? (
                x.buy_confirmations ?? 0
              )
            : signal === "SELL"
              ? (
                  x.sell_confirmations ?? 0
                )
              : Math.max(
                  x.buy_confirmations ?? 0,
                  x.sell_confirmations ?? 0
                );


        /* ----------------------------------------------------
           S/R
        ---------------------------------------------------- */

        const s1 = safeSR(sr.s1);
        const s2 = safeSR(sr.s2);
        const r1 = safeSR(sr.r1);
        const r2 = safeSR(sr.r2);


        /* ----------------------------------------------------
           Trade plan
        ---------------------------------------------------- */

        const hasPlan =
          signal === "BUY" ||
          signal === "SELL";


        const rr =
          hasPlan &&
          Number.isFinite(
            Number(p.rr)
          )
            ? Number(p.rr)
            : null;


        return `
          <tr>

            <td>${i + 1}</td>

            <td>
              <b>${m.symbol || "—"}</b>
            </td>

            <td>
              ${fPrice(m.price)}
            </td>

            <td>
              ${fPct(m.change)}
            </td>

            <td>
              ${f(m.volume,0)}
            </td>

            <td>
              ${m.volume_rank ?? "—"}
            </td>

            <td>
              ${f(m.oi,0)}
            </td>

            <td>
              ${settings.wave_tf || "—"}
            </td>

            <td>
              ${settings.tide_tf || "—"}
            </td>

            <td>
              ${f(x.tide9,8)}
            </td>

            <td>
              ${f(x.tide20,8)}
            </td>

            <td>
              ${f(w.rsi,2)}
            </td>

            <td>
              ${f(macdValue,8)}
              /
              ${f(macdSignal,8)}
            </td>

            <td>
              ${f(stochK,2)}
              /
              ${f(stochD,2)}
            </td>

            <td>
              <b>${x.score ?? "—"}</b>
            </td>

            <td>
              ${x.score_rank ?? "—"}
            </td>

            <td class="${sigClass(signal)}">
              <b>
                ${signalEmoji(signal)}
                ${signal}
              </b>
            </td>

            <td>
              <b>${conf}/8</b>
            </td>

            <td>
              ${haText(ha)}
            </td>

            <td>
              ${fPrice(s2)}
            </td>

            <td>
              ${fPrice(s1)}
            </td>

            <td>
              ${fPrice(r1)}
            </td>

            <td>
              ${fPrice(r2)}
            </td>

            <td>
              ${hasPlan ? fPrice(p.entry) : "—"}
            </td>

            <td>
              ${hasPlan ? fPrice(p.sl) : "—"}
            </td>

            <td>
              ${hasPlan ? fPrice(p.tp1) : "—"}
            </td>

            <td>
              ${hasPlan ? fPrice(p.tp2) : "—"}
            </td>

            <td>
              ${
                rr !== null
                  ? "1:" + rr.toFixed(2)
                  : "—"
              }
            </td>

          </tr>
        `;
      }
    ).join("");


  if (!rows.length) {

    $("rows").innerHTML = `
      <tr>
        <td
          colspan="28"
          style="
            text-align:center;
            padding:30px;
            color:#8da0ae;
          "
        >
          No markets match the current filter.
        </td>
      </tr>
    `;
  }
}


function renderLast() {

  if (!lastJSON) return;

  renderMarkets(
    Array.isArray(lastJSON.markets)
      ? lastJSON.markets
      : [],
    lastJSON.settings || {}
  );
}


/* ============================================================
   INITIAL STATUS
============================================================ */

async function loadInitial() {

  try {

    const r =
      await fetch(
        "/api/status",
        {
          cache: "no-store"
        }
      );

    const j =
      await r.json();

    fill(j.settings);

    render(j);

  } catch (e) {

    console.error(
      "Initial status error:",
      e
    );

    $("st").textContent =
      "API connection failed";
  }
}


/* ============================================================
   WEBSOCKET
============================================================ */

function connect() {

  const protocol =
    location.protocol === "https:"
      ? "wss"
      : "ws";

  const ws =
    new WebSocket(
      protocol +
      "://" +
      location.host +
      "/ws"
    );


  ws.onopen = () => {

    $("st").textContent =
      "Delta WS connected";

    $("dot").className =
      "dot ok";
  };


  ws.onmessage = event => {

    try {

      const j =
        JSON.parse(
          event.data
        );

      render(j);

    } catch (e) {

      console.error(
        "WS JSON error:",
        e
      );
    }
  };


  ws.onerror = () => {

    try {
      ws.close();
    } catch (_) {}

  };


  ws.onclose = () => {

    $("dot").className =
      "dot";

    $("st").textContent =
      "Reconnecting...";

    setTimeout(
      connect,
      3000
    );
  };
}


/* ============================================================
   START
============================================================ */

loadInitial();

connect();
