/* Fire Before Fire — Live hardware dashboard (ACS712 + DS18B20) */

const PAGE_TITLES = {
  dashboard: "Dashboard",
  monitoring: "Monitoring",
  regions: "Hardware",
  statistics: "Statistics",
  bayesian: "Gaussian NB",
  alerts: "Alerts",
  history: "Event History",
  settings: "Settings",
};

const plotlyLayoutBase = {
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor: "rgba(11,18,32,0.55)",
  font: { family: "IBM Plex Sans, sans-serif", color: "#94A3B8", size: 11 },
  margin: { t: 24, r: 18, b: 40, l: 48 },
  xaxis: {
    gridcolor: "#243044",
    zerolinecolor: "#243044",
    linecolor: "#243044",
    tickfont: { family: "IBM Plex Mono, monospace", size: 10 },
  },
  yaxis: {
    gridcolor: "#243044",
    zerolinecolor: "#243044",
    linecolor: "#243044",
    tickfont: { family: "IBM Plex Mono, monospace", size: 10 },
  },
  hovermode: "x unified",
  showlegend: false,
};

const plotlyConfig = {
  responsive: true,
  displayModeBar: true,
  displaylogo: false,
  modeBarButtonsToRemove: ["lasso2d", "select2d"],
  toImageButtonOptions: { format: "png", filename: "fire-before-fire-chart" },
};

/* -------------------- Live hardware region (single ESP32 node) -------------------- */
let regions = [
  {
    id: 1,
    name: "ESP32 Local Node",
    sensor: "ACS712+DS18B20",
    appliance: "SoftAP circuit monitor",
    material: "Copper",
    resistance: 0.04,
    maxCurrent: 16,
    maxTemp: 70,
    status: "ok",
  },
];

let alerts = [];
let historyEvents = [];

const HISTORY_MAX = 180; // ~6 min at 2s poll
const liveSeries = {
  t: [],
  current: [],
  temp: [],
  power: [],
  currentSlope: [],
  tempSlope: [],
  risk: [],
  conf: [],
  varI: [],
  ma3I: [],
  ma3T: [],
  tempAcc: [],
};

let chartsInitialized = {
  monitoring: false,
  statistics: false,
  bayesian: false,
};
let alertFilter = "all";

/* -------------------- Utilities -------------------- */
function timeAxis(n, stepSec = 2) {
  const now = Date.now();
  return Array.from(
    { length: n },
    (_, i) => new Date(now - (n - i) * stepSec * 1000),
  );
}

function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.add("hidden"), 2400);
}

function animateCounters() {
  document.querySelectorAll("[data-counter]").forEach((el) => {
    const target = parseFloat(el.dataset.counter);
    const decimals = String(el.dataset.counter).includes(".")
      ? String(el.dataset.counter).split(".")[1].length
      : 0;
    const duration = 900;
    const start = performance.now();
    const from = 0;

    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const val = from + (target - from) * eased;
      el.textContent = val.toFixed(decimals);
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
}

/* -------------------- Clock -------------------- */
function updateClock() {
  const el = document.getElementById("clock");
  if (!el) return;
  const d = new Date();
  el.textContent = d.toLocaleTimeString("en-GB", { hour12: false });
}

/* -------------------- Sidebar / Navigation -------------------- */
function openSidebar() {
  document.getElementById("sidebar").classList.add("open");
  document.getElementById("sidebar-overlay").classList.remove("hidden");
}

function closeSidebar() {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebar-overlay").classList.add("hidden");
}

function navigateTo(page) {
  document
    .querySelectorAll(".page")
    .forEach((p) => p.classList.remove("active"));
  const target = document.getElementById(`page-${page}`);
  if (target) target.classList.add("active");

  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.page === page);
  });

  document.getElementById("page-title").textContent = PAGE_TITLES[page] || page;
  closeSidebar();

  requestAnimationFrame(() => {
    if (page === "monitoring") initMonitoringCharts();
    if (page === "statistics") initStatisticsCharts();
    if (page === "bayesian") initBayesianCharts();
    window.dispatchEvent(new Event("resize"));
  });
}

/* -------------------- Sparklines (dashboard) -------------------- */
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function renderSpark(id, data, color) {
  const el = document.getElementById(id);
  if (!el) return;
  const series = data?.length ? data : [0];

  if (typeof Plotly !== "undefined") {
    Plotly.react(
      el,
      [
        {
          y: series,
          type: "scatter",
          mode: "lines",
          fill: "tozeroy",
          line: { color, width: 1.5, shape: "spline" },
          fillcolor: hexToRgba(color, 0.12),
          hoverinfo: "skip",
        },
      ],
      {
        margin: { t: 0, r: 0, b: 0, l: 0 },
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)",
        xaxis: { visible: false },
        yaxis: { visible: false },
        height: 36,
      },
      { staticPlot: true, displayModeBar: false, responsive: true },
    );
    return;
  }

  // SoftAP fallback (no Plotly CDN)
  const w = el.clientWidth || 160;
  const h = 36;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const pts = series
    .map((v, i) => {
      const x = (i / Math.max(series.length - 1, 1)) * (w - 2) + 1;
      const y = h - 2 - ((v - min) / span) * (h - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  el.innerHTML = `<svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polyline fill="none" stroke="${color}" stroke-width="1.5" points="${pts}"/>
  </svg>`;
}

function initDashboardSparks() {
  const tail = (arr) => (arr.length ? arr.slice(-40) : [0]);
  renderSpark("spark-current", tail(liveSeries.current), "#3B82F6");
  renderSpark("spark-temp", tail(liveSeries.temp), "#22C55E");
  renderSpark("spark-power", tail(liveSeries.power), "#60A5FA");
  renderSpark("spark-cslope", tail(liveSeries.currentSlope), "#4ADE80");
  renderSpark("spark-tslope", tail(liveSeries.tempSlope), "#F59E0B");
  renderSpark("spark-conf", tail(liveSeries.conf), "#3B82F6");
}

/* -------------------- Monitoring charts -------------------- */
function makeLineChart(id, y, color, yTitle, threshold) {
  const x =
    liveSeries.t.length === y.length ? liveSeries.t : timeAxis(y.length);
  const traces = [
    {
      x,
      y,
      type: "scatter",
      mode: "lines",
      name: yTitle,
      line: { color, width: 2, shape: "spline" },
      hovertemplate: `%{y:.3f}<extra>${yTitle}</extra>`,
    },
  ];

  if (typeof threshold === "number") {
    traces.push({
      x,
      y: x.map(() => threshold),
      type: "scatter",
      mode: "lines",
      name: "Threshold",
      line: { color: "#EF4444", width: 1, dash: "dot" },
      hoverinfo: "skip",
    });
  }

  const layout = {
    ...plotlyLayoutBase,
    yaxis: {
      ...plotlyLayoutBase.yaxis,
      title: { text: yTitle, font: { size: 11 } },
    },
    xaxis: { ...plotlyLayoutBase.xaxis, type: "date" },
  };

  Plotly.newPlot(id, traces, layout, plotlyConfig);
}

function markChartOffline(ids) {
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el || el.dataset.offlineMsg) return;
    el.dataset.offlineMsg = "1";
    el.innerHTML =
      '<div class="chart-empty">Charts load when Plotly CDN is available (needs internet once). Dashboard sparklines work offline.</div>';
  });
}

function initMonitoringCharts(force = false) {
  if (typeof Plotly === "undefined") {
    markChartOffline([
      "chart-current",
      "chart-temp",
      "chart-power",
      "chart-cslope",
      "chart-tslope",
    ]);
    return;
  }
  const n = Math.max(liveSeries.current.length, 2);
  const cur = liveSeries.current.length ? liveSeries.current : [0, 0];
  const tmp = liveSeries.temp.length ? liveSeries.temp : [0, 0];
  const pwr = liveSeries.power.length ? liveSeries.power : [0, 0];
  const csl = liveSeries.currentSlope.length ? liveSeries.currentSlope : [0, 0];
  const tsl = liveSeries.tempSlope.length ? liveSeries.tempSlope : [0, 0];
  const th = thresholdCache;

  if (chartsInitialized.monitoring && !force) {
    const x = liveSeries.t.length ? liveSeries.t : timeAxis(n);
    Plotly.react(
      "chart-current",
      [
        {
          x,
          y: cur,
          type: "scatter",
          mode: "lines",
          line: { color: "#3B82F6", width: 2 },
        },
      ],
      {
        ...plotlyLayoutBase,
        yaxis: { ...plotlyLayoutBase.yaxis, title: "Current (A)" },
        xaxis: { ...plotlyLayoutBase.xaxis, type: "date" },
      },
      plotlyConfig,
    );
    Plotly.react(
      "chart-temp",
      [
        {
          x,
          y: tmp,
          type: "scatter",
          mode: "lines",
          line: { color: "#22C55E", width: 2 },
        },
        {
          x,
          y: x.map(() => th.temp?.critical ?? 70),
          type: "scatter",
          mode: "lines",
          line: { color: "#EF4444", width: 1, dash: "dot" },
        },
      ],
      {
        ...plotlyLayoutBase,
        yaxis: { ...plotlyLayoutBase.yaxis, title: "Temperature (°C)" },
        xaxis: { ...plotlyLayoutBase.xaxis, type: "date" },
      },
      plotlyConfig,
    );
    Plotly.react(
      "chart-power",
      [
        {
          x,
          y: pwr,
          type: "scatter",
          mode: "lines",
          line: { color: "#60A5FA", width: 2 },
        },
      ],
      {
        ...plotlyLayoutBase,
        yaxis: { ...plotlyLayoutBase.yaxis, title: "Power (kW)" },
        xaxis: { ...plotlyLayoutBase.xaxis, type: "date" },
      },
      plotlyConfig,
    );
    Plotly.react(
      "chart-cslope",
      [
        {
          x,
          y: csl,
          type: "scatter",
          mode: "lines",
          line: { color: "#4ADE80", width: 2 },
        },
        {
          x,
          y: x.map(() => th.currentSlope?.warn ?? 0.5),
          type: "scatter",
          mode: "lines",
          line: { color: "#EF4444", width: 1, dash: "dot" },
        },
      ],
      {
        ...plotlyLayoutBase,
        yaxis: { ...plotlyLayoutBase.yaxis, title: "dI/dt (A/s)" },
        xaxis: { ...plotlyLayoutBase.xaxis, type: "date" },
      },
      plotlyConfig,
    );
    Plotly.react(
      "chart-tslope",
      [
        {
          x,
          y: tsl,
          type: "scatter",
          mode: "lines",
          line: { color: "#F59E0B", width: 2 },
        },
        {
          x,
          y: x.map(() => th.tempSlope?.warn ?? 0.08),
          type: "scatter",
          mode: "lines",
          line: { color: "#EF4444", width: 1, dash: "dot" },
        },
      ],
      {
        ...plotlyLayoutBase,
        yaxis: { ...plotlyLayoutBase.yaxis, title: "dT/dt (°C/s)" },
        xaxis: { ...plotlyLayoutBase.xaxis, type: "date" },
      },
      plotlyConfig,
    );
    return;
  }

  makeLineChart("chart-current", cur, "#3B82F6", "Current (A)");
  makeLineChart(
    "chart-temp",
    tmp,
    "#22C55E",
    "Temperature (°C)",
    th.temp?.critical ?? 70,
  );
  makeLineChart("chart-power", pwr, "#60A5FA", "Power (kW)");
  makeLineChart(
    "chart-cslope",
    csl,
    "#4ADE80",
    "dI/dt (A/s)",
    th.currentSlope?.warn ?? 0.5,
  );
  makeLineChart(
    "chart-tslope",
    tsl,
    "#F59E0B",
    "dT/dt (°C/s)",
    th.tempSlope?.warn ?? 0.08,
  );
  chartsInitialized.monitoring = true;
}

