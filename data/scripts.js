/* Fire Before Fire — Frontend Dashboard (placeholder data only) */

const PAGE_TITLES = {
  dashboard: 'Dashboard',
  monitoring: 'Monitoring',
  regions: 'Regions',
  statistics: 'Statistics',
  bayesian: 'Bayesian Analysis',
  alerts: 'Alerts',
  history: 'Event History',
  settings: 'Settings'
};

const plotlyLayoutBase = {
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor: 'rgba(11,18,32,0.55)',
  font: { family: 'IBM Plex Sans, sans-serif', color: '#94A3B8', size: 11 },
  margin: { t: 24, r: 18, b: 40, l: 48 },
  xaxis: {
    gridcolor: '#243044',
    zerolinecolor: '#243044',
    linecolor: '#243044',
    tickfont: { family: 'IBM Plex Mono, monospace', size: 10 }
  },
  yaxis: {
    gridcolor: '#243044',
    zerolinecolor: '#243044',
    linecolor: '#243044',
    tickfont: { family: 'IBM Plex Mono, monospace', size: 10 }
  },
  hovermode: 'x unified',
  showlegend: false
};

const plotlyConfig = {
  responsive: true,
  displayModeBar: true,
  displaylogo: false,
  modeBarButtonsToRemove: ['lasso2d', 'select2d'],
  toImageButtonOptions: { format: 'png', filename: 'fire-before-fire-chart' }
};

/* -------------------- Placeholder data -------------------- */
let regions = [
  {
    id: 1,
    name: 'Kitchen Circuit A',
    sensor: 'S-01',
    appliance: 'Induction Cooktop',
    material: 'Copper',
    resistance: 0.042,
    maxCurrent: 16,
    maxTemp: 70,
    status: 'ok'
  },
  {
    id: 2,
    name: 'HVAC Panel B',
    sensor: 'S-02',
    appliance: 'Air Handler',
    material: 'Copper',
    resistance: 0.028,
    maxCurrent: 25,
    maxTemp: 75,
    status: 'warn'
  },
  {
    id: 3,
    name: 'Server Room UPS',
    sensor: 'S-03',
    appliance: 'UPS Bank',
    material: 'Copper',
    resistance: 0.015,
    maxCurrent: 32,
    maxTemp: 65,
    status: 'ok'
  },
  {
    id: 4,
    name: 'Workshop Lathe',
    sensor: 'S-04',
    appliance: 'CNC Lathe',
    material: 'Aluminum',
    resistance: 0.055,
    maxCurrent: 20,
    maxTemp: 80,
    status: 'danger'
  }
];

const alerts = [
  {
    id: 1,
    state: 'current',
    level: 'red',
    title: 'Temperature slope exceedance',
    reason: 'dT/dt approached threshold near wire junction',
    time: '2026-07-26 22:41:12',
    region: 'HVAC Panel B',
    sensor: 'S-02',
    severity: 'critical'
  },
  {
    id: 2,
    state: 'current',
    level: 'orange',
    title: 'Elevated risk score',
    reason: 'Posterior P(Danger) climbed above soft limit',
    time: '2026-07-26 22:38:04',
    region: 'Workshop Lathe',
    sensor: 'S-04',
    severity: 'warning'
  },
  {
    id: 3,
    state: 'current',
    level: 'yellow',
    title: 'Current variance spike',
    reason: 'Short burst variance above rolling baseline',
    time: '2026-07-26 22:30:55',
    region: 'Kitchen Circuit A',
    sensor: 'S-01',
    severity: 'warning'
  },
  {
    id: 4,
    state: 'past',
    level: 'orange',
    title: 'Transient heating event',
    reason: 'Startup inrush caused temporary slope rise',
    time: '2026-07-26 18:12:41',
    region: 'HVAC Panel B',
    sensor: 'S-02',
    severity: 'warning'
  },
  {
    id: 5,
    state: 'past',
    level: 'green',
    title: 'Return to steady state',
    reason: 'All metrics within nominal operating band',
    time: '2026-07-26 18:20:03',
    region: 'HVAC Panel B',
    sensor: 'S-02',
    severity: 'info'
  },
  {
    id: 6,
    state: 'past',
    level: 'yellow',
    title: 'Sensor reconnect',
    reason: 'S-03 brief dropout recovered',
    time: '2026-07-26 14:05:17',
    region: 'Server Room UPS',
    sensor: 'S-03',
    severity: 'info'
  },
  {
    id: 7,
    state: 'past',
    level: 'green',
    title: 'Daily self-check passed',
    reason: 'Calibration and health checks completed',
    time: '2026-07-26 06:00:00',
    region: 'System',
    sensor: '—',
    severity: 'info'
  }
];

