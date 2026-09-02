"use strict";

/* =========================================================
   DELTA CLOUD SCANNER V3
   FRONTEND
   ========================================================= */

const $ = id => document.getElementById(id);

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

/* =========================================================
   SETTINGS DEFINITIONS
   ========================================================= */

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

/* =========================================================
   APPLICATION STATE
   ========================================================= */

let scannerData = {
  settings: {},
  markets: [],
  status: {}
};

let currentFilter = "ALL";
let searchTerm = "";
let socket = null;
let reconnectTimer = null;
let rendering = false;

/* =========================================================
   BUILD SETTINGS UI
   ========================================================= */

function buildSettings(){

  const container = $("settings");

  if(!container){
    return;
  }

  container.innerHTML = "";

  for(const d of defs){

    const wrapper = document.createElement("div");
    wrapper.className = "setting";

    const label = document.createElement("label");

    label.textContent = d[1];

    const input = document.createElement(
      d[2] === "select"
        ? "select"
        : "input"
    );

    input.id = d[0];

    if(d[2] === "number"){

      input.type = "number";
      input.min = "0";

      if(d[0] === "rr"){
        input.step = "0.1";
      }

      if(d[0] === "slb"){
        input.step = "0.05";
      }

      if(d[0] === "mvr"){
        input.step = "0.1";
      }

    }

    if(d[2] === "select"){

      TF.forEach(t => {

        const option =
          document.createElement("option");

        option.value = t;
        option.textContent = t;

        input.appendChild(option);

      });

    }

    wrapper.appendChild(label);
    wrapper.appendChild(input);

    container.appendChild(wrapper);
  }
}

/* =========================================================
   SETTINGS
   ========================================================= */

function fill(s){

  if(!s){
    return;
  }

  setValue("wave_tf", s.wave_tf);
  setValue("tide_tf", s.tide_tf);

  setArray(
    ["we1","we2","we3"],
    s.wave_ema
  );

  setArray(
    ["te1","te2","te3"],
    s.tide_ema
  );

  setArray(
    ["fe1","fe2"],
    s.tide_filter_ema
  );

  setValue("rp", s.rsi_period);
  setValue("rb", s.rsi_buy);
  setValue("rs", s.rsi_sell);

  setValue("mf", s.macd_fast);
  setValue("ms", s.macd_slow);
  setValue("mg", s.macd_signal);

  setValue("sp", s.stoch_period);
  setValue("sk", s.stoch_k);
  setValue("sd", s.stoch_d);

  setValue("vs", s.volume_sma);

  setValue("bs", s.buy_score);
  setValue("ss", s.sell_score);

  setValue("srl", s.sr_lookback);
  setValue("srp", s.sr_pivot);

  setValue("rr", s.min_rr);
  setValue("slb", s.sl_buffer_pct);
  setValue("mvr", s.min_volume_ratio);
  setValue("mc", s.min_signal_confirmations);
}

function setValue(id,value){

  const el = $(id);

  if(el && value !== undefined && value !== null){
    el.value = value;
  }
}

function setArray(ids,arr){

  if(!Array.isArray(arr)){
    return;
  }

  ids.forEach((id,index) => {

    setValue(
      id,
      arr[index]
    );

  });
}

/* =========================================================
   SAVE SETTINGS
   ========================================================= */

