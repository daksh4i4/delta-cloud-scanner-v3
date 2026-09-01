const $=id=>document.getElementById(id);
const TF=["1m","3m","5m","15m","30m","1h","2h","4h","6h","12h","1d","1w","1M"];
const defs=[
["wave_tf","Wave TF","select"],["tide_tf","Tide TF","select"],
["we1","Wave EMA 1","number"],["we2","Wave EMA 2","number"],["we3","Wave EMA 3","number"],
["te1","Tide EMA 1","number"],["te2","Tide EMA 2","number"],["te3","Tide EMA 3","number"],
["fe1","Tide Filter EMA 1","number"],["fe2","Tide Filter EMA 2","number"],
["rp","RSI Period","number"],["rb","RSI BUY","number"],["rs","RSI SELL","number"],
["mf","MACD Fast","number"],["ms","MACD Slow","number"],["mg","MACD Signal","number"],
["sp","Stoch Period","number"],["sk","Stoch K Smooth","number"],["sd","Stoch D Smooth","number"],
["vs","Volume SMA","number"],["bs","BUY Score","number"],["ss","SELL Score","number"],
["srl","S/R Lookback","number"],["srp","S/R Pivot","number"],["rr","Minimum R:R","number"],
["slb","SL Buffer %","number"],["mvr","Min Volume Ratio","number"],["mc","Min Confirmations","number"]
];
for(const d of defs){
  const l=document.createElement("label"); l.textContent=d[1];
  const x=document.createElement(d[2]=="select"?"select":"input");
  x.id=d[0]; if(d[2]=="number")x.type="number";
  if(d[0]=="rr")x.step=".1"; if(d[0]=="slb")x.step=".05"; if(d[0]=="mvr")x.step=".1";
  if(d[2]=="select")TF.forEach(t=>{const o=document.createElement("option");o.value=t;o.textContent=t;x.appendChild(o)});
  l.appendChild(x); $("settings").appendChild(l);
}
function fill(s){
 $("wave_tf").value=s.wave_tf;$("tide_tf").value=s.tide_tf;
 ["we1","we2","we3"].forEach((x,i)=>$(x).value=s.wave_ema[i]);
 ["te1","te2","te3"].forEach((x,i)=>$(x).value=s.tide_ema[i]);
 ["fe1","fe2"].forEach((x,i)=>$(x).value=s.tide_filter_ema[i]);
 $("rp").value=s.rsi_period;$("rb").value=s.rsi_buy;$("rs").value=s.rsi_sell;
 $("mf").value=s.macd_fast;$("ms").value=s.macd_slow;$("mg").value=s.macd_signal;
 $("sp").value=s.stoch_period;$("sk").value=s.stoch_k;$("sd").value=s.stoch_d;$("vs").value=s.volume_sma;
 $("bs").value=s.buy_score;$("ss").value=s.sell_score;$("srl").value=s.sr_lookback;$("srp").value=s.sr_pivot;
 $("rr").value=s.min_rr;$("slb").value=s.sl_buffer_pct;$("mvr").value=s.min_volume_ratio;$("mc").value=s.min_signal_confirmations;
}
const n=id=>Number($(id).value);
async function save(){
 const s={wave_tf:$("wave_tf").value,tide_tf:$("tide_tf").value,
 wave_ema:[n("we1"),n("we2"),n("we3")],tide_ema:[n("te1"),n("te2"),n("te3")],tide_filter_ema:[n("fe1"),n("fe2")],
 rsi_period:n("rp"),rsi_buy:n("rb"),rsi_sell:n("rs"),macd_fast:n("mf"),macd_slow:n("ms"),macd_signal:n("mg"),
 stoch_period:n("sp"),stoch_k:n("sk"),stoch_d:n("sd"),volume_sma:n("vs"),buy_score:n("bs"),sell_score:n("ss"),
 sr_lookback:n("srl"),sr_pivot:n("srp"),min_rr:n("rr"),sl_buffer_pct:n("slb"),min_volume_ratio:n("mvr"),min_signal_confirmations:n("mc")};
 try{const r=await fetch("/api/settings",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(s)});const j=await r.json();fill(j.settings);$("msg").textContent="✓ Saved. New scan started.";setTimeout(()=>$("msg").textContent="",3000)}
 catch(e){$("msg").textContent="Save failed: "+e}
}
function f(x,d=6){return x==null?"—":Number(x).toLocaleString(undefined,{maximumFractionDigits:d})}
function sigClass(s){return s=="BUY"?"buy":s=="SELL"?"sell":"neutral"}
function render(j){
 $("coins").textContent=j.status.coins;
 $("scan").textContent=j.status.last_scan?new Date(j.status.last_scan*1000).toLocaleTimeString():"—";
 $("wave").textContent=j.settings.wave_tf;$("tide").textContent=j.settings.tide_tf;
 $("dot").className="dot "+(j.status.ws_connected?"ok":"");$("st").textContent=j.status.ws_connected?"Delta WS connected":"Reconnecting";
 const a=[...j.markets].sort((x,y)=>(y.indicators?.score??-1)-(x.indicators?.score??-1));
 $("rows").innerHTML=a.map((m,i)=>{
  const x=m.indicators||{},w=x.wave||{},ha=x.ha||{},sr=x.sr||{},p=x.plan||{};
  const s=x.signal||"NEUTRAL"; const conf=s=="BUY"?x.buy_confirmations:s=="SELL"?x.sell_confirmations:Math.max(x.buy_confirmations||0,x.sell_confirmations||0);
  return `<tr>
  <td>${i+1}</td><td><b>${m.symbol}</b></td><td>${f(m.price,10)}</td><td>${f(m.change,2)}%</td>
  <td>${f(m.volume,0)}</td><td>${m.volume_rank??"—"}</td><td>${f(m.oi,0)}</td>
  <td>${j.settings.wave_tf}</td><td>${j.settings.tide_tf}</td>
  <td>${f(x.tide9,8)}</td><td>${f(x.tide20,8)}</td><td>${f(w.rsi,2)}</td>
  <td>${f(w.macd,6)}</td><td>${f(w.stoch_k,1)}/${f(w.stoch_d,1)}</td>
  <td><b>${x.score??"—"}</b></td><td>${x.score_rank??"—"}</td>
  <td class="${sigClass(s)}">${s}</td>
  <td>${conf}/8</td><td>${ha.bull?"🟢":ha.bear?"🔴":"—"}</td>
  <td>${f(sr.s2,8)}</td><td>${f(sr.s1,8)}</td><td>${f(sr.r1,8)}</td><td>${f(sr.r2,8)}</td>
  <td>${s!="NEUTRAL"?f(p.entry,8):"—"}</td><td>${s!="NEUTRAL"?f(p.sl,8):"—"}</td>
  <td>${s!="NEUTRAL"?f(p.tp1,8):"—"}</td><td>${s!="NEUTRAL"?f(p.tp2,8):"—"}</td>
  <td>${s!="NEUTRAL"?"1:"+f(p.rr,2):"—"}</td></tr>`
 }).join("");
}
fetch("/api/status").then(r=>r.json()).then(j=>{fill(j.settings);render(j)});
function connect(){const p=location.protocol==="https:"?"wss":"ws";const w=new WebSocket(p+"://"+location.host+"/ws");w.onmessage=e=>render(JSON.parse(e.data));w.onclose=()=>setTimeout(connect,3000);w.onerror=()=>w.close()}connect();