const historyEvents = [
  { time: '2026-07-26 22:41:12', event: 'Temp slope warning', region: 'HVAC Panel B', sensor: 'S-02', severity: 'critical', value: '0.14 °C/s' },
  { time: '2026-07-26 22:38:04', event: 'Risk elevated', region: 'Workshop Lathe', sensor: 'S-04', severity: 'warning', value: '48%' },
  { time: '2026-07-26 22:30:55', event: 'Current variance', region: 'Kitchen Circuit A', sensor: 'S-01', severity: 'warning', value: 'σ 0.41' },
  { time: '2026-07-26 21:15:22', event: 'Phase: Steady State', region: 'Kitchen Circuit A', sensor: 'S-01', severity: 'info', value: '—' },
  { time: '2026-07-26 18:20:03', event: 'Alert cleared', region: 'HVAC Panel B', sensor: 'S-02', severity: 'info', value: 'OK' },
  { time: '2026-07-26 18:12:41', event: 'Transient heating', region: 'HVAC Panel B', sensor: 'S-02', severity: 'warning', value: '0.11 °C/s' },
  { time: '2026-07-26 16:44:09', event: 'Power peak', region: 'Server Room UPS', sensor: 'S-03', severity: 'info', value: '4.12 kW' },
  { time: '2026-07-26 14:05:17', event: 'Sensor reconnect', region: 'Server Room UPS', sensor: 'S-03', severity: 'info', value: 'online' },
  { time: '2026-07-26 11:28:50', event: 'Z-score excursion', region: 'Workshop Lathe', sensor: 'S-04', severity: 'warning', value: '+2.1' },
  { time: '2026-07-26 09:02:33', event: 'Region config updated', region: 'Kitchen Circuit A', sensor: 'S-01', severity: 'info', value: '—' },
  { time: '2026-07-26 06:00:00', event: 'Daily self-check', region: 'System', sensor: '—', severity: 'info', value: 'PASS' },
  { time: '2026-07-25 23:51:18', event: 'Night load drop', region: 'Kitchen Circuit A', sensor: 'S-01', severity: 'info', value: '1.2 A' }
];

let editingRegionId = null;
let chartsInitialized = { monitoring: false, statistics: false, bayesian: false };
let alertFilter = 'all';

/* -------------------- Utilities -------------------- */
function randSeries(n, base, amp, noise = 0.15) {
  const ys = [];
  let v = base;
  for (let i = 0; i < n; i++) {
    v += (Math.random() - 0.5) * noise;
    const wave = Math.sin(i / 12) * amp * 0.4 + Math.sin(i / 37) * amp * 0.2;
    ys.push(+(v + wave).toFixed(3));
  }
  return ys;
}

function timeAxis(n, stepSec = 2) {
  const now = Date.now();
  return Array.from({ length: n }, (_, i) => new Date(now - (n - i) * stepSec * 1000));
}

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.add('hidden'), 2400);
}