function refreshMonitoringCharts() {
  chartsInitialized.monitoring = false;
  initMonitoringCharts(true);
  showToast("Monitoring charts refreshed from live sensors");
}

/* -------------------- Statistics charts -------------------- */
function initStatisticsCharts(force = false) {
  if (typeof Plotly === "undefined") return;
  if (liveSeries.current.length >= 3) {
    refreshStatisticsFromLive();
    return;
  }
  if (chartsInitialized.statistics && !force) {
    ["chart-hist", "chart-gauss", "chart-trend"].forEach((id) =>
      Plotly.Plots.resize(id),
    );
    return;
  }
  // waiting for live samples
  chartsInitialized.statistics = false;
}

/* -------------------- Bayesian chart -------------------- */
function initBayesianCharts(force = false) {
  if (typeof Plotly === "undefined") return;
  if (liveSeries.risk.length >= 2) {
    refreshBayesianFromLive(
      liveState || { riskPercent: liveSeries.risk.at(-1), status: "ok" },
    );
    return;
  }
  if (chartsInitialized.bayesian && !force) {
    Plotly.Plots.resize("chart-bayes");
    return;
  }
}

/* -------------------- Regions -------------------- */
function statusMeta(status) {
  if (status === "ok")
    return {
      label: "Normal",
      cls: "bg-success-soft text-success-muted",
      dot: "status-ok",
    };
  if (status === "warn")
    return {
      label: "Caution",
      cls: "bg-warning-soft text-warning-muted",
      dot: "status-warn",
    };
  return {
    label: "Critical",
    cls: "bg-danger-soft text-danger-muted",
    dot: "status-danger",
  };
}

function renderRegions() {
  const grid = document.getElementById("regions-grid");
  if (!grid) return;
  const r = regions[0];
  const s = statusMeta(r.status);
  const live = liveState || {};
  const f = live.features || {};
  grid.innerHTML = `
      <article class="glass glass-hover section-panel shadow-glass h-full flex flex-col sm:col-span-2 xl:col-span-3">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <h3 class="text-base font-semibold text-ink truncate">${r.name}</h3>
            <p class="mt-0.5 text-xs text-ink-dim">ACS712 (GPIO 34) · DS18B20 (GPIO 4) · SoftAP 192.168.4.1</p>
          </div>
          <span class="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-semibold uppercase ${s.cls}">
            <span class="status-dot ${s.dot}"></span>${s.label}
          </span>
        </div>
        <dl class="mt-4 grid grid-cols-2 gap-3 text-xs md:grid-cols-4 flex-1">
          <div>
            <dt class="text-ink-dim">Live current</dt>
            <dd class="mt-0.5 font-mono text-ink">${fmtNum(f.current, 2)} A</dd>
          </div>
          <div>
            <dt class="text-ink-dim">Live temperature</dt>
            <dd class="mt-0.5 font-mono text-ink">${fmtNum(f.temp, 1)} °C</dd>
          </div>
          <div>
            <dt class="text-ink-dim">Est. power (230×|I|)</dt>
            <dd class="mt-0.5 font-mono text-ink">${fmtNum((f.power || 0) / 1000, 2)} kW</dd>
          </div>
          <div>
            <dt class="text-ink-dim">Prediction</dt>
            <dd class="mt-0.5 font-mono text-ink">${live.predictionSource || "rules"}</dd>
          </div>
          <div>
            <dt class="text-ink-dim">Dataset rows</dt>
            <dd class="mt-0.5 font-mono text-ink">${live.datasetCount ?? 0} / 100</dd>
          </div>
          <div>
            <dt class="text-ink-dim">Batch window</dt>
            <dd class="mt-0.5 font-mono text-ink">${live.batchCount ?? 0} / ${live.batchSize ?? 60}</dd>
          </div>
          <div>
            <dt class="text-ink-dim">Default max current</dt>
            <dd class="mt-0.5 font-mono text-ink">${r.maxCurrent} A</dd>
          </div>
          <div>
            <dt class="text-ink-dim">Default max temp</dt>
            <dd class="mt-0.5 font-mono text-ink">${r.maxTemp} °C</dd>
          </div>
        </dl>
      </article>`;
}

/* -------------------- Alerts -------------------- */
function severityBorder(level) {
  if (level === "green") return "sev-green";
  if (level === "yellow") return "sev-yellow";
  if (level === "orange") return "sev-orange";
  return "sev-red";
}

function severityColor(level) {
  if (level === "green") return "text-success-muted bg-success-soft";
  if (level === "yellow") return "text-yellow-400 bg-yellow-400/10";
  if (level === "orange") return "text-warning-muted bg-warning-soft";
  return "text-danger-muted bg-danger-soft";
}

function renderAlerts() {
  const list = alerts.filter(
    (a) => alertFilter === "all" || a.state === alertFilter,
  );
  const el = document.getElementById("alerts-timeline");
  if (!el) return;
  if (!list.length) {
    el.innerHTML = `<div class="empty-state">No alerts in this filter — system nominal</div>`;
    return;
  }
  el.innerHTML = list
    .map(
      (a) => `
    <div class="relative pb-6 pl-6">
      <span class="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ${
        a.level === "red"
          ? "bg-danger alert-blink"
          : a.level === "orange"
            ? "bg-warning"
            : a.level === "yellow"
              ? "bg-yellow-400"
              : "bg-success"
      }"></span>
      <article class="glass rounded-xl border-l-4 ${severityBorder(a.level)} p-4 ${a.state === "current" && a.level === "red" ? "shadow-glow-danger" : ""}">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h4 class="text-sm font-semibold text-ink">${a.title}</h4>
              <span class="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${severityColor(a.level)}">${a.level}</span>
              <span class="rounded bg-surface-raised px-1.5 py-0.5 text-[9px] uppercase text-ink-dim">${a.state}</span>
            </div>
            <p class="mt-1 text-xs text-ink-muted break-words">${a.reason}</p>
          </div>
          <time class="font-mono text-[11px] text-ink-dim shrink-0">${a.time}</time>
        </div>
        <div class="mt-3 flex flex-wrap gap-3 text-[11px] text-ink-dim">
          <span>Node: <span class="text-ink-muted">${a.region}</span></span>
          <span>Sensor: <span class="font-mono text-ink-muted">${a.sensor}</span></span>
          <span>Level: <span class="text-ink-muted capitalize">${a.severity}</span></span>
        </div>
      </article>
    </div>`,
    )
    .join("");
}

/* -------------------- Event History -------------------- */
function severityBadge(sev) {
  if (sev === "critical") return "bg-danger-soft text-danger-muted";
  if (sev === "warning") return "bg-warning-soft text-warning-muted";
  return "bg-success-soft text-success-muted";
}

const HISTORY_PAGE_SIZE = 10;
let historyPage = 0;

function filteredHistoryRows() {
  const q = (
    document.getElementById("history-search")?.value || ""
  ).toLowerCase();
  const sev = document.getElementById("history-severity")?.value || "all";
  const region = document.getElementById("history-region")?.value || "all";
  const sort = document.getElementById("history-sort")?.value || "newest";

  let rows = historyEvents.filter((e) => {
    const matchQ =
      !q ||
      e.event.toLowerCase().includes(q) ||
      e.region.toLowerCase().includes(q) ||
      e.sensor.toLowerCase().includes(q);
    const matchSev = sev === "all" || e.severity === sev;
    const matchRegion = region === "all" || e.region === region;
    return matchQ && matchSev && matchRegion;
  });

  rows = [...rows].sort((a, b) => {
    if (sort === "oldest") return a.time.localeCompare(b.time);
    if (sort === "severity") {
      const rank = { critical: 0, warning: 1, info: 2 };
      return (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9);
    }
    return b.time.localeCompare(a.time);
  });
  return rows;
}

function renderHistory() {
  const tbody = document.getElementById("history-tbody");
  if (!tbody) return;
  const rows = filteredHistoryRows();
  const pages = Math.max(1, Math.ceil(rows.length / HISTORY_PAGE_SIZE) || 1);
  if (historyPage >= pages) historyPage = pages - 1;
  if (historyPage < 0) historyPage = 0;
  const start = historyPage * HISTORY_PAGE_SIZE;
  const pageRows = rows.slice(start, start + HISTORY_PAGE_SIZE);

  tbody.innerHTML = pageRows.length
    ? pageRows
        .map(
          (e) => `
    <tr>
      <td class="px-4 py-3 font-mono text-xs whitespace-nowrap">${e.time}</td>
      <td class="px-4 py-3 text-ink">${e.event}</td>
      <td class="px-4 py-3">${e.region}</td>
      <td class="px-4 py-3 font-mono text-xs">${e.sensor}</td>
      <td class="px-4 py-3">
        <span class="rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${severityBadge(e.severity)}">${e.severity}</span>
      </td>
      <td class="px-4 py-3 font-mono text-xs">${e.value}</td>
    </tr>`,
        )
        .join("")
    : `<tr><td colspan="6" class="px-4 py-8 text-center text-ink-dim">No logged events yet</td></tr>`;

  const countEl = document.getElementById("history-count");
  if (countEl) {
    countEl.textContent = rows.length
      ? `Showing ${start + 1}–${Math.min(start + pageRows.length, rows.length)} of ${rows.length}`
      : "Showing 0 events";
  }
  const pageLabel = document.getElementById("history-page-label");
  if (pageLabel) pageLabel.textContent = `${historyPage + 1} / ${pages}`;
  const prev = document.getElementById("history-prev");
  const next = document.getElementById("history-next");
  if (prev) prev.disabled = historyPage <= 0;
  if (next) next.disabled = historyPage >= pages - 1 || rows.length === 0;
}

