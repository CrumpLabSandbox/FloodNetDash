/* NYC Street Flood Explorer
 * Static page; reads data/*.json built by scripts/build_data.py.
 */
(() => {
"use strict";

// ---------- helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const TZ = "America/New_York";
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const partsFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23", month: "numeric" });
const niceDate = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric" });
const niceTime = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const niceDT = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const dayKey = (ms) => dayFmt.format(ms);
function localParts(ms) {
  const p = partsFmt.formatToParts(ms);
  return { hour: +p.find(x => x.type === "hour").value % 24, month: +p.find(x => x.type === "month").value - 1 };
}
const keyToDate = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d, 12)); };
const fmtKey = (k) => niceDate.format(keyToDate(k).getTime());
const n0 = d3.format(",d");
const in1 = (v) => `${(v ?? 0).toFixed(1)} in.`;
function dur(mins) {
  if (mins == null) return "—";
  if (mins < 60) return `${Math.round(mins)} min`;
  const h = mins / 60;
  return h < 24 ? `${h.toFixed(h < 10 ? 1 : 0)} hr` : `${(h / 24).toFixed(1)} days`;
}
const median = (a) => a.length ? d3.median(a) : null;
const debounce = (fn, ms = 150) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// tooltip
const tip = $("#tip");
function showTip(html, ev) {
  tip.innerHTML = html; tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let x = ev.clientX + 14, y = ev.clientY + 14;
  if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 14;
  if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - 14;
  tip.style.left = x + "px"; tip.style.top = y + "px";
}
const hideTip = () => { tip.hidden = true; };
const row = (k, v) => `<div class="row"><span>${k}</span><span>${v}</span></div>`;

// depth color bins (sequential blue)
const DEPTH_BINS = [4, 8, 12, 24, 36];
const COUNT_BINS = [5, 10, 25, 50, 100];
const SEQ = () => ["--seq-1", "--seq-2", "--seq-3", "--seq-4", "--seq-5", "--seq-6"].map(cssVar);
const binIdx = (v, bins) => { let i = 0; while (i < bins.length && v >= bins[i]) i++; return i; };
const typeColor = (t) => cssVar(t === "tidal" ? "--tidal" : "--rain");
const typeVar = (t) => (t === "tidal" ? "var(--tidal)" : "var(--rain)");
const typeLabel = (t) => (t === "tidal" ? "Tidal" : "Rain-driven");

// ---------- state ----------
let S = [], E = [], P = [], CTX = {}, META = {};
const NOW = Date.now();
const YEAR_MS = 365.25 * 864e5;

// ---------- load ----------
Promise.all(["data/floodnet.json", "data/profiles.json", "data/context.json"].map(u => fetch(u).then(r => r.json())))
  .then(([fn, prof, ctx]) => {
    META = fn.meta; P = prof; CTX = ctx;
    S = fn.sensors.map((s, i) => ({
      ...s, idx: i, type: s.tidal ? "tidal" : "rain",
      t0: s.installed ? Date.parse(s.installed + "T12:00:00Z") : null,
      t1: s.removed ? Date.parse(s.removed + "T12:00:00Z") : NOW,
      evs: [],
    }));
    E = fn.events.map((r, i) => {
      const t = r[1] * 60000, lp = localParts(t);
      const e = { i, s: S[r[0]], t, depth: r[2] || 0, dur: r[3], onset: r[4], drain: r[5], d4: r[6], d12: r[7], d24: r[8],
        day: dayKey(t), hour: lp.hour, month: lp.month };
      e.type = e.s.type; e.end = t + (e.dur || 0) * 60000;
      e.s.evs.push(e);
      return e;
    });
    init();
  })
  .catch(err => {
    console.error(err);
    $("#tiles").innerHTML = `<p>Could not load the data files. If you opened this page straight from disk, run a local web server instead (for example <code>python3 -m http.server</code> in the <code>site/</code> folder).</p>`;
  });

function init() {
  renderTiles();
  renderDepth();
  initMap();
  renderCalendar();
  initReplay();
  renderKinds();
  renderScatter();
  renderHoods();
  render311();
  renderGrowth();
  renderPlans();
  renderSteps();
  const rr = debounce(() => { renderDepth(); renderCalendar(); drawReplayCharts(); renderKinds(); renderScatter(); render311(); renderGrowth(); });
  let lastW = innerWidth;
  addEventListener("resize", () => { if (Math.abs(innerWidth - lastW) > 30) { lastW = innerWidth; rr(); } });
}

