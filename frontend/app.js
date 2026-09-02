/* ============================================================
   DELTA CLOUD SCANNER V3
   PROFESSIONAL FRONTEND
   ------------------------------------------------------------
   Scanner logic is NOT changed here.
   This file only handles:
   - Settings UI
   - API communication
   - WebSocket updates
   - Table rendering
   - Professional UI styling
   ============================================================ */

const $ = id => document.getElementById(id);

/* ============================================================
   TIMEFRAME OPTIONS
   ============================================================ */

const TF = [
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "6h",
  "12h",
  "1d",
  "1w",
  "1M"
];

/* ============================================================
   SETTINGS DEFINITIONS
   ============================================================ */

const defs = [
  ["wave_tf", "Wave TF", "select"],
  ["tide_tf", "Tide TF", "select"],

  ["we1", "Wave EMA 1", "number"],
  ["we2", "Wave EMA 2", "number"],
  ["we3", "Wave EMA 3", "number"],

  ["te1", "Tide EMA 1", "number"],
  ["te2", "Tide EMA 2", "number"],
  ["te3", "Tide EMA 3", "number"],

  ["fe1", "Tide Filter EMA 1", "number"],
  ["fe2", "Tide Filter EMA 2", "number"],

  ["rp", "RSI Period", "number"],
  ["rb", "RSI BUY", "number"],
  ["rs", "RSI SELL", "number"],

  ["mf", "MACD Fast", "number"],
  ["ms", "MACD Slow", "number"],
  ["mg", "MACD Signal", "number"],

  ["sp", "Stoch Period", "number"],
  ["sk", "Stoch K Smooth", "number"],
  ["sd", "Stoch D Smooth", "number"],

  ["vs", "Volume SMA", "number"],

  ["bs", "BUY Score", "number"],
  ["ss", "SELL Score", "number"],

  ["srl", "S/R Lookback", "number"],
  ["srp", "S/R Pivot", "number"],

  ["rr", "Minimum R:R", "number"],
  ["slb", "SL Buffer %", "number"],
  ["mvr", "Min Volume Ratio", "number"],
  ["mc", "Min Confirmations", "number"]
];

