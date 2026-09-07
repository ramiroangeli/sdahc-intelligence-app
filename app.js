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

/* Same formatting as fmtDate, for callers that already hold a Date object
   (e.g. quarterBounds()) rather than a 'YYYY-MM-DD' string. */
function fmtDateObj(dt) {
  if (!dt) return '—';
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

/* --------------------------- INFO ICON / POPOVER --------------------------- */
/* A small "i" affordance next to every KPI card and major chart, across all
   9 pages. Click shows a short plain-language explanation of how that
   number is calculated; where the metric is a simulated/modelled figure,
   the popover links straight to its Assumptions Register entry (item 2's
   grouped-by-page modal, opened via openAssumptionsModal(id)). */

const INFO_TEXT = {
  // Overview
  'ov-settled': { text: 'Sum of SDAHC Revenue (commission + advisory/tranche fees + conjunction + referral — never Transaction Value) for deals Won with a close date inside the current fiscal year.', assumptionId: 'fiscal-year-scope' },
  'ov-open-pipeline': { text: 'Full-value SDAHC Revenue of every deal currently In Progress — not probability-adjusted. Paused deals are excluded; they carry zero value here.', assumptionId: 'paused-exclusion' },
  'ov-weighted': { text: 'Σ (SDAHC Revenue × Probability) across every In Progress deal. Probability is each deal\'s own Notion value, never a stage default.' },
  'ov-active': { text: 'Count of deals with outcome = In Progress. Paused deals are counted separately and excluded here.', assumptionId: 'paused-exclusion' },
  'ov-new-prospects': { text: 'Deals with a createdDate inside the current calendar month, regardless of outcome or stage.' },
  'ov-win-rate': { text: 'Won ÷ (Won + Lost), among deals that have actually been decided. Still-open deals aren\'t counted either way.' },
  'ov-hero': { text: 'Settled (Won, cash) + Contracted (Contract Issued / Under Contract) + Weighted Pipeline (probability-adjusted) stacked against the Annual Target. Gap to Target = Target − that total; the marker shows how far through the year you are.' },
  'ov-waterfall': { text: 'A bridge from Opening to Closing weighted pipeline: + New Opportunities (created this period) + Value Added (simulated re-rating) − Lost − Settled = Closing. Opening is back-solved so the bridge always balances exactly.', assumptionId: 'value-added-rate' },
  'ov-pipeline-chart': { text: 'Every deal grouped by its current stage, regardless of outcome — Won and Lost deals stay visible at the stage they froze at. Paused deals are intentionally included here for that structural picture (see the linked note).', assumptionId: 'paused-exclusion' },

  // Pipeline
  'pipeline-flow': { text: 'Same per-stage grouping as Overview\'s Pipeline by Stage — Won/Lost/Paused deals stay visible at their frozen stage. Toggle changes what each stage card reports.' },
  'pipeline-score': { text: 'The table\'s order is fixed to Score, descending, and isn\'t user-sortable — Score is meant to mirror Notion\'s own Score-sorted view exactly.', assumptionId: 'pipeline-score-mock' },

  // Revenue
  'rev-settled': { text: 'Same figure as Overview\'s hero: Won deals with a close date in the current fiscal year, summed by SDAHC Revenue.', assumptionId: 'fiscal-year-scope' },
  'rev-contracted': { text: 'SDAHC Revenue of In Progress deals already at Contract Issued (B7) or Under Contract (B8) — high-confidence, committed, but not yet cash.' },
  'rev-weighted-forecast': { text: 'Σ (SDAHC Revenue × Probability) across every In Progress deal — identical definition and number as Overview\'s Weighted Pipeline.' },
  'rev-open-pipeline': { text: 'Full, non-probability-adjusted SDAHC Revenue of every In Progress deal.' },
  'rev-target': { text: 'The Annual Revenue Target set in Settings → Business, for the current fiscal year.' },
  'rev-gap': { text: 'Target − (Settled + Contracted + Weighted Open). Shown as "on track" once Settled + Contracted + Weighted already covers the target.' },
  'rev-time-chart': { text: 'Actual bars read real closeDate history. Forecast bars bucket each open deal into a month using an estimated close date derived from its probability — directional only, Notion doesn\'t track an expected close date.', assumptionId: 'estimated-close-date' },
  'rev-source-chart': { text: 'SDAHC Revenue split by fee type (brokerage commission, advisory, conjunction, referral) across Won + In Progress deals. Lost and Paused are excluded — Paused carries zero value.', assumptionId: 'paused-exclusion' },
  'rev-concentration': { text: 'Share of total Won + In Progress revenue sitting in the top 3 deals by SDAHC Revenue — a concentration-risk read, same scope as Revenue Composition.', assumptionId: 'revenue-scope' },
  'rev-by-stage': { text: 'SDAHC Revenue currently held at each stage, across every outcome — the same per-stage data as byStage(), filtered to stages with at least one deal.' },

  // Delivery
  'del-locked': { text: 'Sum of tranche/milestone amounts across all engagements whose status is "Not started" or "WIP" — not yet committed, still part of open pipeline only.', assumptionId: 'delivery-tranche-fields' },
  'del-unlockable': { text: 'Of that Locked total, the portion whose due date falls within the current calendar quarter — i.e. what should convert to Invoiced/Paid soon if on schedule.' },
  'del-at-risk': { text: 'Locked amounts specifically on engagements flagged health = "At risk" or "Slipped" — a subset of Locked Revenue, not an addition to it.' },
  'del-active-engagements': { text: 'Count of deals carrying either billing milestones (brokerage) or explicit consultancy tranches (advisory) — the roster shown in the Engagements grid below.' },
  'del-next-milestone': { text: 'The soonest tranche/milestone across all engagements that isn\'t yet Paid, by due date.' },
  'del-timeline': { text: 'Every tranche/milestone from every engagement, plotted by due date and coloured by status. Dot size scales with the dollar amount.' },

  // Sales Funnel
  'funnel-chart': { text: 'Market/Relationships is an editorial estimate (not tracked in Notion); every tier below it is a real deal count at or past a stage-index threshold, collapsing the 16 real stages into 9 milestones.', assumptionId: 'funnel-tier-mapping' },
  'funnel-table': { text: 'Conversion = this tier\'s count ÷ the previous tier\'s count. Dropped = 1 − conversion.' },
  'prospects-chart': { text: 'New Prospects = deals created that month, by createdDate. Lost = deals whose closeDate (in that month) has outcome Lost. Trailing 14 months.' },
  'source-groups': { text: 'Every prospect source rolled into two channels (Relationship-led vs Marketing-sourced, per PROSPECT_SOURCES). Qualified = reached stage A1/B1 or later.', assumptionId: 'qualified-definition' },
  'source-detail': { text: 'Same "qualified" definition as the channel comparison, broken out per individual source.' },
  'cohort-table': { text: 'Deals grouped by the quarter they were CREATED (not decided). Conversion = Won ÷ (Won + Lost) within that cohort; still-open cohorts show "Too early."', assumptionId: 'cohort-conversion' },

  // SDA Report
  'sda-inventory': { text: 'Printed/Allocated/Delivered are dashboard-owned counters (not in Notion). Pending and Available are always calculated from them live, never stored, so they can\'t drift.', assumptionId: 'sda-report-inventory' },
  'sda-distribution': { text: 'A simulated breakdown of the 122 delivered reports by city/channel/priority/relationship type — individual recipients aren\'t tracked as Notion records.', assumptionId: 'sda-report-distribution' },
  'sda-funnel': { text: 'Reports Delivered, Deal, Pipeline Generated and Settled Revenue are real (read from the 3 deals tagged source = "SDA Report"). Followed Up/Response/Meeting/Opportunity are simulated conversion-rate estimates.', assumptionId: 'sda-report-funnel-upper' },
  'sda-roi': { text: 'Cost ratios divide the real Campaign Cost by a mix of real (Delivered, Deal, Settled Revenue) and simulated (Meeting, Opportunity) counts — Pipeline Generated and Settled Revenue are always shown separately, never combined.', assumptionId: 'sda-report-funnel-upper' },

  // Market Intelligence
  'mi-gauges': { text: 'Illustrative placeholders — no live market-data feed exists yet. Shown to demonstrate how one would be visualised once connected.', assumptionId: 'market-pulse-gauges' },
  'mi-signals': { text: 'Deal names are real; the signal text and implications are illustrative, demonstrating how market intelligence would inform live deals — not a real signal-detection system.', assumptionId: 'market-intel-deal-signals' },
};

function infoIcon(key) {
  return `<button class="info-icon" type="button" data-info-key="${key}" aria-label="How this is calculated">i</button>`;
}

let activeInfoIcon = null;

function closeInfoPopover() {
  document.getElementById('info-popover').classList.remove('open');
  if (activeInfoIcon) activeInfoIcon.classList.remove('active');
  activeInfoIcon = null;
}

function openInfoPopover(iconEl) {
  const entry = INFO_TEXT[iconEl.dataset.infoKey];
  if (!entry) return;
  if (activeInfoIcon === iconEl) { closeInfoPopover(); return; }
  closeInfoPopover();

  const popover = document.getElementById('info-popover');
  document.getElementById('info-popover-text').textContent = entry.text;
  const link = document.getElementById('info-popover-link');
  if (entry.assumptionId) {
    link.hidden = false;
    link.onclick = (e) => { e.preventDefault(); closeInfoPopover(); openAssumptionsModal(entry.assumptionId); };
  } else {
    link.hidden = true;
    link.onclick = null;
  }

  popover.classList.add('open');
  iconEl.classList.add('active');
  activeInfoIcon = iconEl;

  // Position after showing (so offsetWidth/Height are correct), clamped to viewport.
  const r = iconEl.getBoundingClientRect();
  const pw = popover.offsetWidth, ph = popover.offsetHeight;
  let left = r.left + r.width / 2 - pw / 2;
  left = Math.max(12, Math.min(left, window.innerWidth - pw - 12));
  let top = r.bottom + 8;
  if (top + ph > window.innerHeight - 12) top = r.top - ph - 8;
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}

/* Shared renderer for every .kpi-row block across the app (Overview, Revenue,
   Delivery, SDA Report) — one place to keep the card markup and its optional
   info icon consistent. `cards`: [{label, value, foot, footClass, infoKey}]. */
function renderKpiCards(containerId, cards) {
  document.getElementById(containerId).innerHTML = cards.map(c => `
    <div class="kpi-card">
      <div class="kpi-label">${c.label}${c.infoKey ? infoIcon(c.infoKey) : ''}</div>
      <div class="kpi-value tabular">${c.value}</div>
      <div class="kpi-foot ${c.footClass || ''}">${c.foot}</div>
    </div>
  `).join('');
}

function initInfoIcons() {
  document.addEventListener('click', (e) => {
    const icon = e.target.closest('.info-icon');
    if (icon) { e.stopPropagation(); openInfoPopover(icon); return; }
    if (!e.target.closest('#info-popover')) closeInfoPopover();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeInfoPopover(); });
  window.addEventListener('scroll', closeInfoPopover, true);
  window.addEventListener('resize', closeInfoPopover);
}

/* --------------------------------- NAV ------------------------------------ */

const PAGE_META = {
  overview:      { eyebrow: 'Commercial Intelligence', title: 'Executive Overview' },
  pipeline:      { eyebrow: 'Deals Database',           title: 'Pipeline' },
  revenue:       { eyebrow: 'Commercial Intelligence', title: 'Revenue' },
  delivery:      { eyebrow: 'Commercial Intelligence', title: 'Delivery' },
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
  revenue: renderRevenuePage, delivery: renderDeliveryPage, funnel: renderFunnelPage,
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
            <h3 class="panel-title">Commercial Flow${infoIcon('ov-waterfall')}</h3>
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
            <h3 class="panel-title">Pipeline by Stage${infoIcon('ov-pipeline-chart')}</h3>
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
        <div class="hero-metric-label">Settled Revenue · YTD${infoIcon('ov-hero').replace('info-icon', 'info-icon info-icon-on-dark')}</div>
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
    { label: 'Settled Revenue YTD', value: fmtCompact(settled), foot: `of ${fmtCompact(settings.annualTarget)} target`, infoKey: 'ov-settled' },
    { label: 'Expected Open Pipeline', value: fmtCompact(expectedOpen), foot: `${Aggregates.active().length} active deals, full value`, infoKey: 'ov-open-pipeline' },
    { label: 'Weighted Pipeline', value: fmtCompact(weighted), foot: 'probability-adjusted', infoKey: 'ov-weighted' },
    { label: 'Active Deals', value: String(active), foot: `${Aggregates.won().length} won · ${Aggregates.lost().length} lost`, infoKey: 'ov-active' },
    { label: 'New Prospects', value: String(newProspects), foot: 'this calendar month', infoKey: 'ov-new-prospects' },
    { label: 'Win Rate', value: fmtPct(winRate, 0), foot: `${Aggregates.won().length} won of ${Aggregates.won().length + Aggregates.lost().length} decided`, infoKey: 'ov-win-rate' },
  ];

  renderKpiCards('kpi-row', cards);
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

function renderPipelinePage() {
  const root = document.getElementById('view-pipeline');
  root.innerHTML = `
    <div class="pipeline-toolbar">
      <div>
        <div class="panel-sub" style="font-size:13px;">Every stage of the Notion Deals database, coloured by phase. Metric toggle changes what each stage reports.${infoIcon('pipeline-flow')}</div>
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
          <div class="panel-sub">${DEALS.length} deals · fixed order by Score, descending · click a row to open the deal detail${infoIcon('pipeline-score')}</div>
        </div>
      </div>
      <div class="table-wrap">
        <table class="deals-table" id="deals-table">
          <thead>
            <tr>
              <th>Deal</th>
              <th class="num-head sorted">Score</th>
              <th>Stage</th>
              <th>Owner</th>
              <th>Deal Type</th>
              <th class="num-head">Transaction Value</th>
              <th class="num-head">Expected SDAHC Revenue</th>
              <th class="num-head">Probability</th>
              <th class="num-head">Weighted Revenue</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody id="deals-tbody"></tbody>
        </table>
      </div>
    </div>
  `;

  wirePipelineMetricControl();
  renderPipelineFlow();
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

/* Fixed order: Score, descending — see ASSUMPTIONS 'pipeline-score-mock'.
   Not user-sortable: Score represents a Notion formula result, so the
   Pipeline table's row order is meant to always match Notion's own
   Score-sorted view, the way a real synced dashboard would show it. Users
   may still filter/search (if added later) without disturbing this order. */
function sortedDeals() {
  return [...DEALS].sort((a, b) => b.score - a.score);
}

function outcomeClass(outcome) {
  return { Won: 'won', Lost: 'lost', 'In Progress': 'in-progress', Paused: 'paused' }[outcome];
}

function renderDealsTable() {
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
        <td class="num-cell tabular score-cell">${d.score}</td>
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
            <h3 class="panel-title">Revenue Over Time${infoIcon('rev-time-chart')}</h3>
            <div class="panel-sub">Actual settled vs. target vs. forecast · ${TODAY.getFullYear()} · *Forecast month is simulated</div>
          </div>
        </div>
        <div class="chart-body"><div class="chart-canvas tall" id="revenue-time-chart"></div></div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div>
            <h3 class="panel-title">Revenue Composition${infoIcon('rev-source-chart')}</h3>
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
            <h3 class="panel-title">Revenue Concentration${infoIcon('rev-concentration')}</h3>
            <div class="panel-sub">Concentration risk across Won + active deals</div>
          </div>
        </div>
        <div id="concentration-body" style="padding:6px 24px 24px;"></div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div>
            <h3 class="panel-title">Revenue by Stage${infoIcon('rev-by-stage')}</h3>
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
    { label: 'Settled Revenue', value: fmtCompact(t.settled), foot: 'YTD, realised', infoKey: 'rev-settled' },
    { label: 'Contracted Revenue', value: fmtCompact(t.contracted), foot: 'Contract Issued + Under Contract', infoKey: 'rev-contracted' },
    { label: 'Weighted Forecast', value: fmtCompact(t.weighted), foot: 'active pipeline, probability-adjusted', infoKey: 'rev-weighted-forecast' },
    { label: 'Open Revenue Pipeline', value: fmtCompact(openPipeline), foot: 'active pipeline, full value', infoKey: 'rev-open-pipeline' },
    { label: 'Revenue Target', value: fmtCompact(t.target), foot: `FY${TODAY.getFullYear()}`, infoKey: 'rev-target' },
    { label: 'Gap to Target', value: fmtCompact(t.gap), foot: t.onTrack ? 'on track — potential covers target' : `${fmtPct(t.totalPotential / t.target)} of target covered`, footClass: t.onTrack ? 'pos' : 'neg', infoKey: 'rev-gap' },
  ];
  renderKpiCards('revenue-kpi-row', cards);
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
   DELIVERY PAGE
   Commercial delivery layer, NOT a task manager — deliverables/milestones are
   a rollup of work already modelled on the deals themselves (see data.js
   'DELIVERY' section). Answers: how much revenue is locked behind unfinished
   work, what unlocks next, and what downstream brokerage is gated on current
   advisory work. Granular subtasks/time tracking stay in Notion.
   ============================================================================ */

let deliveryTimelineChartInstance = null;

const HEALTH_COLOR = { 'On track': 'var(--green)', 'At risk': 'var(--gold)', 'Slipped': 'var(--red)' };
/* Colours mirror the same Settled=green / Contracted=blue language used on
   the Overview hero bar — Paid IS settled cash, Invoiced IS the contracted,
   not-yet-cash state. WIP/Not started are both still just pipeline. */
const MILESTONE_STATUS_COLOR = { 'Not started': '#8592A6', WIP: '#E0A82E', Invoiced: '#0476D9', Paid: '#2FB37A' };

function renderDeliveryPage() {
  const root = document.getElementById('view-delivery');
  root.innerHTML = `
    <div class="delivery-subtitle">Engagements, milestones &amp; revenue unlock</div>

    <div class="kpi-row" id="delivery-kpi-row"></div>

    <div class="panel section-gap">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">Engagements</h3>
          <div class="panel-sub">Derived from the Advisory/DD and Brokerage deals already in the pipeline · click a card for full delivery detail</div>
        </div>
      </div>
      <div class="chart-body" style="padding:8px 20px 22px;"><div class="engagement-grid" id="engagement-grid"></div></div>
    </div>

    <div class="panel section-gap">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">Milestone Timeline${infoIcon('del-timeline')}</h3>
          <div class="panel-sub">Every billing milestone across active engagements, by due date</div>
        </div>
      </div>
      <div class="chart-body">
        <div class="chart-canvas tall" id="delivery-timeline-chart"></div>
        <div class="timeline-legend">
          ${Object.entries(MILESTONE_STATUS_COLOR).map(([label, color]) => `<span class="timeline-legend-item"><span class="dot" style="background:${color}"></span>${label}</span>`).join('')}
        </div>
      </div>
    </div>

    <div class="panel section-gap">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">Delivery Insights</h3>
          <div class="panel-sub"><span class="ai-badge">✦ Simulated AI — prototype</span> Hardcoded insights computed live from this page's data — no model is called.</div>
        </div>
      </div>
      <div class="chart-body" style="padding:8px 20px 22px;"><div class="ai-card-list" id="delivery-ai-list"></div></div>
    </div>

    <div class="revenue-recognition-note">
      <strong>Invoiced ≠ paid.</strong> A tranche marked "Invoiced" is committed, high-confidence revenue (the same status this page treats as Contracted) — it is not yet cash. Only "Paid" tranches are cash (Settled). Whether revenue is recognised on a milestone basis or a % -of-completion basis is a finance decision, not asserted here — confirm treatment with finance before reporting externally. See the Assumptions Register.
    </div>
  `;

  renderDeliveryKpis();
  renderEngagementGrid();
  renderDeliveryTimeline();
  renderDeliveryAi();
}

function renderDeliveryKpis() {
  const k = Aggregates.deliveryKpis();
  const { end: qEnd } = quarterBounds(TODAY);
  const nm = k.nextMilestone;
  const cards = [
    { label: 'Locked Revenue', value: fmtCompact(k.lockedRevenue), foot: 'Not started / WIP — not yet committed', infoKey: 'del-locked' },
    { label: 'Unlockable This Quarter', value: fmtCompact(k.unlockableThisQuarter), foot: `due by ${fmtDateObj(qEnd)}`, infoKey: 'del-unlockable' },
    { label: 'Revenue At Risk', value: fmtCompact(k.revenueAtRisk), foot: 'locked milestones on at-risk engagements', footClass: k.revenueAtRisk > 0 ? 'neg' : 'pos', infoKey: 'del-at-risk' },
    { label: 'Active Engagements', value: String(k.activeEngagements), foot: 'advisory + brokerage in delivery', infoKey: 'del-active-engagements' },
    { label: 'Next Milestone', value: nm ? fmtCompact(nm.milestone.amount) : '—', foot: nm ? `${fmtDate(nm.milestone.dueDate)} · ${nm.deal.name}` : 'none scheduled', infoKey: 'del-next-milestone' },
  ];
  renderKpiCards('delivery-kpi-row', cards);
}

function healthBadgeClass(health) {
  return 'health-' + health.toLowerCase().replace(/\s+/g, '-');
}

function renderEngagementGrid() {
  const engagements = Aggregates.engagements();
  document.getElementById('engagement-grid').innerHTML = engagements.map(d => {
    const stage = getStage(d.stage);
    const meta = STAGE_GROUPS[stage.group];
    const locked = Aggregates.engagementLocked(d);
    const unlocked = Aggregates.engagementUnlocked(d);
    const total = locked + unlocked;
    const nextM = engagementTranches(d).filter(m => m.status !== 'Paid').sort((a, b) => parseDate(a.dueDate) - parseDate(b.dueDate))[0];
    const recon = Aggregates.trancheReconciliation(d);

    return `
      <div class="engagement-card" data-id="${d.id}">
        <div class="engagement-card-top">
          <div>
            <div class="engagement-card-name">${d.name}</div>
            <span class="stage-chip" style="background:${hexToRgba(meta.color, 0.12)}; color:${meta.color}"><span class="dot" style="background:${meta.color}"></span>${stage.short}</span>
          </div>
          <span class="health-badge ${healthBadgeClass(d.health)}">${d.health}</span>
        </div>

        <div class="engagement-progress-row">
          <div class="engagement-progress-track"><div class="engagement-progress-fill" style="width:${d.progressPct}%"></div></div>
          <div class="engagement-progress-pct tabular">${d.progressPct}%</div>
        </div>

        <div class="engagement-split-track">
          <div class="engagement-split-locked" style="width:${total ? (locked / total) * 100 : 0}%"></div>
          <div class="engagement-split-unlocked" style="width:${total ? (unlocked / total) * 100 : 0}%"></div>
        </div>
        <div class="engagement-split-legend">
          <span><span class="dot locked"></span>Locked <strong class="tabular">${fmtCompact(locked)}</strong></span>
          <span><span class="dot unlocked"></span>Unlocked <strong class="tabular">${fmtCompact(unlocked)}</strong></span>
        </div>

        <div class="engagement-next-milestone">
          ${nextM ? `Next milestone: <strong class="tabular">${fmtCompact(nextM.amount)}</strong> · ${fmtDate(nextM.dueDate)}` : 'All milestones paid'}
        </div>
        ${recon ? `<div class="tranche-recon ${recon.ok ? 'ok' : 'mismatch'}">${recon.ok ? '✓ Tranches reconcile' : '⚠ Tranches don’t match consultancy fee total'}</div>` : ''}
      </div>
    `;
  }).join('');

  document.querySelectorAll('.engagement-card').forEach(card => {
    card.addEventListener('click', () => openEngagementDrawer(card.dataset.id));
  });
}

function renderDeliveryTimeline() {
  const el = document.getElementById('delivery-timeline-chart');
  if (!deliveryTimelineChartInstance) deliveryTimelineChartInstance = echarts.init(el);
  const points = Aggregates.deliveryTimelinePoints();
  const engagementNames = Aggregates.engagements().map(d => d.name);
  const maxAmount = Math.max(1, ...points.map(p => p.amount));

  deliveryTimelineChartInstance.setOption({
    grid: { left: 8, right: 24, top: 16, bottom: 32, containLabel: true },
    tooltip: {
      trigger: 'item',
      formatter: (p) => {
        const d = p.data.point;
        return `<strong>${d.dealName}</strong><br/>${d.name}<br/>${fmtFull(d.amount)} · ${d.status}<br/>${fmtDate(d.dueDate)}`;
      },
      backgroundColor: '#0A1E36', borderWidth: 0, textStyle: { color: '#fff', fontSize: 12 },
    },
    xAxis: {
      type: 'time',
      axisLine: { lineStyle: { color: '#E3E8F0' } }, axisTick: { show: false },
      axisLabel: { color: '#6B7688', fontSize: 10.5, fontFamily: 'IBM Plex Sans' },
      splitLine: { lineStyle: { color: '#EDF0F6' } },
    },
    yAxis: {
      type: 'category', data: engagementNames,
      axisLine: { lineStyle: { color: '#E3E8F0' } }, axisTick: { show: false },
      axisLabel: { color: '#3B4657', fontSize: 11, fontFamily: 'IBM Plex Sans', fontWeight: 600 },
    },
    series: [{
      type: 'scatter',
      markLine: {
        symbol: 'none', silent: true,
        label: { formatter: 'Today', color: '#0476D9', fontSize: 10, fontFamily: 'IBM Plex Sans', fontWeight: 600 },
        lineStyle: { color: '#0476D9', type: 'dashed', width: 1.5 },
        data: [{ xAxis: TODAY.getTime() }],
      },
      data: points.map(p => ({
        value: [parseDate(p.dueDate).getTime(), p.dealName],
        point: p,
        symbolSize: 9 + (p.amount / maxAmount) * 22,
        itemStyle: { color: MILESTONE_STATUS_COLOR[p.status], opacity: 0.88, borderColor: '#fff', borderWidth: 1.5 },
      })),
    }],
  });
}

function renderDeliveryAi() {
  const insights = Aggregates.deliveryInsights();
  document.getElementById('delivery-ai-list').innerHTML = insights.map(i => `
    <div class="ai-card">
      <div class="ai-card-badge">✦ Simulated AI</div>
      <div class="ai-card-text">${i.text}</div>
    </div>
  `).join('');
}

/* ---------------------------- ENGAGEMENT DRAWER ---------------------------- */
/* A second, dedicated drawer (separate DOM elements, same shared CSS classes
   as the Pipeline deal drawer) so Delivery's commercial detail — deliverables,
   payment schedule, brokerage-gating — never has to branch inside the
   existing openDrawer() used by the other 8 pages. */

function openEngagementDrawer(id) {
  const deal = DEALS.find(d => d.id === id);
  if (!deal || !Aggregates.engagements().includes(deal)) return;
  const stage = getStage(deal.stage);
  const meta = STAGE_GROUPS[stage.group];
  const locked = Aggregates.engagementLocked(deal);
  const unlocked = Aggregates.engagementUnlocked(deal);
  const recon = Aggregates.trancheReconciliation(deal);

  document.getElementById('engagement-drawer-stage-chip').innerHTML =
    `<span class="stage-chip" style="background:rgba(255,255,255,0.14); color:#fff"><span class="dot" style="background:${meta.color}"></span>${stage.label}</span>`;
  document.getElementById('engagement-drawer-name').textContent = deal.name;
  document.getElementById('engagement-drawer-entity').textContent = `${deal.entity} · ${deal.owner}`;

  const deliverablesHtml = deal.deliverables.map(dl => `
    <div class="deliverable-row">
      <div>
        <div class="deliverable-name">${dl.name}</div>
        <div class="deliverable-criteria">${dl.acceptanceCriteria}</div>
      </div>
      <span class="deliverable-status status-${dl.status.toLowerCase().replace(/\s+/g, '-')}">${dl.status}</span>
    </div>
  `).join('');

  const milestonesHtml = engagementTranches(deal).map(m => `
    <div class="milestone-row">
      <div class="milestone-row-top">
        <div class="milestone-name">${m.name}</div>
        <span class="milestone-status status-${m.status.toLowerCase().replace(/\s+/g, '-')}">${m.status}</span>
      </div>
      <div class="milestone-meta">${fmtDate(m.dueDate)} · <span class="tabular">${fmtFull(m.amount)}</span></div>
      <div class="milestone-condition">Billable when: ${m.unlockCondition}</div>
    </div>
  `).join('');

  const gatingHtml = deal.gatedBrokerage ? `
    <div class="drawer-section">
      <div class="drawer-section-label">Downstream Dependency</div>
      <div class="gating-card">
        <div class="gating-card-text">Completing this engagement is expected to open a downstream brokerage mandate on the same asset.</div>
        <div class="gating-card-value tabular">~${fmtFull(deal.gatedBrokerage.potentialValue)}<span class="gating-card-unit">potential brokerage revenue*</span></div>
        <div class="gating-card-condition">${deal.gatedBrokerage.condition}</div>
        <div class="gating-card-flag">*Estimated — no Deal record exists for this yet. See Assumptions Register.</div>
      </div>
    </div>
  ` : '';

  document.getElementById('engagement-drawer-body').innerHTML = `
    <div class="drawer-metric-row">
      <div class="drawer-metric"><div class="drawer-metric-label">Progress</div><div class="drawer-metric-value tabular">${deal.progressPct}%</div></div>
      <div class="drawer-metric"><div class="drawer-metric-label">Health</div><div class="drawer-metric-value" style="color:${HEALTH_COLOR[deal.health]}">${deal.health}</div></div>
      <div class="drawer-metric"><div class="drawer-metric-label">Locked Revenue</div><div class="drawer-metric-value tabular">${fmtFull(locked)}</div></div>
      <div class="drawer-metric"><div class="drawer-metric-label">Unlocked Revenue</div><div class="drawer-metric-value tabular">${fmtFull(unlocked)}</div></div>
    </div>

    <div class="drawer-section">
      <div class="drawer-section-label">Deliverables</div>
      <div class="deliverable-list">${deliverablesHtml}</div>
    </div>

    <div class="drawer-section">
      <div class="drawer-section-label">Payment Schedule</div>
      <div class="milestone-list">${milestonesHtml}</div>
      ${recon ? `
        <div class="tranche-recon-detail ${recon.ok ? 'ok' : 'mismatch'}">
          ${recon.ok
            ? `✓ Tranche Reconciliation: ${fmtFull(recon.sum)} across both tranches matches the ${fmtFull(recon.total)} consultancy fee total.`
            : `⚠ Tranche Reconciliation: tranches sum to ${fmtFull(recon.sum)}, which does not match the ${fmtFull(recon.total)} consultancy fee total — check entry in Notion.`}
        </div>
      ` : ''}
    </div>

    ${gatingHtml}

    <div class="drawer-section">
      <div class="drawer-section-label">Owner</div>
      <div class="drawer-section-text">${deal.owner}</div>
    </div>

    <a class="notion-link" href="#" id="engagement-notion-link">
      Open in Notion
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M7 17L17 7M17 7H9M17 7v8"/></svg>
    </a>
  `;

  document.getElementById('engagement-notion-link').addEventListener('click', (e) => {
    e.preventDefault();
    showEngagementDrawerToast('Prototype — this would deep-link to the live Notion record.');
  });

  document.getElementById('engagement-drawer').classList.add('open');
  document.getElementById('engagement-drawer-overlay').classList.add('open');
}

function showEngagementDrawerToast(msg) {
  let toast = document.querySelector('#engagement-drawer .drawer-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'drawer-toast';
    document.getElementById('engagement-drawer').appendChild(toast);
  }
  toast.textContent = msg;
  requestAnimationFrame(() => toast.classList.add('show'));
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.remove('show'), 2400);
}

function closeEngagementDrawer() {
  document.getElementById('engagement-drawer').classList.remove('open');
  document.getElementById('engagement-drawer-overlay').classList.remove('open');
}

function initEngagementDrawer() {
  document.getElementById('engagement-drawer-close').addEventListener('click', closeEngagementDrawer);
  document.getElementById('engagement-drawer-overlay').addEventListener('click', closeEngagementDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeEngagementDrawer(); });
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
            <h3 class="panel-title">Conversion Funnel${infoIcon('funnel-chart')}</h3>
            <div class="panel-sub">Market reach through to settlement · *Market/Relationships is estimated, not tracked in Notion</div>
          </div>
        </div>
        <div class="chart-body"><div class="chart-canvas" id="funnel-chart" style="height:430px;"></div></div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div><h3 class="panel-title">Stage Conversion${infoIcon('funnel-table')}</h3><div class="panel-sub">Conversion and drop-off between each stage</div></div>
        </div>
        <div id="funnel-table-body" style="padding:8px 24px 20px;"></div>
      </div>
    </div>

    <div class="panel section-gap">
      <div class="panel-head">
        <div><h3 class="panel-title">New vs. Lost Prospects${infoIcon('prospects-chart')}</h3><div class="panel-sub">Trailing 14 months · created vs. lost, by month</div></div>
      </div>
      <div class="chart-body"><div class="chart-canvas" id="prospects-chart"></div></div>
    </div>

    <div class="chart-grid section-gap">
      <div class="panel">
        <div class="panel-head">
          <div><h3 class="panel-title">Relationship-Led vs Marketing-Sourced${infoIcon('source-groups')}</h3><div class="panel-sub">Volume and qualification rate by channel</div></div>
        </div>
        <div id="source-group-body" style="padding:18px 24px 22px;"></div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div><h3 class="panel-title">Prospect Sources${infoIcon('source-detail')}</h3><div class="panel-sub">Individual channel performance</div></div>
        </div>
        <div id="source-detail-body" style="padding:6px 24px 18px;"></div>
      </div>
    </div>

    <div class="panel section-gap">
      <div class="panel-head">
        <div><h3 class="panel-title">Cohort Conversion by Quarter${infoIcon('cohort-table')}</h3><div class="panel-sub">Ultimate win rate of deals created each quarter · recent cohorts still undecided</div></div>
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
  const anomaly = Aggregates.stageAnomaly(deal);
  const anomalyBadge = (anomaly.skipped || anomaly.backward)
    ? `<span class="stage-anomaly-badge" title="Display-only — the dashboard flags this, it does not enforce valid transitions">⚠ ${[anomaly.skipped && 'Skipped a stage', anomaly.backward && 'Moved backward'].filter(Boolean).join(' · ')}</span>`
    : '';

  document.getElementById('drawer-stage-chip').innerHTML =
    `<span class="stage-chip" style="background:rgba(255,255,255,0.14); color:#fff"><span class="dot" style="background:${meta.color}"></span>${stage.label}</span>${anomalyBadge}`;
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

  const journey = Aggregates.stageJourney(deal);
  const journeyHtml = journey.map(j => {
    const transitionNote = j.transitionFlag === 'backward'
      ? '<div class="journey-anomaly-note">⚠ Moved backward from the previous stage</div>'
      : j.transitionFlag === 'skip'
        ? '<div class="journey-anomaly-note">⚠ Skipped a stage on the way here</div>'
        : '';
    return `
      <div class="journey-item ${j.isCurrent ? 'current' : ''} ${j.transitionFlag ? 'anomaly' : ''}">
        <div class="journey-rail"><div class="journey-dot" style="background:${STAGE_GROUPS[j.stageMeta.group].color}"></div></div>
        <div class="journey-content">
          <div class="journey-top">
            <span class="journey-stage-name">${j.stageMeta.short}</span>
            <span class="journey-days">${j.isCurrent ? `${j.daysInStage} day${j.daysInStage === 1 ? '' : 's'} so far` : `${j.daysInStage} day${j.daysInStage === 1 ? '' : 's'} in stage`}</span>
          </div>
          <div class="journey-date">Entered ${fmtDate(j.enteredDate)}</div>
          ${transitionNote}
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('drawer-body').innerHTML = `
    <div class="drawer-metric-row">
      <div class="drawer-metric"><div class="drawer-metric-label">Transaction Value</div><div class="drawer-metric-value tabular">${fmtFull(deal.transactionValue)}</div></div>
      <div class="drawer-metric"><div class="drawer-metric-label">Expected SDAHC Revenue</div><div class="drawer-metric-value tabular">${fmtFull(rev)}</div></div>
      <div class="drawer-metric"><div class="drawer-metric-label">Probability</div><div class="drawer-metric-value tabular">${fmtPct(deal.probability)}</div></div>
      <div class="drawer-metric"><div class="drawer-metric-label">Weighted Revenue</div><div class="drawer-metric-value tabular">${fmtFull(wtd)}</div></div>
    </div>

    <div class="drawer-section">
      <div class="drawer-section-label">Stage Journey <span class="drawer-section-note">simulated — see Assumptions Register</span></div>
      <div class="journey-list">${journeyHtml}</div>
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

/* Matches the app's actual 9 nav pages, in nav order. Grouping the register
   this way means a user on a given page can scan just its heading instead
   of the full flat list — an entry that affects more than one page (e.g.
   fiscal year) is listed, and shown, under every page it touches. */
const ASSUMPTION_PAGE_ORDER = ['Overview', 'Pipeline', 'Revenue', 'Delivery', 'Sales Funnel', 'SDA Report', 'Market Intelligence', 'Playbook', 'Settings'];

function renderAssumptionsList() {
  document.getElementById('assumptions-body').innerHTML = ASSUMPTION_PAGE_ORDER.map(page => {
    const entries = ASSUMPTIONS.filter(a => a.pages && a.pages.includes(page));
    if (!entries.length) return '';
    return `
      <div class="assumption-page-group">
        <div class="assumption-page-heading">${page}</div>
        ${entries.map(a => `
          <div class="assumption-item" data-assumption-id="${a.id}">
            <div class="assumption-top">
              <div class="assumption-label">${a.label}</div>
              <span class="assumption-category ${ASSUMPTION_CATEGORY_CLASS[a.category] || ''}">${a.category}</span>
            </div>
            <div class="assumption-used-in">Used in: ${a.usedIn}</div>
            <div class="assumption-why">${a.why}</div>
          </div>
        `).join('')}
      </div>
    `;
  }).join('');
}

/* Pass an ASSUMPTIONS id (e.g. from an info popover's "View in Assumptions
   Register" link) to open the modal scrolled straight to that entry. An
   entry listed under several pages renders once per page — this jumps to
   whichever copy appears first in ASSUMPTION_PAGE_ORDER. */
function openAssumptionsModal(targetId) {
  renderAssumptionsList();
  document.getElementById('assumptions-overlay').classList.add('open');
  if (!targetId) return;
  requestAnimationFrame(() => {
    const el = document.querySelector(`[data-assumption-id="${targetId}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1600);
  });
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
          <h3 class="panel-title">Print Inventory${infoIcon('sda-inventory')}</h3>
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
          <h3 class="panel-title">Distribution${infoIcon('sda-distribution')}</h3>
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
          <h3 class="panel-title">Commercial Funnel${infoIcon('sda-funnel')}</h3>
          <div class="panel-sub">Reports Delivered → Settled Revenue · each stage tagged Real or Simulated</div>
        </div>
      </div>
      <div id="sda-funnel-body" style="padding:8px 24px 20px;"></div>
    </div>

    <div class="panel section-gap">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">Campaign ROI${infoIcon('sda-roi')}</h3>
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
    { label: 'Printed', value: inv.printed, foot: 'reports' },
    { label: 'Allocated', value: inv.allocated, foot: 'reports' },
    { label: 'Delivered', value: inv.delivered, foot: 'reports' },
    { label: 'Pending', value: inv.pending, foot: 'calculated' },
    { label: 'Available', value: inv.available, foot: 'calculated' },
  ];
  renderKpiCards('sda-inventory-row', cards);
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
  renderKpiCards('sda-roi-row', cards);

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
          <h3 class="panel-title">Market Pulse${infoIcon('mi-gauges')}</h3>
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
          <h3 class="panel-title">Intelligence Impacting Active Deals${infoIcon('mi-signals')}</h3>
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
      <div class="panel-head">
        <div>
          <h3 class="panel-title">Explore the Manual</h3>
          <div class="panel-sub">Click a category to expand it · condensed from the SDAHC Operating Manual, see Assumptions</div>
        </div>
      </div>
      <div class="chart-body" style="padding:8px 20px 22px;"><div class="manual-accordion" id="manual-accordion"></div></div>
    </div>
  `;

  renderEngines();
  renderValueLoop();
  renderTeam();
  renderManualAccordion();
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
      <div class="engine-teaser">${e.teaser}</div>
      ${e.subEngine ? `
        <div class="engine-subchip">
          <span class="engine-subchip-dot"></span>
          Includes: ${e.subEngine.label} <span class="engine-substatus">${e.subEngine.status}</span>
        </div>
      ` : ''}
      <div class="engine-body-wrap">
        <div class="engine-body-inner">
          <div class="engine-body">
            <p>${e.body}</p>
            ${e.subEngine ? `<p class="engine-subbody"><strong>${e.subEngine.label} (${e.subEngine.status}):</strong> ${e.subEngine.body}</p>` : ''}
          </div>
        </div>
      </div>
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

function renderManualAccordion() {
  const wrap = document.getElementById('manual-accordion');
  wrap.innerHTML = PLAYBOOK_MANUAL_CATEGORIES.map(c => `
    <div class="manual-card" data-key="${c.key}">
      <div class="manual-card-head">
        <div>
          <div class="manual-card-label">${c.label}</div>
          <div class="manual-card-teaser">${c.teaser}</div>
        </div>
        <svg class="manual-card-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
      </div>
      <div class="manual-card-body-wrap">
        <div class="manual-card-body-inner">
          <div class="manual-card-body">
            ${c.sections.map(s => `
              <div class="manual-subsection">
                <div class="manual-subsection-heading">${s.heading}</div>
                <div class="manual-subsection-text">${s.text}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>
  `).join('');
  wrap.querySelectorAll('.manual-card').forEach(card => {
    card.querySelector('.manual-card-head').addEventListener('click', () => card.classList.toggle('expanded'));
  });
}

/* ============================================================================
   SETTINGS PAGE
   Demonstrates dashboard-owned data end-to-end. Saving persists to
   localStorage via updateSettings() and reloads, so every other page picks
   up the new values from a guaranteed-consistent fresh render.
   ============================================================================ */

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
      <div class="field-hint" style="padding:0 24px 18px;">Probability is a per-deal Notion value Steve sets on each deal — there is no stage-based default to configure here.</div>
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

  document.getElementById('settings-save').addEventListener('click', saveSettingsForm);
  document.getElementById('settings-reset').addEventListener('click', () => {
    resetSettings();
    showSettingsToast('Reset to defaults — reloading…');
    setTimeout(() => location.reload(), 700);
  });
  document.getElementById('settings-view-assumptions').addEventListener('click', openAssumptionsModal);
}

function saveSettingsForm() {
  const patch = {
    annualTarget: parseFloat(document.getElementById('set-annualTarget').value) || 0,
    monthlyTarget: parseFloat(document.getElementById('set-monthlyTarget').value) || 0,
    fyStartMonth: parseInt(document.getElementById('set-fyStartMonth').value, 10),
    highValueDealThreshold: parseFloat(document.getElementById('set-highValueDealThreshold').value) || 0,
    staleWarningDays: parseInt(document.getElementById('set-staleWarningDays').value, 10) || 1,
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
  initEngagementDrawer();
  initAssumptionsModal();
  initInfoIcons();
  renderOverview();
  renderPipelinePage();

  window.addEventListener('resize', () => {
    [pipelineChartInstance, waterfallChartInstance, revenueTimeChartInstance, revenueSourceChartInstance, deliveryTimelineChartInstance, funnelChartInstance, prospectsChartInstance, ...sdaDistChartInstances, ...gaugeChartInstances]
      .forEach(c => c && c.resize());
  });
});