function downloadBlob(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportHistoryCsv() {
  const rows = filteredHistoryRows();
  const header = ["time", "event", "region", "sensor", "severity", "value"];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const body = rows
    .map((e) =>
      [e.time, e.event, e.region, e.sensor, e.severity, e.value]
        .map(esc)
        .join(","),
    )
    .join("\n");
  downloadBlob(
    `fbf-history-${Date.now()}.csv`,
    `${header.join(",")}\n${body}\n`,
    "text/csv;charset=utf-8",
  );
  showToast(`Exported ${rows.length} events (CSV)`);
}

async function exportHistoryJson() {
  let dataset = null;
  try {
    dataset = await api("/api/dataset");
  } catch (_) {}
  const payload = {
    exportedAt: new Date().toISOString(),
    node: "ESP32 Local Node",
    live: liveState
      ? {
          status: liveState.status,
          riskPercent: liveState.riskPercent,
          predictionSource: liveState.predictionSource,
          features: liveState.features,
          gnb: liveState.gnb,
        }
      : null,
    history: filteredHistoryRows(),
    dataset,
  };
  downloadBlob(
    `fbf-export-${Date.now()}.json`,
    JSON.stringify(payload, null, 2),
    "application/json",
  );
  showToast("Exported JSON (history + dataset)");
}

const DATASET_CSV_COLS = [
  "i",
  "current",
  "temp",
  "ma3I",
  "ma3T",
  "currentSlope",
  "tempSlope",
  "varI",
  "power",
  "tempAcc",
  "target",
  "targetLabel",
];

async function fetchDatasetPayload() {
  const data = await api("/api/dataset");
  const rows = Array.isArray(data.rows) ? data.rows : [];
  return { data, rows };
}

async function exportDatasetCsv() {
  try {
    const { rows } = await fetchDatasetPayload();
    if (!rows.length) {
      showToast("No dataset rows yet — wait for a full batch (~60 s)");
      return;
    }
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const body = rows
      .map((r) => DATASET_CSV_COLS.map((k) => esc(r[k])).join(","))
      .join("\n");
    downloadBlob(
      `fbf-dataset-${Date.now()}.csv`,
      `${DATASET_CSV_COLS.join(",")}\n${body}\n`,
      "text/csv;charset=utf-8",
    );
    showToast(`Exported ${rows.length} dataset rows (CSV)`);
  } catch (_) {
    showToast("Dataset export failed — is the ESP32 online?");
  }
}

async function exportDatasetJson() {
  try {
    const { data, rows } = await fetchDatasetPayload();
    if (!rows.length) {
      showToast("No dataset rows yet — wait for a full batch (~60 s)");
      return;
    }
    const payload = {
      exportedAt: new Date().toISOString(),
      node: "ESP32 Local Node",
      legend: data.legend || "target: 0=ok, 1=warn, 2=critical",
      count: data.count ?? rows.length,
      max: data.max ?? 100,
      gnb: data.gnb || null,
      persist: liveState?.persist || null,
      rows,
    };
    downloadBlob(
      `fbf-dataset-${Date.now()}.json`,
      JSON.stringify(payload, null, 2),
      "application/json",
    );
    showToast(`Exported ${rows.length} dataset rows (JSON)`);
  } catch (_) {
    showToast("Dataset export failed — is the ESP32 online?");
  }
}

async function importGnbFromCloud() {
  const btn = document.getElementById("btn-import-gnb-cloud");
  if (btn) btn.disabled = true;
  showToast("Uploading dataset + importing GNB…");
  try {
    const data = await api("/api/cloud/import-gnb", {
      method: "POST",
      body: "{}",
    });
    showToast(
      data.ok
        ? `GNB imported (n=${data.trainN ?? "—"})`
        : data.error || "Import failed",
    );
    pollLiveStatus();
  } catch (e) {
    const hint = e.data && e.data.hint ? ` — ${e.data.hint}` : "";
    showToast((e.message || "Import failed — need Wi‑Fi + dataset") + hint);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function importLogregFromCloud() {
  const btn = document.getElementById("btn-import-logreg-cloud");
  if (btn) btn.disabled = true;
  showToast("Importing softmax LR…");
  try {
    const data = await api("/api/cloud/import-logreg", {
      method: "POST",
      body: "{}",
    });
    showToast(
      data.ok ? `Softmax LR imported (${data.source || "cloud"})` : data.error || "Import failed",
    );
    pollLiveStatus();
  } catch (e) {
    const hint = e.data && e.data.hint ? ` — ${e.data.hint}` : "";
    showToast((e.message || "LR import failed — need home Wi‑Fi") + hint);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function exportHistoryPrint() {
  const rows = filteredHistoryRows();
  const win = window.open("", "_blank");
  if (!win) {
    showToast("Pop-up blocked — allow pop-ups to print");
    return;
  }
  const tr = rows
    .map(
      (e) =>
        `<tr><td>${e.time}</td><td>${e.event}</td><td>${e.region}</td><td>${e.sensor}</td><td>${e.severity}</td><td>${e.value}</td></tr>`,
    )
    .join("");
  win.document
    .write(`<!doctype html><html><head><title>Fire Before Fire — Events</title>
    <style>body{font-family:system-ui,sans-serif;padding:24px;color:#111}
    table{border-collapse:collapse;width:100%;font-size:12px}
    th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}
    th{background:#f1f5f9}</style></head><body>
    <h1>Fire Before Fire — Event Log</h1>
    <p>${new Date().toLocaleString()} · ${rows.length} events</p>
    <table><thead><tr><th>Time</th><th>Event</th><th>Node</th><th>Sensor</th><th>Severity</th><th>Value</th></tr></thead>
    <tbody>${tr || '<tr><td colspan="6">No events</td></tr>'}</tbody></table>
    <script>window.onload=()=>window.print()<\/script></body></html>`);
  win.document.close();
}

function setConnectionStatus(ok) {
  const pill = document.getElementById("online-pill");
  const dot = document.getElementById("online-dot");
  const label = document.getElementById("online-label");
  if (dot) {
    dot.className = `status-dot ${ok ? "status-ok animate-pulseLive" : "status-danger"}`;
  }
  if (label) {
    label.textContent = ok ? "Online" : "Offline";
    label.className = `hidden sm:inline text-[11px] font-medium ${ok ? "text-success-muted" : "text-danger-muted"}`;
  }
  if (pill) {
    pill.className = ok
      ? "flex items-center gap-2 rounded-lg border border-success/30 bg-success-soft/40 px-2.5 py-1.5"
      : "flex items-center gap-2 rounded-lg border border-danger/30 bg-danger-soft/40 px-2.5 py-1.5";
  }
}

let pollTimer = null;
let autoRefreshEnabled = true;

function startPolling() {
  stopPolling();
  pollLiveStatus();
  pollTimer = setInterval(pollLiveStatus, 2000);
  autoRefreshEnabled = true;
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  autoRefreshEnabled = false;
}

function bindThemeButton() {
  const btn = document.getElementById("theme-btn");
  if (!btn) return;
  const apply = (light) => {
    document.documentElement.classList.toggle("theme-light", light);
    localStorage.setItem("fbf_theme", light ? "light" : "dark");
    showToast(light ? "Light theme" : "Dark theme");
  };
  if (localStorage.getItem("fbf_theme") === "light") {
    document.documentElement.classList.add("theme-light");
  }
  btn.addEventListener("click", () => {
    apply(!document.documentElement.classList.contains("theme-light"));
  });
}

function bindHistoryControls() {
  [
    "history-search",
    "history-severity",
    "history-region",
    "history-sort",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const resetPage = () => {
      historyPage = 0;
      renderHistory();
    };
    el.addEventListener("input", resetPage);
    el.addEventListener("change", resetPage);
  });
  document.getElementById("history-prev")?.addEventListener("click", () => {
    historyPage -= 1;
    renderHistory();
  });
  document.getElementById("history-next")?.addEventListener("click", () => {
    historyPage += 1;
    renderHistory();
  });
  document
    .getElementById("btn-export-csv")
    ?.addEventListener("click", exportHistoryCsv);
  document
    .getElementById("btn-export-json")
    ?.addEventListener("click", exportHistoryJson);
  document
    .getElementById("btn-export-print")
    ?.addEventListener("click", exportHistoryPrint);
  document
    .getElementById("btn-export-dataset-csv")
    ?.addEventListener("click", exportDatasetCsv);
  document
    .getElementById("btn-export-dataset-json")
    ?.addEventListener("click", exportDatasetJson);
  document
    .getElementById("btn-import-gnb-cloud")
    ?.addEventListener("click", importGnbFromCloud);
  document
    .getElementById("btn-import-logreg-cloud")
    ?.addEventListener("click", importLogregFromCloud);
  document
    .getElementById("btn-save-cloud-cfg")
    ?.addEventListener("click", saveCloudConfigForm);
  loadCloudConfigForm();
}

function bindAutoRefreshToggle() {
  const t = document.getElementById("auto-refresh-toggle");
  if (!t) return;
  t.addEventListener("click", () => {
    const on = !t.classList.contains("on");
    t.classList.toggle("on", on);
    t.setAttribute("aria-checked", on ? "true" : "false");
    if (on) {
      startPolling();
      showToast("Live polling on (2s)");
    } else {
      stopPolling();
      showToast("Live polling paused");
    }
  });
}

/* -------------------- Init -------------------- */
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => navigateTo(btn.dataset.page));
  });

  document.querySelectorAll(".alert-filter").forEach((btn) => {
    btn.addEventListener("click", () => {
      alertFilter = btn.dataset.filter;
      document.querySelectorAll(".alert-filter").forEach((b) => {
        b.classList.toggle("active", b === btn);
        b.classList.toggle("border-accent/40", b === btn);
        b.classList.toggle("bg-accent-soft", b === btn);
        b.classList.toggle("text-accent-muted", b === btn);
      });
      renderAlerts();
    });
  });

  document
    .getElementById("monitor-window")
    ?.addEventListener("change", refreshMonitoringCharts);

  bindThemeButton();
  bindHistoryControls();
  bindAutoRefreshToggle();
  updateClock();
  setInterval(updateClock, 1000);

  renderRegions();
  renderAlerts();
  renderHistory();
  setTimeout(initDashboardSparks, 80);

  const lu = document.getElementById("last-update");
  if (lu) lu.textContent = "just now";

  initPredictionUI();
  initPwaApp();
  startPolling();

  window.addEventListener("resize", () => {
    const active = document.querySelector(".page.active")?.id;
    if (!active || typeof Plotly === "undefined") return;
    if (active === "page-monitoring" && chartsInitialized.monitoring) {
      [
        "chart-current",
        "chart-temp",
        "chart-power",
        "chart-cslope",
        "chart-tslope",
      ].forEach((id) => {
        try {
          Plotly.Plots.resize(id);
        } catch (_) {}
      });
    }
    if (active === "page-statistics" && chartsInitialized.statistics) {
      ["chart-hist", "chart-gauss", "chart-trend"].forEach((id) => {
        try {
          Plotly.Plots.resize(id);
        } catch (_) {}
      });
    }
    if (active === "page-bayesian" && chartsInitialized.bayesian) {
      try {
        Plotly.Plots.resize("chart-bayes");
      } catch (_) {}
    }
  });
});