/* ============================================================
   BUILD SETTINGS FORM
   ============================================================ */

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
    input.step = ".1";
  }

  if (d[0] === "slb") {
    input.step = ".05";
  }

  if (d[0] === "mvr") {
    input.step = ".1";
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
   PROFESSIONAL UI
   ============================================================ */

function applyProfessionalUI() {

  if (document.getElementById("professional-scanner-ui")) {
    return;
  }

  const style = document.createElement("style");

  style.id = "professional-scanner-ui";

  style.textContent = `

    /* ========================================================
       GLOBAL
       ======================================================== */

    * {
      box-sizing: border-box;
    }

    body {
      background:
        radial-gradient(
          circle at top left,
          rgba(0, 255, 170, 0.055),
          transparent 30%
        ),
        radial-gradient(
          circle at top right,
          rgba(80, 120, 255, 0.055),
          transparent 30%
        ),
        #070b12;

      color: #e7edf5;
      font-family:
        Inter,
        system-ui,
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif;

      margin: 0;
    }

    /* ========================================================
       MAIN CONTAINER
       ======================================================== */

    body > div,
    .container,
    .app,
    main {
      max-width: 1800px;
    }

    /* ========================================================
       HEADINGS
       ======================================================== */

    h1 {
      font-weight: 800;
      letter-spacing: -0.5px;
    }

    h2,
    h3 {
      font-weight: 700;
    }

    /* ========================================================
       CARDS
       ======================================================== */

    .card,
    .panel,
    section,
    .settings-panel {

      background:
        linear-gradient(
          145deg,
          rgba(18, 25, 36, 0.96),
          rgba(9, 14, 22, 0.96)
        );

      border: 1px solid rgba(255,255,255,0.07);

      border-radius: 14px;

      box-shadow:
        0 12px 35px rgba(0,0,0,0.22),
        inset 0 1px 0 rgba(255,255,255,0.025);
    }

    /* ========================================================
       SETTINGS
       ======================================================== */

    #settings {

      display: grid;

      grid-template-columns:
        repeat(auto-fit, minmax(145px, 1fr));

      gap: 10px;

      margin-top: 12px;
      margin-bottom: 18px;
    }

    #settings label {

      display: flex;

      flex-direction: column;

      gap: 6px;

      padding: 9px 10px;

      background: rgba(255,255,255,0.025);

      border:
        1px solid rgba(255,255,255,0.055);

      border-radius: 10px;

      color: #9caabd;

      font-size: 11px;

      font-weight: 600;

      transition: 0.2s ease;
    }

    #settings label:hover {

      border-color:
        rgba(0, 220, 160, 0.25);

      background:
        rgba(0, 220, 160, 0.035);
    }

    #settings input,
    #settings select {

      width: 100%;

      background: #0c131d;

      color: #edf4fb;

      border:
        1px solid rgba(255,255,255,0.09);

      border-radius: 7px;

      padding: 7px 8px;

      outline: none;

      font-size: 12px;

      font-weight: 600;
    }

    #settings input:focus,
    #settings select:focus {

      border-color:
        rgba(0, 220, 160, 0.65);

      box-shadow:
        0 0 0 2px
        rgba(0, 220, 160, 0.08);
    }

    /* ========================================================
       STATUS
       ======================================================== */

    .dot {

      display: inline-block;

      width: 9px;
      height: 9px;

      border-radius: 50%;

      background: #64748b;

      margin-right: 7px;

      box-shadow: 0 0 0 transparent;
    }

    .dot.ok {

      background: #00e6a0;

      box-shadow:
        0 0 8px
        rgba(0,230,160,0.8);
    }

    /* ========================================================
       TABLE WRAPPER
       ======================================================== */

    .table-wrap {

      width: 100%;

      overflow-x: auto;

      border-radius: 14px;

      border:
        1px solid rgba(255,255,255,0.07);

      background: #080d14;

      box-shadow:
        0 14px 40px rgba(0,0,0,0.25);
    }

    /* ========================================================
       TABLE
       ======================================================== */

    table {

      width: 100%;

      min-width: 1900px;

      border-collapse: separate;

      border-spacing: 0;

      font-size: 12px;
    }

    thead th {

      position: sticky;

      top: 0;

      z-index: 5;

      background:
        linear-gradient(
          180deg,
          #131c28,
          #0d151f
        );

      color: #9eafc3;

      font-size: 10px;

      font-weight: 800;

      text-transform: uppercase;

      letter-spacing: .45px;

      white-space: nowrap;

      padding: 11px 10px;

      border-bottom:
        1px solid rgba(255,255,255,0.08);
    }

    tbody td {

      padding: 10px 9px;

      border-bottom:
        1px solid rgba(255,255,255,0.035);

      white-space: nowrap;

      color: #dbe4ee;

      font-variant-numeric: tabular-nums;
    }

    tbody tr {

      transition:
        background 0.16s ease,
        transform 0.16s ease;
    }

    tbody tr:hover {

      background:
        rgba(255,255,255,0.035);
    }

    tbody tr:last-child td {

      border-bottom: none;
    }

    /* ========================================================
       COIN NAME
       ======================================================== */

    .coin-name {

      color: #ffffff;

      font-weight: 800;

      letter-spacing: .2px;
    }

    /* ========================================================
       POSITIVE / NEGATIVE
       ======================================================== */

    .positive {

      color: #00e6a0 !important;

      font-weight: 800;
    }

    .negative {

      color: #ff5577 !important;

      font-weight: 800;
    }

    .neutral-value {

      color: #9aa8b8 !important;
    }

    /* ========================================================
       SIGNAL BADGES
       ======================================================== */

    .signal-badge {

      display: inline-flex;

      align-items: center;

      justify-content: center;

      min-width: 74px;

      padding: 5px 10px;

      border-radius: 999px;

      font-size: 10px;

      font-weight: 900;

      letter-spacing: .5px;

      border: 1px solid transparent;
    }

    .signal-buy {

      color: #00f0a8;

      background:
        rgba(0,230,160,0.11);

      border-color:
        rgba(0,230,160,0.28);

      box-shadow:
        0 0 14px
        rgba(0,230,160,0.06);
    }

    .signal-sell {

      color: #ff587b;

      background:
        rgba(255,70,105,0.10);

      border-color:
        rgba(255,70,105,0.28);

      box-shadow:
        0 0 14px
        rgba(255,70,105,0.05);
    }

    .signal-neutral {

      color: #a8b4c3;

      background:
        rgba(148,163,184,0.08);

      border-color:
        rgba(148,163,184,0.18);
    }

    /* ========================================================
       SCORE
       ======================================================== */

    .score {

      display: inline-flex;

      align-items: center;

      justify-content: center;

      min-width: 45px;

      padding: 4px 7px;

      border-radius: 7px;

      font-weight: 900;
    }

    .score-high {

      color: #00edaa;

      background:
        rgba(0,230,160,0.10);

      border:
        1px solid rgba(0,230,160,0.18);
    }

    .score-low {

      color: #ff5b7e;

      background:
        rgba(255,70,105,0.10);

      border:
        1px solid rgba(255,70,105,0.18);
    }

    .score-mid {

      color: #f6c85f;

      background:
        rgba(246,200,95,0.08);

      border:
        1px solid rgba(246,200,95,0.16);
    }

    /* ========================================================
       CONFIRMATION
       ======================================================== */

    .confirmation {

      display: inline-flex;

      align-items: center;

      justify-content: center;

      padding: 4px 7px;

      border-radius: 6px;

      font-weight: 800;

      font-size: 10px;
    }

    .confirmation-strong {

      color: #00e6a0;

      background:
        rgba(0,230,160,0.09);
    }

    .confirmation-medium {

      color: #f4c95d;

      background:
        rgba(244,201,93,0.08);
    }

    .confirmation-low {

      color: #ff627f;

      background:
        rgba(255,98,127,0.08);
    }

    /* ========================================================
       HEIKIN ASHI
       ======================================================== */

    .ha-bull {

      color: #00e6a0;

      font-weight: 900;
    }

    .ha-bear {

      color: #ff5577;

      font-weight: 900;
    }

    /* ========================================================
       INDICATORS
       ======================================================== */

    .indicator-buy {

      color: #00e6a0;

      font-weight: 700;
    }

    .indicator-sell {

      color: #ff5577;

      font-weight: 700;
    }

    .indicator-neutral {

      color: #a4b0bf;
    }

    /* ========================================================
       TRADE PLAN
       ======================================================== */

    .entry {

      color: #70b7ff;

      font-weight: 800;
    }

    .sl {

      color: #ff587b;

      font-weight: 800;
    }

    .tp {

      color: #00e6a0;

      font-weight: 800;
    }

    .rr-value {

      color: #f4c95d;

      font-weight: 900;
    }

    /* ========================================================
       S/R
       ======================================================== */

    .support {

      color: #78d9bb;

      font-weight: 650;
    }

    .resistance {

      color: #ff9aae;

      font-weight: 650;
    }

    /* ========================================================
       BUTTONS
       ======================================================== */

    button {

      border: 1px solid
        rgba(0,230,160,0.25);

      background:
        linear-gradient(
          135deg,
          rgba(0,230,160,0.13),
          rgba(0,150,255,0.08)
        );

      color: #eafff8;

      border-radius: 9px;

      padding: 9px 15px;

      font-weight: 800;

      cursor: pointer;

      transition: .18s ease;
    }

    button:hover {

      transform: translateY(-1px);

      border-color:
        rgba(0,230,160,0.5);

      box-shadow:
        0 8px 22px
        rgba(0,230,160,0.08);
    }

    button:active {

      transform: translateY(0);
    }

    /* ========================================================
       STATUS TEXT
       ======================================================== */

    #msg {

      color: #00e6a0;

      font-weight: 700;

      font-size: 12px;
    }

    /* ========================================================
       RESPONSIVE
       ======================================================== */

    @media (max-width: 900px) {

      #settings {

        grid-template-columns:
          repeat(2, minmax(130px, 1fr));
      }

      table {

        font-size: 11px;
      }
    }

    @media (max-width: 600px) {

      #settings {

        grid-template-columns: 1fr;
      }
    }

  `;

  document.head.appendChild(style);
}

applyProfessionalUI();

/* ============================================================
   SETTINGS FILL
   ============================================================ */

function fill(s) {

  if (!s) return;

  $("wave_tf").value = s.wave_tf;
  $("tide_tf").value = s.tide_tf;

  ["we1", "we2", "we3"].forEach((x, i) => {
    $(x).value = s.wave_ema[i];
  });

  ["te1", "te2", "te3"].forEach((x, i) => {
    $(x).value = s.tide_ema[i];
  });

  ["fe1", "fe2"].forEach((x, i) => {
    $(x).value = s.tide_filter_ema[i];
  });

  $("rp").value = s.rsi_period;
  $("rb").value = s.rsi_buy;
  $("rs").value = s.rsi_sell;

  $("mf").value = s.macd_fast;
  $("ms").value = s.macd_slow;
  $("mg").value = s.macd_signal;

  $("sp").value = s.stoch_period;
  $("sk").value = s.stoch_k;
  $("sd").value = s.stoch_d;

  $("vs").value = s.volume_sma;

  $("bs").value = s.buy_score;
  $("ss").value = s.sell_score;

  $("srl").value = s.sr_lookback;
  $("srp").value = s.sr_pivot;

  $("rr").value = s.min_rr;
  $("slb").value = s.sl_buffer_pct;

  $("mvr").value = s.min_volume_ratio;
  $("mc").value = s.min_signal_confirmations;
}

/* ============================================================
   NUMBER HELPER
   ============================================================ */

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

    fill(j.settings);

    $("msg").textContent =
      "✓ Saved. New scan started.";

    setTimeout(() => {
      $("msg").textContent = "";
    }, 3000);

  } catch (e) {

    $("msg").textContent =
      "Save failed: " + e;
  }
}