// ---------- theme ----------
(function theme() {
  const btn = $("#themeBtn");
  try { const t = localStorage.getItem("theme"); if (t) document.documentElement.dataset.theme = t; } catch (e) {}
  btn.addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch (e) {}
    onTheme();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => onTheme());
})();
const isDark = () => (document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark";
const themeHooks = [];
function onTheme() { themeHooks.forEach(f => f()); }

// ---------- tiles ----------
function renderTiles() {
  const deepest = E.reduce((a, b) => (b.depth > a.depth ? b : a), E[0]);
  const byDay = d3.rollup(E, v => new Set(v.map(e => e.s.idx)).size, e => e.day);
  const [worstDay, worstN] = [...byDay].sort((a, b) => b[1] - a[1])[0];
  const active = S.filter(s => !s.removed).length;
  const hoods = new Set(E.map(e => e.s.ntaName)).size;
  const since = d3.min(E, e => e.t);
  $("#tiles").innerHTML = `
    <div class="tile hero"><div class="label">Floods recorded</div><div class="value">${n0(E.length)}</div><div class="sub">since ${niceDate.format(since)}</div></div>
    <div class="tile"><div class="label">Sensors active now</div><div class="value">${n0(active)}</div><div class="sub">${n0(S.length)} sites ever installed</div></div>
    <div class="tile"><div class="label">Neighborhoods that flooded</div><div class="value">${n0(hoods)}</div><div class="sub">across all 5 boroughs</div></div>
    <div class="tile"><div class="label">Deepest flood</div><div class="value">${deepest.depth.toFixed(1)} in.</div><div class="sub">${deepest.s.ntaName}, ${niceDate.format(deepest.t)}</div></div>
    <div class="tile"><div class="label">Most sensors flooded at once</div><div class="value">${n0(worstN)}</div><div class="sub">${fmtKey(worstDay)}</div></div>`;
  $("#builtNote").textContent = `Data last refreshed ${niceDate.format(Date.parse(META.built))}. The City updates FloodNet open data about every two weeks.`;
}

// ---------- depth ruler ----------
const BANDS = [
  { lo: 0, hi: 4, name: "Under 4 in.", desc: "Puddles along the curb. Can still seep into low doorways and basements.", c: "--seq-1" },
  { lo: 4, hi: 12, name: "4 – 12 in.", desc: "Over the curb. About 6 in. can stall a car.", c: "--seq-3" },
  { lo: 12, hi: 24, name: "1 – 2 ft", desc: "Knee-deep. About 12 in. of moving water can float most cars.", c: "--seq-4" },
  { lo: 24, hi: 999, name: "Over 2 ft", desc: "Waist-high. About 2 ft can sweep away SUVs and trucks.", c: "--seq-6" },
];
function renderDepth() {
  $("#depthBands").innerHTML = BANDS.map(b => {
    const n = E.filter(e => e.depth >= b.lo && e.depth < b.hi).length;
    return `<li><span class="sw" style="background:var(${b.c})"></span><span><b>${b.name}</b><span class="desc">${b.desc}</span></span><span class="n">${n0(n)}</span></li>`;
  }).join("");

  const el = $("#ruler"); el.innerHTML = "";
  const W = el.clientWidth || 480, H = 380, m = { t: 10, r: 40, b: 26, l: 34 };
  const svg = d3.select(el).append("svg").attr("width", W).attr("height", H);
  const y = d3.scaleLinear([0, 72], [H - m.b, m.t]);
  const ink = Math.min(190, W * 0.4); // illustration width
  const hx0 = m.l + ink + 18;
  // band washes
  BANDS.forEach(b => svg.append("rect").attr("x", m.l).attr("width", W - m.l - m.r)
    .attr("y", y(Math.min(b.hi, 72))).attr("height", y(b.lo) - y(Math.min(b.hi, 72)))
    .style("fill", `var(${b.c})`).style("opacity", 0.12));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`)
    .call(d3.axisLeft(y).tickValues([0, 12, 24, 36, 48, 60, 72]).tickFormat(d => d ? `${d / 12} ft` : "0").tickSizeOuter(0));
  // person (5 ft 6 in = 66 in)
  const s = (y(0) - y(66)) / 66, px = m.l + 14 * s;
  const g = svg.append("g").style("fill", "var(--muted)").style("opacity", 0.55);
  g.append("circle").attr("cx", px).attr("cy", y(61)).attr("r", 5 * s);
  g.append("rect").attr("x", px - 7 * s).attr("y", y(55)).attr("width", 14 * s).attr("height", 24 * s).attr("rx", 5 * s);
  g.append("rect").attr("x", px - 6 * s).attr("y", y(32)).attr("width", 5 * s).attr("height", 32 * s).attr("rx", 2 * s);
  g.append("rect").attr("x", px + 1 * s).attr("y", y(32)).attr("width", 5 * s).attr("height", 32 * s).attr("rx", 2 * s);
  svg.append("text").attr("x", px).attr("y", H - 6).attr("text-anchor", "middle").text("5′6″ person");
  // driving thresholds (NWS)
  [[6, "6″ can stall a car"], [12, "12″ can float a car"], [24, "2 ft sweeps away SUVs"]].forEach(([v, t]) => {
    svg.append("line").attr("x1", px + 10 * s).attr("x2", hx0 - 6).attr("y1", y(v)).attr("y2", y(v)).style("stroke", "var(--axis)");
    svg.append("text").attr("x", px + 12 * s).attr("y", y(v) - 4).style("font-size", "11px").text(t);
  });
  // histogram, 2-inch bins
  const bins = d3.bin().domain([0, 72]).thresholds(d3.range(0, 72, 2))(E.map(e => e.depth));
  const x = d3.scaleSqrt([0, d3.max(bins, b => b.length)], [hx0, W - m.r]);
  const bh = Math.max(1, y(0) - y(2) - 2);
  svg.append("g").selectAll("rect").data(bins.filter(b => b.length)).join("rect")
    .attr("x", hx0).attr("y", b => y(b.x1) + 1).attr("height", bh)
    .attr("width", b => Math.max(2, x(b.length) - hx0)).attr("rx", Math.min(3, bh / 2))
    .style("fill", b => `var(${BANDS[binIdx(b.x0, [4, 12, 24])].c})`)
    .on("mousemove", (ev, b) => showTip(`<b>${b.x0}–${b.x1} in. deep</b>${row("Floods", n0(b.length))}`, ev))
    .on("mouseleave", hideTip);
  const big = bins.reduce((a, b) => (b.length > a.length ? b : a));
  svg.append("text").attr("class", "lbl").attr("x", x(big.length) + 6).attr("y", y(big.x1) + bh / 2 + 4).text(`${n0(big.length)} floods`);
  // deepest marker
  const dmax = d3.max(E, e => e.depth);
  svg.append("line").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(dmax)).attr("y2", y(dmax)).style("stroke", "var(--critical)").style("stroke-width", 1.5);
  svg.append("text").attr("class", "lbl-strong").attr("x", W - m.r).attr("y", y(dmax) - 6).attr("text-anchor", "end").text(`Deepest: ${dmax.toFixed(1)} in.`);
}

// ---------- map ----------
let map, tileLayer, markers = [], selected = null, searchMarker = null;
const mapState = { type: "all", color: "depth" };
const tileUrl = () => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${isDark() ? "Dark" : "Light"}_Gray_Base/MapServer/tile/{z}/{y}/{x}`;
const ATTR = 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors';

function sensorStats(s, type) {
  const evs = type === "all" || type === s.type ? s.evs : [];
  return { n: evs.length, max: d3.max(evs, e => e.depth) || 0 };
}
function markerStyle(s) {
  const st = sensorStats(s, mapState.type);
  const visible = mapState.type === "all" || s.type === mapState.type;
  const seq = SEQ();
  if (!visible) return { radius: 0, opacity: 0, fillOpacity: 0 };
  if (!st.n) return { radius: 3, color: cssVar("--muted"), weight: 1, fillOpacity: 0, opacity: s.removed ? 0.3 : 0.7 };
  const fill = mapState.color === "depth" ? seq[binIdx(st.max, DEPTH_BINS)] : seq[binIdx(st.n, COUNT_BINS)];
  return { radius: Math.min(22, 4 + Math.sqrt(st.n) * 1.1), color: cssVar("--surface"), weight: 1.5, fillColor: fill, fillOpacity: 0.9, opacity: 1 };
}
function initMap() {
  map = L.map("mapEl", { scrollWheelZoom: false, zoomControl: true }).setView([40.69, -73.92], 10);
  tileLayer = L.tileLayer(tileUrl(), { attribution: ATTR, maxZoom: 16 }).addTo(map);
  map.on("click", () => map.scrollWheelZoom.enable());
  const order = [...S].sort((a, b) => a.evs.length - b.evs.length); // big circles on top
  order.forEach(s => {
    if (s.lat == null) return;
    const mk = L.circleMarker([s.lat, s.lon], markerStyle(s)).addTo(map);
    mk.on("click", () => selectSensor(s));
    mk.bindTooltip(() => `<b>${s.name}</b><br>${s.ntaName} · ${n0(s.evs.length)} floods`, { direction: "top" });
    markers[s.idx] = mk;
  });
  $$("[data-type]").forEach(b => b.addEventListener("click", () => {
    $$("[data-type]").forEach(x => x.classList.toggle("on", x === b));
    mapState.type = b.dataset.type; restyleMarkers();
  }));
  $$("[data-color]").forEach(b => b.addEventListener("click", () => {
    $$("[data-color]").forEach(x => x.classList.toggle("on", x === b));
    mapState.color = b.dataset.color; restyleMarkers();
  }));
  $("#geoForm").addEventListener("submit", geocode);
  // quick picks
  const picks = [];
  const byN = [...S].sort((a, b) => b.evs.length - a.evs.length);
  picks.push(byN.find(s => s.type === "tidal"), byN.find(s => s.type === "rain"));
  const deep = E.reduce((a, b) => (b.depth > a.depth ? b : a)).s; picks.push(deep);
  const gow = byN.find(s => /Gowanus/.test(s.ntaName)); if (gow) picks.push(gow);
  $("#quickPicks").innerHTML = [...new Set(picks.filter(Boolean))].map(s => `<button data-pick="${s.idx}">${s.name.replace(/^[A-Z]+ - /, "")}</button>`).join("");
  $$("[data-pick]").forEach(b => b.addEventListener("click", () => selectSensor(S[+b.dataset.pick], true)));
  renderMapLegend();
  themeHooks.push(() => { tileLayer.setUrl(tileUrl()); restyleMarkers(); if (replay.map) { replay.tiles.setUrl(tileUrl()); drawReplayFrame(); } renderMapLegend(); });
}
function restyleMarkers() {
  S.forEach(s => { const mk = markers[s.idx]; if (mk) { const st = markerStyle(s); mk.setStyle(st); mk.setRadius(st.radius); } });
  if (selected) markers[selected.idx]?.setStyle({ color: cssVar("--ink"), weight: 2.5 });
  renderMapLegend();
}
function renderMapLegend() {
  const seq = SEQ();
  const bins = mapState.color === "depth" ? DEPTH_BINS : COUNT_BINS;
  const labels = mapState.color === "depth"
    ? ["<4", "4–8", "8–12", "12–24", "24–36", "36+ in."]
    : ["1–4", "5–9", "10–24", "25–49", "50–99", "100+ floods"];
  $("#mapLegend").innerHTML = `<span>${mapState.color === "depth" ? "Deepest flood" : "Number of floods"}</span>
    <span class="key"><span class="ramp">${seq.map(c => `<i style="background:${c}"></i>`).join("")}</span> ${labels[0]} → ${labels[bins.length]}</span>
    <span class="key"><span class="sw" style="border:1.5px solid var(--muted);border-radius:50%;background:none"></span> No floods recorded yet</span>
    <span class="key">Circle size = number of floods</span>`;
}

function selectSensor(s, fly) {
  if (selected && markers[selected.idx]) { const st = markerStyle(selected); markers[selected.idx].setStyle(st); }
  selected = s;
  markers[s.idx]?.setStyle({ color: cssVar("--ink"), weight: 2.5 }).bringToFront();
  if (fly) map.flyTo([s.lat, s.lon], 14, { duration: 0.8 });
  const evs = s.evs;
  const deepest = evs.reduce((a, b) => (!a || b.depth > a.depth ? b : a), null);
  const yrs = Math.max((s.t1 - (s.t0 || s.t1)) / YEAR_MS, 1 / 12);
  const plans = plansFor(s);
  const panel = $("#sensorPanel");
  panel.innerHTML = `
    <h3>${s.street || s.name}</h3>
    <p class="meta">${s.ntaName}, ${s.boro} · sensor ${s.name}</p>
    <span class="pill"><span class="dot" style="background:${typeVar(s.type)}"></span>${s.tidal ? "Tidally influenced site" : "Rain-driven site"}</span>
    <span class="pill">Installed ${s.installed ? niceDate.format(s.t0) : "—"}${s.removed ? ` · removed ${niceDate.format(s.t1)}` : ""}</span>
    <div class="kv">
      <div><div class="k">Floods recorded</div><div class="v">${n0(evs.length)}</div></div>
      <div><div class="k">Per year (avg.)</div><div class="v">${(evs.length / yrs).toFixed(1)}</div></div>
      <div><div class="k">Deepest</div><div class="v">${deepest ? in1(deepest.depth) : "—"}</div></div>
      <div><div class="k">Typical length</div><div class="v">${dur(median(evs.map(e => e.dur)))}</div></div>
    </div>
    ${evs.length ? `<h4>Every flood here</h4><div id="strip" class="chart"></div>
      <h4>Deepest flood: ${niceDT.format(deepest.t)}</h4><div id="miniProf" class="chart"></div>` :
      `<p>No floods recorded here yet. A sensor with no floods is good news, and it's useful data too.</p>`}
    <h4>City projects that apply here</h4>
    ${plans.map(p => `<div class="plan-mini"><a href="${p.url}" target="_blank" rel="noopener">${p.title}</a><div>${p.status}</div></div>`).join("")}
    <p class="note" style="margin-top:12px"><a href="https://dataviz.floodnet.nyc" target="_blank" rel="noopener">See live readings on FloodNet's dashboard →</a></p>`;
  if (evs.length) { drawStrip($("#strip"), s); drawProfile($("#miniProf"), deepest, { h: 130, compact: true }); }
  if (innerWidth < 900) panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function plansFor(s) {
  const local = CITY_PLANS.filter(p => p.areas.length && (p.boros.includes(s.boro) || p.boros.includes("*")) && p.areas.some(a => s.ntaName.includes(a)));
  const city = CITY_PLANS.filter(p => p.id === (s.tidal ? "coastal-bureau" : "catch-basins") || p.id === "floodnet-expansion");
  if (!s.tidal && !local.some(p => p.kind === "Cloudburst")) city.push(CITY_PLANS.find(p => p.id === "green-infra"));
  return [...local, ...city].filter(Boolean).slice(0, 6);
}
function drawStrip(el, s) {
  const W = el.clientWidth || 320, H = 120, m = { t: 8, r: 8, b: 22, l: 34 };
  const svg = d3.select(el).append("svg").attr("width", W).attr("height", H);
  const x = d3.scaleTime([s.t0 || d3.min(s.evs, e => e.t), Math.min(s.t1, NOW)], [m.l, W - m.r]);
  const y = d3.scaleLinear([0, Math.max(6, d3.max(s.evs, e => e.depth))], [H - m.b, m.t]).nice();
  svg.append("g").attr("class", "grid").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(3).tickSize(-(W - m.l - m.r)).tickFormat(""));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(3).tickFormat(d => d + "″").tickSize(0)).call(g => g.select("path").remove());
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(4).tickSizeOuter(0));
  svg.append("g").selectAll("circle").data(s.evs).join("circle")
    .attr("cx", e => x(e.t)).attr("cy", e => y(e.depth)).attr("r", 4)
    .style("fill", typeVar(s.type)).style("stroke", "var(--surface)").style("stroke-width", 1.5).style("cursor", "pointer")
    .on("mousemove", (ev, e) => showTip(`<b>${niceDT.format(e.t)}</b>${row("Deepest", in1(e.depth))}${row("Lasted", dur(e.dur))}`, ev))
    .on("mouseleave", hideTip)
    .on("click", (ev, e) => { const mp = $("#miniProf"); mp.innerHTML = ""; mp.previousElementSibling.textContent = `Flood: ${niceDT.format(e.t)}`; drawProfile(mp, e, { h: 130, compact: true }); });
}

