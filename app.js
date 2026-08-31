/* ============================================================================
   SDAHC INTELLIGENCE — APPLICATION LOGIC
   Single-page shell: sidebar view switching, Overview + Pipeline rendering,
   ECharts charts, deal drawer. Everything reads through data.js helpers —
   no numbers are computed or hardcoded here beyond formatting/UI state.
   ============================================================================ */

/* ------------------------------- FORMATTERS ------------------------------ */

function hexToRgba(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function fmtFull(n) {
  return '$' + Math.round(n).toLocaleString('en-AU');
}

function fmtCompact(n) {
  const sign = n < 0 ? '-' : '';
  n = Math.abs(n);
  if (n >= 1000000) return sign + '$' + (n / 1000000).toFixed(n >= 10000000 ? 1 : 2) + 'M';
  if (n >= 1000) return sign + '$' + (n / 1000).toFixed(1) + 'k';
  return sign + '$' + Math.round(n);
}

function fmtPct(n, decimals = 0) {
  return (n * 100).toFixed(decimals) + '%';
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

const METRIC_LABELS = {
  count: 'Deal Count',
  transactionValue: 'Transaction Value',
  revenue: 'SDAHC Revenue',
  weighted: 'Weighted Revenue',
};
function fmtMetric(metric, value) {
  return metric === 'count' ? String(value) : fmtCompact(value);
}

/* --------------------------------- NAV ------------------------------------ */

const PAGE_META = {
  overview:      { eyebrow: 'Commercial Intelligence', title: 'Executive Overview' },
  pipeline:      { eyebrow: 'Deals Database',           title: 'Pipeline' },
  revenue:       { eyebrow: 'Commercial Intelligence', title: 'Revenue' },
  funnel:        { eyebrow: 'Commercial Intelligence', title: 'Sales Funnel' },
  'sda-report':  { eyebrow: 'Growth',                   title: 'SDA Report' },
  'market-intel':{ eyebrow: 'Growth',                   title: 'Market Intelligence' },
  playbook:      { eyebrow: 'Reference',                title: 'SDAHC Playbook' },
  settings:      { eyebrow: 'System',                   title: 'Settings' },
};

/* Revenue and Sales Funnel contain ECharts instances; initialising a chart
   into a hidden (display:none) container measures 0×0 and renders blank. So
   those two pages render lazily, the first time their nav item is opened —
   by then the view already has .active applied and a real size. */
const LAZY_PAGE_RENDERERS = {
  revenue: renderRevenuePage, funnel: renderFunnelPage,
  'sda-report': renderSdaReportPage, 'market-intel': renderMarketIntelPage,
  playbook: renderPlaybookPage, settings: renderSettingsPage,
};
const renderedViews = new Set();

function initNav() {
  const items = document.querySelectorAll('.nav-item');
  items.forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      items.forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.getElementById('view-' + view).classList.add('active');
      const meta = PAGE_META[view];
      document.getElementById('page-eyebrow').textContent = meta.eyebrow;
      document.getElementById('page-title').textContent = meta.title;
      if (LAZY_PAGE_RENDERERS[view] && !renderedViews.has(view)) {
        LAZY_PAGE_RENDERERS[view]();
        renderedViews.add(view);
      }
      window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    });
  });
}

function initSyncStatus() {
  const el = document.getElementById('sync-status');
  const dot = document.getElementById('sync-dot');
  const title = document.getElementById('sync-title');
  const sub = document.getElementById('sync-sub');
  el.addEventListener('click', () => {
    dot.classList.add('syncing');
    title.textContent = 'Syncing with Notion…';
    sub.textContent = 'Fetching latest deals';
    setTimeout(() => {
      dot.classList.remove('syncing');
      title.textContent = 'Synced with Notion';
      sub.textContent = 'Just now';
    }, 1100);
  });
}

/* ============================================================================
   OVERVIEW PAGE
   ============================================================================ */

let overviewPeriod = 'ytd';
let overviewMetric = 'revenue';
let pipelineChartInstance = null;
let waterfallChartInstance = null;

function renderOverview() {
  const root = document.getElementById('view-overview');
  root.innerHTML = `
    <div class="hero-panel" id="hero-panel"></div>

    <div class="kpi-row" id="kpi-row"></div>

    <div class="chart-grid section-gap">
      <div class="panel">
        <div class="panel-head">
          <div>
            <h3 class="panel-title">Commercial Flow</h3>
            <div class="panel-sub">Pipeline movement across the selected period · *Value Added is simulated</div>
          </div>
          <div class="seg-control" id="period-control">
            <button class="seg-btn" data-period="7d">7D</button>
            <button class="seg-btn" data-period="30d">30D</button>
            <button class="seg-btn" data-period="quarter">Quarter</button>
            <button class="seg-btn" data-period="ytd">YTD</button>
          </div>
        </div>
        <div class="chart-body"><div class="chart-canvas" id="waterfall-chart"></div></div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div>
            <h3 class="panel-title">Pipeline by Stage</h3>
            <div class="panel-sub">All active + closed deals</div>
          </div>
        </div>
        <div class="chart-body" style="padding-top:16px;">
          <div class="seg-control" id="metric-control" style="margin-bottom:14px;">
            <button class="seg-btn" data-metric="count">Count</button>
            <button class="seg-btn" data-metric="transactionValue">Transaction Value</button>
            <button class="seg-btn" data-metric="revenue">SDAHC Revenue</button>
            <button class="seg-btn" data-metric="weighted">Weighted Revenue</button>
          </div>
          <div class="chart-canvas tall" id="pipeline-chart"></div>
        </div>
      </div>
    </div>

    <div class="panel section-gap">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">Deal Activity</h3>
          <div class="panel-sub">New opportunity entering the funnel vs. deals leaving it, for the selected period</div>
        </div>
      </div>
      <div class="activity-row" id="activity-row"></div>
    </div>
  `;

  renderHero();
  renderKpiRow();
  renderActivityRow();
  wirePeriodControl();
  wireMetricControl();
  renderWaterfallChart();
  renderPipelineChart();
}

function renderHero() {
  const { target, settled, contracted, weighted, gap, onTrack } = Aggregates.revenueTargetSummary();

  const settledPct = Math.min(100, (settled / target) * 100);
  const contractedPct = Math.min(100 - settledPct, (contracted / target) * 100);
  const weightedPct = Math.min(100 - settledPct - contractedPct, (weighted / target) * 100);

  // Pace marker: how far through the calendar year we are, as a % of target.
  const yearStart = new Date(TODAY.getFullYear(), 0, 1);
  const yearEnd = new Date(TODAY.getFullYear() + 1, 0, 1);
  const paceFraction = (TODAY - yearStart) / (yearEnd - yearStart);
  const pacePct = paceFraction * 100;

  const hero = document.getElementById('hero-panel');
  hero.innerHTML = `
    <div class="hero-top">
      <div>
        <div class="hero-metric-label">Settled Revenue · YTD</div>
        <div class="hero-figure tabular">${fmtFull(settled)}</div>
      </div>
      <div class="hero-target">
        <div class="hero-target-label">Annual Target</div>
        <div class="hero-target-figure tabular">${fmtFull(target)}</div>
        <div class="hero-target-pct">${fmtPct(settled / target, 0)} settled to date</div>
      </div>
    </div>

    <div class="hero-progress">
      <div class="hero-progress-track">
        <div class="hero-progress-seg seg-settled" style="width:${settledPct}%"></div>
        <div class="hero-progress-seg seg-contracted" style="width:${contractedPct}%"></div>
        <div class="hero-progress-seg seg-weighted" style="width:${weightedPct}%"></div>
      </div>
      <div class="hero-progress-marker" style="left:${pacePct}%" data-label="Pace · ${pacePct.toFixed(0)}% of year"></div>
    </div>

    <div class="hero-legend">
      <div class="hero-legend-item"><span class="hero-legend-swatch" style="background:#2FB37A"></span>Settled <strong>${fmtCompact(settled)}</strong></div>
      <div class="hero-legend-item"><span class="hero-legend-swatch" style="background:#0476D9"></span>Contracted <strong>${fmtCompact(contracted)}</strong></div>
      <div class="hero-legend-item"><span class="hero-legend-swatch" style="background:#E0A82E"></span>Weighted Pipeline <strong>${fmtCompact(weighted)}</strong></div>
      <div class="hero-gap ${onTrack ? 'on-track' : ''}">${onTrack ? 'Potential clears target by' : 'Gap to target'} <strong>${fmtCompact(gap)}</strong></div>
    </div>
  `;
}

function renderKpiRow() {
  const settled = Aggregates.settledRevenueYTD();
  const settings = getSettings();
  const expectedOpen = Aggregates.expectedOpenPipelineRevenue();
  const weighted = Aggregates.weightedPipelineRevenue();
  const active = Aggregates.active().length;
  const newProspects = Aggregates.newProspectsThisMonth();
  const winRate = Aggregates.winRate();

  const cards = [
    { label: 'Settled Revenue YTD', value: fmtCompact(settled), foot: `of ${fmtCompact(settings.annualTarget)} target` },
    { label: 'Expected Open Pipeline', value: fmtCompact(expectedOpen), foot: `${Aggregates.active().length} active deals, full value` },
    { label: 'Weighted Pipeline', value: fmtCompact(weighted), foot: 'probability-adjusted' },
    { label: 'Active Deals', value: String(active), foot: `${Aggregates.won().length} won · ${Aggregates.lost().length} lost` },
    { label: 'New Prospects', value: String(newProspects), foot: 'this calendar month' },
    { label: 'Win Rate', value: fmtPct(winRate, 0), foot: `${Aggregates.won().length} won of ${Aggregates.won().length + Aggregates.lost().length} decided` },
  ];

  document.getElementById('kpi-row').innerHTML = cards.map(c => `
    <div class="kpi-card">
      <div class="kpi-label">${c.label}</div>
      <div class="kpi-value tabular">${c.value}</div>
      <div class="kpi-foot">${c.foot}</div>
    </div>
  `).join('');
}