/* ============================================================
   NUMBER FORMATTER
   ============================================================ */

function f(x, d = 6) {

  if (
    x === null ||
    x === undefined ||
    x === "" ||
    Number.isNaN(Number(x))
  ) {
    return "—";
  }

  return Number(x).toLocaleString(
    undefined,
    {
      maximumFractionDigits: d
    }
  );
}

/* ============================================================
   PERCENT FORMATTER
   ============================================================ */

function formatChange(x) {

  if (
    x === null ||
    x === undefined ||
    Number.isNaN(Number(x))
  ) {
    return "—";
  }

  const v = Number(x);

  if (v > 0) {

    return `
      <span class="positive">
        ▲ ${f(v, 2)}%
      </span>
    `;
  }

  if (v < 0) {

    return `
      <span class="negative">
        ▼ ${f(Math.abs(v), 2)}%
      </span>
    `;
  }

  return `
    <span class="neutral-value">
      ${f(v, 2)}%
    </span>
  `;
}

/* ============================================================
   SIGNAL CLASS
   ============================================================ */

function sigClass(s) {

  if (s === "BUY") {
    return "signal-buy";
  }

  if (s === "SELL") {
    return "signal-sell";
  }

  return "signal-neutral";
}

/* ============================================================
   SIGNAL BADGE
   ============================================================ */