async function geocode(ev) {
  ev.preventDefault();
  const q = $("#geoInput").value.trim();
  if (!q) return;
  try {
    const r = await fetch(`https://geosearch.planninglabs.nyc/v2/search?size=1&text=${encodeURIComponent(q)}`);
    const j = await r.json();
    const f = j.features && j.features[0];
    if (!f) { $("#geoInput").setCustomValidity("Address not found"); $("#geoInput").reportValidity(); setTimeout(() => $("#geoInput").setCustomValidity(""), 2000); return; }
    const [lon, lat] = f.geometry.coordinates;
    if (searchMarker) searchMarker.remove();
    searchMarker = L.marker([lat, lon]).addTo(map).bindTooltip(f.properties.label, { permanent: false });
    const here = L.latLng(lat, lon);
    const near = S.filter(s => s.lat != null && !s.removed).map(s => ({ s, d: here.distanceTo([s.lat, s.lon]) })).sort((a, b) => a.d - b.d).slice(0, 4);
    map.flyTo([lat, lon], 14, { duration: 0.8 });
    const mi = (m) => (m / 1609.34 < 0.1 ? `${Math.round(m * 3.281)} ft` : `${(m / 1609.34).toFixed(1)} mi`);
    $("#sensorPanel").innerHTML = `<h3>Near ${f.properties.label}</h3>
      <p class="meta">Closest active FloodNet sensors</p>
      ${near.map(({ s, d }) => `<div class="plan-mini"><a href="#" data-near="${s.idx}">${s.street || s.name}</a><div>${mi(d)} away · ${n0(s.evs.length)} floods · deepest ${in1(d3.max(s.evs, e => e.depth))}</div></div>`).join("")}
      <p class="note">A sensor measures only the spot right below it. Check the <a href="https://nyc.gov/stormwater-map" target="_blank" rel="noopener">Stormwater Flood Map</a> to see your block's mapped rain-flood risk.</p>`;
    $$("[data-near]").forEach(a => a.addEventListener("click", (e) => { e.preventDefault(); selectSensor(S[+a.dataset.near], true); }));
  } catch (e) { console.error(e); }
}

// ---------- profile chart (shared) ----------
function drawProfile(el, e, opt = {}) {
  el.innerHTML = "";
  const prof = P[e.i] || [];
  if (!prof.length) { el.innerHTML = `<p class="note">No depth curve published for this flood.</p>`; return; }
  const step = META.profileStepMin;
  const pts = prof.map((d, k) => [k * step, d]);
  pts.push([prof.length * step, 0]);
  const W = el.clientWidth || 320, H = opt.h || 260, m = { t: 12, r: 12, b: 26, l: 38 };
  const svg = d3.select(el).append("svg").attr("width", W).attr("height", H);
  const x = d3.scaleLinear([0, pts[pts.length - 1][0]], [m.l, W - m.r]);
  const y = d3.scaleLinear([0, Math.max(6, e.depth * 1.08)], [H - m.b, m.t]).nice();
  svg.append("g").attr("class", "grid").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickSize(-(W - m.l - m.r)).tickFormat(""));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickFormat(d => d + "″").tickSize(0)).call(g => g.select("path").remove());
  const xt = x.domain()[1] > 240 ? (d => `${Math.round(d / 60)}h`) : (d => `${d}m`);
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(5).tickFormat(xt).tickSizeOuter(0));
  [4, 12, 24].filter(v => v < y.domain()[1]).forEach(v => {
    svg.append("line").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(v)).attr("y2", y(v)).style("stroke", "var(--axis)").style("stroke-dasharray", "0").style("opacity", .9);
    if (!opt.compact) svg.append("text").attr("x", W - m.r).attr("y", y(v) - 4).attr("text-anchor", "end").text(v === 4 ? "curb" : v === 12 ? "1 ft" : "2 ft");
  });
  const area = d3.area().x(d => x(d[0])).y0(y(0)).y1(d => y(d[1])).curve(d3.curveMonotoneX);
  const line = d3.line().x(d => x(d[0])).y(d => y(d[1])).curve(d3.curveMonotoneX);
  svg.append("path").attr("d", area(pts)).style("fill", typeVar(e.type)).style("opacity", 0.15);
  svg.append("path").attr("d", line(pts)).style("fill", "none").style("stroke", typeVar(e.type)).style("stroke-width", 2).style("stroke-linejoin", "round");
  const pk = pts.reduce((a, b) => (b[1] > a[1] ? b : a));
  svg.append("circle").attr("cx", x(pk[0])).attr("cy", y(pk[1])).attr("r", 4.5).style("fill", typeVar(e.type)).style("stroke", "var(--surface)").style("stroke-width", 2);
  svg.append("text").attr("class", "lbl-strong").attr("x", Math.min(x(pk[0]) + 8, W - 60)).attr("y", y(pk[1]) + 4).text(in1(e.depth));
  // hover
  const hover = svg.append("line").style("stroke", "var(--axis)").attr("y1", m.t).attr("y2", H - m.b).style("opacity", 0);
  svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", W - m.l - m.r).attr("height", H - m.t - m.b).style("fill", "transparent")
    .on("mousemove", (ev) => {
      const mx = x.invert(d3.pointer(ev)[0]); const k = Math.max(0, Math.min(prof.length - 1, Math.round(mx / step)));
      hover.attr("x1", x(k * step)).attr("x2", x(k * step)).style("opacity", 1);
      showTip(`<b>${niceTime.format(e.t + k * step * 60000)}</b>${row("Depth", in1(prof[k]))}${row("Minutes in", k * step)}`, ev);
    })
    .on("mouseleave", () => { hover.style("opacity", 0); hideTip(); });
}