function renderActivityRow() {
  const a = Aggregates.activitySummary(overviewPeriod);
  const items = [
    { label: 'New Prospects', value: a.newProspects, color: 'var(--stage-prospecting)' },
    { label: 'Qualified Opportunities', value: a.qualifiedOpportunities, color: 'var(--stage-advisory)' },
    { label: 'Proposals Sent', value: a.proposalsSent, color: 'var(--blue)' },
    { label: 'Engagements Won', value: a.engagementsWon, color: 'var(--stage-negotiation)' },
    { label: 'Deals Lost', value: a.dealsLost, color: 'var(--red)' },
    { label: 'Deals Settled', value: a.dealsSettled, color: 'var(--green)' },
  ];
  document.getElementById('activity-row').innerHTML = items.map(i => `
    <div class="activity-item">
      <div class="activity-bar" style="background:${i.color}"></div>
      <div class="activity-figure tabular">${i.value}</div>
      <div class="activity-caption">${i.label}</div>
    </div>
  `).join('');
}

function wirePeriodControl() {
  const control = document.getElementById('period-control');
  control.querySelectorAll('.seg-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.period === overviewPeriod);
    btn.addEventListener('click', () => {
      overviewPeriod = btn.dataset.period;
      control.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b === btn));
      renderWaterfallChart();
      renderActivityRow();
    });
  });
}

function wireMetricControl() {
  const control = document.getElementById('metric-control');
  control.querySelectorAll('.seg-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.metric === overviewMetric);
    btn.addEventListener('click', () => {
      overviewMetric = btn.dataset.metric;
      control.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b === btn));
      renderPipelineChart();
    });
  });
}

function renderWaterfallChart() {
  const el = document.getElementById('waterfall-chart');
  if (!waterfallChartInstance) waterfallChartInstance = echarts.init(el);
  const flow = Aggregates.commercialFlow(overviewPeriod);

  const cum0 = flow.opening;
  const cum1 = cum0 + flow.newOpportunities;
  const cum2 = cum1 + flow.valueAdded;
  const cum3 = cum2 - flow.lost;
  const cum4 = cum3 - flow.settled;

  const categories = ['Opening', 'New Opps', 'Value Added*', 'Lost', 'Settled', 'Closing'];
  const placeholder = [0, cum0, cum1, cum3, cum4, 0];
  const values = [flow.opening, flow.newOpportunities, flow.valueAdded, flow.lost, flow.settled, flow.closing];
  const colors = ['#8592A6', '#0476D9', '#14A8A0', '#D9534F', '#2FB37A', '#0A1E36'];

  waterfallChartInstance.setOption({
    grid: { left: 8, right: 16, top: 20, bottom: 28, containLabel: true },
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const idx = params[0].dataIndex;
        const note = idx === 2 ? '<br/><span style="color:#94A3B8">Simulated — no stage-history to derive this from</span>' : '';
        return `<strong>${categories[idx]}</strong><br/>${fmtFull(values[idx])}${note}`;
      },
      backgroundColor: '#0A1E36', borderWidth: 0, textStyle: { color: '#fff', fontSize: 12 },
    },
    xAxis: {
      type: 'category', data: categories,
      axisLine: { lineStyle: { color: '#E3E8F0' } },
      axisTick: { show: false },
      axisLabel: { color: '#6B7688', fontSize: 11, fontFamily: 'IBM Plex Sans' },
    },
    yAxis: {
      type: 'value', axisLabel: { formatter: (v) => fmtCompact(v), color: '#97A1B0', fontSize: 10.5 },
      splitLine: { lineStyle: { color: '#EDF0F6' } },
    },
    series: [
      { type: 'bar', stack: 'wf', silent: true, itemStyle: { color: 'transparent' }, data: placeholder, barWidth: '56%' },
      {
        type: 'bar', stack: 'wf', data: values.map((v, i) => ({ value: v, itemStyle: { color: colors[i], borderRadius: i === 0 || i === 5 ? [4,4,4,4] : [3,3,3,3] } })),
        barWidth: '56%',
        label: { show: true, position: 'top', formatter: (p) => fmtCompact(p.data.value), color: '#3B4657', fontSize: 10.5, fontFamily: 'IBM Plex Mono' },
      },
    ],
  });
}

function renderPipelineChart() {
  const el = document.getElementById('pipeline-chart');
  if (!pipelineChartInstance) pipelineChartInstance = echarts.init(el);
  const rows = Aggregates.byStage(overviewMetric);

  pipelineChartInstance.setOption({
    grid: { left: 8, right: 16, top: 10, bottom: 56, containLabel: true },
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const row = rows[params[0].dataIndex];
        return `<strong>${row.stage.label}</strong><br/>${METRIC_LABELS[overviewMetric]}: ${fmtMetric(overviewMetric, row.value)}<br/>${row.count} deal${row.count === 1 ? '' : 's'}`;
      },
      backgroundColor: '#0A1E36', borderWidth: 0, textStyle: { color: '#fff', fontSize: 12 },
    },
    xAxis: {
      type: 'category', data: rows.map(r => r.stage.short),
      axisLine: { lineStyle: { color: '#E3E8F0' } },
      axisTick: { show: false },
      axisLabel: { color: '#6B7688', fontSize: 10, rotate: 38, fontFamily: 'IBM Plex Sans' },
    },
    yAxis: {
      type: 'value', axisLabel: { formatter: (v) => fmtMetric(overviewMetric, v), color: '#97A1B0', fontSize: 10.5 },
      splitLine: { lineStyle: { color: '#EDF0F6' } },
    },
    series: [{
      type: 'bar',
      data: rows.map(r => ({ value: r.value, itemStyle: { color: STAGE_GROUPS[r.stage.group].color, borderRadius: [4,4,0,0] } })),
      barWidth: '62%',
    }],
  });
}

/* ============================================================================
   PIPELINE PAGE
   ============================================================================ */

let pipelineMetric = 'count';
let tableSortKey = 'stage';
let tableSortDir = 'asc';

function renderPipelinePage() {
  const root = document.getElementById('view-pipeline');
  root.innerHTML = `
    <div class="pipeline-toolbar">
      <div>
        <div class="panel-sub" style="font-size:13px;">Every stage of the Notion Deals database, coloured by phase. Metric toggle changes what each stage reports.</div>
      </div>
      <div class="seg-control" id="pipeline-metric-control">
        <button class="seg-btn" data-metric="count">Count</button>
        <button class="seg-btn" data-metric="transactionValue">Transaction Value</button>
        <button class="seg-btn" data-metric="revenue">SDAHC Revenue</button>
        <button class="seg-btn" data-metric="weighted">Weighted Revenue</button>
      </div>
    </div>

    <div class="panel" style="padding:20px 16px 18px;">
      <div class="pipeline-flow-scroller">
        <div class="pipeline-flow" id="pipeline-flow"></div>
      </div>
    </div>

    <div class="panel section-gap">
      <div class="panel-head" style="padding-bottom:16px;">
        <div>
          <h3 class="panel-title">Deals</h3>
          <div class="panel-sub">${DEALS.length} deals · click a row to open the deal detail</div>
        </div>
      </div>
      <div class="table-wrap">
        <table class="deals-table" id="deals-table">
          <thead>
            <tr>
              <th data-key="name">Deal</th>
              <th data-key="stage">Stage</th>
              <th data-key="owner">Owner</th>
              <th>Deal Type</th>
              <th class="num-head" data-key="transactionValue">Transaction Value</th>
              <th class="num-head" data-key="revenue">Expected SDAHC Revenue</th>
              <th class="num-head" data-key="probability">Probability</th>
              <th class="num-head" data-key="weighted">Weighted Revenue</th>
              <th data-key="outcome">Outcome</th>
            </tr>
          </thead>
          <tbody id="deals-tbody"></tbody>
        </table>
      </div>
    </div>
  `;

  wirePipelineMetricControl();
  renderPipelineFlow();
  wireTableSort();
  renderDealsTable();
}

function wirePipelineMetricControl() {
  const control = document.getElementById('pipeline-metric-control');
  control.querySelectorAll('.seg-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.metric === pipelineMetric);
    btn.addEventListener('click', () => {
      pipelineMetric = btn.dataset.metric;
      control.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b === btn));
      renderPipelineFlow();
    });
  });
}

function renderPipelineFlow() {
  const rows = Aggregates.byStage(pipelineMetric);
  const maxVal = Math.max(1, ...rows.map(r => r.value));

  // group consecutive stages by their stage.group
  const blocks = [];
  rows.forEach(row => {
    const last = blocks[blocks.length - 1];
    if (last && last.group === row.stage.group) last.rows.push(row);
    else blocks.push({ group: row.stage.group, rows: [row] });
  });

  const container = document.getElementById('pipeline-flow');
  container.innerHTML = blocks.map(block => {
    const meta = STAGE_GROUPS[block.group];
    const cards = block.rows.map(row => {
      const pct = Math.max(4, (row.value / maxVal) * 100);
      return `
        <div class="stage-card">
          <div class="stage-card-top">
            <div class="stage-card-name">${row.stage.short}</div>
            <div class="stage-card-count">${row.count}</div>
          </div>
          <div class="stage-card-value">${fmtMetric(pipelineMetric, row.value)}<span class="unit">${pipelineMetric === 'count' ? (row.count === 1 ? 'deal' : 'deals') : ''}</span></div>
          <div class="stage-card-bar-track"><div class="stage-card-bar-fill" style="width:${pct}%; background:${meta.color}"></div></div>
          <div class="stage-card-sub">Rev ${fmtCompact(row.revenue)} · Wtd ${fmtCompact(row.weighted)}</div>
        </div>
      `;
    }).join('');
    return `
      <div class="stage-group-block">
        <div class="stage-group-header" style="color:${meta.color}"><span class="dot" style="background:${meta.color}"></span>${meta.label}</div>
        <div class="stage-group-cards">${cards}</div>
      </div>
    `;
  }).join('');
}