function signalBadge(s) {

  const value = s || "NEUTRAL";

  let icon = "•";

  if (value === "BUY") {
    icon = "▲";
  }

  if (value === "SELL") {
    icon = "▼";
  }

  return `
    <span class="signal-badge ${sigClass(value)}">
      ${icon}&nbsp; ${value}
    </span>
  `;
}

/* ============================================================
   SCORE BADGE
   ============================================================ */

function scoreBadge(score) {

  if (
    score === null ||
    score === undefined ||
    Number.isNaN(Number(score))
  ) {
    return "—";
  }

  const value = Number(score);

  let cls = "score-mid";

  if (value >= 70) {
    cls = "score-high";
  } else if (value <= 30) {
    cls = "score-low";
  }

  return `
    <span class="score ${cls}">
      ${f(value, 0)}
    </span>
  `;
}

/* ============================================================
   CONFIRMATION BADGE
   ============================================================ */

function confirmationBadge(conf) {

  if (
    conf === null ||
    conf === undefined ||
    Number.isNaN(Number(conf))
  ) {
    return "—";
  }

  const value = Number(conf);

  let cls = "confirmation-low";

  if (value >= 7) {

    cls = "confirmation-strong";

  } else if (value >= 5) {

    cls = "confirmation-medium";
  }

  return `
    <span class="confirmation ${cls}">
      ${value}/8
    </span>
  `;
}

/* ============================================================
   INDICATOR VALUE COLOR
   ============================================================ */