/* -------------------- Fire prediction (live + settings) -------------------- */
const PARAM_META = [
  {
    key: "current",
    label: "Current",
    source: "ACS712",
    stars: 4,
    unit: "A",
    step: 0.1,
  },
  {
    key: "temp",
    label: "Temperature",
    source: "DS18B20",
    stars: 5,
    unit: "C",
    step: 0.1,
  },
  {
    key: "ma3I",
    label: "Moving Avg Current",
    source: "Derived",
    stars: 3,
    unit: "A",
    step: 0.1,
  },
  {
    key: "ma3T",
    label: "Moving Avg Temperature",
    source: "Derived",
    stars: 4,
    unit: "C",
    step: 0.1,
  },
  {
    key: "currentSlope",
    label: "Current Slope",
    source: "Derived",
    stars: 4,
    unit: "A/s",
    step: 0.01,
  },
  {
    key: "tempSlope",
    label: "Temperature Slope",
    source: "Derived",
    stars: 5,
    unit: "C/s",
    step: 0.01,
  },
  {
    key: "varI",
    label: "Current Variance",
    source: "Derived",
    stars: 3,
    unit: "",
    step: 0.01,
  },
  {
    key: "power",
    label: "Estimated Power",
    source: "Derived",
    stars: 4,
    unit: "W",
    step: 10,
  },
  {
    key: "tempAcc",
    label: "Temperature Acceleration",
    source: "Derived",
    stars: 5,
    unit: "C/s2",
    step: 0.001,
  },
];

const DEFAULT_THRESHOLDS = {
  current: { warn: 12, critical: 16 },
  temp: { warn: 55, critical: 70 },
  ma3I: { warn: 11, critical: 15 },
  ma3T: { warn: 50, critical: 65 },
  currentSlope: { warn: 0.8, critical: 2.0 },
  tempSlope: { warn: 0.3, critical: 0.6 },
  varI: { warn: 0.5, critical: 1.5 },
  power: { warn: 2500, critical: 3500 },
  tempAcc: { warn: 0.15, critical: 0.35 },
};

let liveState = null;
let thresholdCache = { ...DEFAULT_THRESHOLDS };
let adaptiveEnabled = false;

function starHtml(n) {
  return "★".repeat(n) + "☆".repeat(5 - n);
}

function levelBorder(level) {
  if (level === "critical") return "border-danger";
  if (level === "warn") return "border-warning";
  return "border-success";
}

function levelDot(level) {
  if (level === "critical") return "status-danger";
  if (level === "warn") return "status-warn";
  return "status-ok";
}

function fmtNum(v, digits = 3) {
  if (v == null || Number.isNaN(v)) return "—";
  return Number(v).toFixed(digits);
}

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  let data = null;
  try {
    data = await res.json();
  } catch (_) {}
  if (!res.ok) {
    const msg =
      (data && (data.error || data.message)) || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function renderThresholdEditor(thresholds, liveValues) {
  const body = document.getElementById("threshold-editor-body");
  if (!body) return;
  const disabled = adaptiveEnabled ? "disabled" : "";
  body.innerHTML = PARAM_META.map((p) => {
    const th = thresholds[p.key] || DEFAULT_THRESHOLDS[p.key];
    const live = liveValues?.[p.key];
    return `<tr class="hover:bg-surface-hover/40">
      <td class="px-3 py-2.5 text-ink">${p.label}</td>
      <td class="px-3 py-2.5 text-ink-dim text-xs">${p.source}</td>
      <td class="px-3 py-2.5 font-mono text-xs text-warning-muted" title="${p.stars}/5">${starHtml(p.stars)}</td>
      <td class="px-3 py-2.5">
        <input data-th-key="${p.key}" data-th-field="warn" type="number" step="${p.step}" value="${th.warn}"
          ${disabled}
          class="w-28 rounded-lg border border-surface-border bg-surface-raised px-2 py-1.5 text-sm font-mono text-ink disabled:opacity-50" />
        <span class="ml-1 text-[10px] text-ink-dim">${p.unit}</span>
      </td>
      <td class="px-3 py-2.5">
        <input data-th-key="${p.key}" data-th-field="critical" type="number" step="${p.step}" value="${th.critical}"
          ${disabled}
          class="w-28 rounded-lg border border-surface-border bg-surface-raised px-2 py-1.5 text-sm font-mono text-ink disabled:opacity-50" />
        <span class="ml-1 text-[10px] text-ink-dim">${p.unit}</span>
      </td>
      <td class="px-3 py-2.5 font-mono text-xs text-ink-muted">${live == null ? "—" : fmtNum(live, p.step < 0.01 ? 4 : 3)}</td>
    </tr>`;
  }).join("");
}

function readThresholdInputs() {
  const out = {};
  PARAM_META.forEach((p) => {
    out[p.key] = {
      warn: DEFAULT_THRESHOLDS[p.key].warn,
      critical: DEFAULT_THRESHOLDS[p.key].critical,
    };
  });
  document.querySelectorAll("[data-th-key]").forEach((el) => {
    const key = el.dataset.thKey;
    const field = el.dataset.thField;
    out[key][field] = parseFloat(el.value);
  });
  return out;
}

function setAdaptiveToggle(on) {
  adaptiveEnabled = on;
  const t = document.getElementById("adaptive-toggle");
  if (t) {
    t.classList.toggle("on", on);
    t.setAttribute("aria-checked", on ? "true" : "false");
  }
  const badge = document.getElementById("mode-badge");
  if (badge) {
    badge.textContent = on ? "adaptive" : "manual";
    badge.className = on
      ? "ml-2 rounded-md bg-accent-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-muted"
      : "ml-2 rounded-md bg-warning-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning-muted";
  }
}

function renderGnbBadge(gnb, source, logreg, ensemble) {
  const badge = document.getElementById("gnb-badge");
  if (!badge) return;
  const ens = ensemble || {};
  if (ens.active || source === "ensemble") {
    const conf = ((ens.confidence || 0) * 100).toFixed(0);
    const tag = ens.agree ? "ens✓" : "ens";
    badge.textContent = `${tag}: ${ens.predLabel || "ok"} ${conf}%`;
    badge.className =
      "rounded-md bg-success-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success-muted";
    badge.title = `${ens.status || "ensemble"} · GNB ${gnb?.predLabel || "—"} / LR ${logreg?.predLabel || "—"}`;
    return;
  }
  if (!gnb && !logreg) return;
  const conf = ((gnb?.confidence || logreg?.confidence || 0) * 100).toFixed(0);
  if (gnb?.ready || logreg?.ready) {
    badge.textContent = `ml: standby ${conf}%`;
    badge.className =
      "rounded-md bg-accent-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-muted";
    badge.title = ens.status || "Models ready — below ensemble gate";
  } else {
    badge.textContent = `gnb: ${gnb?.score || 0}/10`;
    badge.className =
      "rounded-md bg-surface-raised px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-dim";
    badge.title = gnb?.status || "Collecting labeled dataset rows";
  }
}

function renderWarnings(warnings, meta = {}) {
  const box = document.getElementById("prediction-warnings");
  if (!box) return;
  if (!warnings?.length) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  box.classList.remove("hidden");
  const source = meta.source || "rules";
  box.innerHTML = warnings
    .map((w) => {
      const crit = w.level === "critical";
      const fromGnb =
        w.source === "gnb" || source === "gnb" || w.param === "gnb";
      const detail = fromGnb
        ? `NB confidence ${fmtNum(w.value, 1)}% (min ${fmtNum(w.threshold, 1)}%) · overrides rules`
        : `Value ${fmtNum(w.value)} exceeds ${w.level} threshold ${fmtNum(w.threshold)}`;
      return `<div class="glass rounded-xl px-4 py-3 border-l-4 ${crit ? "border-danger shadow-glow-danger" : "border-warning"} ${crit ? "alert-blink" : ""}">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p class="text-sm font-semibold ${crit ? "text-danger-muted" : "text-warning-muted"}">${crit ? "CRITICAL" : "WARNING"} — ${w.label}</p>
            <p class="text-xs text-ink-dim mt-0.5">${detail}</p>
          </div>
          <span class="font-mono text-xs text-ink-muted">${fromGnb ? "GNB" : w.param}</span>
        </div>
      </div>`;
    })
    .join("");
}

function renderParamStatus(rows) {
  const grid = document.getElementById("param-status-grid");
  if (!grid || !rows) return;
  grid.innerHTML = rows
    .map((r) => {
      const pct =
        r.critical > 0 ? Math.min(100, (r.value / r.critical) * 100) : 0;
      return `<div class="glass param-card ${levelBorder(r.level)}">
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0">
            <p class="text-[10px] uppercase tracking-wider text-ink-dim truncate">${r.label}</p>
            <p class="font-mono text-sm text-ink">${fmtNum(r.value)} <span class="text-ink-dim text-[10px]">${r.unit || ""}</span></p>
          </div>
          <span class="status-dot ${levelDot(r.level)} shrink-0"></span>
        </div>
        <div class="mt-auto pt-2 h-1 rounded-full bg-surface-raised overflow-hidden">
          <div class="h-full rounded-full ${r.level === "critical" ? "bg-danger" : r.level === "warn" ? "bg-warning" : "bg-success"}" style="width:${pct.toFixed(0)}%"></div>
        </div>
        <p class="mt-1 text-[10px] font-mono text-ink-dim">W ${fmtNum(r.warn)} · C ${fmtNum(r.critical)} · ★${r.importance}</p>
      </div>`;
    })
    .join("");
}

function levelFromParam(data, key) {
  const row = (data.paramStatus || []).find((p) => p.key === key);
  return row?.level || "ok";
}

function setDot(id, level) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `status-dot mt-1 ${levelDot(level)}`;
}