// ---------- calendar ----------
let calType = "all";
function renderCalendar() {
  const el = $("#calendarEl"); el.innerHTML = "";
  const evs = E.filter(e => calType === "all" || e.type === calType);
  const byDay = d3.rollup(evs, v => ({ n: new Set(v.map(e => e.s.idx)).size, max: d3.max(v, e => e.depth), ev: v.length }), e => e.day);
  const years = d3.range(+dayKey(d3.min(E, e => e.t)).slice(0, 4), +dayKey(NOW).slice(0, 4) + 1).reverse();
  const cell = Math.max(9, Math.min(15, Math.floor(((el.clientWidth || 900) - 48) / 54)));
  const gap = 2, yh = cell * 7 + 26, W = 48 + 54 * cell, H = years.length * yh;
  const svg = d3.select(el).append("svg").attr("width", W).attr("height", H);
  const seq = SEQ(), cbins = [2, 5, 10, 25, 50];
  years.forEach((yr, yi) => {
    const g = svg.append("g").attr("transform", `translate(48,${yi * yh + 18})`);
    g.append("text").attr("class", "yr").attr("x", -44).attr("y", cell * 3.5 + 4).text(yr);
    const start = new Date(Date.UTC(yr, 0, 1, 12)), days = d3.utcDays(start, new Date(Date.UTC(yr + 1, 0, 1, 12)));
    const off = start.getUTCDay();
    if (yi === 0) d3.utcMonths(start, new Date(Date.UTC(yr + 1, 0, 1))).forEach(mo => {
      const di = Math.round((mo - start) / 864e5) + off;
      g.append("text").attr("x", Math.floor(di / 7) * cell).attr("y", -5).text(d3.utcFormat("%b")(mo));
    });
    g.selectAll("rect").data(days).join("rect")
      .attr("x", d => Math.floor((Math.round((d - start) / 864e5) + off) / 7) * cell)
      .attr("y", d => d.getUTCDay() * cell)
      .attr("width", cell - gap).attr("height", cell - gap).attr("rx", 2)
      .attr("fill", d => { const v = byDay.get(d3.utcFormat("%Y-%m-%d")(d)); return v ? seq[binIdx(v.n, cbins)] : null; })
      .style("fill", d => (byDay.has(d3.utcFormat("%Y-%m-%d")(d)) ? null : (d.getTime() > NOW ? "transparent" : "var(--empty)")))
      .style("cursor", d => (byDay.has(d3.utcFormat("%Y-%m-%d")(d)) ? "pointer" : "default"))
      .on("mousemove", (ev, d) => {
        const k = d3.utcFormat("%Y-%m-%d")(d), v = byDay.get(k), rain = CTX.rain[k], c = CTX.c311[k];
        const calls = c ? d3.sum(Object.values(c)) : 0;
        showTip(`<b>${fmtKey(k)}</b>${row("Sensors flooded", v ? n0(v.n) : 0)}${v ? row("Deepest", in1(v.max)) : ""}${row("Rain, Central Park", rain ? rain[0].toFixed(2) + " in." : "—")}${row("311 flood calls", n0(calls))}${v ? `<div class="note" style="margin-top:4px">Tap to replay</div>` : ""}`, ev);
      })
      .on("mouseleave", hideTip)
      .on("click", (ev, d) => { const k = d3.utcFormat("%Y-%m-%d")(d); if (byDay.has(k)) { hideTip(); loadStorm(k, true); } });
  });
  $("#calLegend").innerHTML = `<span>Sensors flooded that day</span><span class="key"><span class="sw" style="background:var(--empty)"></span>none</span>` +
    ["1", "2–4", "5–9", "10–24", "25–49", "50+"].map((l, i) => `<span class="key"><span class="sw" style="background:${seq[i]}"></span>${l}</span>`).join("");
  if (!renderCalendar.bound) {
    renderCalendar.bound = true;
    $$("[data-cal]").forEach(b => b.addEventListener("click", () => { $$("[data-cal]").forEach(x => x.classList.toggle("on", x === b)); calType = b.dataset.cal; renderCalendar(); }));
    themeHooks.push(renderCalendar);
  }
}