function coloredIndicator(value, type) {

  if (
    value === null ||
    value === undefined ||
    Number.isNaN(Number(value))
  ) {
    return "—";
  }

  const v = Number(value);

  if (type === "rsi") {

    if (v >= 50) {

      return `
        <span class="indicator-buy">
          ${f(v, 2)}
        </span>
      `;
    }

    return `
      <span class="indicator-sell">
        ${f(v, 2)}
      </span>
    `;
  }

  return f(v, 6);
}

/* ============================================================
   MACD DISPLAY
   ============================================================ */

function macdDisplay(w) {

  const macd = w?.macd;
  const signal = w?.macd_signal;

  if (
    macd === null ||
    macd === undefined ||
    signal === null ||
    signal === undefined
  ) {
    return "—";
  }

  const cls =
    Number(macd) >= Number(signal)
      ? "indicator-buy"
      : "indicator-sell";

  return `
    <span class="${cls}">
      ${f(macd, 6)}
    </span>
  `;
}

/* ============================================================
   STOCH DISPLAY
   ============================================================ */

function stochDisplay(w) {

  const k = w?.stoch_k;
  const d = w?.stoch_d;

  if (
    k === null ||
    k === undefined ||
    d === null ||
    d === undefined
  ) {
    return "—";
  }

  const cls =
    Number(k) >= Number(d)
      ? "indicator-buy"
      : "indicator-sell";

  return `
    <span class="${cls}">
      ${f(k, 1)} / ${f(d, 1)}
    </span>
  `;
}

/* ============================================================
   HEIKIN ASHI DISPLAY
   ============================================================ */

function haDisplay(ha) {

  if (!ha) {
    return "—";
  }

  if (ha.bull) {

    return `
      <span class="ha-bull">
        🟢 Bull
      </span>
    `;
  }

  if (ha.bear) {

    return `
      <span class="ha-bear">
        🔴 Bear
      </span>
    `;
  }

  return "—";
}

/* ============================================================
   SAFE S/R
   ------------------------------------------------------------
   UI ONLY:
   Does not modify scanner calculations.
   It prevents invalid zero values from being displayed.
   ============================================================ */

function safeSR(value) {

  if (
    value === null ||
    value === undefined ||
    value === "" ||
    Number.isNaN(Number(value)) ||
    Number(value) <= 0
  ) {
    return "—";
  }

  return f(value, 8);
}

/* ============================================================
   TRADE PLAN DISPLAY
   ============================================================ */

function planValue(value, cls) {

  if (
    value === null ||
    value === undefined ||
    value === "" ||
    Number.isNaN(Number(value))
  ) {
    return "—";
  }

  return `
    <span class="${cls}">
      ${f(value, 8)}
    </span>
  `;
}

/* ============================================================
   R:R DISPLAY
   ============================================================ */

function rrDisplay(value) {

  if (
    value === null ||
    value === undefined ||
    Number.isNaN(Number(value))
  ) {
    return "—";
  }

  return `
    <span class="rr-value">
      1:${f(value, 2)}
    </span>
  `;
}

/* ============================================================
   MAIN RENDER
   ============================================================ */