function setText(id, text, cls) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  if (cls) el.className = cls;
}

function pushLiveSample(data) {
  const f = data.features || {};
  const now = new Date();
  const conf = Math.min(
    99,
    35 +
      (data.datasetCount || 0) * 8 +
      ((data.batchCount || 0) / Math.max(data.batchSize || 60, 1)) * 25,
  );

  const push = (key, v) => {
    liveSeries[key].push(v);
    if (liveSeries[key].length > HISTORY_MAX) liveSeries[key].shift();
  };

  push("t", now);
  push("current", f.current ?? 0);
  push("temp", f.temp ?? 0);
  push("power", (f.power || 0) / 1000);
  push("currentSlope", f.currentSlope ?? 0);
  push("tempSlope", f.tempSlope ?? 0);
  push("risk", data.riskPercent ?? 0);
  push("conf", conf);
  push("varI", f.varI ?? 0);
  push("ma3I", f.ma3I ?? 0);
  push("ma3T", f.ma3T ?? 0);
  push("tempAcc", f.tempAcc ?? 0);
  return conf;
}

function updateOperatingPhase(data, f) {
  const th = data.thresholds || {};
  let phase = "steady";
  if (
    data.status === "danger" ||
    (data.warnings || []).some((w) => w.level === "critical")
  )
    phase = "fault";
  else if (
    Math.abs(f.tempSlope || 0) > (th.tempSlope?.warn ?? 0.08) * 0.6 ||
    Math.abs(f.currentSlope || 0) > (th.currentSlope?.warn ?? 0.5) * 0.6
  )
    phase = "transient";
  else if (Math.abs(f.current || 0) < 0.15) phase = "idle";

  const labels = {
    idle: "Idle",
    steady: "Steady State",
    transient: "Transient",
    fault: "Fault",
  };
  setText("kpi-phase", labels[phase]);
  setDot(
    "dot-phase",
    phase === "fault" ? "critical" : phase === "transient" ? "warn" : "ok",
  );

  ["idle", "steady", "transient", "fault"].forEach((p) => {
    const el = document.getElementById(`phase-${p}`);
    if (!el) return;
    el.className = p === phase ? "phase-chip is-active" : "phase-chip";
    const label = el.querySelector(".label") || el.querySelector("div");
    if (label) label.className = "label";
  });

  setText(
    "phase-meta",
    `ESP32 · ACS712+DS18B20 · batch ${data.batchCount || 0}/${data.batchSize || 60} · dataset ${data.datasetCount || 0}`,
  );
}

function updatePersistUi(data) {
  const p = data.persist || {};
  const persist = document.getElementById("persist-status");
  if (persist) {
    persist.textContent = p.saved
      ? `${data.datasetCount || 0} rows on flash`
      : `${data.datasetCount || 0} rows (not saved yet)`;
  }
  const c = data.cloud || {};
  const cloudEl = document.getElementById("cloud-status");
  if (cloudEl) {
    if (!c.configured) cloudEl.textContent = "need home Wi‑Fi";
    else if (c.done) cloudEl.textContent = c.status || "uploaded";
    else if (c.pending) cloudEl.textContent = c.status || "queued";
    else
      cloudEl.textContent =
        c.status || `${data.datasetCount || 0}/100 then upload`;
  }
  const hint = document.getElementById("cfg-cloud-hint");
  if (hint && c.url) {
    hint.textContent = c.staConnected
      ? `STA online · ${c.staSsid || "wifi"} → ${String(c.url).replace(/^https?:\/\//, "")}`
      : `URL ${String(c.url).replace(/^https?:\/\//, "")} · STA ${c.staSsid ? "saved, connecting…" : "not set"}`;
  }
}

async function loadCloudConfigForm() {
  try {
    const cfg = await api("/api/cloud/config");
    const ssid = document.getElementById("cfg-sta-ssid");
    const pass = document.getElementById("cfg-sta-pass");
    const url = document.getElementById("cfg-cloud-url");
    const key = document.getElementById("cfg-cloud-key");
    const id = document.getElementById("cfg-device-id");
    if (ssid) ssid.value = cfg.staSsid || "";
    if (pass) pass.value = "";
    if (pass) pass.placeholder = cfg.staPassSet ? "•••••••• (unchanged)" : "Password";
    if (url)
      url.value =
        cfg.cloudBaseUrl ||
        cfg.defaults?.cloudBaseUrl ||
        "https://fire-before-fire.onrender.com";
    if (key) key.value = cfg.cloudApiKey || "";
    if (id) id.value = cfg.deviceId || cfg.defaults?.deviceId || "esp32-01";
    const hint = document.getElementById("cfg-cloud-hint");
    if (hint) {
      hint.textContent = cfg.staConnected
        ? `STA online ${cfg.staIp || ""}`
        : cfg.configured
          ? "Saved — waiting for STA"
          : "Enter home Wi‑Fi to enable cloud";
    }
  } catch (_) {}
}

async function saveCloudConfigForm() {
  const body = {
    staSsid: document.getElementById("cfg-sta-ssid")?.value?.trim() || "",
    staPass: document.getElementById("cfg-sta-pass")?.value || "",
    cloudBaseUrl: (
      document.getElementById("cfg-cloud-url")?.value?.trim() ||
      "https://fire-before-fire.onrender.com"
    ).replace(/\/$/, ""),
    cloudApiKey: document.getElementById("cfg-cloud-key")?.value?.trim() || "",
    deviceId:
      document.getElementById("cfg-device-id")?.value?.trim() || "esp32-01",
  };
  if (!body.staSsid) {
    showToast("Enter home Wi‑Fi SSID");
    return;
  }
  if (!body.cloudApiKey) {
    showToast("Enter cloud API key");
    return;
  }
  const btn = document.getElementById("btn-save-cloud-cfg");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Saving…";
  }
  try {
    const res = await api("/api/cloud/config", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (res.staConnected) {
      showToast(`Connected · ${res.staIp || "STA OK"}`);
    } else if (res.ok) {
      showToast(
        "Saved — Wi‑Fi still connecting (check SSID/password; SoftAP stays up)",
      );
    } else {
      showToast(res.error || "Save failed");
    }
    const pass = document.getElementById("cfg-sta-pass");
    if (pass) pass.value = "";
    loadCloudConfigForm();
    pollLiveStatus();
  } catch (e) {
    showToast(e.message || "Could not save cloud config");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Save & connect";
    }
  }
}

function updateSensorFaultBanner(data) {
  const el = document.getElementById("sensor-fault-banner");
  if (!el) return;
  const s = data.sensors || {};
  const f = data.features || {};
  const tempMissing =
    s.tempOk === false ||
    (typeof f.temp === "number" && f.temp === 0 && (data.batchCount || 0) === 0);
  if (tempMissing) {
    const n = s.tempDevices != null ? ` (${s.tempDevices} device(s) on bus)` : "";
    el.textContent = `DS18B20 not reading${n} — check GPIO 4 wiring/pull-up. Current can still update; temp/risk stay at 0 until the sensor responds.`;
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
    el.textContent = "";
  }
}