async function save(){

  const button = $("saveButton");

  try{

    const settings = {

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

    validateSettings(settings);

    button.disabled = true;
    button.textContent = "⏳ Saving...";

    const response = await fetch(
      "/api/settings",
      {
        method:"PUT",
        headers:{
          "Content-Type":"application/json"
        },
        body:JSON.stringify(settings)
      }
    );

    if(!response.ok){
      throw new Error(
        "Settings update failed: HTTP " +
        response.status
      );
    }

    const data =
      await response.json();

    scannerData.settings =
      data.settings || settings;

    fill(scannerData.settings);

    showMessage(
      "✅ Settings saved. New scan started."
    );

    updateHeader();

  }catch(error){

    console.error(
      "Settings error:",
      error
    );

    showMessage(
      "❌ Save failed: " +
      error.message
    );

  }finally{

    button.disabled = false;
    button.textContent = "💾 Save & Rescan";

  }
}

/* =========================================================
   VALIDATION
   ========================================================= */

function validateSettings(s){

  const arrays = [
    s.wave_ema,
    s.tide_ema,
    s.tide_filter_ema
  ];

  arrays.forEach(arr => {

    arr.forEach(value => {

      if(
        !Number.isFinite(value) ||
        value < 1
      ){
        throw new Error(
          "EMA values must be positive numbers."
        );
      }

    });

  });

  if(
    s.buy_score < 0 ||
    s.buy_score > 100
  ){
    throw new Error(
      "BUY score must be between 0 and 100."
    );
  }

  if(
    s.sell_score < 0 ||
    s.sell_score > 100
  ){
    throw new Error(
      "SELL score must be between 0 and 100."
    );
  }

  if(
    s.sell_score >= s.buy_score
  ){
    throw new Error(
      "SELL score should be lower than BUY score."
    );
  }

  if(
    s.min_rr <= 0
  ){
    throw new Error(
      "Minimum R:R must be greater than 0."
    );
  }
}

/* =========================================================
   HELPERS
   ========================================================= */

function n(id){

  const value =
    Number(
      $(id).value
    );

  if(
    !Number.isFinite(value) ||
    value < 0
  ){
    throw new Error(
      "All numeric settings must contain valid numbers."
    );
  }

  return value;
}

function f(value, decimals = 6){

  if(
    value === null ||
    value === undefined ||
    value === "" ||
    !Number.isFinite(Number(value))
  ){
    return "—";
  }

  return Number(value)
    .toLocaleString(
      undefined,
      {
        maximumFractionDigits:decimals
      }
    );
}

/*
 * Price formatter.
 * Keeps small crypto prices readable without
 * showing excessive decimal places.
 */

function formatPrice(value){

  const n =
    Number(value);

  if(
    !Number.isFinite(n)
  ){
    return "—";
  }

  const abs =
    Math.abs(n);

  if(abs >= 100000){
    return n.toLocaleString(
      undefined,
      {
        maximumFractionDigits:2
      }
    );
  }

  if(abs >= 1000){
    return n.toLocaleString(
      undefined,
      {
        maximumFractionDigits:3
      }
    );
  }

  if(abs >= 100){
    return n.toFixed(2);
  }

  if(abs >= 10){
    return n.toFixed(3);
  }

  if(abs >= 1){
    return n.toFixed(4);
  }

  if(abs >= 0.1){
    return n.toFixed(5);
  }

  if(abs >= 0.01){
    return n.toFixed(6);
  }

  if(abs >= 0.001){
    return n.toFixed(7);
  }

  return n.toPrecision(6);
}

function formatIndicator(value){

  const n =
    Number(value);

  if(
    !Number.isFinite(n)
  ){
    return "—";
  }

  return n.toFixed(2);
}

function formatCompact(value){

  const n =
    Number(value);

  if(
    !Number.isFinite(n)
  ){
    return "—";
  }

  const abs =
    Math.abs(n);

  if(abs >= 1e12){
    return (n / 1e12).toFixed(2) + "T";
  }

  if(abs >= 1e9){
    return (n / 1e9).toFixed(2) + "B";
  }

  if(abs >= 1e6){
    return (n / 1e6).toFixed(2) + "M";
  }

  if(abs >= 1e3){
    return (n / 1e3).toFixed(2) + "K";
  }

  return n.toFixed(2);
}

function formatRR(value){

  const n =
    Number(value);

  if(
    !Number.isFinite(n) ||
    n <= 0
  ){
    return "—";
  }

  return "1:" +
    n.toFixed(2);
}

function escapeHTML(value){

  return String(
    value ?? ""
  )
  .replace(/&/g,"&amp;")
  .replace(/</g,"&lt;")
  .replace(/>/g,"&gt;")
  .replace(/"/g,"&quot;")
  .replace(/'/g,"&#039;");
}

function safeNumber(value){

  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}

/* =========================================================
   SIGNAL
   ========================================================= */

function getSignal(x){

  const s =
    String(
      x?.signal || "NEUTRAL"
    ).toUpperCase();

  if(
    s === "BUY" ||
    s === "SELL"
  ){
    return s;
  }

  return "NEUTRAL";
}

function signalBadge(signal){

  if(signal === "BUY"){
    return '<span class="signal buy">🟢 BUY</span>';
  }

  if(signal === "SELL"){
    return '<span class="signal sell">🔴 SELL</span>';
  }

  return '<span class="signal neutral">⚪ NEUTRAL</span>';
}

/* =========================================================
   SCORE
   ========================================================= */

function scoreHTML(score){

  const n =
    safeNumber(score);

  if(n === null){
    return '<span class="dash">—</span>';
  }

  let cls = "score-mid";

  if(n >= 70){
    cls = "score-high";
  }

  if(n <= 30){
    cls = "score-low";
  }

  return `
    <span class="score ${cls}">
      ${n.toFixed(0)}
    </span>
  `;
}

/* =========================================================
   HA
   ========================================================= */

function haHTML(ha){

  if(ha?.bull){
    return '<span class="ha-bull">▲ Bull</span>';
  }

  if(ha?.bear){
    return '<span class="ha-bear">▼ Bear</span>';
  }

  return '<span class="dash">—</span>';
}

/* =========================================================
   R:R
   ========================================================= */

function rrHTML(value){

  const n =
    safeNumber(value);

  if(
    n === null ||
    n <= 0
  ){
    return '<span class="dash">—</span>';
  }

  const cls =
    n >= 2
      ? "rr-good"
      : "rr-low";

  return `
    <span class="${cls}">
      1:${n.toFixed(2)}
    </span>
  `;
}

/* =========================================================
   CONFIRMATIONS
   ========================================================= */

function getConfirmations(x,signal){

  if(signal === "BUY"){
    return Number(
      x.buy_confirmations || 0
    );
  }

  if(signal === "SELL"){
    return Number(
      x.sell_confirmations || 0
    );
  }

  return Math.max(
    Number(x.buy_confirmations || 0),
    Number(x.sell_confirmations || 0)
  );
}

/* =========================================================
   TABLE ROW
   ========================================================= */

function makeRow(m,index){

  const x =
    m.indicators || {};

  const w =
    x.wave || {};

  const ha =
    x.ha || {};

  const sr =
    x.sr || {};

  const plan =
    x.plan || {};

  const signal =
    getSignal(x);

  const conf =
    getConfirmations(
      x,
      signal
    );

  const price =
    safeNumber(m.price);

  const change =
    safeNumber(m.change);

  const rr =
    safeNumber(plan.rr);

  const hasPlan =
    signal !== "NEUTRAL" &&
    (
      safeNumber(plan.entry) !== null ||
      safeNumber(plan.sl) !== null ||
      safeNumber(plan.tp1) !== null ||
      safeNumber(plan.tp2) !== null
    );

  const planClass =
    signal === "BUY"
      ? "plan-buy"
      : signal === "SELL"
        ? "plan-sell"
        : "";

  const changeClass =
    change === null
      ? ""
      : change > 0
        ? "positive"
        : change < 0
          ? "negative"
          : "";

  const coin =
    escapeHTML(
      m.symbol || "—"
    );

  return `
    <tr>

      <td>${index + 1}</td>

      <td>
        <span class="coin">${coin}</span>
      </td>

      <td class="price">
        ${formatPrice(price)}
      </td>

      <td class="${changeClass}">
        ${
          change === null
            ? "—"
            : (change > 0 ? "+" : "") +
              change.toFixed(2) +
              "%"
        }
      </td>

      <td>
        ${formatCompact(m.volume)}
      </td>

      <td>
        ${f(m.volume_rank,0)}
      </td>

      <td>
        ${formatCompact(m.oi)}
      </td>

      <td>
        ${escapeHTML(
          scannerData.settings.wave_tf || "—"
        )}
      </td>

      <td>
        ${escapeHTML(
          scannerData.settings.tide_tf || "—"
        )}
      </td>

      <td>
        ${formatPrice(x.tide9)}
      </td>

      <td>
        ${formatPrice(x.tide20)}
      </td>

      <td>
        ${formatIndicator(w.rsi)}
      </td>

      <td>
        ${formatIndicator(x.macd)}
      </td>

      <td>
        ${formatIndicator(x.stoch_k)}
        /
        ${formatIndicator(x.stoch_d)}
      </td>

      <td>
        ${scoreHTML(x.score)}
      </td>

      <td>
        ${f(x.score_rank,0)}
      </td>

      <td>
        ${signalBadge(signal)}
      </td>

      <td>
        <strong>${conf}/8</strong>
      </td>

      <td>
        ${haHTML(ha)}
      </td>

      <td>
        ${formatPrice(sr.s2)}
      </td>

      <td>
        ${formatPrice(sr.s1)}
      </td>

      <td>
        ${formatPrice(sr.r1)}
      </td>

      <td>
        ${formatPrice(sr.r2)}
      </td>

      <td class="${planClass}">
        ${
          hasPlan
            ? formatPrice(plan.entry)
            : "—"
        }
      </td>

      <td class="${planClass}">
        ${
          hasPlan
            ? formatPrice(plan.sl)
            : "—"
        }
      </td>

      <td class="${planClass}">
        ${
          hasPlan
            ? formatPrice(plan.tp1)
            : "—"
        }
      </td>

      <td class="${planClass}">
        ${
          hasPlan
            ? formatPrice(plan.tp2)
            : "—"
        }
      </td>

      <td>
        ${
          hasPlan
            ? rrHTML(rr)
            : '<span class="dash">—</span>'
        }
      </td>

    </tr>
  `;
}

/* =========================================================
   FILTER + SEARCH
   ========================================================= */

function setFilter(filter){

  currentFilter =
    String(filter).toUpperCase();

  updateFilterButtons();

  renderTable();
}

function updateFilterButtons(){

  const buttons = {
    ALL:"filterAll",
    BUY:"filterBuy",
    SELL:"filterSell",
    NEUTRAL:"filterNeutral"
  };

  Object.keys(buttons)
    .forEach(key => {

      const el =
        $(buttons[key]);

      if(!el){
        return;
      }

      el.classList.toggle(
        "active",
        currentFilter === key
      );

    });
}

function applyFilters(markets){

  const term =
    searchTerm
      .trim()
      .toUpperCase();

  return markets.filter(m => {

    const x =
      m.indicators || {};

    const signal =
      getSignal(x);

    const symbol =
      String(
        m.symbol || ""
      ).toUpperCase();

    const matchesSearch =
      !term ||
      symbol.includes(term);

    const matchesSignal =
      currentFilter === "ALL" ||
      signal === currentFilter;

    return (
      matchesSearch &&
      matchesSignal
    );

  });
}

/* =========================================================
   SORT
   ========================================================= */

function sortMarkets(markets){

  return [...markets].sort(
    (a,b) => {

      const sa =
        safeNumber(
          a.indicators?.score
        );

      const sb =
        safeNumber(
          b.indicators?.score
        );

      return (
        (sb ?? -1) -
        (sa ?? -1)
      );

    }
  );
}

/* =========================================================
   RENDER TABLE
   ========================================================= */

function renderTable(){

  if(rendering){
    return;
  }

  rendering = true;

  try{

    const rows =
      $("rows");

    if(!rows){
      return;
    }

    const markets =
      Array.isArray(
        scannerData.markets
      )
        ? scannerData.markets
        : [];

    let filtered =
      applyFilters(markets);

    filtered =
      sortMarkets(filtered);

    if(!filtered.length){

      rows.innerHTML = `
        <tr>
          <td
            colspan="28"
            class="empty">
            No markets match the current filter.
          </td>
        </tr>
      `;

      return;
    }

    rows.innerHTML =
      filtered
        .map(
          (m,i) =>
            makeRow(m,i)
        )
        .join("");

  }finally{

    rendering = false;

  }
}

/* =========================================================
   MAIN RENDER
   ========================================================= */

function render(j){

  if(!j){
    return;
  }

  scannerData =
    j;

  updateHeader();

  renderTable();
}

/* =========================================================
   HEADER
   ========================================================= */

function updateHeader(){

  const status =
    scannerData.status || {};

  const settings =
    scannerData.settings || {};

  if($("coins")){
    $("coins").textContent =
      Number(
        status.coins || 0
      ).toLocaleString();
  }

  if($("scan")){

    $("scan").textContent =
      status.last_scan
        ? new Date(
            status.last_scan * 1000
          ).toLocaleTimeString()
        : "—";
  }

  if($("wave")){
    $("wave").textContent =
      settings.wave_tf || "—";
  }

  if($("tide")){
    $("tide").textContent =
      settings.tide_tf || "—";
  }

  const connected =
    Boolean(
      status.ws_connected
    );

  const dot =
    $("dot");

  if(dot){

    dot.className =
      "dot " +
      (
        connected
          ? "ok"
          : ""
      );

  }

  if($("st")){

    $("st").textContent =
      connected
        ? "Delta WS connected"
        : "Reconnecting...";
  }
}

/* =========================================================
   LOAD INITIAL STATUS
   ========================================================= */

async function loadStatus(){

  try{

    const response =
      await fetch(
        "/api/status",
        {
          cache:"no-store"
        }
      );

    if(!response.ok){

      throw new Error(
        "HTTP " +
        response.status
      );

    }

    const data =
      await response.json();

    fill(data.settings);

    render(data);

  }catch(error){

    console.error(
      "Initial status error:",
      error
    );

    if($("st")){
      $("st").textContent =
        "Backend connection error";
    }

  }
}

/* =========================================================
   WEBSOCKET
   ========================================================= */

function connect(){

  if(socket){

    try{
      socket.close();
    }catch(e){}

  }

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

    if($("st")){
      $("st").textContent =
        "Delta WS connected";
    }

    if($("dot")){
      $("dot").className =
        "dot ok";
    }

  };

  socket.onmessage = event => {

    try{

      const data =
        JSON.parse(
          event.data
        );

      /*
       * Update the state first.
       * Then redraw the table once.
       */

      scannerData =
        data;

      updateHeader();

      renderTable();

    }catch(error){

      console.error(
        "WebSocket JSON error:",
        error
      );

    }

  };

  socket.onerror = error => {

    console.warn(
      "WebSocket error",
      error
    );

    try{
      socket.close();
    }catch(e){}

  };

  socket.onclose = () => {

    if($("st")){
      $("st").textContent =
        "Reconnecting...";
    }

    if($("dot")){
      $("dot").className =
        "dot";
    }

    clearTimeout(
      reconnectTimer
    );

    reconnectTimer =
      setTimeout(
        connect,
        3000
      );

  };
}

/* =========================================================
   SEARCH
   ========================================================= */

function setupSearch(){

  const input =
    $("searchInput");

  if(!input){
    return;
  }

  input.addEventListener(
    "input",
    event => {

      searchTerm =
        event.target.value;

      renderTable();

    }
  );

}

/* =========================================================
   KEYBOARD SHORTCUT
   ========================================================= */

function setupKeyboard(){

  document.addEventListener(
    "keydown",
    event => {

      if(
        event.key === "/" &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "SELECT"
      ){

        event.preventDefault();

        const input =
          $("searchInput");

        if(input){
          input.focus();
        }

      }

      if(
        event.key === "Escape"
      ){

        const input =
          $("searchInput");

        if(input){
          input.value = "";
          searchTerm = "";
          renderTable();
        }

      }

    }
  );

}

/* =========================================================
   MESSAGE
   ========================================================= */

let messageTimer = null;

function showMessage(message){

  const el =
    $("msg");

  if(!el){
    return;
  }

  el.textContent =
    message;

  clearTimeout(
    messageTimer
  );

  messageTimer =
    setTimeout(
      () => {
        el.textContent = "";
      },
      4000
    );

}

/* =========================================================
   START APPLICATION
   ========================================================= */

document.addEventListener(
  "DOMContentLoaded",
  async () => {

    buildSettings();

    setupSearch();

    setupKeyboard();

    updateFilterButtons();

    await loadStatus();

    connect();

  }
);