// ---------- storm replay ----------
const replay = { map: null, tiles: null, circles: new Map(), dry: [], evs: [], t0: 0, t1: 0, k: 0, steps: 0, series: [], timer: null, day: null };
function initReplay() {
  const byDay = d3.rollup(E, v => new Set(v.map(e => e.s.idx)).size, e => e.day);
  const top = [...byDay].sort((a, b) => b[1] - a[1]).slice(0, 20).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  const sel = $("#stormSelect");
  sel.innerHTML = top.map(([k, n]) => `<option value="${k}">${fmtKey(k)}: ${n} sensors</option>`).join("");
  sel.addEventListener("change", () => loadStorm(sel.value));
  replay.map = L.map("replayMap", { scrollWheelZoom: false }).setView([40.69, -73.92], 10);
  replay.tiles = L.tileLayer(tileUrl(), { attribution: ATTR, maxZoom: 16 }).addTo(replay.map);
  $("#playBtn").addEventListener("click", togglePlay);
  $("#timeSlider").addEventListener("input", (e) => { stopPlay(); replay.k = +e.target.value; drawReplayFrame(); });
  const worst = [...byDay].sort((a, b) => b[1] - a[1])[0][0];
  loadStorm(worst);
}
function loadStorm(day, scroll) {
  stopPlay();
  const sel = $("#stormSelect");
  if (![...sel.options].some(o => o.value === day)) {
    const n = new Set(E.filter(e => e.day === day).map(e => e.s.idx)).size;
    sel.insertAdjacentHTML("afterbegin", `<option value="${day}">${fmtKey(day)}: ${n} sensors</option>`);
  }
  sel.value = day;
  replay.day = day;
  replay.evs = E.filter(e => e.day === day);
  const step = META.profileStepMin * 60000;
  replay.t0 = Math.floor((d3.min(replay.evs, e => e.t) - 20 * 60000) / step) * step;
  replay.t1 = Math.min(d3.max(replay.evs, e => e.end) + 20 * 60000, replay.t0 + 36 * 3600e3);
  replay.steps = Math.ceil((replay.t1 - replay.t0) / step);
  replay.k = 0;
  // series: sensors under water per step
  replay.series = d3.range(replay.steps + 1).map(k => {
    const T = replay.t0 + k * step; let n = 0; const seen = new Set();
    replay.evs.forEach(e => { if (!seen.has(e.s.idx) && depthAt(e, T) > 0.4) { seen.add(e.s.idx); n++; } });
    return [T, n];
  });
  $("#timeSlider").max = replay.steps; $("#timeSlider").value = 0;
  // layers
  replay.circles.forEach(c => c.remove()); replay.circles.clear();
  replay.dry.forEach(c => c.remove()); replay.dry = [];
  const T0 = replay.t0;
  S.filter(s => s.lat != null && s.t0 && s.t0 <= T0 && s.t1 >= T0).forEach(s => {
    replay.dry.push(L.circleMarker([s.lat, s.lon], { radius: 2.5, weight: 0, fillColor: cssVar("--muted"), fillOpacity: 0.5, interactive: false }).addTo(replay.map));
  });
  const sensorsHit = [...new Set(replay.evs.map(e => e.s))];
  sensorsHit.forEach(s => {
    const c = L.circleMarker([s.lat, s.lon], { radius: 0 }).addTo(replay.map);
    c.bindTooltip(() => `<b>${s.street || s.name}</b><br>${s.ntaName}<br>${c._depth ? in1(c._depth) + " now" : "dry right now"}`);
    c.on("click", () => { document.getElementById("map").scrollIntoView({ behavior: "smooth" }); selectSensor(s, true); });
    replay.circles.set(s, c);
  });
  if (sensorsHit.length > 1) replay.map.fitBounds(L.latLngBounds(sensorsHit.map(s => [s.lat, s.lon])).pad(0.15), { maxZoom: 13 });
  const deepest = d3.max(replay.evs, e => e.depth);
  const deepE = replay.evs.find(e => e.depth === deepest);
  $("#replayStats").innerHTML = `
    <div><div class="k">Sensors flooded</div><div class="v">${sensorsHit.length}</div></div>
    <div><div class="k">Deepest</div><div class="v">${in1(deepest)}</div></div>
    <div><div class="k">Deepest at</div><div class="v" style="font-size:14px;line-height:1.3">${deepE.s.ntaName.split("-")[0]}</div></div>`;
  drawReplayCharts();
  drawReplayFrame();
  if (scroll) document.getElementById("replay").scrollIntoView({ behavior: "smooth" });
}
function depthAt(e, T) {
  if (T < e.t || T > e.end) return 0;
  const prof = P[e.i]; if (!prof || !prof.length) return T <= e.end ? e.depth * 0.5 : 0;
  const k = Math.floor((T - e.t) / (META.profileStepMin * 60000));
  return prof[Math.min(k, prof.length - 1)] || 0;
}
function drawReplayFrame() {
  if (!replay.evs.length) return;
  const T = replay.t0 + replay.k * META.profileStepMin * 60000;
  const seq = SEQ(), surf = cssVar("--surface");
  replay.circles.forEach((c, s) => {
    let d = 0; s.evs.forEach(e => { if (e.day === replay.day || (T >= e.t && T <= e.end)) d = Math.max(d, depthAt(e, T)); });
    c._depth = d;
    if (d > 0.4) c.setStyle({ radius: 4 + Math.sqrt(d) * 3.2, fillColor: seq[binIdx(d, DEPTH_BINS)], fillOpacity: 0.9, color: surf, weight: 1.5, opacity: 1 }).setRadius(4 + Math.sqrt(d) * 3.2);
    else c.setStyle({ radius: 3, fillOpacity: 0, color: typeColor(s.type), weight: 1, opacity: 0.5 }).setRadius(3);
  });
  replay.dry.forEach(c => c.setStyle({ fillColor: cssVar("--muted") }));
  $("#clock").textContent = niceDT.format(T);
  $("#timeSlider").value = replay.k;
  if (replay.cursor) replay.cursor.forEach(f => f(T));
}
function togglePlay() { replay.timer ? stopPlay() : startPlay(); }
function startPlay() {
  if (replay.k >= replay.steps) replay.k = 0;
  $("#playBtn").textContent = "❚❚ Pause";
  const ms = Math.max(30, Math.min(120, 12000 / replay.steps));
  replay.timer = setInterval(() => { replay.k++; if (replay.k >= replay.steps) { replay.k = replay.steps; stopPlay(); } drawReplayFrame(); }, ms);
}
function stopPlay() { clearInterval(replay.timer); replay.timer = null; $("#playBtn").textContent = "▶ Play"; }
function drawReplayCharts() {
  if (!replay.series.length) return;
  replay.cursor = [];
  // sensors under water
  const el = $("#replayCount"); el.innerHTML = "";
  const W = el.clientWidth || 320, H = 120, m = { t: 8, r: 10, b: 22, l: 30 };
  const x = d3.scaleTime([replay.t0, replay.t1], [m.l, W - m.r]);
  const y = d3.scaleLinear([0, Math.max(4, d3.max(replay.series, d => d[1]))], [H - m.b, m.t]).nice();
  const svg = d3.select(el).append("svg").attr("width", W).attr("height", H);
  svg.append("g").attr("class", "grid").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(3).tickSize(-(W - m.l - m.r)).tickFormat(""));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(3).tickSize(0)).call(g => g.select("path").remove());
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(4).tickFormat(d => niceTime.format(d)).tickSizeOuter(0));
  svg.append("path").attr("d", d3.area().x(d => x(d[0])).y0(y(0)).y1(d => y(d[1])).curve(d3.curveStepAfter)(replay.series)).style("fill", "var(--rain)").style("opacity", .12);
  svg.append("path").attr("d", d3.line().x(d => x(d[0])).y(d => y(d[1])).curve(d3.curveStepAfter)(replay.series)).style("fill", "none").style("stroke", "var(--rain)").style("stroke-width", 2);
  const cur = svg.append("line").attr("y1", m.t).attr("y2", H - m.b).style("stroke", "var(--ink)").style("stroke-width", 1);
  const dot = svg.append("circle").attr("r", 4).style("fill", "var(--rain)").style("stroke", "var(--surface)").style("stroke-width", 2);
  const lab = svg.append("text").attr("class", "lbl-strong");
  replay.cursor.push(T => {
    const k = Math.min(replay.series.length - 1, Math.round((T - replay.t0) / (META.profileStepMin * 60000)));
    const v = replay.series[k][1];
    cur.attr("x1", x(T)).attr("x2", x(T)); dot.attr("cx", x(T)).attr("cy", y(v));
    lab.attr("x", x(T) + (x(T) > W - 60 ? -8 : 8)).attr("text-anchor", x(T) > W - 60 ? "end" : "start").attr("y", Math.max(m.t + 10, y(v) - 6)).text(v);
  });
  svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", W - m.l - m.r).attr("height", H - m.t - m.b).style("fill", "transparent").style("cursor", "pointer")
    .on("click", (ev) => { stopPlay(); replay.k = Math.round((x.invert(d3.pointer(ev)[0]) - replay.t0) / (META.profileStepMin * 60000)); drawReplayFrame(); });
  // rain
  const rel = $("#replayRain"); rel.innerHTML = "";
  const hrs = d3.utcHours(new Date(replay.t0), new Date(replay.t1)).map(h => {
    const k = dayKey(h.getTime()), lh = localParts(h.getTime()).hour;
    const arr = CTX.rainHourly[k]; return [h.getTime(), arr ? arr[lh] : 0];
  });
  const H2 = 90;
  const y2 = d3.scaleLinear([0, Math.max(0.25, d3.max(hrs, d => d[1]))], [H2 - m.b, m.t]).nice();
  const s2 = d3.select(rel).append("svg").attr("width", W).attr("height", H2);
  s2.append("g").attr("class", "grid").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y2).ticks(2).tickSize(-(W - m.l - m.r)).tickFormat(""));
  s2.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y2).ticks(2).tickFormat(d => d + "″").tickSize(0)).call(g => g.select("path").remove());
  s2.append("g").attr("class", "axis").attr("transform", `translate(0,${H2 - m.b})`).call(d3.axisBottom(x).ticks(4).tickFormat(d => niceTime.format(d)).tickSizeOuter(0));
  const bw = Math.max(1, Math.min(24, x(replay.t0 + 3600e3) - x(replay.t0) - 2));
  s2.append("g").selectAll("rect").data(hrs.filter(d => d[1] > 0)).join("rect")
    .attr("x", d => x(d[0]) + 1).attr("width", bw).attr("y", d => y2(d[1])).attr("height", d => y2(0) - y2(d[1])).attr("rx", Math.min(3, bw / 2))
    .style("fill", "var(--seq-3)")
    .on("mousemove", (ev, d) => showTip(`<b>${niceTime.format(d[0])}</b>${row("Rain that hour", d[1].toFixed(2) + " in.")}`, ev)).on("mouseleave", hideTip);
  if (!hrs.some(d => d[1] > 0)) s2.append("text").attr("x", W / 2).attr("y", H2 / 2).attr("text-anchor", "middle").attr("class", "lbl").text("No rain at Central Park. Likely a tidal flood.");
  const cur2 = s2.append("line").attr("y1", m.t).attr("y2", H2 - m.b).style("stroke", "var(--ink)");
  replay.cursor.push(T => cur2.attr("x1", x(T)).attr("x2", x(T)));
  drawReplayFrame();
}