function animateCounters() {
  document.querySelectorAll('[data-counter]').forEach((el) => {
    const target = parseFloat(el.dataset.counter);
    const decimals = String(el.dataset.counter).includes('.')
      ? String(el.dataset.counter).split('.')[1].length
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
  const el = document.getElementById('clock');
  if (!el) return;
  const d = new Date();
  el.textContent = d.toLocaleTimeString('en-GB', { hour12: false });
}

/* -------------------- Sidebar / Navigation -------------------- */
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-overlay').classList.remove('hidden');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.add('hidden');
}

function navigateTo(page) {
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  const target = document.getElementById(`page-${page}`);
  if (target) target.classList.add('active');

  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });

  document.getElementById('page-title').textContent = PAGE_TITLES[page] || page;
  closeSidebar();

  requestAnimationFrame(() => {
    if (page === 'monitoring') initMonitoringCharts();
    if (page === 'statistics') initStatisticsCharts();
    if (page === 'bayesian') initBayesianCharts();
    window.dispatchEvent(new Event('resize'));
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
  if (!el || typeof Plotly === 'undefined') return;
  Plotly.newPlot(
    el,
    [{
      y: data,
      type: 'scatter',
      mode: 'lines',
      fill: 'tozeroy',
      line: { color, width: 1.5, shape: 'spline' },
      fillcolor: hexToRgba(color, 0.12),
      hoverinfo: 'skip'
    }],
    {
      margin: { t: 0, r: 0, b: 0, l: 0 },
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      xaxis: { visible: false },
      yaxis: { visible: false },
      height: 36
    },
    { staticPlot: true, displayModeBar: false, responsive: true }
  );
}

function initDashboardSparks() {
  renderSpark('spark-current', randSeries(40, 12.4, 0.4, 0.08), '#3B82F6');
  renderSpark('spark-temp', randSeries(40, 42, 1.2, 0.12), '#22C55E');
  renderSpark('spark-power', randSeries(40, 2.8, 0.25, 0.06), '#60A5FA');
  renderSpark('spark-cslope', randSeries(40, 0.01, 0.02, 0.01), '#4ADE80');
  renderSpark('spark-tslope', randSeries(40, 0.07, 0.04, 0.015), '#F59E0B');
  renderSpark('spark-conf', randSeries(40, 90, 2, 0.4), '#3B82F6');
}

/* -------------------- Monitoring charts -------------------- */
function makeLineChart(id, y, color, yTitle, threshold) {
  const x = timeAxis(y.length);
  const traces = [{
    x,
    y,
    type: 'scatter',
    mode: 'lines',
    name: yTitle,
    line: { color, width: 2, shape: 'spline' },
    hovertemplate: `%{y:.3f}<extra>${yTitle}</extra>`
  }];

  if (typeof threshold === 'number') {
    traces.push({
      x,
      y: x.map(() => threshold),
      type: 'scatter',
      mode: 'lines',
      name: 'Threshold',
      line: { color: '#EF4444', width: 1, dash: 'dot' },
      hoverinfo: 'skip'
    });
  }

  const layout = {
    ...plotlyLayoutBase,
    yaxis: { ...plotlyLayoutBase.yaxis, title: { text: yTitle, font: { size: 11 } } },
    xaxis: { ...plotlyLayoutBase.xaxis, type: 'date' }
  };

  Plotly.newPlot(id, traces, layout, plotlyConfig);
}

function initMonitoringCharts(force = false) {
  if (chartsInitialized.monitoring && !force) {
    Plotly.Plots.resize('chart-current');
    Plotly.Plots.resize('chart-temp');
    Plotly.Plots.resize('chart-power');
    Plotly.Plots.resize('chart-cslope');
    Plotly.Plots.resize('chart-tslope');
    return;
  }
  makeLineChart('chart-current', randSeries(150, 12.4, 0.6), '#3B82F6', 'Current (A)');
  makeLineChart('chart-temp', randSeries(150, 42.5, 2.2), '#22C55E', 'Temperature (°C)', 70);
  makeLineChart('chart-power', randSeries(150, 2.85, 0.35), '#60A5FA', 'Power (kW)');
  makeLineChart('chart-cslope', randSeries(150, 0.012, 0.025), '#4ADE80', 'dI/dt (A/s)', 0.12);
  makeLineChart('chart-tslope', randSeries(180, 0.08, 0.05), '#F59E0B', 'dT/dt (°C/s)', 0.15);
  chartsInitialized.monitoring = true;
}

function refreshMonitoringCharts() {
  chartsInitialized.monitoring = false;
  initMonitoringCharts(true);
  showToast('Monitoring charts refreshed (placeholder)');
}

/* -------------------- Statistics charts -------------------- */
function initStatisticsCharts(force = false) {
  if (chartsInitialized.statistics && !force) {
    ['chart-hist', 'chart-gauss', 'chart-trend'].forEach((id) => Plotly.Plots.resize(id));
    return;
  }

  const samples = randSeries(400, 12.3, 0.5, 0.35);

  Plotly.newPlot(
    'chart-hist',
    [{
      x: samples,
      type: 'histogram',
      nbinsx: 24,
      marker: { color: 'rgba(59,130,246,0.75)', line: { color: '#1E3A5F', width: 1 } }
    }],
    {
      ...plotlyLayoutBase,
      bargap: 0.05,
      xaxis: { ...plotlyLayoutBase.xaxis, title: 'Current (A)' },
      yaxis: { ...plotlyLayoutBase.yaxis, title: 'Count' }
    },
    plotlyConfig
  );

  const mu = 12.31;
  const sigma = 0.29;
  const gx = [];
  const gy = [];
  for (let i = 0; i <= 80; i++) {
    const x = mu - 3.5 * sigma + (i / 80) * 7 * sigma;
    const y = (1 / (sigma * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * ((x - mu) / sigma) ** 2);
    gx.push(x);
    gy.push(y);
  }

  Plotly.newPlot(
    'chart-gauss',
    [{
      x: gx,
      y: gy,
      type: 'scatter',
      mode: 'lines',
      fill: 'tozeroy',
      line: { color: '#22C55E', width: 2 },
      fillcolor: 'rgba(34,197,94,0.12)'
    }],
    {
      ...plotlyLayoutBase,
      xaxis: { ...plotlyLayoutBase.xaxis, title: 'Value' },
      yaxis: { ...plotlyLayoutBase.yaxis, title: 'Density' }
    },
    plotlyConfig
  );

  const trendY = randSeries(120, 12.2, 0.7);
  const ma = trendY.map((_, i, arr) => {
    const w = arr.slice(Math.max(0, i - 7), i + 1);
    return w.reduce((a, b) => a + b, 0) / w.length;
  });

  Plotly.newPlot(
    'chart-trend',
    [
      {
        x: timeAxis(trendY.length, 5),
        y: trendY,
        type: 'scatter',
        mode: 'lines',
        name: 'Signal',
        line: { color: 'rgba(148,163,184,0.55)', width: 1 },
        showlegend: true
      },
      {
        x: timeAxis(ma.length, 5),
        y: ma,
        type: 'scatter',
        mode: 'lines',
        name: 'Rolling Mean',
        line: { color: '#3B82F6', width: 2.5 },
        showlegend: true
      }
    ],
    {
      ...plotlyLayoutBase,
      showlegend: true,
      legend: { orientation: 'h', y: 1.12, font: { size: 11 } },
      xaxis: { ...plotlyLayoutBase.xaxis, type: 'date' },
      yaxis: { ...plotlyLayoutBase.yaxis, title: 'Current (A)' }
    },
    plotlyConfig
  );

  chartsInitialized.statistics = true;
}

/* -------------------- Bayesian chart -------------------- */
function initBayesianCharts(force = false) {
  if (chartsInitialized.bayesian && !force) {
    Plotly.Plots.resize('chart-bayes');
    return;
  }

  const x = [];
  const prior = [];
  const posterior = [];
  for (let i = 0; i <= 100; i++) {
    const t = i / 100;
    x.push(t);
    // Beta-like shapes (visual placeholder)
    prior.push(Math.pow(t, 1.2) * Math.pow(1 - t, 4.5) * 18);
    posterior.push(Math.pow(t, 2.4) * Math.pow(1 - t, 2.8) * 14);
  }

  Plotly.newPlot(
    'chart-bayes',
    [
      {
        x,
        y: prior,
        type: 'scatter',
        mode: 'lines',
        name: 'Prior',
        fill: 'tozeroy',
        line: { color: '#64748B', width: 2 },
        fillcolor: 'rgba(100,116,139,0.15)'
      },
      {
        x,
        y: posterior,
        type: 'scatter',
        mode: 'lines',
        name: 'Posterior',
        fill: 'tozeroy',
        line: { color: '#F59E0B', width: 2 },
        fillcolor: 'rgba(245,158,11,0.12)'
      }
    ],
    {
      ...plotlyLayoutBase,
      showlegend: true,
      legend: { orientation: 'h', y: 1.12 },
      xaxis: { ...plotlyLayoutBase.xaxis, title: 'θ (heating hypothesis)' },
      yaxis: { ...plotlyLayoutBase.yaxis, title: 'Density' }
    },
    plotlyConfig
  );

  chartsInitialized.bayesian = true;
}

/* -------------------- Regions -------------------- */
function statusMeta(status) {
  if (status === 'ok') return { label: 'Normal', cls: 'bg-success-soft text-success-muted', dot: 'status-ok' };
  if (status === 'warn') return { label: 'Caution', cls: 'bg-warning-soft text-warning-muted', dot: 'status-warn' };
  return { label: 'Critical', cls: 'bg-danger-soft text-danger-muted', dot: 'status-danger' };
}

function renderRegions() {
  const grid = document.getElementById('regions-grid');
  grid.innerHTML = regions
    .map((r) => {
      const s = statusMeta(r.status);
      return `
      <article class="glass glass-hover rounded-2xl p-5 shadow-glass">
        <div class="flex items-start justify-between gap-2">
          <div>
            <h3 class="text-base font-semibold text-ink">${r.name}</h3>
            <p class="mt-0.5 text-xs text-ink-dim">${r.appliance} · Sensor ${r.sensor}</p>
          </div>
          <span class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-semibold uppercase ${s.cls}">
            <span class="status-dot ${s.dot}"></span>${s.label}
          </span>
        </div>
        <dl class="mt-4 grid grid-cols-2 gap-3 text-xs">
          <div>
            <dt class="text-ink-dim">Wire Material</dt>
            <dd class="mt-0.5 font-medium text-ink">${r.material}</dd>
          </div>
          <div>
            <dt class="text-ink-dim">Wire Resistance</dt>
            <dd class="mt-0.5 font-mono text-ink">${r.resistance} Ω</dd>
          </div>
          <div>
            <dt class="text-ink-dim">Max Current</dt>
            <dd class="mt-0.5 font-mono text-ink">${r.maxCurrent} A</dd>
          </div>
          <div>
            <dt class="text-ink-dim">Max Safe Temp</dt>
            <dd class="mt-0.5 font-mono text-ink">${r.maxTemp} °C</dd>
          </div>
        </dl>
        <div class="mt-4 flex gap-2">
          <button onclick="editRegion(${r.id})" class="flex-1 rounded-lg border border-surface-border py-2 text-xs text-ink-muted hover:bg-surface-hover transition">Edit</button>
          <button onclick="deleteRegion(${r.id})" class="flex-1 rounded-lg border border-danger/30 py-2 text-xs text-danger-muted hover:bg-danger-soft/40 transition">Delete</button>
        </div>
      </article>`;
    })
    .join('');
}

function openRegionModal(region = null) {
  editingRegionId = region ? region.id : null;
  document.getElementById('rm-name').value = region?.name || '';
  document.getElementById('rm-sensor').value = region?.sensor || '';
  document.getElementById('rm-appliance').value = region?.appliance || '';
  document.getElementById('rm-material').value = region?.material || 'Copper';
  document.getElementById('rm-resistance').value = region?.resistance ?? '';
  document.getElementById('rm-maxcurrent').value = region?.maxCurrent ?? '';
  document.getElementById('rm-maxtemp').value = region?.maxTemp ?? '';
  const modal = document.getElementById('region-modal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeRegionModal() {
  const modal = document.getElementById('region-modal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  editingRegionId = null;
}

function editRegion(id) {
  const region = regions.find((r) => r.id === id);
  if (region) openRegionModal(region);
}

function deleteRegion(id) {
  if (!confirm('Delete this region? (UI placeholder)')) return;
  regions = regions.filter((r) => r.id !== id);
  renderRegions();
  showToast('Region removed (placeholder)');
}

function saveRegion() {
  const payload = {
    name: document.getElementById('rm-name').value.trim() || 'Untitled Region',
    sensor: document.getElementById('rm-sensor').value.trim() || 'S-XX',
    appliance: document.getElementById('rm-appliance').value.trim() || 'Unknown',
    material: document.getElementById('rm-material').value,
    resistance: parseFloat(document.getElementById('rm-resistance').value) || 0,
    maxCurrent: parseFloat(document.getElementById('rm-maxcurrent').value) || 0,
    maxTemp: parseFloat(document.getElementById('rm-maxtemp').value) || 0,
    status: 'ok'
  };

  if (editingRegionId) {
    regions = regions.map((r) => (r.id === editingRegionId ? { ...r, ...payload } : r));
    showToast('Region updated (placeholder)');
  } else {
    const id = Math.max(0, ...regions.map((r) => r.id)) + 1;
    regions.push({ id, ...payload });
    showToast('Region added (placeholder)');
  }
  renderRegions();
  closeRegionModal();
}

/* -------------------- Alerts -------------------- */
function severityBorder(level) {
  if (level === 'green') return 'sev-green';
  if (level === 'yellow') return 'sev-yellow';
  if (level === 'orange') return 'sev-orange';
  return 'sev-red';
}

function severityColor(level) {
  if (level === 'green') return 'text-success-muted bg-success-soft';
  if (level === 'yellow') return 'text-yellow-400 bg-yellow-400/10';
  if (level === 'orange') return 'text-warning-muted bg-warning-soft';
  return 'text-danger-muted bg-danger-soft';
}

function renderAlerts() {
  const list = alerts.filter((a) => alertFilter === 'all' || a.state === alertFilter);
  const el = document.getElementById('alerts-timeline');
  el.innerHTML = list
    .map(
      (a) => `
    <div class="relative pb-6 pl-6">
      <span class="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ${
        a.level === 'red' ? 'bg-danger alert-blink' : a.level === 'orange' ? 'bg-warning' : a.level === 'yellow' ? 'bg-yellow-400' : 'bg-success'
      }"></span>
      <article class="glass rounded-xl border-l-4 ${severityBorder(a.level)} p-4 ${a.state === 'current' && a.level === 'red' ? 'shadow-glow-danger' : ''}">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <h4 class="text-sm font-semibold text-ink">${a.title}</h4>
              <span class="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${severityColor(a.level)}">${a.level}</span>
              <span class="rounded bg-surface-raised px-1.5 py-0.5 text-[9px] uppercase text-ink-dim">${a.state}</span>
            </div>
            <p class="mt-1 text-xs text-ink-muted">${a.reason}</p>
          </div>
          <time class="font-mono text-[11px] text-ink-dim">${a.time}</time>
        </div>
        <div class="mt-3 flex flex-wrap gap-3 text-[11px] text-ink-dim">
          <span>Region: <span class="text-ink-muted">${a.region}</span></span>
          <span>Sensor: <span class="font-mono text-ink-muted">${a.sensor}</span></span>
          <span>Level: <span class="text-ink-muted capitalize">${a.severity}</span></span>
        </div>
      </article>
    </div>`
    )
    .join('');
}

/* -------------------- Event History -------------------- */
function severityBadge(sev) {
  if (sev === 'critical') return 'bg-danger-soft text-danger-muted';
  if (sev === 'warning') return 'bg-warning-soft text-warning-muted';
  return 'bg-success-soft text-success-muted';
}

function renderHistory() {
  const q = (document.getElementById('history-search').value || '').toLowerCase();
  const sev = document.getElementById('history-severity').value;
  const region = document.getElementById('history-region').value;
  const sort = document.getElementById('history-sort').value;

  let rows = historyEvents.filter((e) => {
    const matchQ =
      !q ||
      e.event.toLowerCase().includes(q) ||
      e.region.toLowerCase().includes(q) ||
      e.sensor.toLowerCase().includes(q);
    const matchSev = sev === 'all' || e.severity === sev;
    const matchRegion = region === 'all' || e.region === region;
    return matchQ && matchSev && matchRegion;
  });

  rows = [...rows].sort((a, b) => {
    if (sort === 'oldest') return a.time.localeCompare(b.time);
    if (sort === 'severity') {
      const rank = { critical: 0, warning: 1, info: 2 };
      return (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9);
    }
    return b.time.localeCompare(a.time);
  });

  document.getElementById('history-tbody').innerHTML = rows
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
    </tr>`
    )
    .join('');

  document.getElementById('history-count').textContent = `Showing ${rows.length} events`;
}

/* -------------------- Theme button (visual only) -------------------- */
function bindThemeButton() {
  document.getElementById('theme-btn')?.addEventListener('click', () => {
    showToast('Dark industrial theme active (placeholder)');
  });
}

/* -------------------- Live placeholder tick -------------------- */
function tickLive() {
  const el = document.getElementById('last-update');
  if (el) {
    const d = new Date();
    el.textContent = d.toLocaleTimeString('en-GB', { hour12: false });
  }
}

/* -------------------- Init -------------------- */
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
  });

  document.querySelectorAll('.alert-filter').forEach((btn) => {
    btn.addEventListener('click', () => {
      alertFilter = btn.dataset.filter;
      document.querySelectorAll('.alert-filter').forEach((b) => {
        b.classList.toggle('active', b === btn);
        b.classList.toggle('border-accent/40', b === btn);
        b.classList.toggle('bg-accent-soft', b === btn);
        b.classList.toggle('text-accent-muted', b === btn);
      });
      renderAlerts();
    });
  });

  ['history-search', 'history-severity', 'history-region', 'history-sort'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', renderHistory);
    document.getElementById(id)?.addEventListener('change', renderHistory);
  });

  document.getElementById('monitor-window')?.addEventListener('change', refreshMonitoringCharts);

  bindThemeButton();
  updateClock();
  setInterval(updateClock, 1000);
  setInterval(tickLive, 2000);

  renderRegions();
  renderAlerts();
  renderHistory();
  animateCounters();

  // Delay sparklines slightly so layout is ready
  setTimeout(initDashboardSparks, 80);

  // Soft loading skeleton flash on first paint (optional polish)
  document.getElementById('last-update').textContent = 'just now';

  window.addEventListener('resize', () => {
    const active = document.querySelector('.page.active')?.id;
    if (!active || typeof Plotly === 'undefined') return;
    if (active === 'page-monitoring' && chartsInitialized.monitoring) {
      ['chart-current', 'chart-temp', 'chart-power', 'chart-cslope', 'chart-tslope'].forEach((id) => {
        try { Plotly.Plots.resize(id); } catch (_) {}
      });
    }
    if (active === 'page-statistics' && chartsInitialized.statistics) {
      ['chart-hist', 'chart-gauss', 'chart-trend'].forEach((id) => {
        try { Plotly.Plots.resize(id); } catch (_) {}
      });
    }
    if (active === 'page-bayesian' && chartsInitialized.bayesian) {
      try { Plotly.Plots.resize('chart-bayes'); } catch (_) {}
    }
  });
});

/* Expose for inline handlers */
window.navigateTo = navigateTo;
window.openSidebar = openSidebar;
window.closeSidebar = closeSidebar;
window.openRegionModal = openRegionModal;
window.closeRegionModal = closeRegionModal;
window.editRegion = editRegion;
window.deleteRegion = deleteRegion;
window.saveRegion = saveRegion;
window.refreshMonitoringCharts = refreshMonitoringCharts;