function render(j) {

  if (!j) {
    return;
  }

  /* ----------------------------------------------------------
     STATUS
     ---------------------------------------------------------- */

  if (j.status) {

    if ($("coins")) {
      $("coins").textContent =
        j.status.coins ?? "—";
    }

    if ($("scan")) {

      $("scan").textContent =
        j.status.last_scan
          ? new Date(
              j.status.last_scan * 1000
            ).toLocaleTimeString()
          : "—";
    }

    if ($("dot")) {

      $("dot").className =
        "dot " +
        (j.status.ws_connected ? "ok" : "");
    }

    if ($("st")) {

      $("st").textContent =
        j.status.ws_connected
          ? "Delta WS connected"
          : "Reconnecting";
    }
  }

  /* ----------------------------------------------------------
     TIMEFRAMES
     ---------------------------------------------------------- */

  if (j.settings) {

    if ($("wave")) {
      $("wave").textContent =
        j.settings.wave_tf;
    }

    if ($("tide")) {
      $("tide").textContent =
        j.settings.tide_tf;
    }
  }

  /* ----------------------------------------------------------
     MARKET DATA
     ---------------------------------------------------------- */

  const markets =
    Array.isArray(j.markets)
      ? j.markets
      : [];

  /* ----------------------------------------------------------
     SORT
     ----------------------------------------------------------
     Same sorting logic:
     score descending.
     ---------------------------------------------------------- */

  const a = [...markets].sort(
    (x, y) =>
      (y.indicators?.score ?? -1) -
      (x.indicators?.score ?? -1)
  );

  /* ----------------------------------------------------------
     EMPTY STATE
     ---------------------------------------------------------- */

  if (!a.length) {

    $("rows").innerHTML = `
      <tr>
        <td
          colspan="29"
          style="
            text-align:center;
            padding:35px;
            color:#8795a8;
          "
        >
          Waiting for scanner data...
        </td>
      </tr>
    `;

    return;
  }

  /* ----------------------------------------------------------
     BUILD TABLE
     ---------------------------------------------------------- */

  $("rows").innerHTML = a.map((m, i) => {

    const x =
      m.indicators || {};

    const w =
      x.wave || {};

    const ha =
      x.ha || {};

    const sr =
      x.sr || {};

    const p =
      x.plan || {};

    const s =
      x.signal || "NEUTRAL";

    /* --------------------------------------------------------
       CONFIRMATIONS
       -------------------------------------------------------- */

    const conf =
      s === "BUY"
        ? (x.buy_confirmations ?? 0)
        : s === "SELL"
          ? (x.sell_confirmations ?? 0)
          : Math.max(
              x.buy_confirmations || 0,
              x.sell_confirmations || 0
            );

    /* --------------------------------------------------------
       VOLUME
       -------------------------------------------------------- */

    const volume =
      f(m.volume, 0);

    /* --------------------------------------------------------
       OI
       -------------------------------------------------------- */

    const oi =
      f(m.oi, 0);

    /* --------------------------------------------------------
       RSI
       -------------------------------------------------------- */

    const rsi =
      coloredIndicator(
        w.rsi,
        "rsi"
      );

    /* --------------------------------------------------------
       MACD
       --------------------------------------------------------
       Correct backend path:
       x.wave.macd
       x.wave.macd_signal
       -------------------------------------------------------- */

    const macd =
      macdDisplay(w);

    /* --------------------------------------------------------
       STOCHASTIC
       --------------------------------------------------------
       Correct backend path:
       x.wave.stoch_k
       x.wave.stoch_d
       -------------------------------------------------------- */

    const stoch =
      stochDisplay(w);

    /* --------------------------------------------------------
       S/R
       -------------------------------------------------------- */

    const s2 =
      safeSR(sr.s2);

    const s1 =
      safeSR(sr.s1);

    const r1 =
      safeSR(sr.r1);

    const r2 =
      safeSR(sr.r2);

    /* --------------------------------------------------------
       TRADE PLAN
       -------------------------------------------------------- */

    const entry =
      s !== "NEUTRAL"
        ? planValue(p.entry, "entry")
        : "—";

    const sl =
      s !== "NEUTRAL"
        ? planValue(p.sl, "sl")
        : "—";

    const tp1 =
      s !== "NEUTRAL"
        ? planValue(p.tp1, "tp")
        : "—";

    const tp2 =
      s !== "NEUTRAL"
        ? planValue(p.tp2, "tp")
        : "—";

    const rr =
      s !== "NEUTRAL"
        ? rrDisplay(p.rr)
        : "—";

    /* --------------------------------------------------------
       ROW
       -------------------------------------------------------- */

    return `

      <tr>

        <!-- Rank -->

        <td>
          <strong>${i + 1}</strong>
        </td>

        <!-- Coin -->

        <td>
          <span class="coin-name">
            ${m.symbol ?? "—"}
          </span>
        </td>

        <!-- Price -->

        <td>
          <strong>
            ${f(m.price, 10)}
          </strong>
        </td>

        <!-- 24H CHANGE -->

        <td>
          ${formatChange(m.change)}
        </td>

        <!-- Volume -->

        <td>
          ${volume}
        </td>

        <!-- Volume Rank -->

        <td>
          ${m.volume_rank ?? "—"}
        </td>

        <!-- OI -->

        <td>
          ${oi}
        </td>

        <!-- Wave TF -->

        <td>
          ${j.settings?.wave_tf ?? "—"}
        </td>

        <!-- Tide TF -->

        <td>
          ${j.settings?.tide_tf ?? "—"}
        </td>

        <!-- Tide EMA 9 -->

        <td>
          ${f(x.tide9, 8)}
        </td>

        <!-- Tide EMA 20 -->

        <td>
          ${f(x.tide20, 8)}
        </td>

        <!-- RSI -->

        <td>
          ${rsi}
        </td>

        <!-- MACD -->

        <td>
          ${macd}
        </td>

        <!-- STOCH -->

        <td>
          ${stoch}
        </td>

        <!-- SCORE -->

        <td>
          ${scoreBadge(x.score)}
        </td>

        <!-- SCORE RANK -->

        <td>
          ${x.score_rank ?? "—"}
        </td>

        <!-- SIGNAL -->

        <td>
          ${signalBadge(s)}
        </td>

        <!-- CONFIRMATIONS -->

        <td>
          ${confirmationBadge(conf)}
        </td>

        <!-- HEIKIN ASHI -->

        <td>
          ${haDisplay(ha)}
        </td>

        <!-- S2 -->

        <td>
          <span class="support">
            ${s2}
          </span>
        </td>

        <!-- S1 -->

        <td>
          <span class="support">
            ${s1}
          </span>
        </td>

        <!-- R1 -->

        <td>
          <span class="resistance">
            ${r1}
          </span>
        </td>

        <!-- R2 -->

        <td>
          <span class="resistance">
            ${r2}
          </span>
        </td>

        <!-- ENTRY -->

        <td>
          ${entry}
        </td>

        <!-- SL -->

        <td>
          ${sl}
        </td>

        <!-- TP1 -->

        <td>
          ${tp1}
        </td>

        <!-- TP2 -->

        <td>
          ${tp2}
        </td>

        <!-- R:R -->

        <td>
          ${rr}
        </td>

      </tr>

    `;

  }).join("");
}