function wireTableSort() {
  document.querySelectorAll('#deals-table thead th[data-key]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      if (tableSortKey === key) tableSortDir = tableSortDir === 'asc' ? 'desc' : 'asc';
      else { tableSortKey = key; tableSortDir = key === 'stage' ? 'asc' : 'desc'; }
      renderDealsTable();
    });
  });
}

function sortedDeals() {
  const list = [...DEALS];
  const dir = tableSortDir === 'asc' ? 1 : -1;
  list.sort((a, b) => {
    let av, bv;
    switch (tableSortKey) {
      case 'stage': av = STAGE_INDEX[a.stage]; bv = STAGE_INDEX[b.stage]; break;
      case 'name': av = a.name; bv = b.name; break;
      case 'owner': av = a.owner; bv = b.owner; break;
      case 'outcome': av = a.outcome; bv = b.outcome; break;
      case 'transactionValue': av = a.transactionValue; bv = b.transactionValue; break;
      case 'revenue': av = sdahcRevenue(a); bv = sdahcRevenue(b); break;
      case 'probability': av = a.probability; bv = b.probability; break;
      case 'weighted': av = weightedRevenue(a); bv = weightedRevenue(b); break;
      default: av = 0; bv = 0;
    }
    if (typeof av === 'string') return av.localeCompare(bv) * dir;
    return (av - bv) * dir;
  });
  return list;
}

function outcomeClass(outcome) {
  return { Won: 'won', Lost: 'lost', 'In Progress': 'in-progress', Paused: 'paused' }[outcome];
}