function updateKpis(data) {
  const f = data.features || {};
  const th = data.thresholds || {};
  const conf = pushLiveSample(data);
  updateSensorFaultBanner(data);
  updatePersistUi(data);

  const set = (id, v, digits) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (v == null || Number.isNaN(v)) {
      el.textContent = "—";
      return;
    }
    el.textContent = fmtNum(v, digits);
  };
  set("kpi-current", f.current, 2);
  set("kpi-temp", f.temp, 1);
  set("kpi-power", (f.power || 0) / 1000, 2);
  set("kpi-cslope", f.currentSlope, 3);
  set("kpi-tslope", f.tempSlope, 3);
  set("kpi-risk", data.riskPercent, 0);
  set("kpi-conf", conf, 0);
  set("sensor-current", f.current, 2);
  set("sensor-temp", f.temp, 1);

  const batchEl = document.getElementById("sensor-batch");
  if (batchEl)
    batchEl.textContent = `${data.batchCount || 0}/${data.batchSize || 60}`;

  const gnb = data.gnb || {};
  const logreg = data.logreg || {};
  const ens = data.ensemble || {};
  const gnbEl = document.getElementById("sensor-gnb");
  if (gnbEl) {
    if (ens.active || data.predictionSource === "ensemble") {
      gnbEl.textContent = `ens ${ens.predLabel || "ok"} ${((ens.confidence || 0) * 100).toFixed(0)}%`;
    } else if (gnb.ready || logreg.ready) {
      const g = gnb.ready
        ? `${gnb.predLabel || "ok"} ${((gnb.confidence || 0) * 100).toFixed(0)}%`
        : "—";
      const l = logreg.ready
        ? `${logreg.predLabel || "ok"} ${((logreg.confidence || 0) * 100).toFixed(0)}%`
        : "—";
      gnbEl.textContent = `G ${g} · L ${l}`;
    } else {
      gnbEl.textContent = gnb.status || "collecting";
    }
  }
  const gnbBadge = document.getElementById("badge-gnb-hw");
  if (gnbBadge) {
    if (ens.active) {
      gnbBadge.textContent = ens.agree ? "ENS✓" : "ENS";
      gnbBadge.className =
        "rounded bg-success-soft px-1.5 py-0.5 text-[9px] font-semibold uppercase text-success-muted";
    } else if (gnb.ready || logreg.ready) {
      gnbBadge.textContent = "ML";
      gnbBadge.className =
        "rounded bg-accent-soft px-1.5 py-0.5 text-[9px] font-semibold uppercase text-accent-muted";
    } else {
      gnbBadge.textContent = "Rules";
      gnbBadge.className =
        "rounded bg-surface-raised px-1.5 py-0.5 text-[9px] font-semibold uppercase text-ink-dim";
    }
  }

  const bar = document.getElementById("kpi-risk-bar");
  if (bar)
    bar.style.width = `${Math.min(100, data.riskPercent || 0).toFixed(0)}%`;

  const badge = document.getElementById("kpi-risk-badge");
  if (badge) {
    const s = data.status || "ok";
    badge.textContent =
      s === "danger" ? "Danger" : s === "caution" ? "Caution" : "Normal";
    badge.className =
      s === "danger"
        ? "rounded-md bg-danger-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-danger-muted"
        : s === "caution"
          ? "rounded-md bg-warning-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning-muted"
          : "rounded-md bg-success-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success-muted";
  }

  const liveDot = document.getElementById("live-status-dot");
  if (liveDot) {
    liveDot.className = `status-dot animate-pulseLive ${
      data.status === "danger"
        ? "status-danger"
        : data.status === "caution"
          ? "status-warn"
          : "status-ok"
    }`;
  }

  // KPI status from thresholds
  setDot("dot-current", levelFromParam(data, "current"));
  setDot("dot-temp", levelFromParam(data, "temp"));
  setDot("dot-power", levelFromParam(data, "power"));
  setDot("dot-cslope", levelFromParam(data, "currentSlope"));
  setDot("dot-tslope", levelFromParam(data, "tempSlope"));
  setDot("dot-conf", conf >= 70 ? "ok" : conf >= 40 ? "warn" : "ok");

  const lblCls = (lvl) =>
    lvl === "critical"
      ? "text-danger-muted"
      : lvl === "warn"
        ? "text-warning-muted"
        : "text-success-muted";
  const lblTxt = (lvl, ok, warn) =>
    lvl === "critical" ? "critical" : lvl === "warn" ? warn : ok;

  const lc = levelFromParam(data, "current");
  setText("lbl-current", lblTxt(lc, "▲ stable", "elevated"), lblCls(lc));
  setText("sub-current", `Δ ${fmtNum(f.currentSlope, 3)} A/s`);

  const lt = levelFromParam(data, "temp");
  setText("lbl-temp", lblTxt(lt, "within band", "heating"), lblCls(lt));
  setText("sub-temp", `Δ ${fmtNum(f.tempSlope, 3)} °C/s`);

  const lp = levelFromParam(data, "power");
  setText("lbl-power", lblTxt(lp, "nominal load", "high load"), lblCls(lp));

  const lcs = levelFromParam(data, "currentSlope");
  setText("lbl-cslope", lblTxt(lcs, "no runaway", "rising fast"), lblCls(lcs));
  setText("sub-cslope", `thresh ${fmtNum(th.currentSlope?.warn ?? 0.5, 2)}`);

  const lts = levelFromParam(data, "tempSlope");
  setText(
    "lbl-tslope",
    lblTxt(lts, "stable rise", "elevated rise"),
    lblCls(lts),
  );
  setText("sub-tslope", `thresh ${fmtNum(th.tempSlope?.warn ?? 0.08, 2)}`);

  setText(
    "lbl-conf",
    conf >= 70 ? "model stable" : "warming up",
    "text-accent-muted",
  );
  setText(
    "sub-conf",
    `n = ${(data.datasetCount || 0) * (data.batchSize || 60) + (data.batchCount || 0)}`,
  );

  // sensor badges
  const acs = document.getElementById("badge-acs712");
  const ds = document.getElementById("badge-ds18b20");
  if (acs) {
    acs.textContent = "Active";
    acs.className =
      "rounded bg-success-soft px-1.5 py-0.5 text-[9px] font-semibold uppercase text-success-muted";
  }
  if (ds) {
    const ok = f.temp != null && f.temp > -100;
    ds.textContent = ok ? "Active" : "Error";
    ds.className = ok
      ? "rounded bg-success-soft px-1.5 py-0.5 text-[9px] font-semibold uppercase text-success-muted"
      : "rounded bg-danger-soft px-1.5 py-0.5 text-[9px] font-semibold uppercase text-danger-muted";
  }

  updateOperatingPhase(data, f);

  // live region card
  regions[0].status =
    data.status === "danger"
      ? "danger"
      : data.status === "caution"
        ? "warn"
        : "ok";
  regions[0].maxCurrent = th.current?.critical ?? 16;
  regions[0].maxTemp = th.temp?.critical ?? 70;
  renderRegions();

  // sparklines + open pages
  initDashboardSparks();
  const active = document.querySelector(".page.active")?.id;
  if (active === "page-monitoring") initMonitoringCharts(true);
  if (active === "page-statistics") refreshStatisticsFromLive();
  if (active === "page-bayesian") refreshBayesianFromLive(data);
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function varianceArr(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length;
}

function refreshStatisticsFromLive() {
  if (typeof Plotly === "undefined" || liveSeries.current.length < 3) return;
  const samples = liveSeries.current;
  Plotly.react(
    "chart-hist",
    [
      {
        x: samples,
        type: "histogram",
        nbinsx: 20,
        marker: { color: "rgba(59,130,246,0.75)" },
      },
    ],
    {
      ...plotlyLayoutBase,
      xaxis: { ...plotlyLayoutBase.xaxis, title: "Current (A)" },
      yaxis: { ...plotlyLayoutBase.yaxis, title: "Count" },
    },
    plotlyConfig,
  );
  const m = mean(samples);
  const sd = Math.sqrt(varianceArr(samples)) || 0.01;
  const xs = [];
  const ys = [];
  for (let i = 0; i < 60; i++) {
    const x = m - 3 * sd + (6 * sd * i) / 59;
    xs.push(x);
    ys.push(
      Math.exp(-0.5 * ((x - m) / sd) ** 2) / (sd * Math.sqrt(2 * Math.PI)),
    );
  }
  Plotly.react(
    "chart-gauss",
    [
      {
        x: xs,
        y: ys,
        type: "scatter",
        mode: "lines",
        fill: "tozeroy",
        line: { color: "#60A5FA", width: 2 },
      },
    ],
    {
      ...plotlyLayoutBase,
      xaxis: { ...plotlyLayoutBase.xaxis, title: "Current (A)" },
      yaxis: { ...plotlyLayoutBase.yaxis, title: "Density" },
    },
    plotlyConfig,
  );
  Plotly.react(
    "chart-trend",
    [
      {
        x: liveSeries.t,
        y: liveSeries.current,
        name: "I",
        type: "scatter",
        mode: "lines",
        line: { color: "#3B82F6" },
      },
      {
        x: liveSeries.t,
        y: liveSeries.temp,
        name: "T",
        type: "scatter",
        mode: "lines",
        yaxis: "y2",
        line: { color: "#22C55E" },
      },
    ],
    {
      ...plotlyLayoutBase,
      showlegend: true,
      yaxis: { ...plotlyLayoutBase.yaxis, title: "A" },
      yaxis2: {
        overlaying: "y",
        side: "right",
        title: "°C",
        gridcolor: "transparent",
      },
      xaxis: { ...plotlyLayoutBase.xaxis, type: "date" },
    },
    plotlyConfig,
  );
  chartsInitialized.statistics = true;

  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

  const setStat = (id, v, digits = 3) => {
    const el = document.getElementById(id);
    if (el) el.textContent = fmtNum(v, digits);
  };
  setStat("stat-mean", m, 2);
  setStat("stat-median", median, 2);
  setStat("stat-ma3i", liveSeries.ma3I.at(-1) || 0, 2);
  setStat("stat-vari", liveSeries.varI.at(-1) || varianceArr(samples), 4);
  setStat("stat-std", sd, 3);
  setStat("stat-tslope", liveSeries.tempSlope.at(-1) || 0, 3);
  setStat("stat-ma3t", liveSeries.ma3T.at(-1) || 0, 1);
  setStat("stat-n", samples.length, 0);
}