// ---------- rain vs tide ----------
function legendKeys(el) {
  el.innerHTML = `<span class="key"><span class="sw" style="background:var(--rain)"></span>Rain-driven sites</span><span class="key"><span class="sw" style="background:var(--tidal)"></span>Tidally influenced sites</span>`;
}
function groupedBars(el, cats, get, fmtCat) {
  el.innerHTML = "";
  const W = el.clientWidth || 480, H = 220, m = { t: 10, r: 8, b: 24, l: 40 };
  const x = d3.scaleBand(cats, [m.l, W - m.r]).paddingInner(0.2);
  const types = ["rain", "tidal"];
  const xi = d3.scaleBand(types, [0, x.bandwidth()]).padding(0.08);
  const data = cats.flatMap(c => types.map(t => ({ c, t, v: get(c, t) })));
  const y = d3.scaleLinear([0, d3.max(data, d => d.v)], [H - m.b, m.t]).nice();
  const svg = d3.select(el).append("svg").attr("width", W).attr("height", H);
  svg.append("g").attr("class", "grid").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickSize(-(W - m.l - m.r)).tickFormat(""));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickSize(0)).call(g => g.select("path").remove());
  const every = Math.ceil(cats.length / Math.max(4, Math.floor((W - 60) / 34)));
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`)
    .call(d3.axisBottom(x).tickFormat((c, i) => (i % every ? "" : fmtCat(c))).tickSize(0)).call(g => g.select("path").style("stroke", "var(--axis)"));
  const bw = Math.min(24, xi.bandwidth());
  svg.append("g").selectAll("path").data(data).join("path")
    .attr("d", d => { const x0 = x(d.c) + xi(d.t) + (xi.bandwidth() - bw) / 2, y0 = y(0), y1 = y(d.v), r = Math.min(4, bw / 2, y0 - y1);
      return `M${x0},${y0}V${y1 + r}Q${x0},${y1} ${x0 + r},${y1}H${x0 + bw - r}Q${x0 + bw},${y1} ${x0 + bw},${y1 + r}V${y0}Z`; })
    .style("fill", d => typeVar(d.t))
    .on("mousemove", (ev, d) => showTip(`<b>${fmtCat(d.c)}</b>${row(typeLabel(d.t), n0(d.v) + " floods")}`, ev)).on("mouseleave", hideTip);
}
function renderKinds() {
  const months = d3.range(12), hours = d3.range(24);
  const cm = d3.rollup(E, v => v.length, e => e.month, e => e.type);
  const ch = d3.rollup(E, v => v.length, e => e.hour, e => e.type);
  groupedBars($("#byMonth"), months, (c, t) => cm.get(c)?.get(t) || 0, c => d3.utcFormat("%b")(new Date(Date.UTC(2020, c, 1))));
  groupedBars($("#byHour"), hours, (c, t) => ch.get(c)?.get(t) || 0, c => (c === 0 ? "12a" : c < 12 ? c + "a" : c === 12 ? "12p" : (c - 12) + "p"));
  legendKeys($("#kindLegend"));
  // dry share
  const el = $("#dryShare"); el.innerHTML = "";
  const known = E.filter(e => CTX.rain[e.day]);
  const share = ["rain", "tidal"].map(t => {
    const v = known.filter(e => e.type === t); const dry = v.filter(e => CTX.rain[e.day][0] < 0.05).length;
    return { t, p: v.length ? dry / v.length : 0, dry, n: v.length };
  });
  const W = el.clientWidth || 480, H = 110, m = { t: 6, r: 50, b: 6, l: 110 };
  const svg = d3.select(el).append("svg").attr("width", W).attr("height", H);
  const x = d3.scaleLinear([0, 1], [m.l, W - m.r]);
  const y = d3.scaleBand(["rain", "tidal"], [m.t, H - m.b]).padding(0.35);
  const bh = Math.min(24, y.bandwidth());
  svg.selectAll("rect.track").data(share).join("rect").attr("x", m.l).attr("width", W - m.l - m.r).attr("y", d => y(d.t) + (y.bandwidth() - bh) / 2).attr("height", bh).attr("rx", 4).style("fill", "var(--surface-2)");
  svg.selectAll("rect.v").data(share).join("rect").attr("x", m.l).attr("width", d => Math.max(2, x(d.p) - m.l)).attr("y", d => y(d.t) + (y.bandwidth() - bh) / 2).attr("height", bh).attr("rx", 4).style("fill", d => typeVar(d.t))
    .on("mousemove", (ev, d) => showTip(`<b>${typeLabel(d.t)}</b>${row("Floods on dry days", n0(d.dry))}${row("All floods", n0(d.n))}`, ev)).on("mouseleave", hideTip);
  svg.selectAll("text.k").data(share).join("text").attr("class", "lbl").attr("x", m.l - 8).attr("text-anchor", "end").attr("y", d => y(d.t) + y.bandwidth() / 2 + 4).text(d => typeLabel(d.t));
  svg.selectAll("text.v").data(share).join("text").attr("class", "lbl-strong").attr("x", d => x(d.p) + 6).attr("y", d => y(d.t) + y.bandwidth() / 2 + 4).text(d => Math.round(d.p * 100) + "%");
  // callout: busiest tidal sensor
  const tidal = S.filter(s => s.type === "tidal").sort((a, b) => b.evs.length - a.evs.length)[0];
  const tv = tidal.evs.filter(e => CTX.rain[e.day]);
  const tdry = tv.filter(e => CTX.rain[e.day][0] < 0.05).length;
  const yrs = Math.max((Math.min(tidal.t1, NOW) - tidal.t0) / YEAR_MS, 0.1);
  $("#kindCallout").innerHTML = `<div class="big">${n0(tidal.evs.length)} floods</div>
    <p>at <b>${tidal.street || tidal.name}</b> in ${tidal.ntaName}, about <b>${Math.round(tidal.evs.length / yrs)} a year</b>. ${Math.round(100 * tdry / Math.max(1, tv.length))}% of them came on days with almost no rain.</p>
    <p>Tidal flooding is predictable. It peaks around new and full moons and in spring and fall "king tides." It's driven by sea level, so better sewers alone won't stop it. The fixes are raised streets and shorelines, bulkheads, and tide gates.</p>
    <p class="note">"Dry day" uses modeled Central Park rainfall, which may not match the coast exactly.</p>`;
}

// ---------- anatomy scatter ----------
let currentProfileEvent = null;
function renderScatter() {
  const el = $("#scatter"); el.innerHTML = "";
  const pts = E.filter(e => e.onset != null && e.drain != null);
  const W = el.clientWidth || 600, H = 380, m = { t: 12, r: 14, b: 40, l: 52 };
  const x = d3.scaleLog([0.5, d3.max(pts, e => Math.max(1, e.onset))], [m.l, W - m.r]).clamp(true).nice();
  const y = d3.scaleLog([0.5, d3.max(pts, e => Math.max(1, e.drain))], [H - m.b, m.t]).clamp(true).nice();
  const svg = d3.select(el).append("svg").attr("width", W).attr("height", H);
  const tv = [1, 10, 60, 360, 1440, 10080].filter(v => v <= x.domain()[1]);
  const tf = v => (v < 60 ? `${v} min` : v < 1440 ? `${v / 60} hr` : `${v / 1440} d`);
  svg.append("g").attr("class", "grid").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).tickValues(tv).tickSize(-(H - m.t - m.b)).tickFormat(""));
  svg.append("g").attr("class", "grid").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).tickValues(tv.filter(v => v <= y.domain()[1])).tickSize(-(W - m.l - m.r)).tickFormat(""));
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).tickValues(tv).tickFormat(tf).tickSizeOuter(0));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).tickValues(tv.filter(v => v <= y.domain()[1])).tickFormat(tf).tickSize(0)).call(g => g.select("path").remove());
  svg.append("text").attr("x", (m.l + W - m.r) / 2).attr("y", H - 6).attr("text-anchor", "middle").text("Time for water to rise to its peak →");
  svg.append("text").attr("transform", `translate(12,${(m.t + H - m.b) / 2}) rotate(-90)`).attr("text-anchor", "middle").text("Time to drain away →");
  const cx = e => x(Math.max(0.5, e.onset)), cy = e => y(Math.max(0.5, e.drain));
  const canvasPts = svg.append("g");
  canvasPts.selectAll("circle").data(pts).join("circle").attr("cx", cx).attr("cy", cy).attr("r", 2.6)
    .style("fill", e => typeVar(e.type)).style("opacity", 0.5);
  svg.append("text").attr("class", "lbl").attr("x", m.l + 8).attr("y", H - m.b - 10).text("Flash floods: up and gone fast");
  svg.append("text").attr("class", "lbl").attr("x", m.l + 8).attr("y", m.t + 14).text("Rises fast, lingers: drains can't keep up");
  svg.append("text").attr("class", "lbl").attr("x", W - m.r - 8).attr("y", m.t + 14).attr("text-anchor", "end").text("Slow, long floods: often tides");
  const hl = svg.append("circle").attr("r", 6).style("fill", "none").style("stroke", "var(--ink)").style("stroke-width", 2).style("opacity", 0);
  const del = d3.Delaunay.from(pts, cx, cy);
  const pick = (ev) => { const [mx, my] = d3.pointer(ev); const i = del.find(mx, my); const e = pts[i]; return Math.hypot(cx(e) - mx, cy(e) - my) < 20 ? e : null; };
  svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", W - m.l - m.r).attr("height", H - m.t - m.b).style("fill", "transparent").style("cursor", "crosshair")
    .on("mousemove", (ev) => { const e = pick(ev); if (!e) { hl.style("opacity", 0); hideTip(); return; }
      hl.attr("cx", cx(e)).attr("cy", cy(e)).style("opacity", 1);
      showTip(`<b>${e.s.street || e.s.name}</b><div class="note">${e.s.ntaName} · ${niceDT.format(e.t)}</div>${row("Deepest", in1(e.depth))}${row("Rose to peak in", dur(e.onset))}${row("Drained in", dur(e.drain))}`, ev); })
    .on("mouseleave", () => { hl.style("opacity", 0); hideTip(); })
    .on("click", (ev) => { const e = pick(ev); if (e) showProfile(e); });
  legendKeys($("#scatterLegend"));
  showProfile(currentProfileEvent || E.reduce((a, b) => (b.depth > a.depth ? b : a)));
}
function showProfile(e) {
  currentProfileEvent = e;
  $("#profileTitle").textContent = `${e.s.street || e.s.name}, ${e.s.ntaName}`;
  drawProfile($("#profile"), e, { h: 300 });
  $("#profileNote").innerHTML = `${niceDT.format(e.t)} · ${typeLabel(e.type).toLowerCase()} site. Water reached <b>${in1(e.depth)}</b> in ${dur(e.onset)}, then took ${dur(e.drain)} to drain.` +
    (e.d12 ? ` It was over a foot deep for ${dur(e.d12)}.` : "");
}

// ---------- neighborhoods ----------
const hoodState = { type: "all", boro: "", sort: "rate" };
function renderHoods() {
  const boros = [...new Set(S.map(s => s.boro))].sort();
  if (!renderHoods.bound) {
    renderHoods.bound = true;
    $("#hoodBoro").insertAdjacentHTML("beforeend", boros.map(b => `<option>${b}</option>`).join(""));
    $("#planBoro").insertAdjacentHTML("beforeend", boros.map(b => `<option>${b}</option>`).join(""));
    $("#hoodBoro").addEventListener("change", (e) => { hoodState.boro = e.target.value; renderHoods(); });
    $$("[data-hood]").forEach(b => b.addEventListener("click", () => { $$("[data-hood]").forEach(x => x.classList.toggle("on", x === b)); hoodState.type = b.dataset.hood; renderHoods(); }));
  }
  const sens = S.filter(s => (hoodState.type === "all" || s.type === hoodState.type) && (!hoodState.boro || s.boro === hoodState.boro) && s.t0);
  const groups = d3.groups(sens, s => s.ntaName + "|" + s.boro).map(([k, ss]) => {
    const [name, boro] = k.split("|");
    const evs = ss.flatMap(s => s.evs);
    const sy = d3.sum(ss, s => Math.max(0, (Math.min(s.t1, NOW) - s.t0) / YEAR_MS));
    const days = d3.rollup(evs, v => new Set(v.map(e => e.s.idx)).size, e => e.day);
    const worst = [...days].sort((a, b) => b[1] - a[1])[0];
    return { name, boro, sensors: ss.length, sy, n: evs.length, rate: sy > 0.25 ? evs.length / sy : null,
      max: d3.max(evs, e => e.depth) || 0, worst: worst ? worst[0] : null, deep12: evs.filter(e => e.depth >= 12).length };
  });
  const cols = [
    { k: "name", label: "Neighborhood" }, { k: "boro", label: "Borough" },
    { k: "sensors", label: "Sensors", num: true }, { k: "n", label: "Floods", num: true },
    { k: "rate", label: "Floods per sensor-year", num: true, bar: true },
    { k: "deep12", label: "Floods ≥ 1 ft", num: true }, { k: "max", label: "Deepest", num: true }, { k: "worst", label: "Worst day" },
  ];
  const sk = hoodState.sort;
  groups.sort((a, b) => (typeof a[sk] === "string" ? (a[sk] || "").localeCompare(b[sk] || "") : (b[sk] ?? -1) - (a[sk] ?? -1)));
  const maxRate = d3.max(groups, g => g.rate) || 1;
  $("#hoodTable").innerHTML = `<thead><tr>${cols.map(c => `<th class="${c.num ? "num" : ""}" data-k="${c.k}" ${c.k === sk ? 'aria-sort="descending"' : ""} scope="col">${c.label}</th>`).join("")}</tr></thead>
    <tbody>${groups.map(g => `<tr>
      <td>${g.name}</td><td>${g.boro}</td><td class="num">${g.sensors}</td><td class="num">${n0(g.n)}</td>
      <td class="num">${g.rate == null ? "—" : g.rate.toFixed(1)}<span class="bar-cell" style="width:${g.rate ? Math.max(2, 70 * g.rate / maxRate) : 0}px"></span></td>
      <td class="num">${n0(g.deep12)}</td><td class="num">${g.n ? in1(g.max) : "—"}</td><td>${g.worst ? fmtKey(g.worst) : "—"}</td></tr>`).join("")}</tbody>`;
  $$("#hoodTable th").forEach(th => th.addEventListener("click", () => { hoodState.sort = th.dataset.k; renderHoods(); }));
}

// ---------- 311 ----------
function render311() {
  const el = $("#vs311"); el.innerHTML = "";
  const rainEv = E.filter(e => e.type === "rain");
  const days = d3.rollups(rainEv, v => new Set(v.map(e => e.s.idx)).size, e => e.day)
    .filter(([k]) => k >= "2020-11-01").map(([k, n]) => ({ k, n, calls: CTX.c311[k] ? d3.sum(Object.values(CTX.c311[k])) : 0 }));
  const allDays = Object.entries(CTX.c311).map(([k, v]) => d3.sum(Object.values(v)));
  const typical = d3.median(allDays);
  const W = el.clientWidth || 600, H = 340, m = { t: 12, r: 14, b: 40, l: 50 };
  const x = d3.scaleSqrt([0, d3.max(days, d => d.n)], [m.l, W - m.r]).nice();
  const y = d3.scaleSqrt([0, d3.max(days, d => d.calls)], [H - m.b, m.t]).nice();
  const svg = d3.select(el).append("svg").attr("width", W).attr("height", H);
  svg.append("g").attr("class", "grid").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(W - m.l - m.r)).tickFormat(""));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(0)).call(g => g.select("path").remove());
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(6).tickSizeOuter(0));
  svg.append("text").attr("x", (m.l + W - m.r) / 2).attr("y", H - 6).attr("text-anchor", "middle").text("Sensors that flooded that day →");
  svg.append("text").attr("transform", `translate(12,${(m.t + H - m.b) / 2}) rotate(-90)`).attr("text-anchor", "middle").text("311 flooding calls →");
  svg.append("line").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(typical)).attr("y2", y(typical)).style("stroke", "var(--muted)");
  svg.append("text").attr("x", W - m.r).attr("y", y(typical) - 5).attr("text-anchor", "end").text(`typical day: ${Math.round(typical)} calls`);
  svg.append("g").selectAll("circle").data(days).join("circle").attr("cx", d => x(d.n)).attr("cy", d => y(d.calls)).attr("r", 4.5)
    .style("fill", "var(--rain)").style("opacity", 0.75).style("stroke", "var(--surface)").style("stroke-width", 1.5).style("cursor", "pointer")
    .on("mousemove", (ev, d) => showTip(`<b>${fmtKey(d.k)}</b>${row("Sensors flooded", d.n)}${row("311 flooding calls", n0(d.calls))}<div class="note">Tap to replay</div>`, ev))
    .on("mouseleave", hideTip).on("click", (ev, d) => loadStorm(d.k, true));
  const big = days.sort((a, b) => b.n - a.n)[0];
  svg.append("text").attr("class", "lbl-strong").attr("x", x(big.n) - 8).attr("y", y(big.calls) - 10).attr("text-anchor", "end").text(fmtKey(big.k));
  const quiet = days.filter(d => d.calls <= typical * 1.25);
  const quiet3 = days.filter(d => d.n >= 3);
  const quiet3q = quiet3.filter(d => d.calls <= typical * 1.25);
  $("#callout311").innerHTML = `<div class="big">${Math.round(100 * quiet.length / days.length)}%</div>
    <p>of the ${n0(days.length)} days when rain-driven sensors flooded, 311 got <b>no more street-flooding calls than an ordinary day</b> (about ${Math.round(typical)} citywide). That's true even on ${n0(quiet3q.length)} of the ${n0(quiet3.length)} days when 3 or more sensors flooded.</p>
    <p>Many small floods never get reported, and they still damage cars, basements, and businesses. Sensor records fill that gap, so the City can see where flooding repeats, not only where people complain.</p>
    <p class="note">311 counts are citywide calls coded Street Flooding, Catch Basin Clogged/Flooding, or Highway Flooding. They aren't matched to sensor locations.</p>`;
}