/* ============================================================
   INITIAL API LOAD
   ============================================================ */

async function loadInitial() {

  try {

    const response =
      await fetch("/api/status");

    if (!response.ok) {

      throw new Error(
        `HTTP ${response.status}`
      );
    }

    const data =
      await response.json();

    if (data.settings) {
      fill(data.settings);
    }

    render(data);

  } catch (e) {

    console.error(
      "Initial API load failed:",
      e
    );

    if ($("st")) {

      $("st").textContent =
        "API connection failed";
    }
  }
}

/* ============================================================
   WEBSOCKET CONNECTION
   ============================================================ */

let socket = null;

let reconnectTimer = null;

function connect() {

  try {

    const protocol =
      location.protocol === "https:"
        ? "wss"
        : "ws";

    const url =
      protocol +
      "://" +
      location.host +
      "/ws";

    socket =
      new WebSocket(url);

    socket.onopen = () => {

      console.log(
        "Delta Cloud Scanner WebSocket connected"
      );

      if ($("st")) {

        $("st").textContent =
          "Delta WS connected";
      }

      if ($("dot")) {

        $("dot").className =
          "dot ok";
      }
    };

    socket.onmessage = event => {

      try {

        const data =
          JSON.parse(event.data);

        render(data);

      } catch (e) {

        console.error(
          "WebSocket JSON error:",
          e
        );
      }
    };

    socket.onerror = error => {

      console.error(
        "WebSocket error:",
        error
      );

      if (socket) {
        socket.close();
      }
    };

    socket.onclose = () => {

      console.warn(
        "WebSocket disconnected. Reconnecting..."
      );

      if ($("st")) {

        $("st").textContent =
          "Reconnecting...";
      }

      if ($("dot")) {

        $("dot").className =
          "dot";
      }

      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }

      reconnectTimer =
        setTimeout(
          connect,
          3000
        );
    };

  } catch (e) {

    console.error(
      "WebSocket connection failed:",
      e
    );

    reconnectTimer =
      setTimeout(
        connect,
        3000
      );
  }
}

/* ============================================================
   START APPLICATION
   ============================================================ */

loadInitial();

connect();

/* ============================================================
   OPTIONAL GLOBAL SAVE FUNCTION
   ------------------------------------------------------------
   Keeps compatibility with:
   onclick="save()"
   in index.html
   ============================================================ */

window.save = save;

/* ============================================================
   DEBUG
   ============================================================ */

console.log(
  "%cDelta Cloud Scanner V3",
  "color:#00e6a0;font-size:16px;font-weight:800"
);

console.log(
  "%cProfessional frontend loaded",
  "color:#8fa0b5;font-size:12px"
);