function refreshBayesianFromLive(data) {
  const gnb = data.gnb || {};
  const logreg = data.logreg || {};
  const ens = data.ensemble || {};
  const post = Array.isArray(ens.posteriors)
    ? ens.posteriors
    : Array.isArray(gnb.posteriors)
      ? gnb.posteriors
      : [];
  const pOk =
    post[0] != null ? post[0] : Math.max(0, 1 - (data.riskPercent || 0) / 100);
  const pWarn = post[1] != null ? post[1] : 0;
  const pCrit =
    post[2] != null ? post[2] : Math.min(0.95, (data.riskPercent || 0) / 100);
  const pHazard = Math.min(1, pWarn + pCrit);
  const conf =
    ens.confidence != null
      ? ens.confidence
      : gnb.confidence != null
        ? gnb.confidence
        : Math.min(0.99, (data.riskPercent || 0) / 100);

  const set = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  const fmtPost = (arr) => {
    if (!Array.isArray(arr) || arr.length < 3) return "—";
    return `ok ${Number(arr[0]).toFixed(2)} · warn ${Number(arr[1]).toFixed(2)} · crit ${Number(arr[2]).toFixed(2)}`;
  };

  set(
    "ml-gnb-pred",
    gnb.ready
      ? `${gnb.predLabel || "ok"} · ${((gnb.confidence || 0) * 100).toFixed(0)}%`
      : gnb.status || "not ready",
  );
  set("ml-gnb-detail", gnb.ready ? fmtPost(gnb.posteriors) : "—");
  set(
    "ml-lr-pred",
    logreg.ready
      ? `${logreg.predLabel || "ok"} · ${((logreg.confidence || 0) * 100).toFixed(0)}%`
      : logreg.status || "not loaded",
  );
  set("ml-lr-detail", logreg.ready ? fmtPost(logreg.posteriors) : "—");

  set("bayes-p-ok", pOk.toFixed(2));
  set("bayes-p-hazard", pHazard.toFixed(2));
  set("bayes-conf", `${(conf * 100).toFixed(0)}%`);
  set(
    "bayes-posteriors",
    `ok ${pOk.toFixed(2)} · warn ${pWarn.toFixed(2)} · crit ${pCrit.toFixed(2)}`,
  );
  set("bayes-train", `n = ${gnb.trainN ?? data.datasetCount ?? 0}`);
  const counts = gnb.classCounts || [0, 0, 0];
  set("bayes-counts", `counts [${counts.join(",")}]`);
  set("bayes-score", `${gnb.score ?? 0} / 10`);
  set(
    "bayes-source",
    data.predictionSource || (ens.active ? "ensemble" : "rules"),
  );
  const modelSrc = document.getElementById("bayes-model-src");
  if (modelSrc) {
    const parts = [];
    if (gnb.ready) parts.push(gnb.fromCloud ? "gnb·cloud" : "gnb");
    if (logreg.ready) parts.push(logreg.fromCloud ? "lr·cloud" : "lr");
    modelSrc.textContent = parts.length ? parts.join("+") : "—";
  }
  set(
    "bayes-pipeline-status",
    ens.status ||
      (gnb.ready || logreg.ready
        ? "Models ready"
        : gnb.status || "Collecting labeled dataset…"),
  );

  const barOk = document.getElementById("bayes-bar-ok");
  const barHz = document.getElementById("bayes-bar-hazard");
  if (barOk) barOk.style.width = `${(pOk * 100).toFixed(0)}%`;
  if (barHz) barHz.style.width = `${(pHazard * 100).toFixed(0)}%`;
  const gauge = document.getElementById("bayes-gauge");
  if (gauge) gauge.style.setProperty("--pct", `${(conf * 100).toFixed(1)}%`);

  const decision = document.getElementById("bayes-decision");
  const decisionEq = document.getElementById("bayes-decision-eq");
  const decisionCard = document.getElementById("bayes-decision-card");
  let label = "Standby (rules)";
  let tone = "border-surface-border";
  let eq = "waiting for ML models or below ensemble gate";
  if (ens.active || data.predictionSource === "ensemble") {
    label =
      ens.predLabel === "critical"
        ? "Ensemble Critical"
        : ens.predLabel === "warn"
          ? "Ensemble Warning"
          : "Ensemble OK";
    tone =
      ens.predLabel === "critical"
        ? "border-danger/40"
        : ens.predLabel === "warn"
          ? "border-warning/40"
          : "border-success/40";
    const agree = ens.agree ? "agree" : "mix";
    eq = `ens ${agree} conf ${(conf * 100).toFixed(0)}% · GNB ${gnb.predLabel || "—"} / LR ${logreg.predLabel || "—"} ≥ rule ${((ens.ruleConfidence || gnb.ruleConfidence || 0) * 100).toFixed(0)}%`;
  } else if (gnb.ready || logreg.ready) {
    label = "Ensemble standby · rules leading";
    tone = "border-accent/30";
    eq = `ens conf ${(conf * 100).toFixed(0)}% below gate · GNB ${gnb.predLabel || "—"} / LR ${logreg.predLabel || "—"}`;
  } else if (data.status === "danger") {
    label = "Rules: Intervene";
    tone = "border-danger/40";
  } else if (data.status === "caution") {
    label = "Rules: Monitor";
    tone = "border-warning/40";
  }
  if (decision) {
    decision.textContent = label;
    decision.className =
      "mt-1 text-xl font-semibold " +
      (tone.includes("danger")
        ? "text-danger-muted"
        : tone.includes("warning")
          ? "text-warning-muted"
          : tone.includes("success")
            ? "text-success-muted"
            : "text-ink-muted");
  }
  if (decisionEq) decisionEq.textContent = eq;
  if (decisionCard) {
    decisionCard.className = `glass rounded-xl p-4 border ${tone}`;
  }

  if (typeof Plotly !== "undefined" && document.getElementById("chart-bayes")) {
    const xs = liveSeries.t.length ? liveSeries.t : timeAxis(2);
    const ys = liveSeries.risk.length
      ? liveSeries.risk.map((r) => r / 100)
      : [pHazard, pHazard];
    Plotly.react(
      "chart-bayes",
      [
        {
          x: xs,
          y: ys,
          type: "scatter",
          mode: "lines",
          fill: "tozeroy",
          name: "Hazard risk",
          line: { color: "#EF4444", width: 2 },
        },
      ],
      {
        ...plotlyLayoutBase,
        yaxis: {
          ...plotlyLayoutBase.yaxis,
          title: "Risk / posterior",
          range: [0, 1],
        },
        xaxis: { ...plotlyLayoutBase.xaxis, type: "date" },
      },
      plotlyConfig,
    );
    chartsInitialized.bayesian = true;
  }
}

function thresholdsFromApi(thObj) {
  const out = {};
  PARAM_META.forEach((p) => {
    const src = thObj?.[p.key];
    out[p.key] = {
      warn: src?.warn ?? DEFAULT_THRESHOLDS[p.key].warn,
      critical: src?.critical ?? DEFAULT_THRESHOLDS[p.key].critical,
    };
  });
  return out;
}

function liveValuesFromFeatures(f) {
  if (!f) return {};
  return {
    current: Math.abs(f.current),
    temp: f.temp,
    ma3I: Math.abs(f.ma3I),
    ma3T: f.ma3T,
    currentSlope: Math.abs(f.currentSlope),
    tempSlope: Math.abs(f.tempSlope),
    varI: f.varI,
    power: f.power,
    tempAcc: Math.abs(f.tempAcc),
  };
}

function applyLiveAlerts(warnings) {
  const mapped = (warnings || []).map((w, i) => ({
    id: `live-${w.param}-${i}`,
    state: "current",
    level: w.level === "critical" ? "red" : "orange",
    title: `${w.level === "critical" ? "Critical" : "Warning"}: ${w.label}`,
    reason: `Live value ${fmtNum(w.value)} vs threshold ${fmtNum(w.threshold)}`,
    time: new Date().toISOString().replace("T", " ").slice(0, 19),
    region: "ESP32 Local Node",
    sensor: "ACS712+DS18B20",
    action: "Review circuit / reduce load",
    severity: w.level === "critical" ? "critical" : "warning",
  }));

  // promote previous current→past when cleared
  const prevCurrent = alerts.filter((a) => a.state === "current");
  const past = alerts.filter((a) => a.state === "past");
  if (!mapped.length && prevCurrent.length) {
    past.unshift(
      ...prevCurrent.map((a) => ({
        ...a,
        state: "past",
        id: `past-${a.id}-${Date.now()}`,
      })),
    );
  }

  alerts.length = 0;
  alerts.push(...mapped, ...past.slice(0, 30));
  renderAlerts();

  // history table — append only new breach keys
  const seen = new Set(
    historyEvents.slice(0, 20).map((h) => h.event + h.time.slice(0, 16)),
  );
  mapped.forEach((a) => {
    const key = a.title + a.time.slice(0, 16);
    if (seen.has(key)) return;
    historyEvents.unshift({
      time: a.time,
      event: a.title,
      region: a.region,
      sensor: a.sensor,
      severity: a.severity,
      value: a.reason.replace("Live value ", ""),
    });
  });
  if (historyEvents.length > 80) historyEvents.length = 80;
  renderHistory();

  (warnings || []).forEach((w) => maybeNotifyWarning(w));

  const badge = document.getElementById("alert-badge");
  if (badge) badge.textContent = String(mapped.length);

  const setC = (id, n) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(n);
  };
  setC("alert-count-orange", mapped.filter((a) => a.level === "orange").length);
  setC("alert-count-red", mapped.filter((a) => a.level === "red").length);
  setC(
    "alert-count-yellow",
    past.filter((a) => a.level === "orange" || a.severity === "warning").length,
  );
  setC("alert-count-info", past.length);
}

async function pollLiveStatus() {
  try {
    const data = await api("/api/status");
    liveState = data;
    setConnectionStatus(true);
    setAdaptiveToggle(data.mode === "adaptive");
    thresholdCache = thresholdsFromApi(data.thresholds);
    updateKpis(data);
    renderRegions();
    renderGnbBadge(data.gnb, data.predictionSource, data.logreg, data.ensemble);
    renderWarnings(data.warnings || [], { source: data.predictionSource });
    renderParamStatus(data.paramStatus || []);
    applyLiveAlerts(data.warnings || []);
    updatePwaNetworkUrls(data);
    connectAlertWebSocket(data);
    renderThresholdEditor(
      thresholdCache,
      liveValuesFromFeatures(data.features),
    );
    const el = document.getElementById("last-update");
    if (el)
      el.textContent = new Date().toLocaleTimeString("en-GB", {
        hour12: false,
      });
  } catch (_) {
    setConnectionStatus(false);
    const banner = document.getElementById("sensor-fault-banner");
    if (banner) {
      banner.textContent =
        "ESP32 offline — join Wi‑Fi FireBeforeFire / firebefore123, then open http://192.168.4.1";
      banner.classList.remove("hidden");
    }
    if (!document.getElementById("threshold-editor-body")?.children.length) {
      renderThresholdEditor(thresholdCache, {});
    }
  }
}

async function saveManualThresholds() {
  setAdaptiveToggle(false);
  const thresholds = readThresholdInputs();
  thresholdCache = thresholds;
  try {
    await api("/api/thresholds", {
      method: "POST",
      body: JSON.stringify({ mode: "manual", thresholds }),
    });
    showToast("Manual thresholds saved to device");
    pollLiveStatus();
  } catch (_) {
    localStorage.setItem(
      "fbf_thresholds",
      JSON.stringify({ mode: "manual", thresholds }),
    );
    showToast("Saved locally (device offline)");
  }
}

async function applyAdaptive() {
  setAdaptiveToggle(true);
  try {
    const data = await api("/api/adaptive", {
      method: "POST",
      body: JSON.stringify({ enabled: true }),
    });
    if (data.thresholds) thresholdCache = thresholdsFromApi(data.thresholds);
    renderThresholdEditor(
      thresholdCache,
      liveValuesFromFeatures(liveState?.features),
    );
    showToast("Adaptive thresholds applied from dataset");
    pollLiveStatus();
  } catch (_) {
    showToast("Adaptive needs ESP32 online (uses dataset averages)");
  }
}

async function resetDefaults() {
  try {
    const data = await api("/api/defaults", { method: "POST", body: "{}" });
    if (data.thresholds) thresholdCache = thresholdsFromApi(data.thresholds);
    else thresholdCache = { ...DEFAULT_THRESHOLDS };
    setAdaptiveToggle(false);
    renderThresholdEditor(
      thresholdCache,
      liveValuesFromFeatures(liveState?.features),
    );
    showToast("Defaults restored");
    pollLiveStatus();
  } catch (_) {
    thresholdCache = JSON.parse(JSON.stringify(DEFAULT_THRESHOLDS));
    setAdaptiveToggle(false);
    renderThresholdEditor(thresholdCache, {});
    showToast("Defaults restored locally");
  }
}