// ---------- growth ----------
function renderGrowth() {
  const months = d3.utcMonths(new Date(d3.min(S, s => s.t0 || NOW)), new Date(NOW));
  const active = months.map(mo => [mo, S.filter(s => s.t0 && s.t0 <= +mo && s.t1 >= +mo).length]);
  let el = $("#activeChart"); el.innerHTML = "";
  let W = el.clientWidth || 480, H = 220, m = { t: 12, r: 40, b: 24, l: 40 };
  const x = d3.scaleUtc(d3.extent(months), [m.l, W - m.r]);
  const y = d3.scaleLinear([0, d3.max(active, d => d[1])], [H - m.b, m.t]).nice();
  let svg = d3.select(el).append("svg").attr("width", W).attr("height", H);
  svg.append("g").attr("class", "grid").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickSize(-(W - m.l - m.r)).tickFormat(""));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickSize(0)).call(g => g.select("path").remove());
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(6).tickSizeOuter(0));
  svg.append("path").attr("d", d3.area().x(d => x(d[0])).y0(y(0)).y1(d => y(d[1]))(active)).style("fill", "var(--rain)").style("opacity", 0.1);
  svg.append("path").attr("d", d3.line().x(d => x(d[0])).y(d => y(d[1]))(active)).style("fill", "none").style("stroke", "var(--rain)").style("stroke-width", 2);
  const last = active[active.length - 1];
  svg.append("circle").attr("cx", x(last[0])).attr("cy", y(last[1])).attr("r", 4).style("fill", "var(--rain)").style("stroke", "var(--surface)").style("stroke-width", 2);
  svg.append("text").attr("class", "lbl-strong").attr("x", x(last[0]) + 6).attr("y", y(last[1]) + 4).text(last[1]);
  const hover = svg.append("line").attr("y1", m.t).attr("y2", H - m.b).style("stroke", "var(--axis)").style("opacity", 0);
  svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", W - m.l - m.r).attr("height", H - m.t - m.b).style("fill", "transparent")
    .on("mousemove", (ev) => { const t = x.invert(d3.pointer(ev)[0]); const d = active[d3.bisector(d => d[0]).center(active, t)]; hover.attr("x1", x(d[0])).attr("x2", x(d[0])).style("opacity", 1); showTip(`<b>${d3.utcFormat("%b %Y")(d[0])}</b>${row("Active sensors", d[1])}`, ev); })
    .on("mouseleave", () => { hover.style("opacity", 0); hideTip(); });

  // per-sensor rate by year (rain sites)
  const y0 = +dayKey(d3.min(E, e => e.t)).slice(0, 4) + 1, y1 = +dayKey(NOW).slice(0, 4);
  const rows = d3.range(y0, y1 + 1).map(yr => {
    const a = Date.UTC(yr, 0, 1), b = Math.min(Date.UTC(yr + 1, 0, 1), NOW);
    const sy = d3.sum(S.filter(s => s.type === "rain" && s.t0), s => Math.max(0, Math.min(b, s.t1) - Math.max(a, s.t0)) / YEAR_MS);
    const n = E.filter(e => e.type === "rain" && +e.day.slice(0, 4) === yr).length;
    return { yr, rate: sy > 0 ? n / sy : 0, n, sy, partial: b < Date.UTC(yr + 1, 0, 1) };
  });
  el = $("#perSensorChart"); el.innerHTML = "";
  W = el.clientWidth || 480; m = { t: 20, r: 8, b: 24, l: 40 };
  const xb = d3.scaleBand(rows.map(r => r.yr), [m.l, W - m.r]).padding(0.3);
  const yb = d3.scaleLinear([0, d3.max(rows, r => r.rate)], [H - m.b, m.t]).nice();
  svg = d3.select(el).append("svg").attr("width", W).attr("height", H);
  svg.append("g").attr("class", "grid").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(yb).ticks(4).tickSize(-(W - m.l - m.r)).tickFormat(""));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(yb).ticks(4).tickSize(0)).call(g => g.select("path").remove());
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`).call(d3.axisBottom(xb).tickFormat(d => (rows.find(r => r.yr === d).partial ? d + "*" : d)).tickSize(0));
  const bw = Math.min(24, xb.bandwidth());
  svg.append("g").selectAll("path").data(rows).join("path")
    .attr("d", r => { const x0 = xb(r.yr) + (xb.bandwidth() - bw) / 2, ya = yb(0), yv = yb(r.rate), rr = Math.min(4, ya - yv);
      return `M${x0},${ya}V${yv + rr}Q${x0},${yv} ${x0 + rr},${yv}H${x0 + bw - rr}Q${x0 + bw},${yv} ${x0 + bw},${yv + rr}V${ya}Z`; })
    .style("fill", "var(--rain)")
    .on("mousemove", (ev, r) => showTip(`<b>${r.yr}${r.partial ? " (so far)" : ""}</b>${row("Rain-driven floods", n0(r.n))}${row("Sensor-years", r.sy.toFixed(0))}${row("Per sensor", r.rate.toFixed(2))}`, ev)).on("mouseleave", hideTip);
  svg.append("g").selectAll("text").data(rows).join("text").attr("class", "lbl").attr("text-anchor", "middle")
    .attr("x", r => xb(r.yr) + xb.bandwidth() / 2).attr("y", r => yb(r.rate) - 5).text(r => r.rate.toFixed(1));
  svg.append("text").attr("x", W - m.r).attr("y", 10).attr("text-anchor", "end").text("* year to date");
}

// ---------- plans ----------
const planState = { boro: "", kind: "" };
function renderPlans() {
  const kinds = [...new Set(CITY_PLANS.map(p => p.kind))];
  if (!renderPlans.bound) {
    renderPlans.bound = true;
    $("#planKinds").innerHTML = `<button data-kind="" class="on">All</button>` + kinds.map(k => `<button data-kind="${k}">${k}</button>`).join("");
    $$("[data-kind]").forEach(b => b.addEventListener("click", () => { $$("[data-kind]").forEach(x => x.classList.toggle("on", x === b)); planState.kind = b.dataset.kind; renderPlans(); }));
    $("#planBoro").addEventListener("change", (e) => { planState.boro = e.target.value; renderPlans(); });
  }
  const list = CITY_PLANS.filter(p => (!planState.kind || p.kind === planState.kind) && (!planState.boro || p.boros.includes("*") || p.boros.includes(planState.boro)));
  $("#planGrid").innerHTML = list.map(p => {
    const near = S.filter(s => p.areas.length && (p.boros.includes(s.boro) || p.boros.includes("*")) && p.areas.some(a => s.ntaName.includes(a)));
    const nEv = d3.sum(near, s => s.evs.length);
    return `<article class="plan">
      <div class="kind">${p.kind}</div>
      <h3>${p.title}</h3>
      <p>${p.text}</p>
      <div class="facts">
        <div><b>Status:</b> ${p.status}</div>
        ${p.money ? `<div><b>Funding:</b> ${p.money}</div>` : ""}
        <div><b>When:</b> ${p.when}</div>
        ${near.length ? `<div><b>FloodNet nearby:</b> ${near.length} sensors in these neighborhoods have recorded ${n0(nEv)} floods</div>` : ""}
      </div>
      <a class="go" href="${p.url}" target="_blank" rel="noopener">Official source →</a>
    </article>`;
  }).join("");
}
function renderSteps() {
  $("#stepsGrid").innerHTML = RESIDENT_STEPS.map((s, i) => `<div class="step"><div class="num">${i + 1}</div><h3>${s.title}</h3><p>${s.text}</p><a href="${s.url}" target="_blank" rel="noopener">Learn more →</a></div>`).join("");
}
})();