function renderDealsTable() {
  document.querySelectorAll('#deals-table thead th[data-key]').forEach(th => {
    th.classList.toggle('sorted', th.dataset.key === tableSortKey);
  });

  const highValueThreshold = getSettings().highValueDealThreshold;
  const tbody = document.getElementById('deals-tbody');
  tbody.innerHTML = sortedDeals().map(d => {
    const stage = getStage(d.stage);
    const meta = STAGE_GROUPS[stage.group];
    const rev = sdahcRevenue(d);
    const wtd = weightedRevenue(d);
    const highValueTag = d.transactionValue >= highValueThreshold ? '<span class="high-value-badge">High Value</span>' : '';
    return `
      <tr data-id="${d.id}">
        <td class="deal-name-cell">${d.name}${highValueTag}<span class="deal-entity">${d.entity}</span></td>
        <td><span class="stage-chip" style="background:${hexToRgba(meta.color, 0.12)}; color:${meta.color}"><span class="dot" style="background:${meta.color}"></span>${stage.short}</span></td>
        <td>${d.owner}</td>
        <td><div class="type-tags">${d.dealType.map(t => `<span class="type-tag">${t}</span>`).join('')}</div></td>
        <td class="num-cell tabular">${fmtFull(d.transactionValue)}</td>
        <td class="num-cell tabular">${fmtFull(rev)}</td>
        <td class="num-cell"><div class="prob-cell" style="justify-content:flex-end;"><div class="prob-track"><div class="prob-fill" style="width:${d.probability * 100}%"></div></div><span class="prob-num tabular">${fmtPct(d.probability)}</span></div></td>
        <td class="num-cell tabular">${fmtFull(wtd)}</td>
        <td><span class="outcome-chip ${outcomeClass(d.outcome)}">${d.outcome}</span></td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', () => openDrawer(tr.dataset.id));
  });
}

/* ============================================================================
   REVENUE PAGE
   ============================================================================ */

let revenueTimeChartInstance = null;
let revenueSourceChartInstance = null;

function renderRevenuePage() {
  const root = document.getElementById('view-revenue');
  root.innerHTML = `
    <div class="kpi-row kpi-row-6" id="revenue-kpi-row"></div>

    <div class="chart-grid section-gap">
      <div class="panel">
        <div class="panel-head">
          <div>
            <h3 class="panel-title">Revenue Over Time</h3>
            <div class="panel-sub">Actual settled vs. target vs. forecast · ${TODAY.getFullYear()} · *Forecast month is simulated</div>
          </div>
        </div>
        <div class="chart-body"><div class="chart-canvas tall" id="revenue-time-chart"></div></div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div>
            <h3 class="panel-title">Revenue Composition</h3>
            <div class="panel-sub">By fee source · Won + active pipeline</div>
          </div>
        </div>
        <div class="chart-body" style="padding-bottom:20px;">
          <div class="chart-canvas" id="revenue-source-chart" style="height:230px;"></div>
          <div class="legend-list" id="revenue-source-legend"></div>
        </div>
      </div>
    </div>

    <div class="chart-grid section-gap">
      <div class="panel">
        <div class="panel-head">
          <div>
            <h3 class="panel-title">Revenue Concentration</h3>
            <div class="panel-sub">Concentration risk across Won + active deals</div>
          </div>
        </div>
        <div id="concentration-body" style="padding:6px 24px 24px;"></div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div>
            <h3 class="panel-title">Revenue by Stage</h3>
            <div class="panel-sub">Expected SDAHC revenue currently held at each stage</div>
          </div>
        </div>
        <div id="revenue-stage-body" style="padding:14px 24px 20px;"></div>
      </div>
    </div>
  `;

  renderRevenueKpiRow();
  renderRevenueTimeChart();
  renderRevenueSourceChart();
  renderConcentration();
  renderRevenueByStageList();
}

function renderRevenueKpiRow() {
  const t = Aggregates.revenueTargetSummary();
  const openPipeline = Aggregates.expectedOpenPipelineRevenue();
  const cards = [
    { label: 'Settled Revenue', value: fmtCompact(t.settled), foot: 'YTD, realised' },
    { label: 'Contracted Revenue', value: fmtCompact(t.contracted), foot: 'Contract Issued + Under Contract' },
    { label: 'Weighted Forecast', value: fmtCompact(t.weighted), foot: 'active pipeline, probability-adjusted' },
    { label: 'Open Revenue Pipeline', value: fmtCompact(openPipeline), foot: 'active pipeline, full value' },
    { label: 'Revenue Target', value: fmtCompact(t.target), foot: `FY${TODAY.getFullYear()}` },
    { label: 'Gap to Target', value: fmtCompact(t.gap), foot: t.onTrack ? 'on track — potential covers target' : `${fmtPct(t.totalPotential / t.target)} of target covered`, footClass: t.onTrack ? 'pos' : 'neg' },
  ];
  document.getElementById('revenue-kpi-row').innerHTML = cards.map(c => `
    <div class="kpi-card">
      <div class="kpi-label">${c.label}</div>
      <div class="kpi-value tabular">${c.value}</div>
      <div class="kpi-foot ${c.footClass || ''}">${c.foot}</div>
    </div>
  `).join('');
}

function renderRevenueTimeChart() {
  const el = document.getElementById('revenue-time-chart');
  if (!revenueTimeChartInstance) revenueTimeChartInstance = echarts.init(el);
  const months = Aggregates.monthlyRevenueSeries();

  revenueTimeChartInstance.setOption({
    grid: { left: 8, right: 16, top: 38, bottom: 28, containLabel: true },
    legend: { top: 0, right: 0, textStyle: { fontSize: 11, color: '#6B7688', fontFamily: 'IBM Plex Sans' }, itemWidth: 12, itemHeight: 8 },
    tooltip: {
      trigger: 'axis',
      formatter: (params) => {
        const idx = params[0].dataIndex;
        const m = months[idx];
        let lines = `<strong>${m.label} ${TODAY.getFullYear()}</strong>`;
        if (m.actual !== null) lines += `<br/>Actual: ${fmtFull(m.actual)}`;
        if (m.forecast !== null) lines += `<br/>Forecast*: ${fmtFull(m.forecast)}`;
        lines += `<br/>Target: ${fmtFull(m.target)}`;
        return lines;
      },
      backgroundColor: '#0A1E36', borderWidth: 0, textStyle: { color: '#fff', fontSize: 12 },
    },
    xAxis: {
      type: 'category', data: months.map(m => m.label),
      axisLine: { lineStyle: { color: '#E3E8F0' } }, axisTick: { show: false },
      axisLabel: { color: '#6B7688', fontSize: 11, fontFamily: 'IBM Plex Sans' },
    },
    yAxis: {
      type: 'value', axisLabel: { formatter: (v) => fmtCompact(v), color: '#97A1B0', fontSize: 10.5 },
      splitLine: { lineStyle: { color: '#EDF0F6' } },
    },
    series: [
      { name: 'Actual', type: 'bar', data: months.map(m => m.actual), itemStyle: { color: '#2FB37A', borderRadius: [3, 3, 0, 0] }, barMaxWidth: 22 },
      { name: 'Forecast*', type: 'bar', data: months.map(m => m.forecast), itemStyle: { color: '#E0A82E', opacity: 0.78, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 22 },
      { name: 'Target', type: 'line', data: months.map(m => m.target), symbol: 'none', lineStyle: { color: '#64748B', type: 'dashed', width: 1.5 } },
    ],
  });
}

function renderRevenueSourceChart() {
  const el = document.getElementById('revenue-source-chart');
  if (!revenueSourceChartInstance) revenueSourceChartInstance = echarts.init(el);
  const { totals, total } = Aggregates.revenueBySource();
  const rows = [
    { name: 'Brokerage / Sale', value: totals.brokerage, color: '#0476D9' },
    { name: 'Paid Advisory', value: totals.advisory, color: '#7A5CC7' },
    { name: 'Conjunction', value: totals.conjunction, color: '#14A8A0' },
    { name: 'Referral', value: totals.referral, color: '#E0A82E' },
  ];

  revenueSourceChartInstance.setOption({
    tooltip: {
      trigger: 'item',
      formatter: (p) => `<strong>${p.name}</strong><br/>${fmtFull(p.value)} (${p.percent}%)`,
      backgroundColor: '#0A1E36', borderWidth: 0, textStyle: { color: '#fff', fontSize: 12 },
    },
    series: [{
      type: 'pie', radius: ['54%', '80%'], center: ['50%', '50%'],
      avoidLabelOverlap: true,
      label: { formatter: '{d}%', fontSize: 11, fontWeight: 600, color: '#3B4657', fontFamily: 'IBM Plex Mono' },
      labelLine: { length: 8, length2: 6 },
      data: rows.map(r => ({ name: r.name, value: r.value, itemStyle: { color: r.color } })),
    }],
  });

  document.getElementById('revenue-source-legend').innerHTML = rows.map(r => `
    <div class="legend-row">
      <div class="legend-left"><span class="legend-dot" style="background:${r.color}"></span>${r.name}</div>
      <div><span class="legend-amount tabular">${fmtCompact(r.value)}</span><span class="legend-pct tabular">${fmtPct(total ? r.value / total : 0)}</span></div>
    </div>
  `).join('');
}

function renderConcentration() {
  const c = Aggregates.revenueConcentration(3);
  const maxVal = c.top.length ? sdahcRevenue(c.top[0]) : 1;
  const rows = c.top.map((d, i) => {
    const rev = sdahcRevenue(d);
    const pct = c.total ? rev / c.total : 0;
    return `
      <div class="concentration-row">
        <div class="concentration-rank">#${i + 1}</div>
        <div class="concentration-info">
          <div class="concentration-name">${d.name}</div>
          <div class="concentration-sub">${d.owner} · ${getStage(d.stage).short}</div>
        </div>
        <div class="concentration-bar-track"><div class="concentration-bar-fill" style="width:${(rev / maxVal) * 100}%"></div></div>
        <div class="concentration-value tabular">${fmtCompact(rev)}<span class="concentration-pct">${fmtPct(pct)}</span></div>
      </div>
    `;
  }).join('');

  document.getElementById('concentration-body').innerHTML = `
    <div class="concentration-headline">Top ${c.n} deals = <strong>${fmtPct(c.pct)}</strong> of expected revenue</div>
    <div class="concentration-headline-sub">Across ${c.top.length ? c.top.length + '+' : ''} Won + active deals · excludes Lost</div>
    <div class="concentration-list">${rows}</div>
  `;
}

function renderRevenueByStageList() {
  const rows = Aggregates.byStage('revenue').filter(r => r.count > 0);
  const maxVal = Math.max(1, ...rows.map(r => r.revenue));
  document.getElementById('revenue-stage-body').innerHTML = rows.map(r => `
    <div class="stage-list-row">
      <div class="stage-list-label" style="color:${STAGE_GROUPS[r.stage.group].color}">${r.stage.short}</div>
      <div class="stage-list-bar-track"><div class="stage-list-bar-fill" style="width:${(r.revenue / maxVal) * 100}%; background:${STAGE_GROUPS[r.stage.group].color}"></div></div>
      <div class="stage-list-value tabular">${fmtCompact(r.revenue)}</div>
    </div>
  `).join('');
}

/* ============================================================================
   SALES FUNNEL PAGE
   Conceptually distinct from Pipeline: Pipeline shows where TODAY'S deals
   currently sit across the 16 real Notion stages. This page shows conversion
   EFFICIENCY — of everyone SDAHC talks to, what fraction reaches each
   successive milestone, and where the biggest drop-offs are.
   ============================================================================ */

let funnelChartInstance = null;
let prospectsChartInstance = null;

const FUNNEL_TIER_COLORS = [
  '#B7C1D1',                       // Market / Relationships (estimate)
  STAGE_GROUPS.prospecting.color,  // Prospects
  STAGE_GROUPS.prospecting.color,  // Qualified Opportunities
  STAGE_GROUPS.advisory.color,     // Advisory Proposal
  STAGE_GROUPS.advisory.color,     // Advisory Engagement
  STAGE_GROUPS.brokerage.color,    // Transaction Ready
  STAGE_GROUPS.brokerage.color,    // Brokerage / Sale Mandate
  STAGE_GROUPS.negotiation.color,  // Negotiation
  STAGE_GROUPS.negotiation.color,  // Contract
  STAGE_GROUPS.settlement.color,   // Settlement
];

function renderFunnelPage() {
  const root = document.getElementById('view-funnel');
  root.innerHTML = `
    <div class="chart-grid" style="grid-template-columns: 1fr 1.05fr;">
      <div class="panel">
        <div class="panel-head">
          <div>
            <h3 class="panel-title">Conversion Funnel</h3>
            <div class="panel-sub">Market reach through to settlement · *Market/Relationships is estimated, not tracked in Notion</div>
          </div>
        </div>
        <div class="chart-body"><div class="chart-canvas" id="funnel-chart" style="height:430px;"></div></div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div><h3 class="panel-title">Stage Conversion</h3><div class="panel-sub">Conversion and drop-off between each stage</div></div>
        </div>
        <div id="funnel-table-body" style="padding:8px 24px 20px;"></div>
      </div>
    </div>

    <div class="panel section-gap">
      <div class="panel-head">
        <div><h3 class="panel-title">New vs. Lost Prospects</h3><div class="panel-sub">Trailing 14 months · created vs. lost, by month</div></div>
      </div>
      <div class="chart-body"><div class="chart-canvas" id="prospects-chart"></div></div>
    </div>

    <div class="chart-grid section-gap">
      <div class="panel">
        <div class="panel-head">
          <div><h3 class="panel-title">Relationship-Led vs Marketing-Sourced</h3><div class="panel-sub">Volume and qualification rate by channel</div></div>
        </div>
        <div id="source-group-body" style="padding:18px 24px 22px;"></div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div><h3 class="panel-title">Prospect Sources</h3><div class="panel-sub">Individual channel performance</div></div>
        </div>
        <div id="source-detail-body" style="padding:6px 24px 18px;"></div>
      </div>
    </div>

    <div class="panel section-gap">
      <div class="panel-head">
        <div><h3 class="panel-title">Cohort Conversion by Quarter</h3><div class="panel-sub">Ultimate win rate of deals created each quarter · recent cohorts still undecided</div></div>
      </div>
      <div id="cohort-body" style="padding:6px 24px 18px;"></div>
    </div>
  `;

  renderFunnelChart();
  renderFunnelTable();
  renderProspectsChart();
  renderSourceGroups();
  renderSourceDetail();
  renderCohortTable();
}

function renderFunnelChart() {
  const el = document.getElementById('funnel-chart');
  if (!funnelChartInstance) funnelChartInstance = echarts.init(el);
  const rows = Aggregates.funnelStages();
  const maxVal = rows[0].count;

  funnelChartInstance.setOption({
    tooltip: {
      trigger: 'item',
      formatter: (p) => {
        const row = rows[p.dataIndex];
        let s = `<strong>${row.label}${row.isEstimate ? ' (estimated)' : ''}</strong><br/>${row.count} ${row.isEstimate ? '' : 'deals'}`;
        if (row.conversionFromPrevious !== null) s += `<br/>Converted from previous stage: ${fmtPct(row.conversionFromPrevious)}`;
        return s;
      },
      backgroundColor: '#0A1E36', borderWidth: 0, textStyle: { color: '#fff', fontSize: 12 },
    },
    series: [{
      type: 'funnel',
      left: 110, right: 110, top: 8, bottom: 8,
      min: 0, max: maxVal, sort: 'none', gap: 3,
      label: {
        position: 'outer', formatter: '{b}  ·  {c}',
        fontSize: 11.5, color: '#3B4657', fontFamily: 'IBM Plex Sans', fontWeight: 600,
      },
      labelLine: { length: 14, lineStyle: { color: '#CBD5E1' } },
      itemStyle: { borderColor: '#fff', borderWidth: 1 },
      data: rows.map((r, i) => ({
        value: r.count,
        name: r.label + (r.isEstimate ? ' *' : ''),
        itemStyle: { color: FUNNEL_TIER_COLORS[i], opacity: r.isEstimate ? 0.6 : 1 },
      })),
    }],
  });
}

function renderFunnelTable() {
  const rows = Aggregates.funnelStages();
  const head = `<div class="funnel-table-head"><div>Stage</div><div style="text-align:right">Count</div><div style="text-align:right">Converted</div><div style="text-align:right">Dropped</div></div>`;
  const list = rows.map((r, i) => `
    <div class="funnel-row">
      <div class="funnel-row-label"><span class="dot" style="background:${FUNNEL_TIER_COLORS[i]}"></span>${r.label}${r.isEstimate ? ' *' : ''}</div>
      <div class="funnel-row-count tabular">${r.count}</div>
      <div class="funnel-row-conv tabular">${r.conversionFromPrevious === null ? '—' : fmtPct(r.conversionFromPrevious)}</div>
      <div class="funnel-row-drop tabular">${r.dropoffFromPrevious === null ? '—' : fmtPct(r.dropoffFromPrevious)}</div>
    </div>
  `).join('');
  document.getElementById('funnel-table-body').innerHTML = head + list;
}

function renderProspectsChart() {
  const el = document.getElementById('prospects-chart');
  if (!prospectsChartInstance) prospectsChartInstance = echarts.init(el);
  const months = Aggregates.prospectsOverTime();

  prospectsChartInstance.setOption({
    grid: { left: 8, right: 16, top: 34, bottom: 28, containLabel: true },
    legend: { top: 0, right: 0, textStyle: { fontSize: 11, color: '#6B7688', fontFamily: 'IBM Plex Sans' }, itemWidth: 12, itemHeight: 8 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: '#0A1E36', borderWidth: 0, textStyle: { color: '#fff', fontSize: 12 } },
    xAxis: {
      type: 'category', data: months.map(m => m.label),
      axisLine: { lineStyle: { color: '#E3E8F0' } }, axisTick: { show: false },
      axisLabel: { color: '#6B7688', fontSize: 10, fontFamily: 'IBM Plex Sans' },
    },
    yAxis: { type: 'value', axisLabel: { color: '#97A1B0', fontSize: 10.5 }, splitLine: { lineStyle: { color: '#EDF0F6' } } },
    series: [
      { name: 'New Prospects', type: 'bar', data: months.map(m => m.newCount), itemStyle: { color: '#0476D9', borderRadius: [3, 3, 0, 0] }, barMaxWidth: 16 },
      { name: 'Lost', type: 'bar', data: months.map(m => m.lostCount), itemStyle: { color: '#D9534F', borderRadius: [3, 3, 0, 0] }, barMaxWidth: 16 },
    ],
  });
}

function renderSourceGroups() {
  const { groups } = Aggregates.prospectSourceBreakdown();
  const rel = groups.find(g => g.group === 'relationship');
  const mkt = groups.find(g => g.group === 'marketing');
  const totalCount = rel.count + mkt.count;
  document.getElementById('source-group-body').innerHTML = `
    <div class="channel-compare">
      <div class="channel-card">
        <div class="channel-card-label" style="color:${STAGE_GROUPS.brokerage.color}">Relationship-Led</div>
        <div class="channel-card-value tabular">${rel.count}</div>
        <div class="channel-card-sub">${fmtPct(totalCount ? rel.count / totalCount : 0)} of all prospects</div>
        <div class="channel-card-rate" style="color:${STAGE_GROUPS.brokerage.color}">${fmtPct(rel.qualifiedRate)} qualified</div>
      </div>
      <div class="channel-card">
        <div class="channel-card-label" style="color:${STAGE_GROUPS.negotiation.color}">Marketing-Sourced</div>
        <div class="channel-card-value tabular">${mkt.count}</div>
        <div class="channel-card-sub">${fmtPct(totalCount ? mkt.count / totalCount : 0)} of all prospects</div>
        <div class="channel-card-rate" style="color:${STAGE_GROUPS.negotiation.color}">${fmtPct(mkt.qualifiedRate)} qualified</div>
      </div>
    </div>
    <div class="channel-bar-track"><div class="channel-bar-fill" style="width:${totalCount ? (rel.count / totalCount) * 100 : 0}%"></div></div>
    <div class="channel-bar-caption">Relationship-led sources supply ${fmtPct(totalCount ? rel.count / totalCount : 0)} of volume at a ${fmtPct(rel.qualifiedRate)} qualification rate, vs ${fmtPct(mkt.qualifiedRate)} for marketing-sourced.</div>
  `;
}

function renderSourceDetail() {
  const { bySource } = Aggregates.prospectSourceBreakdown();
  const sorted = [...bySource].sort((a, b) => b.count - a.count);
  const maxCount = Math.max(1, ...sorted.map(s => s.count));
  document.getElementById('source-detail-body').innerHTML = sorted.map(s => `
    <div class="source-row">
      <div class="source-row-name">${s.source}<span class="source-row-group">${s.group === 'relationship' ? 'Relationship-led' : 'Marketing-sourced'}</span></div>
      <div class="source-row-bar-track"><div class="source-row-bar-fill" style="width:${(s.count / maxCount) * 100}%; background:${s.group === 'relationship' ? STAGE_GROUPS.brokerage.color : STAGE_GROUPS.negotiation.color}"></div></div>
      <div class="source-row-count tabular">${s.count}</div>
      <div class="source-row-rate tabular">${fmtPct(s.qualifiedRate)}</div>
    </div>
  `).join('');
}

function renderCohortTable() {
  const rows = Aggregates.conversionByQuarter();
  document.getElementById('cohort-body').innerHTML = `
    <div class="cohort-head"><div>Quarter</div><div>Created</div><div>Won</div><div>Lost</div><div>Conversion</div></div>
    ${rows.map(r => `
      <div class="cohort-row">
        <div>${r.label}</div>
        <div class="tabular">${r.created}</div>
        <div class="tabular" style="color:var(--green)">${r.won}</div>
        <div class="tabular" style="color:var(--red)">${r.lost}</div>
        <div class="tabular">${r.conversionRate === null ? 'Too early' : fmtPct(r.conversionRate)}</div>
      </div>
    `).join('')}
  `;
}

/* ============================================================================
   DEAL DETAIL DRAWER
   ============================================================================ */

function openDrawer(id) {
  const deal = DEALS.find(d => d.id === id);
  if (!deal) return;
  const stage = getStage(deal.stage);
  const meta = STAGE_GROUPS[stage.group];
  const rev = sdahcRevenue(deal);
  const wtd = weightedRevenue(deal);

  document.getElementById('drawer-stage-chip').innerHTML =
    `<span class="stage-chip" style="background:rgba(255,255,255,0.14); color:#fff"><span class="dot" style="background:${meta.color}"></span>${stage.label}</span>`;
  document.getElementById('drawer-name').textContent = deal.name;
  document.getElementById('drawer-entity').textContent = `${deal.entity} · ${deal.owner}`;

  let statusBlock = '';
  if (deal.outcome === 'Lost') {
    statusBlock = `<div class="drawer-section"><div class="drawer-section-label">Lost Reason</div><div class="drawer-section-text">${deal.lostReason}</div></div>`;
  } else if (deal.outcome === 'Won') {
    statusBlock = `<div class="drawer-section"><div class="drawer-section-label">Settled</div><div class="drawer-section-text">${fmtDate(deal.closeDate)}</div></div>`;
  } else {
    const staleThreshold = getSettings().staleWarningDays;
    const staleColor = deal.daysStale > staleThreshold ? 'var(--red)' : deal.daysStale > staleThreshold / 2 ? 'var(--gold)' : 'var(--green)';
    statusBlock = `
      <div class="drawer-section">
        <div class="drawer-section-label">Next Action</div>
        <div class="drawer-section-text">${deal.nextAction}</div>
      </div>
      <div class="drawer-section">
        <div class="drawer-section-label">Days Stale</div>
        <span class="drawer-stale" style="background:${hexToRgba(staleColor.startsWith('var') ? getComputedColor(staleColor) : staleColor, 0.12)}; color:${staleColor.startsWith('var') ? getComputedColor(staleColor) : staleColor}">${deal.daysStale} day${deal.daysStale === 1 ? '' : 's'} since last activity</span>
      </div>
    `;
  }

  document.getElementById('drawer-body').innerHTML = `
    <div class="drawer-metric-row">
      <div class="drawer-metric"><div class="drawer-metric-label">Transaction Value</div><div class="drawer-metric-value tabular">${fmtFull(deal.transactionValue)}</div></div>
      <div class="drawer-metric"><div class="drawer-metric-label">Expected SDAHC Revenue</div><div class="drawer-metric-value tabular">${fmtFull(rev)}</div></div>
      <div class="drawer-metric"><div class="drawer-metric-label">Probability</div><div class="drawer-metric-value tabular">${fmtPct(deal.probability)}</div></div>
      <div class="drawer-metric"><div class="drawer-metric-label">Weighted Revenue</div><div class="drawer-metric-value tabular">${fmtFull(wtd)}</div></div>
    </div>

    <div class="drawer-section">
      <div class="drawer-section-label">Deal Type</div>
      <div class="drawer-chip-list">${deal.dealType.map(t => `<span class="drawer-chip">${t}</span>`).join('')}</div>
    </div>

    <div class="drawer-section">
      <div class="drawer-section-label">Source</div>
      <div class="drawer-section-text">${deal.source}</div>
    </div>

    <div class="drawer-section">
      <div class="drawer-section-label">Organisations</div>
      <div class="drawer-chip-list">${deal.organisations.map(o => `<span class="drawer-chip">${o}</span>`).join('')}</div>
    </div>

    <div class="drawer-section">
      <div class="drawer-section-label">Properties</div>
      <div class="drawer-chip-list">${deal.properties.map(p => `<span class="drawer-chip">${p}</span>`).join('')}</div>
    </div>

    ${statusBlock}

    <a class="notion-link" href="#" id="notion-link">
      Open in Notion
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M7 17L17 7M17 7H9M17 7v8"/></svg>
    </a>
  `;

  document.getElementById('notion-link').addEventListener('click', (e) => {
    e.preventDefault();
    showDrawerToast('Prototype — this would deep-link to the live Notion record.');
  });

  document.getElementById('drawer').classList.add('open');
  document.getElementById('drawer-overlay').classList.add('open');
}

function getComputedColor(varExpr) {
  const name = varExpr.replace('var(', '').replace(')', '').trim();
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function showDrawerToast(msg) {
  let toast = document.querySelector('.drawer-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'drawer-toast';
    document.getElementById('drawer').appendChild(toast);
  }
  toast.textContent = msg;
  requestAnimationFrame(() => toast.classList.add('show'));
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.remove('show'), 2400);
}

function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawer-overlay').classList.remove('open');
}

function initDrawer() {
  document.getElementById('drawer-close').addEventListener('click', closeDrawer);
  document.getElementById('drawer-overlay').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
}

/* ============================================================================
   ASSUMPTIONS REGISTER MODAL
   Every simulated/estimated/placeholder figure in the app, in one place.
   Opened from the "Prototype — Mock Data" badge, or from Settings.
   ============================================================================ */

const ASSUMPTION_CATEGORY_CLASS = {
  'Modelled': 'cat-modelled',
  'Definitional': 'cat-definitional',
  'Estimated constant': 'cat-estimated',
  'Dashboard-owned': 'cat-dashboard-owned',
  'Real (cross-page check)': 'cat-real',
};

function renderAssumptionsList() {
  document.getElementById('assumptions-body').innerHTML = ASSUMPTIONS.map(a => `
    <div class="assumption-item">
      <div class="assumption-top">
        <div class="assumption-label">${a.label}</div>
        <span class="assumption-category ${ASSUMPTION_CATEGORY_CLASS[a.category] || ''}">${a.category}</span>
      </div>
      <div class="assumption-used-in">Used in: ${a.usedIn}</div>
      <div class="assumption-why">${a.why}</div>
    </div>
  `).join('');
}

function openAssumptionsModal() {
  renderAssumptionsList();
  document.getElementById('assumptions-overlay').classList.add('open');
}
function closeAssumptionsModal() {
  document.getElementById('assumptions-overlay').classList.remove('open');
}
function initAssumptionsModal() {
  document.getElementById('assumptions-badge').addEventListener('click', openAssumptionsModal);
  document.getElementById('assumptions-close').addEventListener('click', closeAssumptionsModal);
  document.getElementById('assumptions-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'assumptions-overlay') closeAssumptionsModal();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAssumptionsModal(); });
}

/* ============================================================================
   SDA REPORT PAGE
   Treated as a commercial origination campaign. Inventory + adjustments are
   entirely dashboard-owned (no Notion source). The Commercial Funnel mixes
   simulated upper-funnel activity with real deal data for the bottom three
   stages — each row is tagged so the distinction is never ambiguous.
   ============================================================================ */

let sdaDistChartInstances = [];

const SDA_ADJUSTMENTS = [
  { key: 'additionalPrintRun', label: 'Additional Print Run', hint: 'Adds to Printed', accent: '#0476D9' },
  { key: 'damaged', label: 'Damaged', hint: 'Removes from Available', accent: '#D9534F' },
  { key: 'internalUse', label: 'Internal Use', hint: 'Removes from Available', accent: '#7A5CC7' },
  { key: 'returned', label: 'Returned', hint: 'Adds back to Available', accent: '#14A8A0' },
  { key: 'manualAdjustment', label: 'Manual Adjustment', hint: 'Signed correction to Available', accent: '#E0A82E', allowNegative: true },
];

function renderSdaReportPage() {
  const root = document.getElementById('view-sda-report');
  root.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">Print Inventory</h3>
          <div class="panel-sub">SDA Report 2026 campaign — <span class="scope-tag dashboard">Dashboard-owned</span> · not tracked in Notion</div>
        </div>
      </div>
      <div class="kpi-row" id="sda-inventory-row" style="padding:0 24px 22px; margin-top:14px;"></div>
    </div>

    <div class="panel section-gap">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">Inventory Adjustments</h3>
          <div class="panel-sub">Saved locally · updates Pending / Available immediately</div>
        </div>
      </div>
      <div class="adjustment-panel">
        <div class="adjustment-grid" id="adjustment-grid"></div>
        <div class="adjustment-log" id="adjustment-log"></div>
      </div>
    </div>

    <div class="panel section-gap">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">Distribution</h3>
          <div class="panel-sub">Of the 122 delivered reports · *simulated breakdown, see Assumptions</div>
        </div>
      </div>
      <div class="distribution-panel-body">
        <div class="distribution-grid">
          <div><div class="panel-sub" style="font-weight:600; color:var(--ink-soft);">By City</div><div class="distribution-chart" id="sda-city-chart"></div></div>
          <div><div class="panel-sub" style="font-weight:600; color:var(--ink-soft);">By Channel</div><div class="distribution-chart" id="sda-channel-chart"></div></div>
          <div><div class="panel-sub" style="font-weight:600; color:var(--ink-soft);">By Priority</div><div class="distribution-chart" id="sda-priority-chart"></div></div>
          <div><div class="panel-sub" style="font-weight:600; color:var(--ink-soft);">By Relationship Type</div><div class="distribution-chart" id="sda-rel-chart"></div></div>
        </div>
      </div>
    </div>

    <div class="panel section-gap">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">Commercial Funnel</h3>
          <div class="panel-sub">Reports Delivered → Settled Revenue · each stage tagged Real or Simulated</div>
        </div>
      </div>
      <div id="sda-funnel-body" style="padding:8px 24px 20px;"></div>
    </div>

    <div class="panel section-gap">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">Campaign ROI</h3>
          <div class="panel-sub">Pipeline Generated and Settled Revenue are shown separately — never combined</div>
        </div>
      </div>
      <div class="kpi-row" id="sda-roi-row" style="padding:0 24px 6px; margin-top:14px;"></div>
      <div id="sda-target-progress" style="padding:6px 24px 22px;"></div>
    </div>
  `;

  renderSdaInventorySummary();
  renderSdaAdjustmentPanel();
  renderSdaDistribution();
  renderSdaFunnel();
  renderSdaRoi();
}

function renderSdaInventorySummary() {
  const inv = Aggregates.sdaReportInventory();
  const cards = [
    { label: 'Printed', value: inv.printed },
    { label: 'Allocated', value: inv.allocated },
    { label: 'Delivered', value: inv.delivered },
    { label: 'Pending', value: inv.pending, foot: 'calculated' },
    { label: 'Available', value: inv.available, foot: 'calculated' },
  ];
  document.getElementById('sda-inventory-row').innerHTML = cards.map(c => `
    <div class="kpi-card">
      <div class="kpi-label">${c.label}</div>
      <div class="kpi-value tabular">${c.value}</div>
      <div class="kpi-foot">${c.foot || 'reports'}</div>
    </div>
  `).join('');
}

function renderSdaAdjustmentPanel() {
  const grid = document.getElementById('adjustment-grid');
  grid.innerHTML = SDA_ADJUSTMENTS.map(a => `
    <div class="adjustment-form">
      <div class="adjustment-form-label" style="color:${a.accent}">${a.label}</div>
      <div class="adjustment-form-hint">${a.hint}</div>
      <div class="adjustment-form-row">
        <input class="field-input" type="number" ${a.allowNegative ? '' : 'min="0"'} placeholder="Qty" id="qty-${a.key}">
        <button class="btn btn-primary btn-sm" data-key="${a.key}" data-label="${a.label}">Apply</button>
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('button[data-key]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      const input = document.getElementById(`qty-${key}`);
      const qty = parseInt(input.value, 10);
      if (!qty || isNaN(qty)) return;
      applySdaAdjustment(key, qty, btn.dataset.label);
      input.value = '';
    });
  });

  renderSdaAdjustmentLog();
}

function applySdaAdjustment(key, qty, label) {
  const current = getSettings().sdaReport;
  const nextVal = (current[key] || 0) + qty;
  const log = [{ type: label, qty, date: TODAY.toISOString().slice(0, 10) }, ...current.adjustmentLog].slice(0, 20);
  updateSettings({ sdaReport: { [key]: nextVal, adjustmentLog: log } });
  renderSdaInventorySummary();
  renderSdaAdjustmentLog();
}

function renderSdaAdjustmentLog() {
  const log = getSettings().sdaReport.adjustmentLog;
  const el = document.getElementById('adjustment-log');
  if (!log.length) { el.innerHTML = '<div class="adjustment-log-empty">No adjustments yet — try Additional Print Run above.</div>'; return; }
  el.innerHTML = log.map(l => `
    <div class="adjustment-log-row">
      <div class="adjustment-log-type">${l.type}</div>
      <div class="adjustment-log-note">Applied to SDA Report inventory</div>
      <div class="adjustment-log-qty" style="color:${l.qty >= 0 ? 'var(--green)' : 'var(--red)'}">${l.qty >= 0 ? '+' : ''}${l.qty}</div>
      <div class="adjustment-log-date">${fmtDate(l.date)}</div>
    </div>
  `).join('');
}

function renderDistBar(elId, rows, colors) {
  const el = document.getElementById(elId);
  const instance = echarts.init(el);
  instance.setOption({
    grid: { left: 8, right: 44, top: 8, bottom: 8, containLabel: true },
    tooltip: { trigger: 'item', backgroundColor: '#0A1E36', borderWidth: 0, textStyle: { color: '#fff', fontSize: 12 } },
    xAxis: { type: 'value', show: false },
    yAxis: {
      type: 'category', data: [...rows].reverse().map(r => r.label),
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: '#3B4657', fontSize: 11.5, fontWeight: 600, fontFamily: 'IBM Plex Sans' },
    },
    series: [{
      type: 'bar', barWidth: '55%',
      data: [...rows].reverse().map((r, i) => ({ value: r.value, itemStyle: { color: colors[(rows.length - 1 - i) % colors.length], borderRadius: [0, 4, 4, 0] } })),
      label: { show: true, position: 'right', formatter: '{c}', color: '#3B4657', fontSize: 11.5, fontFamily: 'IBM Plex Mono', fontWeight: 600 },
    }],
  });
  return instance;
}

function renderSdaDistribution() {
  sdaDistChartInstances = [
    renderDistBar('sda-city-chart', SDA_REPORT_DISTRIBUTION.byCity, ['#0476D9', '#14A8A0', '#7A5CC7', '#E0A82E', '#2FB37A', '#8592A6']),
    renderDistBar('sda-channel-chart', SDA_REPORT_DISTRIBUTION.byChannel, ['#0476D9', '#14A8A0']),
    renderDistBar('sda-priority-chart', SDA_REPORT_DISTRIBUTION.byPriority, ['#E0A82E', '#8592A6']),
    renderDistBar('sda-rel-chart', SDA_REPORT_DISTRIBUTION.byRelationshipType, ['#0476D9', '#14A8A0', '#7A5CC7', '#8592A6']),
  ];
}

function renderSdaFunnel() {
  const f = Aggregates.sdaReportFunnel();
  const head = `<div class="funnel-table-head"><div>Stage</div><div style="text-align:right">Value</div><div style="text-align:right">Converted</div><div style="text-align:right">Source</div></div>`;
  const rows = f.stages.map(s => {
    const valueStr = s.kind === 'currency' ? fmtFull(s.count) : String(s.count);
    return `
      <div class="funnel-row">
        <div class="funnel-row-label">${s.label}</div>
        <div class="funnel-row-count tabular">${valueStr}</div>
        <div class="funnel-row-conv tabular">${s.conversionFromPrevious === null ? '—' : fmtPct(s.conversionFromPrevious)}</div>
        <div style="text-align:right;"><span class="scope-tag ${s.isReal ? 'real' : 'dashboard'}">${s.isReal ? 'Real' : 'Simulated'}</span></div>
      </div>
    `;
  }).join('');
  document.getElementById('sda-funnel-body').innerHTML = head + rows;
}

function renderSdaRoi() {
  const roi = Aggregates.sdaReportRoi();
  const cards = [
    { label: 'Campaign Cost', value: fmtFull(roi.campaignCost), foot: 'dashboard-owned' },
    { label: 'Cost per Report Delivered', value: '$' + roi.costPerDelivered.toFixed(2), foot: 'real ÷ real' },
    { label: 'Cost per Meeting', value: '$' + roi.costPerMeeting.toFixed(2), foot: 'real ÷ simulated *' },
    { label: 'Cost per Opportunity', value: '$' + roi.costPerOpportunity.toFixed(2), foot: 'real ÷ simulated *' },
    { label: 'Pipeline Generated', value: fmtCompact(roi.pipelineGenerated), foot: 'real, from 3 SDA Report deals' },
    { label: 'Settled Revenue', value: fmtCompact(roi.settledRevenue), foot: 'real, from 3 SDA Report deals' },
    { label: 'Return Multiple', value: roi.returnMultiple === null ? '—' : roi.returnMultiple.toFixed(2) + 'x', foot: 'Settled Revenue ÷ Cost' },
  ];
  document.getElementById('sda-roi-row').innerHTML = cards.map(c => `
    <div class="kpi-card">
      <div class="kpi-label">${c.label}</div>
      <div class="kpi-value tabular">${c.value}</div>
      <div class="kpi-foot">${c.foot}</div>
    </div>
  `).join('');

  const targets = [
    { label: 'Meetings vs Target', value: roi.meeting, target: roi.targetMeetings },
    { label: 'Opportunities vs Target', value: roi.opportunity, target: roi.targetOpportunities },
    { label: 'Pipeline vs Target', value: roi.pipelineGenerated, target: roi.targetPipeline, isCurrency: true },
  ];
  document.getElementById('sda-target-progress').innerHTML = targets.map(t => {
    const pct = t.target ? Math.min(100, (t.value / t.target) * 100) : 0;
    return `
      <div class="target-progress-row">
        <div class="target-progress-label">${t.label}</div>
        <div class="target-progress-track"><div class="target-progress-fill" style="width:${pct}%"></div></div>
        <div class="target-progress-value">${t.isCurrency ? fmtCompact(t.value) : t.value} / ${t.isCurrency ? fmtCompact(t.target) : t.target}</div>
      </div>
    `;
  }).join('');
}

/* ============================================================================
   MARKET INTELLIGENCE PAGE
   Light — a place to grow. Gauges and category cards are illustrative;
   the deal-linked signals demonstrate the concept using real deal names.
   ============================================================================ */

let gaugeChartInstances = [];

function renderMarketIntelPage() {
  const root = document.getElementById('view-market-intel');
  root.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">Market Pulse</h3>
          <div class="panel-sub">Illustrative indicators · *no live market-data feed yet, see Assumptions</div>
        </div>
      </div>
      <div class="chart-body" style="padding:14px 20px 22px;"><div class="gauge-grid" id="gauge-grid"></div></div>
    </div>

    <div class="panel section-gap">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">Intelligence Categories</h3>
          <div class="panel-sub">Click a category to preview what it will hold</div>
        </div>
      </div>
      <div class="chart-body" style="padding:8px 20px 22px;"><div class="category-grid" id="market-category-grid"></div></div>
    </div>

    <div class="panel section-gap">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">Intelligence Impacting Active Deals</h3>
          <div class="panel-sub">Illustrative only — shows how intelligence will feed commercial decisions</div>
        </div>
      </div>
      <div style="padding:8px 24px 22px;"><div class="signal-list" id="signal-list"></div></div>
    </div>
  `;

  renderGauges();
  renderMarketCategories();
  renderSignals();
}

function renderGauges() {
  const grid = document.getElementById('gauge-grid');
  grid.innerHTML = MARKET_PULSE.map(g => `
    <div class="gauge-card">
      <div class="gauge-canvas" id="gauge-${g.key}"></div>
      <div class="gauge-card-label">${g.label}</div>
      <div class="gauge-card-summary">${g.summary}</div>
    </div>
  `).join('');

  gaugeChartInstances = MARKET_PULSE.map(g => {
    const el = document.getElementById(`gauge-${g.key}`);
    const instance = echarts.init(el);
    const color = g.sentiment === 'positive' ? '#2FB37A' : g.sentiment === 'neutral' ? '#E0A82E' : '#D9534F';
    instance.setOption({
      series: [{
        type: 'gauge', startAngle: 200, endAngle: -20, min: 0, max: 100,
        radius: '92%', center: ['50%', '68%'],
        axisLine: { lineStyle: { width: 8, color: [[1, '#EDF0F6']] } },
        pointer: { show: false },
        progress: { show: true, width: 8, itemStyle: { color } },
        splitLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false },
        detail: { formatter: '{value}', fontSize: 22, fontFamily: 'IBM Plex Mono', fontWeight: 600, color: '#101828', offsetCenter: [0, '-6%'] },
        data: [{ value: g.value }],
      }],
    });
    return instance;
  });
}

function renderMarketCategories() {
  const grid = document.getElementById('market-category-grid');
  grid.innerHTML = MARKET_INTEL_CATEGORIES.map(c => `
    <div class="category-card" data-key="${c.key}">
      <div class="category-card-head">
        <div class="category-card-label">${c.label}</div>
        <svg class="category-card-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
      </div>
      <div class="category-card-summary">${c.summary}</div>
    </div>
  `).join('');
  grid.querySelectorAll('.category-card').forEach(card => card.addEventListener('click', () => card.classList.toggle('expanded')));
}

function renderSignals() {
  document.getElementById('signal-list').innerHTML = MARKET_INTEL_SIGNALS.map(s => {
    const deal = DEALS.find(d => d.name === s.dealName);
    const stageLabel = deal ? getStage(deal.stage).short : '';
    return `
      <div class="signal-card">
        <div class="signal-deal-chip">${s.dealName}${deal ? ' · ' + stageLabel : ''}</div>
        <div class="signal-text">${s.signal}</div>
        <div class="signal-implication">${s.implication}</div>
      </div>
    `;
  }).join('');
}

/* ============================================================================
   SDAHC PLAYBOOK PAGE
   Reference content — not derived from data.js, so not part of the
   Assumptions Register (it's documentation, not a figure).
   ============================================================================ */

const ENGINE_COLORS = { 'deals-capital-markets': '#0476D9', 'transaction-advisory': '#7A5CC7', 'special-situations': '#E0A82E', 'operating-platform': '#14A8A0' };

function renderPlaybookPage() {
  const root = document.getElementById('view-playbook');
  root.innerHTML = `
    <div class="panel"><div class="playbook-intro">${PLAYBOOK_WHAT_WE_ARE}</div></div>

    <div class="panel section-gap">
      <div class="panel-head"><div><h3 class="panel-title">Four Engines</h3><div class="panel-sub">Click a card for a short explanation</div></div></div>
      <div class="chart-body" style="padding:8px 20px 22px;"><div class="engine-grid" id="engine-grid"></div></div>
    </div>

    <div class="panel section-gap">
      <div class="panel-head"><div><h3 class="panel-title">How Value Moves</h3><div class="panel-sub">The loop every deal travels, feeding back into new intelligence</div></div></div>
      <div class="value-loop" id="value-loop"></div>
    </div>

    <div class="panel section-gap">
      <div class="panel-head"><div><h3 class="panel-title">Who Does What</h3></div></div>
      <div class="chart-body" style="padding:8px 20px 22px;"><div class="team-grid" id="team-grid"></div></div>
    </div>

    <div class="panel section-gap">
      <div class="panel-head"><div><h3 class="panel-title">Explore the Manual</h3><div class="panel-sub">Click a category for a short summary</div></div></div>
      <div class="chart-body" style="padding:8px 20px 22px;"><div class="category-grid" id="manual-category-grid"></div></div>
    </div>
  `;

  renderEngines();
  renderValueLoop();
  renderTeam();
  renderManualCategories();
}

function renderEngines() {
  const grid = document.getElementById('engine-grid');
  grid.innerHTML = PLAYBOOK_ENGINES.map(e => `
    <div class="engine-card" data-key="${e.key}">
      <div class="engine-top">
        <div class="engine-code" style="background:${ENGINE_COLORS[e.key]}">${e.code}</div>
        <span class="engine-status ${e.status.toLowerCase()}">${e.status}</span>
      </div>
      <div class="engine-label">${e.label}</div>
      <div class="engine-summary">${e.summary}</div>
    </div>
  `).join('');
  grid.querySelectorAll('.engine-card').forEach(card => card.addEventListener('click', () => card.classList.toggle('expanded')));
}

function renderValueLoop() {
  const el = document.getElementById('value-loop');
  el.innerHTML = VALUE_LOOP.map((node, i) =>
    `<span class="value-loop-node">${node}</span>${i < VALUE_LOOP.length - 1 ? '<span class="value-loop-arrow">→</span>' : ''}`
  ).join('') + `<div class="value-loop-back">↺ feeds back into Relationship / Intelligence</div>`;
}

function renderTeam() {
  document.getElementById('team-grid').innerHTML = TEAM.map(p => `
    <div class="team-card">
      <div class="team-avatar">${p.name[0]}</div>
      <div class="team-name">${p.name}</div>
      <div class="team-role">${p.role}</div>
    </div>
  `).join('');
}

function renderManualCategories() {
  const grid = document.getElementById('manual-category-grid');
  grid.innerHTML = PLAYBOOK_MANUAL_CATEGORIES.map(c => `
    <div class="category-card" data-key="${c.key}">
      <div class="category-card-head">
        <div class="category-card-label">${c.label}</div>
        <svg class="category-card-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
      </div>
      <div class="category-card-summary">${c.summary}</div>
    </div>
  `).join('');
  grid.querySelectorAll('.category-card').forEach(card => card.addEventListener('click', () => card.classList.toggle('expanded')));
}

/* ============================================================================
   SETTINGS PAGE
   Demonstrates dashboard-owned data end-to-end. Saving persists to
   localStorage via updateSettings() and reloads, so every other page picks
   up the new values from a guaranteed-consistent fresh render.
   ============================================================================ */

let probTableEdits = null;

function renderSettingsPage() {
  const root = document.getElementById('view-settings');
  const s = getSettings();
  root.innerHTML = `
    <div class="panel settings-section">
      <div class="settings-section-head"><div class="settings-section-title">Business</div><span class="scope-tag dashboard">Dashboard-owned</span></div>
      <div class="settings-field-grid">
        <div class="field-block">
          <label class="field-label">Annual Revenue Target</label>
          <input class="field-input" type="number" id="set-annualTarget" value="${s.annualTarget}">
          <div class="field-hint">Drives Overview's hero target bar and Revenue's KPIs.</div>
        </div>
        <div class="field-block">
          <label class="field-label">Monthly Revenue Target</label>
          <input class="field-input" type="number" id="set-monthlyTarget" value="${s.monthlyTarget}">
          <div class="field-hint">Feeds the Target line on Revenue → Revenue Over Time.</div>
        </div>
        <div class="field-block">
          <label class="field-label">Financial Year Start</label>
          <select class="field-select" id="set-fyStartMonth">
            <option value="0" ${s.fyStartMonth === 0 ? 'selected' : ''}>January (calendar year)</option>
            <option value="3" ${s.fyStartMonth === 3 ? 'selected' : ''}>April</option>
            <option value="6" ${s.fyStartMonth === 6 ? 'selected' : ''}>July</option>
            <option value="9" ${s.fyStartMonth === 9 ? 'selected' : ''}>October</option>
          </select>
          <div class="field-hint">Changes the window every "YTD" figure uses across the app.</div>
        </div>
      </div>
    </div>

    <div class="panel settings-section section-gap">
      <div class="settings-section-head"><div class="settings-section-title">Pipeline</div><span class="scope-tag dashboard">Dashboard-owned</span></div>
      <div class="settings-field-grid" style="grid-template-columns:1fr 1fr;">
        <div class="field-block">
          <label class="field-label">High-Value Deal Threshold</label>
          <input class="field-input" type="number" id="set-highValueDealThreshold" value="${s.highValueDealThreshold}">
          <div class="field-hint">Tags rows on the Pipeline table at or above this Transaction Value.</div>
        </div>
        <div class="field-block">
          <label class="field-label">Stale Warning Threshold (days)</label>
          <input class="field-input" type="number" id="set-staleWarningDays" value="${s.staleWarningDays}">
          <div class="field-hint">Drives the Days Stale colour in the Deal Drawer — live, no reload needed.</div>
        </div>
      </div>
      <div class="settings-section-head" style="padding-top:0;"><div class="settings-section-title" style="font-size:13.5px;">Default Stage Probabilities</div></div>
      <div class="prob-table-wrap">
        <div class="prob-table-head"><div>Stage</div><div style="text-align:right">Probability %</div><div style="text-align:right">Weighted Δ (this stage)</div></div>
        <div id="prob-table-rows"></div>
      </div>
      <div class="settings-preview" id="prob-preview"></div>
    </div>

    <div class="panel settings-section section-gap">
      <div class="settings-section-head"><div class="settings-section-title">SDA Report</div><span class="scope-tag dashboard">Dashboard-owned</span></div>
      <div class="settings-field-grid">
        <div class="field-block"><label class="field-label">Initial Print Run</label><input class="field-input" type="number" id="set-initialPrintRun" value="${s.sdaReport.initialPrintRun}"></div>
        <div class="field-block"><label class="field-label">Campaign Cost</label><input class="field-input" type="number" id="set-campaignCost" value="${s.sdaReport.campaignCost}"></div>
        <div class="field-block"><label class="field-label">Target Meetings</label><input class="field-input" type="number" id="set-targetMeetings" value="${s.sdaReport.targetMeetings}"></div>
        <div class="field-block"><label class="field-label">Target Opportunities</label><input class="field-input" type="number" id="set-targetOpportunities" value="${s.sdaReport.targetOpportunities}"></div>
        <div class="field-block"><label class="field-label">Target Pipeline</label><input class="field-input" type="number" id="set-targetPipeline" value="${s.sdaReport.targetPipeline}"></div>
      </div>
    </div>

    <div class="panel section-gap">
      <div class="settings-actions">
        <button class="btn btn-primary" id="settings-save">Save Changes</button>
        <button class="btn btn-secondary" id="settings-reset">Reset to Defaults</button>
        <button class="btn btn-secondary" id="settings-view-assumptions">View Assumptions Register</button>
      </div>
    </div>

    <div class="settings-toast" id="settings-toast"></div>
  `;

  renderProbTable();
  document.getElementById('settings-save').addEventListener('click', saveSettingsForm);
  document.getElementById('settings-reset').addEventListener('click', () => {
    resetSettings();
    showSettingsToast('Reset to defaults — reloading…');
    setTimeout(() => location.reload(), 700);
  });
  document.getElementById('settings-view-assumptions').addEventListener('click', openAssumptionsModal);
}

function renderProbTable() {
  const s = getSettings();
  probTableEdits = { ...s.stageProbabilities };
  const rows = document.getElementById('prob-table-rows');
  rows.innerHTML = STAGES.map(stage => `
    <div class="prob-table-row" data-stage="${stage.id}">
      <div class="prob-table-stage">${stage.short}</div>
      <input class="field-input prob-table-input" type="number" step="1" min="0" max="100" data-stage="${stage.id}" value="${Math.round(probTableEdits[stage.id] * 100)}">
      <div class="prob-table-delta tabular" style="text-align:right; font-size:11.5px; color:var(--ink-faint);" data-delta="${stage.id}">—</div>
    </div>
  `).join('');

  rows.querySelectorAll('input[data-stage]').forEach(input => {
    input.addEventListener('input', () => {
      const stageId = input.dataset.stage;
      const val = Math.max(0, Math.min(100, parseFloat(input.value) || 0)) / 100;
      probTableEdits[stageId] = val;
      updateProbPreview();
    });
  });

  updateProbPreview();
}

/* Two seeded deals (LVP Logan, Skychest) deliberately carry a probability
   that differs from their stage's factory default (STAGES[i].defaultProbability
   — not the editable settings copy). Editing a stage's default in Settings
   should shift every OTHER deal at that stage, but must not silently override
   those two explicit per-deal judgement calls. This keeps the preview's
   baseline (no edits yet) exactly equal to the real weighted pipeline. */
function previewProbabilityFor(deal) {
  const stageDefault = getStage(deal.stage).defaultProbability;
  const isAtFactoryDefault = Math.abs(deal.probability - stageDefault) < 1e-9;
  return isAtFactoryDefault ? probTableEdits[deal.stage] : deal.probability;
}

function updateProbPreview() {
  const currentWeighted = Aggregates.weightedPipelineRevenue();
  const previewWeighted = Aggregates.active().reduce((sum, d) => sum + sdahcRevenue(d) * previewProbabilityFor(d), 0);
  const delta = previewWeighted - currentWeighted;

  document.getElementById('prob-preview').innerHTML = `
    <div class="settings-preview-label">Weighted Pipeline — Live Preview</div>
    <div class="settings-preview-value tabular">${fmtFull(previewWeighted)}</div>
    <div class="settings-preview-delta ${delta >= 0 ? 'pos' : 'neg'} tabular">${delta >= 0 ? '+' : ''}${fmtCompact(delta)} vs current ${fmtCompact(currentWeighted)}</div>
    <div class="settings-preview-hint">Preview only — saving persists these defaults for future reference but does not retroactively reweight the 25 seeded deals elsewhere in this prototype. See the Assumptions Register.</div>
  `;

  STAGES.forEach(stage => {
    const el = document.querySelector(`[data-delta="${stage.id}"]`);
    if (!el) return;
    const stageDeals = DEALS.filter(d => d.stage === stage.id && d.outcome === 'In Progress');
    const before = stageDeals.reduce((sum, d) => sum + sdahcRevenue(d) * d.probability, 0);
    const after = stageDeals.reduce((sum, d) => sum + sdahcRevenue(d) * previewProbabilityFor(d), 0);
    const rowDelta = after - before;
    el.textContent = rowDelta === 0 ? '—' : (rowDelta > 0 ? '+' : '') + fmtCompact(rowDelta);
    el.style.color = rowDelta > 0 ? 'var(--green)' : rowDelta < 0 ? 'var(--red)' : 'var(--ink-faint)';
  });
}

function saveSettingsForm() {
  const patch = {
    annualTarget: parseFloat(document.getElementById('set-annualTarget').value) || 0,
    monthlyTarget: parseFloat(document.getElementById('set-monthlyTarget').value) || 0,
    fyStartMonth: parseInt(document.getElementById('set-fyStartMonth').value, 10),
    highValueDealThreshold: parseFloat(document.getElementById('set-highValueDealThreshold').value) || 0,
    staleWarningDays: parseInt(document.getElementById('set-staleWarningDays').value, 10) || 1,
    stageProbabilities: { ...probTableEdits },
    sdaReport: {
      initialPrintRun: parseInt(document.getElementById('set-initialPrintRun').value, 10) || 0,
      campaignCost: parseFloat(document.getElementById('set-campaignCost').value) || 0,
      targetMeetings: parseInt(document.getElementById('set-targetMeetings').value, 10) || 0,
      targetOpportunities: parseInt(document.getElementById('set-targetOpportunities').value, 10) || 0,
      targetPipeline: parseFloat(document.getElementById('set-targetPipeline').value) || 0,
    },
  };
  updateSettings(patch);
  showSettingsToast('Saved — reloading dashboard…');
  setTimeout(() => location.reload(), 700);
}

function showSettingsToast(msg) {
  const toast = document.getElementById('settings-toast');
  toast.textContent = msg;
  toast.classList.add('show');
}

/* ============================================================================
   INIT
   ============================================================================ */

window.addEventListener('DOMContentLoaded', () => {
  initSettings();
  initNav();
  initSyncStatus();
  initDrawer();
  initAssumptionsModal();
  renderOverview();
  renderPipelinePage();

  window.addEventListener('resize', () => {
    [pipelineChartInstance, waterfallChartInstance, revenueTimeChartInstance, revenueSourceChartInstance, funnelChartInstance, prospectsChartInstance, ...sdaDistChartInstances, ...gaugeChartInstances]
      .forEach(c => c && c.resize());
  });
});