function initPredictionUI() {
  const toggle = document.getElementById("adaptive-toggle");
  toggle?.addEventListener("click", () => {
    const next = !toggle.classList.contains("on");
    setAdaptiveToggle(next);
    renderThresholdEditor(
      readThresholdInputs(),
      liveValuesFromFeatures(liveState?.features),
    );
    if (next) applyAdaptive();
  });

  document
    .getElementById("btn-save-thresholds")
    ?.addEventListener("click", saveManualThresholds);
  document
    .getElementById("btn-apply-adaptive")
    ?.addEventListener("click", applyAdaptive);
  document
    .getElementById("btn-reset-defaults")
    ?.addEventListener("click", resetDefaults);

  try {
    const saved = JSON.parse(localStorage.getItem("fbf_thresholds") || "null");
    if (saved?.thresholds) {
      thresholdCache = thresholdsFromApi(saved.thresholds);
      setAdaptiveToggle(saved.mode === "adaptive");
    }
  } catch (_) {}

  renderThresholdEditor(thresholdCache, {});
  pollLiveStatus();
}

/* ── PWA install + multi-phone alerts (SoftAP-safe) ───────────────── */
let deferredInstallPrompt = null;
let alertWs = null;
let swReg = null;
const notifiedAlertKeys = new Set();
let notificationsWanted = localStorage.getItem("fbf_notify") === "1";
let pushBannerTimer = null;

function canUseOsNotifications() {
  return (
    typeof Notification !== "undefined" &&
    !!window.isSecureContext &&
    (location.protocol === "https:" ||
      location.hostname === "localhost" ||
      location.hostname === "127.0.0.1")
  );
}

function updatePwaNotifyStatus() {
  const el = document.getElementById("pwa-notify-status");
  if (!el) return;
  const ws = alertWs && alertWs.readyState === WebSocket.OPEN ? "live WS" : "poll";
  if (!notificationsWanted) {
    el.textContent = `Alerts: off · channel: ${ws}`;
    return;
  }
  if (canUseOsNotifications() && Notification.permission === "granted") {
    el.textContent = `Alerts: on (OS + in-app) · ${ws}`;
  } else if (!window.isSecureContext) {
    el.textContent = `Alerts: on (in-app — SoftAP HTTP can't use OS popups) · ${ws}`;
  } else if (typeof Notification !== "undefined" && Notification.permission === "denied") {
    el.textContent = `Alerts: on (in-app — OS permission blocked in browser settings) · ${ws}`;
  } else {
    el.textContent = `Alerts: on (in-app) · ${ws}`;
  }
}

function updatePwaNetworkUrls(data) {
  const net = data.network || {};
  const cloud = data.cloud || {};
  const ap = document.getElementById("pwa-ap-url");
  const lan = document.getElementById("pwa-lan-url");
  const osUrl = document.getElementById("pwa-os-notify-url");
  const apIp = net.apIp || "192.168.4.1";
  if (ap) ap.textContent = `http://${apIp}`;
  if (lan) {
    if (net.staConnected && net.staIp) {
      lan.textContent = `http://${net.staIp}  (open on any phone on ${net.staSsid || "home Wi‑Fi"})`;
    } else {
      lan.textContent = "Connect home Wi‑Fi in Settings first…";
    }
  }
  if (osUrl) {
    const base = (
      cloud.url ||
      cloud.cloudBaseUrl ||
      "https://fire-before-fire.onrender.com"
    ).replace(/\/$/, "");
    const id = encodeURIComponent(cloud.deviceId || "esp32-01");
    osUrl.textContent = `${base}/notify?device=${id}`;
  }
}

async function openOsNotifyPage() {
  const el = document.getElementById("pwa-os-notify-url");
  const url =
    (el && el.textContent && el.textContent.trim()) ||
    "https://fire-before-fire.onrender.com/notify";
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(url);
    }
  } catch (_) {}
  // SoftAP usually has no internet — open may fail; clipboard + leave SoftAP is the path.
  try {
    window.open(url, "_blank", "noopener,noreferrer");
  } catch (_) {}
  showToast(
    "OS notify URL ready — leave SoftAP, open on home Wi‑Fi or mobile data, tap Allow",
  );
}

async function ensureServiceWorker() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return null;
  try {
    swReg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    return swReg;
  } catch (e) {
    console.warn("SW register failed", e);
    return null;
  }
}

function playAlertBeep(critical) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "square";
    o.frequency.value = critical ? 880 : 660;
    g.gain.value = 0.04;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    setTimeout(() => {
      o.stop();
      ctx.close();
    }, critical ? 350 : 180);
  } catch (_) {}
}

function showInAppPush(title, body, level) {
  const banner = document.getElementById("push-banner");
  const t = document.getElementById("push-banner-title");
  const b = document.getElementById("push-banner-body");
  if (!banner || !t || !b) {
    showToast(`${title}: ${body}`);
    return;
  }
  t.textContent = title;
  b.textContent = body;
  const crit = level === "critical";
  banner.className =
    "fixed inset-x-3 top-3 z-[70] rounded-xl border px-4 py-3 shadow-glass animate-slideIn " +
    (crit
      ? "border-danger/50 bg-danger-soft"
      : "border-warning/50 bg-warning-soft");
  banner.classList.remove("hidden");
  clearTimeout(pushBannerTimer);
  pushBannerTimer = setTimeout(() => banner.classList.add("hidden"), 8000);
  try {
    if (navigator.vibrate) navigator.vibrate(crit ? [120, 60, 120] : [80]);
  } catch (_) {}
  playAlertBeep(crit);
}

async function showPhoneNotification(title, body, opts = {}) {
  if (!canUseOsNotifications()) return false;
  if (Notification.permission !== "granted") return false;
  const payload = {
    type: "notify",
    title,
    body,
    tag: opts.tag || "fbf-alert",
    requireInteraction: !!opts.requireInteraction,
    url: "/",
  };
  const reg = swReg || (await navigator.serviceWorker.getRegistration());
  if (reg) {
    try {
      const ready = reg.active ? reg : await navigator.serviceWorker.ready;
      await (ready.showNotification
        ? ready.showNotification(title, {
            body,
            tag: payload.tag,
            icon: "/icon-192.png",
            requireInteraction: !!opts.requireInteraction,
            data: { url: "/" },
          })
        : Promise.reject(new Error("no showNotification")));
      return true;
    } catch (_) {}
  }
  // Do not call `new Notification()` — illegal in Android Chrome / some PWAs.
  return false;
}

function deliverAlert(title, body, level, tag) {
  showInAppPush(title, body, level);
  showPhoneNotification(title, body, {
    tag: tag || "fbf-alert",
    requireInteraction: level === "critical",
  });
}

function alertKey(w) {
  return `${w.param}|${w.level}|${Math.round(w.ms || Date.now())}`;
}

function maybeNotifyWarning(w) {
  if (!notificationsWanted || !w) return;
  const key = alertKey(w);
  if (notifiedAlertKeys.has(key)) return;
  notifiedAlertKeys.add(key);
  if (notifiedAlertKeys.size > 80) {
    const first = notifiedAlertKeys.values().next().value;
    notifiedAlertKeys.delete(first);
  }
  const title =
    w.level === "critical"
      ? "Fire Before Fire — CRITICAL"
      : "Fire Before Fire — Warning";
  const val = Number(w.value);
  const thr = Number(w.threshold);
  const body = `${w.label || w.param}: ${Number.isFinite(val) ? val.toFixed(2) : w.value} (thr ${Number.isFinite(thr) ? thr.toFixed(2) : w.threshold})`;
  deliverAlert(title, body, w.level || "warn", key);
}

function connectAlertWebSocket(data) {
  const net = data.network || {};
  const port = net.wsPort || 81;
  const host = location.hostname;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${proto}//${host}:${port}/`;
  if (alertWs && (alertWs.readyState === WebSocket.OPEN || alertWs.readyState === WebSocket.CONNECTING)) {
    return;
  }
  try {
    alertWs = new WebSocket(url);
  } catch (_) {
    updatePwaNotifyStatus();
    return;
  }
  alertWs.onopen = () => updatePwaNotifyStatus();
  alertWs.onclose = () => {
    updatePwaNotifyStatus();
    setTimeout(() => {
      if (liveState) connectAlertWebSocket(liveState);
    }, 4000);
  };
  alertWs.onerror = () => updatePwaNotifyStatus();
  alertWs.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === "alert") maybeNotifyWarning(msg);
    } catch (_) {}
  };
}

async function enableNotifications() {
  // Always enable in-app channel — this is what works on SoftAP HTTP.
  notificationsWanted = true;
  localStorage.setItem("fbf_notify", "1");

  let osNote = "";
  if (canUseOsNotifications()) {
    await ensureServiceWorker();
    try {
      const perm = await Notification.requestPermission();
      if (perm === "granted") osNote = " + OS popups";
      else if (perm === "denied")
        osNote = " (OS popups blocked — use browser site settings to allow)";
    } catch (_) {
      osNote = " (OS popups unavailable)";
    }
  } else {
    osNote = " (OS popups need HTTPS; SoftAP uses in-app alerts)";
  }

  updatePwaNotifyStatus();
  deliverAlert(
    "Fire Before Fire — alerts on",
    "This phone will show banners/sound when risk rises" + osNote,
    "warn",
    "fbf-welcome-" + Date.now(),
  );
  showToast("In-app alerts enabled" + osNote);
}

async function testNotification() {
  notificationsWanted = true;
  localStorage.setItem("fbf_notify", "1");
  updatePwaNotifyStatus();
  deliverAlert(
    "Fire Before Fire — test",
    "In-app alert OK. OS popup only works on HTTPS / after Install on some phones.",
    "warn",
    "fbf-test-" + Date.now(),
  );
  showToast("Test alert sent");
}

function initPwaApp() {
  if (window.isSecureContext) ensureServiceWorker();
  updatePwaNotifyStatus();
  document
    .getElementById("push-banner-dismiss")
    ?.addEventListener("click", () => {
      document.getElementById("push-banner")?.classList.add("hidden");
    });
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
  });
  document
    .getElementById("btn-enable-notifications")
    ?.addEventListener("click", enableNotifications);
  document
    .getElementById("btn-enable-os-notifications")
    ?.addEventListener("click", openOsNotifyPage);
  document
    .getElementById("btn-test-notification")
    ?.addEventListener("click", testNotification);
  document.getElementById("btn-install-pwa")?.addEventListener("click", async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      showToast(
        choice.outcome === "accepted" ? "App install started" : "Install dismissed",
      );
      return;
    }
    showToast(
      "Browser menu → Add to Home Screen (iOS: Share → Add to Home Screen)",
    );
  });
}

/* Expose for inline handlers */
window.navigateTo = navigateTo;
window.openSidebar = openSidebar;
window.closeSidebar = closeSidebar;
window.refreshMonitoringCharts = refreshMonitoringCharts;
