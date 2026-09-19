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
  if (!d) return '';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* Same formatting as fmtDate, for callers that already hold a Date object
   (e.g. quarterBounds()) rather than a 'YYYY-MM-DD' string. */
function fmtDateObj(dt) {
  if (!dt) return '';
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
  'ov-settled': { text: 'Money actually collected: SDAHC Revenue of deals Won with a close date in the current fiscal year, PLUS Paid advisory tranches on every other (non-Paused, non-Won) deal. The Paid-tranche portion has no "paid on" date in Notion, so it\'s a present-day snapshot, not strictly FY-scoped — it can make this figure read higher than the Revenue page\'s Cumulative Actual chart, which only plots dated (Won) revenue.', assumptionId: 'fiscal-year-scope' },
  'ov-open-pipeline': { text: 'Full-value SDAHC Revenue of every deal currently In Progress — not probability-adjusted. Paused deals are excluded; they carry zero value here.', assumptionId: 'paused-exclusion' },
  'ov-weighted': { text: 'Σ (SDAHC Revenue × Probability) across every In Progress deal. Probability is each deal\'s own Notion value, never a stage default.' },
  'ov-active': { text: 'Count of deals with outcome = In Progress. Paused deals are counted separately and excluded here.', assumptionId: 'paused-exclusion' },
  'ov-new-prospects': { text: 'Deals with a createdDate inside the current calendar month, regardless of outcome or stage. Paused deals excluded, per the non-negotiable rule that they carry zero weight everywhere. createdDate is Notion\'s page-creation date, which for bulk-migrated deals is the migration date, not the real prospecting date — expect a spike around the migration month rather than a smooth trend.', assumptionId: 'paused-exclusion' },
  'ov-win-rate': { text: 'Won ÷ (Won + Lost), among deals that have actually been decided. Still-open deals aren\'t counted either way.' },
  'ov-avg-consultancy': { text: 'Mean advisory/consultancy fee across every deal with one, any outcome (Won, Lost or In Progress) — a typical engagement size, not a revenue forecast.', assumptionId: 'avg-consultancy-listing-value' },
  'ov-avg-listing': { text: 'Mean Transaction Value (the underlying asset price, never SDAHC revenue) across every deal tagged Brokerage / Divestment, any outcome — a typical listing size, not a revenue forecast.', assumptionId: 'avg-consultancy-listing-value' },
  'ov-hero': { text: 'Settled (Won, cash) + Unconditional Contracted (Under Contract, ~99% certain) + Contracted conditional (Contract Issued, or WIP/Invoiced delivery tranches — committed but a condition can still apply) + Weighted Pipeline (probability-adjusted) stacked against the Annual Target. Gap to Target = Target − that total; the marker shows how far through the FY you are.' },
  'ov-waterfall': { text: 'A bridge from Opening to Closing weighted pipeline: + New Opportunities (created this period) + Value Added (simulated re-rating) − Lost − Settled = Closing. Opening is back-solved so the bridge always balances exactly. Paused deals contribute to none of these. createdDate (used for New Opportunities) is Notion\'s page-creation date — for bulk-migrated deals that\'s the migration date, not the real deal date, so this can show a migration-driven spike.', assumptionId: 'value-added-rate' },
  'ov-pipeline-chart': { text: 'Every non-Paused deal grouped by its current stage, regardless of outcome — Won and Lost deals stay visible at the stage they froze at. Paused deals are excluded entirely (zero count, zero value) per the non-negotiable rule that they never contribute to any pipeline total.', assumptionId: 'paused-exclusion' },

  // Pipeline
  'pipeline-flow': { text: 'Same per-stage grouping as Overview\'s Pipeline by Stage — Won/Lost/Paused deals stay visible at their frozen stage. Toggle changes what each stage card reports.' },
  'pipeline-score': { text: 'The table\'s order is fixed to Score, descending, and isn\'t user-sortable — Score is meant to mirror Notion\'s own Score-sorted view exactly.', assumptionId: 'pipeline-score-mock' },

  // Revenue
  'rev-settled': { text: 'Same figure as Overview\'s hero: Won deals with a close date in the current fiscal year, summed by SDAHC Revenue.', assumptionId: 'fiscal-year-scope' },
  'rev-contracted-unconditional': { text: 'SDAHC Revenue of In Progress deals at Under Contract (B8) only — nothing left to negotiate, ~99% certain. The most confident non-cash tier.' },
  'rev-contracted-conditional': { text: 'SDAHC Revenue of In Progress deals at Contract Issued (B7) — signed, but a condition (finance, DD, etc.) can still be live — PLUS the WIP + Invoiced tranche amounts of any other Delivery engagement not already counted as Unconditional or via B7. Committed, but less certain than Unconditional.', assumptionId: 'delivery-tranche-fields' },
  'rev-weighted-forecast': { text: 'Σ (SDAHC Revenue × Probability) across every In Progress deal — identical definition and number as Overview\'s Weighted Pipeline.' },
  'rev-open-pipeline': { text: 'Full, non-probability-adjusted SDAHC Revenue of every In Progress deal.' },
  'rev-target': { text: 'The Annual Revenue Target set in Settings → Business, for the current fiscal year.' },
  'rev-gap': { text: 'Target − (Settled + Contracted + Weighted Open). Shown as "on track" once Settled + Contracted + Weighted already covers the target.' },
  'rev-time-chart': { text: 'Actual bars read real closeDate history. Forecast bars bucket each open deal into a month using an estimated close date derived from its probability — directional only, Notion doesn\'t track an expected close date.', assumptionId: 'estimated-close-date' },
  'rev-source-chart': { text: 'SDAHC Revenue split by fee type across Won + In Progress deals. Lost and Paused are excluded — Paused carries zero value. Only Brokerage and Advisory are shown — Conjunction and Referral fees aren\'t columns in the current Notion sync, so they can\'t be split out from real data yet.', assumptionId: 'paused-exclusion' },
  'rev-concentration': { text: 'Share of total Won + In Progress revenue sitting in the top 3 deals by SDAHC Revenue — a concentration-risk read, same scope as Revenue Composition.', assumptionId: 'revenue-scope' },
  'rev-by-stage': { text: 'SDAHC Revenue currently held at each stage, across every outcome — the same per-stage data as byStage(), filtered to stages with at least one deal.' },
  'rev-cumulative': { text: 'A business-plan-style pace chart: cumulative Target (annual target ÷ 12, accumulated month by month across the FY) vs. cumulative Actual (settled revenue, accumulated through the current month — the line simply stops at today, since future actuals don\'t exist yet).', assumptionId: 'monthly-target-split' },
  'rev-cumulative-actual': { text: 'Cumulative settled SDAHC Revenue from the start of the FY through today — identical figure to Settled Revenue elsewhere on this page.' },
  'rev-cumulative-target': { text: 'Cumulative plan value through the current month only (not the full annual target) — monthly target × months elapsed so far this FY — so it\'s a fair like-for-like comparison against Cumulative Actual.', assumptionId: 'monthly-target-split' },
  'rev-cumulative-variance': { text: 'Cumulative Actual − Cumulative Target (both through the current month). Positive = ahead of plan, negative = behind. % is variance ÷ Cumulative Target.' },

  // Delivery
  'del-advisory-real': { text: 'Every deal in analytics.deals with advisory_fee > 0 AND at least one tranche STATUS field set in Notion (a status field being set, even to "Not started", is what "loaded" means — the amount columns are coalesced to 0 by the view and can\'t tell a real zero apart from never-filled-in). Locked = tranches still "Not started" — not yet committed. Unlocked = Contracted (WIP/Invoiced) + Settled (Paid) combined, the same mapping used everywhere else on this app for real advisory money. Paused deals appear here too but contribute zero. A deal with advisory_fee but no tranche fields at all doesn\'t qualify yet — it still counts normally on Overview/Revenue via its flat advisory_fee.', assumptionId: 'delivery-advisory-real' },
  'del-locked': { text: 'Sum of milestone amounts across Brokerage engagements whose status is "Not started" — not yet committed, still part of open pipeline only. WIP counts as committed (Contracted) here, same as Invoiced. Brokerage only — see the Advisory Engagements section above for the real advisory equivalent.', assumptionId: 'delivery-milestone-model' },
  'del-unlockable': { text: 'Of that Locked total, the portion whose due date falls within the current calendar quarter — i.e. what should convert to Invoiced/Paid soon if on schedule. Brokerage only — milestone due dates aren\'t a real field for advisory tranches, so this KPI has no advisory equivalent.' },
  'del-at-risk': { text: 'Locked amounts specifically on Brokerage engagements flagged health = "At risk" or "Slipped" — a subset of Locked Revenue, not an addition to it. Health is a modelled field with no advisory equivalent, so this KPI is Brokerage-only.' },
  'del-active-engagements': { text: 'Count of Brokerage deals carrying billing milestones — the roster shown in the Brokerage Engagements grid below. Advisory engagements have their own, separate "Active Engagements" count in the Advisory KPI row above.' },
  'del-next-milestone': { text: 'The soonest tranche/milestone across Brokerage engagements that isn\'t yet Paid, by due date. Brokerage only — real advisory tranches have no due-date field to rank by.' },
  'del-timeline': { text: 'Every tranche/milestone from every Brokerage engagement, plotted by due date and coloured by status. Dot size scales with the dollar amount. Brokerage only — real advisory tranches have no due date to plot.' },

  // Sales Funnel
  'funnel-chart': { text: 'CUMULATIVE, not a snapshot: each tier counts every non-Paused deal that reached AT LEAST that stage or further — not deals sitting exactly there today (that\'s what Pipeline\'s Pipeline-by-Stage chart shows). A deal now frozen at a later stage, or Lost from one, still counts in every earlier tier it passed through. In real stage-ID terms: Prospects = every non-Paused deal (stage 0 or later — i.e. all of them). Qualified Opportunities = reached A1 or later. Advisory Proposal = reached A2 or later. Advisory Engagement = reached A3 or later. Transaction Ready = reached A5 (Advisory Complete) or later. Brokerage / Sale Mandate = reached B3 (Appointed & Market Prep) or later. Negotiation = reached B6 or later. Contract = reached B7 (Contract Issued) or later. Settlement = at stage 9 with outcome Won. Because every brokerage stage sits after every advisory stage in the pipeline order, a brokerage deal automatically satisfies every advisory tier too, even one that never visited A1-A5 — read as "reached an equivalent depth via a different service line," not as drop-off. The single most useful number here isn\'t any one tier\'s raw count — it\'s the drop-off % between consecutive tiers (Stage Conversion, alongside), which shows where deals are actually lost. Advisory Proposal onward is clickable — click a bar or table row to see exactly which deals qualify.', assumptionId: 'funnel-tier-mapping' },
  'funnel-table': { text: 'Conversion = this tier\'s count ÷ the previous tier\'s count. Dropped = 1 − conversion. Same real, Paused-excluded, cumulative counts as the Conversion Funnel — see that chart\'s info icon for what each tier means in stage-ID terms. Rows from Advisory Proposal onward are clickable.' },
  'prospects-chart': { text: 'New Prospects = mock deals created that month, by createdDate. Lost = mock deals whose closeDate (in that month) has outcome Lost. Trailing 14 months. Mock — not yet reconnected to real data.' },
  'source-groups': { text: 'Every MOCK prospect source rolled into two channels (Relationship-led vs Marketing-sourced, per PROSPECT_SOURCES). Qualified = reached stage A1/B1 or later. No source field exists in the real Notion data — see ASSUMPTIONS \'prospect-source-mock\'.', assumptionId: 'prospect-source-mock' },
  'source-detail': { text: 'Same "qualified" definition as the channel comparison, broken out per individual MOCK source.', assumptionId: 'prospect-source-mock' },
  'cohort-table': { text: 'Mock deals grouped by the quarter they were CREATED (not decided). Conversion = Won ÷ (Won + Lost) within that cohort; still-open cohorts show "Too early." Mock — not yet reconnected to real data.', assumptionId: 'cohort-conversion' },

  // SDA Report
  'sda-inventory': { text: 'Printed/Allocated/Delivered are dashboard-owned counters (not in Notion). Pending and Available are always calculated from them live, never stored, so they can\'t drift.', assumptionId: 'sda-report-inventory' },
  'sda-distribution': { text: 'A simulated breakdown of the 122 delivered reports by city/channel/priority/relationship type — individual recipients aren\'t tracked as Notion records.', assumptionId: 'sda-report-distribution' },
  'sda-funnel': { text: 'Reports Delivered, Deal, Pipeline Generated and Settled Revenue are real (read from the 3 deals tagged source = "SDA Report"). Followed Up/Response/Meeting/Opportunity are simulated conversion-rate estimates.', assumptionId: 'sda-report-funnel-upper' },
  'sda-roi': { text: 'Cost ratios divide the real Campaign Cost by a mix of real (Delivered, Deal, Settled Revenue) and simulated (Meeting, Opportunity) counts — Pipeline Generated and Settled Revenue are always shown separately, never combined.', assumptionId: 'sda-report-funnel-upper' },

  // Marketing
  'mkt-spend': { text: 'Annual marketing/origination spend by category — entirely dashboard-owned, seeded with plausible figures. Not tracked in Notion; no Settings edit form exists yet.', assumptionId: 'marketing-spend' },
  'mkt-spend-total': { text: 'Sum of Travel, Events, Report Print/Production (reads SDA Report\'s Campaign Cost live), Digital and Other.', assumptionId: 'marketing-spend' },
  'mkt-spend-largest': { text: 'Whichever category has the highest annual spend — expected to be Travel, reflecting relationship-building trips as the dominant cost.', assumptionId: 'marketing-spend' },
  'mkt-spend-travel': { text: 'Travel + Events as a share of total annual marketing spend — the two large-scale, relationship-building categories.', assumptionId: 'marketing-spend' },
  'mkt-electronic': { text: 'The printed summary strip reads SDA Report\'s real inventory figures live (see SDA Report page for the full breakdown and adjustment history) — nothing here recomputes or duplicates that. Only the electronic figures below it (Sent, Website Downloads, the funnel) are new.', assumptionId: 'marketing-electronic-distribution' },
  'mkt-electronic-sent': { text: 'Electronic copies emailed out — a dashboard-owned mock input, not a Notion or email-platform record.', assumptionId: 'marketing-electronic-distribution' },
  'mkt-electronic-downloads': { text: 'Copies downloaded directly from the SDAHC website — independent of the Sent count (a download can come from someone never emailed a copy). Dashboard-owned mock input.', assumptionId: 'marketing-electronic-distribution' },
  'mkt-electronic-cost': { text: 'Digital spend category ÷ Engaged count — the simplest cost-per-outcome view for the electronic channel specifically (not the whole Marketing Spend total).', assumptionId: 'marketing-electronic-distribution' },

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
  marketing:     { eyebrow: 'Growth',                   title: 'Marketing' },
  'market-intel':{ eyebrow: 'Growth',                   title: 'Market Intelligence' },
  playbook:      { eyebrow: 'Reference',                title: 'SDAHC Playbook' },
  settings:      { eyebrow: 'System',                   title: 'Settings' },
};

/* Revenue and Sales Funnel contain ECharts instances; initialising a chart
   into a hidden (display:none) container measures 0×0 and renders blank. So
   those two pages render lazily, the first time their nav item is opened —
   by then the view already has .active applied and a real size.

   Overview and Pipeline are also listed here (see the PIPELINE HANG fix
   note above renderPipelinePage()) even though Overview is the one page
   that also gets an explicit render call at DOMContentLoaded, before any
   nav click ever happens — it has to, since it's the default active view.
   That startup call manually does what a click on its nav item would do
   (render, then mark it in renderedViews) so both pages funnel through the
   exact same "was this page active when the data actually arrived" retry
   contract every lazy page relies on, instead of Pipeline's old special
   case: rendered eagerly while HIDDEN (Overview was the visible one), so
   its "re-render once data arrives" callback checked `.active`, saw
   Pipeline wasn't it, and gave up permanently with nothing left to ever
   call it again. */
const LAZY_PAGE_RENDERERS = {
  overview: renderOverview, pipeline: renderPipelinePage, revenue: renderRevenuePage, delivery: renderDeliveryPage, funnel: renderFunnelPage,
  'sda-report': renderSdaReportPage, marketing: renderMarketingPage, 'market-intel': renderMarketIntelPage,
  playbook: renderPlaybookPage, settings: renderSettingsPage,
};
const renderedViews = new Set();

/* Overview, Pipeline and Revenue read live analytics.deals via Supabase —
   every other page still reads data.js's mock DEALS. The topbar badge
   switches label/colour so it's never ambiguous which kind of data is on
   screen (see supabase-data.js). */
const REAL_DATA_PAGES = new Set(['overview', 'pipeline', 'revenue']);

function updateDataSourceBadge(view) {
  const badge = document.getElementById('assumptions-badge');
  const isLive = REAL_DATA_PAGES.has(view);
  badge.classList.toggle('live-badge', isLive);
  badge.innerHTML = isLive ? '<span class="dot"></span>Live Data — Supabase' : '<span class="dot"></span>Prototype — Mock Data';
}

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
      updateDataSourceBadge(view);
      if (LAZY_PAGE_RENDERERS[view] && !renderedViews.has(view)) {
        LAZY_PAGE_RENDERERS[view]();
        renderedViews.add(view);
      }
      window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    });
  });
  updateDataSourceBadge(document.querySelector('.nav-item.active')?.dataset.view || 'overview');
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
   OVERVIEW PAGE — REAL DATA (Supabase)
   Reads REAL_DEALS / RealAggregates from supabase-data.js, not data.js's
   mock DEALS / Aggregates. Advisory→Brokerage Conversion has been removed
   app-wide (mock pages included, not just this one) — see ASSUMPTIONS
   'advisory-brokerage-conversion' in data.js for why and what would bring
   it back. Deal Activity, unlike that KPI, only ever needed createdDate +
   each deal's current stage (never stage history) — see activitySummary()
   in supabase-data.js — so it's shown here from real data.
   ============================================================================ */

let overviewPeriod = 'ytd';
let overviewMetric = 'revenue';
let pipelineChartInstance = null;
let waterfallChartInstance = null;

function renderOverview() {
  if (RealData.status === 'loading') {
    renderRealDataStatusPanel('view-overview');
    /* Same shape as the Pipeline/Revenue fix: if the user has already
       clicked away from Overview by the time the fetch resolves, drop it
       from renderedViews so the click handler renders it fresh (with the
       chart instance vars still null, so a clean first init) next time
       Overview is opened, instead of leaving it stuck on this placeholder
       forever with nothing left to ever call renderOverview() again. */
    initRealData().then(() => {
      if (document.getElementById('view-overview').classList.contains('active')) renderOverview();
      else renderedViews.delete('overview');
    });
    return;
  }
  if (renderRealDataStatusPanel('view-overview')) return;

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
            <div class="panel-sub">All active + closed deals, excluding Paused</div>
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
  const { target, settled, unconditional, conditional, weighted, gap, onTrack } = RealAggregates.revenueTargetSummary();

  const settledPct = Math.min(100, (settled / target) * 100);
  const unconditionalPct = Math.min(100 - settledPct, (unconditional / target) * 100);
  const conditionalPct = Math.min(100 - settledPct - unconditionalPct, (conditional / target) * 100);
  const weightedPct = Math.min(100 - settledPct - unconditionalPct - conditionalPct, (weighted / target) * 100);

  // Pace marker: how far through the current FY we are, as a % of target.
  const { start: fyStart, end: fyEnd } = fiscalYearBounds(TODAY);
  const paceFraction = (TODAY - fyStart) / (fyEnd - fyStart);
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
        <div class="hero-progress-seg seg-unconditional" style="width:${unconditionalPct}%"></div>
        <div class="hero-progress-seg seg-conditional" style="width:${conditionalPct}%"></div>
        <div class="hero-progress-seg seg-weighted" style="width:${weightedPct}%"></div>
      </div>
      <div class="hero-progress-marker" style="left:${pacePct}%" data-label="Pace · ${pacePct.toFixed(0)}% of FY"></div>
    </div>

    <div class="hero-legend">
      <div class="hero-legend-item"><span class="hero-legend-swatch" style="background:#2FB37A"></span>Settled <strong>${fmtCompact(settled)}</strong></div>
      <div class="hero-legend-item"><span class="hero-legend-swatch" style="background:#14A8A0"></span>Unconditional Contracted <strong>${fmtCompact(unconditional)}</strong></div>
      <div class="hero-legend-item"><span class="hero-legend-swatch" style="background:#0476D9"></span>Contracted (conditional) <strong>${fmtCompact(conditional)}</strong></div>
      <div class="hero-legend-item"><span class="hero-legend-swatch" style="background:#E0A82E"></span>Weighted Pipeline <strong>${fmtCompact(weighted)}</strong></div>
      <div class="hero-gap ${onTrack ? 'on-track' : ''}">${onTrack ? 'Potential clears target by' : 'Gap to target'} <strong>${fmtCompact(gap)}</strong></div>
    </div>
  `;
}

function renderKpiRow() {
  const settled = RealAggregates.settledRevenueYTD();
  const settings = getSettings();
  const expectedOpen = RealAggregates.expectedOpenPipelineRevenue();
  const weighted = RealAggregates.weightedPipelineRevenue();
  const active = RealAggregates.active().length;
  const newProspects = RealAggregates.newProspectsThisMonth();
  const winRate = RealAggregates.winRate();
  const avgConsultancy = RealAggregates.avgConsultancyValue();
  const avgListing = RealAggregates.avgListingValue();

  const cards = [
    { label: 'Settled Revenue YTD', value: fmtCompact(settled), foot: `of ${fmtCompact(settings.annualTarget)} target`, infoKey: 'ov-settled' },
    { label: 'Expected Open Pipeline', value: fmtCompact(expectedOpen), foot: `${active} active deals, full value`, infoKey: 'ov-open-pipeline' },
    { label: 'Weighted Pipeline', value: fmtCompact(weighted), foot: 'probability-adjusted', infoKey: 'ov-weighted' },
    { label: 'Active Deals', value: String(active), foot: `${RealAggregates.won().length} won · ${RealAggregates.lost().length} lost · ${RealAggregates.paused().length} paused`, infoKey: 'ov-active' },
    { label: 'New Prospects', value: String(newProspects), foot: 'this calendar month', infoKey: 'ov-new-prospects' },
    { label: 'Win Rate', value: fmtPct(winRate, 0), foot: `${RealAggregates.won().length} won of ${RealAggregates.won().length + RealAggregates.lost().length} decided`, infoKey: 'ov-win-rate' },
    { label: 'Avg. Consultancy Value', value: fmtCompact(avgConsultancy.avg), foot: `across ${avgConsultancy.count} advisory deals`, infoKey: 'ov-avg-consultancy' },
    { label: 'Avg. Listing Value', value: fmtCompact(avgListing.avg), foot: `across ${avgListing.count} brokerage deals`, infoKey: 'ov-avg-listing' },
  ];

  renderKpiCards('kpi-row', cards);
}

function renderActivityRow() {
  const a = RealAggregates.activitySummary(overviewPeriod);
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
  const flow = RealAggregates.commercialFlow(overviewPeriod);

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
  const rows = RealAggregates.byStage(overviewMetric);

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
   PIPELINE PAGE — REAL DATA (Supabase)
   Reads REAL_DEALS / RealAggregates. Paused deals still appear in the deals
   table (clearly flagged via the existing "Paused" outcome chip) but are
   excluded from the stage-flow totals above and from every other aggregate,
   per the non-negotiable Paused-exclusion rule.
   ============================================================================ */

let pipelineMetric = 'count';

function renderPipelinePage() {
  if (RealData.status === 'loading') {
    renderRealDataStatusPanel('view-pipeline');
    /* PIPELINE HANG FIX: Pipeline has no ECharts instance, but keep the same
       shape as Revenue's fix (see its comment) for consistency — only drop
       the renderedViews entry when we did NOT just render for real (view
       navigated away before the fetch resolved), so a future visit gets one
       clean render instead of silently doing nothing forever. */
    initRealData().then(() => {
      if (document.getElementById('view-pipeline').classList.contains('active')) renderPipelinePage();
      else renderedViews.delete('pipeline');
    });
    return;
  }
  if (renderRealDataStatusPanel('view-pipeline')) return;

  const root = document.getElementById('view-pipeline');
  root.innerHTML = `
    <div class="pipeline-toolbar">
      <div>
        <div class="panel-sub" style="font-size:13px;">Every stage of the Notion Deals database, coloured by phase (Paused excluded). Metric toggle changes what each stage reports.${infoIcon('pipeline-flow')}</div>
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
          <div class="panel-sub">${REAL_DEALS.length} deals · fixed order by Score, descending · click a row to open the deal detail${infoIcon('pipeline-score')}</div>
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
  const rows = RealAggregates.byStage(pipelineMetric);
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
  return [...REAL_DEALS].sort((a, b) => b.score - a.score);
}

function outcomeClass(outcome) {
  return { Won: 'won', Lost: 'lost', 'In Progress': 'in-progress', Paused: 'paused' }[outcome];
}

function renderDealsTable() {
  const highValueThreshold = getSettings().highValueDealThreshold;
  const tbody = document.getElementById('deals-tbody');
  tbody.innerHTML = sortedDeals().map(d => {
    const stage = getStage(d.stage) || { short: d.stageLabel, group: 'prospecting' };
    const meta = STAGE_GROUPS[stage.group];
    const rev = d.sdahcRevenue;
    const wtd = d.weightedRevenue;
    const highValueTag = d.transactionValue >= highValueThreshold ? '<span class="high-value-badge">High Value</span>' : '';
    const probText = d.probability == null ? '0%' : fmtPct(d.probability);
    const probWidth = d.probability == null ? 0 : d.probability * 100;
    return `
      <tr data-id="${d.id}" class="row-${outcomeClass(d.outcome)}">
        <td class="deal-name-cell">${d.name}${highValueTag}<span class="deal-entity">${d.entity || ''}</span></td>
        <td class="num-cell tabular score-cell">${d.score}</td>
        <td><span class="stage-chip" style="background:${hexToRgba(meta.color, 0.12)}; color:${meta.color}"><span class="dot" style="background:${meta.color}"></span>${stage.short}</span></td>
        <td>${d.owner || '.'}</td>
        <td><div class="type-tags">${d.dealType.map(t => `<span class="type-tag">${t}</span>`).join('') || '.'}</div></td>
        <td class="num-cell tabular">${fmtFull(d.transactionValue)}</td>
        <td class="num-cell tabular">${fmtFull(rev)}</td>
        <td class="num-cell"><div class="prob-cell" style="justify-content:flex-end;"><div class="prob-track"><div class="prob-fill" style="width:${probWidth}%"></div></div><span class="prob-num tabular">${probText}</span></div></td>
        <td class="num-cell tabular">${fmtFull(wtd)}</td>
        <td><span class="outcome-chip ${outcomeClass(d.outcome)}">${d.outcome}</span></td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', () => openRealDealDrawer(tr.dataset.id));
  });
}

/* Lightweight drawer for real deals — reuses the same #drawer DOM/close
   wiring as the mock openDrawer() (see initDrawer()), but only shows fields
   analytics.deals actually has. Stage history, organisations, properties,
   source and lost-reason aren't part of the current Notion sync, so unlike
   the mock drawer this doesn't attempt them. */
function openRealDealDrawer(id) {
  const deal = REAL_DEALS.find(d => d.id === id);
  if (!deal) return;
  const stage = getStage(deal.stage);
  const meta = STAGE_GROUPS[(stage && stage.group) || 'prospecting'];

  document.getElementById('drawer-stage-chip').innerHTML =
    `<span class="stage-chip" style="background:rgba(255,255,255,0.14); color:#fff"><span class="dot" style="background:${meta.color}"></span>${deal.stageLabel || (stage && stage.label) || '.'}</span>`;
  document.getElementById('drawer-name').textContent = deal.name;
  document.getElementById('drawer-entity').textContent = `${deal.entity || '.'} · ${deal.owner || '.'}`;

  let statusBlock = '';
  if (deal.isLost) {
    statusBlock = `<div class="drawer-section"><div class="drawer-section-label">Outcome</div><div class="drawer-section-text">Lost — reason isn't part of the current Notion sync.</div></div>`;
  } else if (deal.isWon) {
    statusBlock = `<div class="drawer-section"><div class="drawer-section-label">Settled</div><div class="drawer-section-text">${fmtDate(deal.closeDate)}</div></div>`;
  } else {
    statusBlock = `
      <div class="drawer-section">
        <div class="drawer-section-label">Next Action</div>
        <div class="drawer-section-text">${deal.nextAction || '.'}${deal.nextActionDate ? ' · ' + fmtDate(deal.nextActionDate) : ''}</div>
      </div>
      <div class="drawer-section">
        <div class="drawer-section-label">Days Stale</div>
        <div class="drawer-section-text">${deal.daysStale} day${deal.daysStale === 1 ? '' : 's'} since last activity</div>
      </div>
    `;
  }

  const trancheLines = [];
  if (deal.tranche1Status) trancheLines.push(`Tranche 1: ${fmtFull(deal.tranche1Amount)} · ${deal.tranche1Status}`);
  if (deal.tranche2Status) trancheLines.push(`Tranche 2: ${fmtFull(deal.tranche2Amount)} · ${deal.tranche2Status}`);
  /* Same reconciliation check as the Advisory Engagements grid card (see
     renderAdvisoryEngagementGrid()) — only meaningful once at least one
     tranche has real data, same qualifying rule as advisoryEngagements(). */
  const recon = (deal.advisoryFee > 0 && trancheLines.length)
    ? RealAggregates.advisoryTrancheReconciliation(deal) : null;
  if (recon) {
    trancheLines.push(recon.ok
      ? `✓ Tranches reconcile with the ${fmtFull(recon.total)} advisory fee.`
      : `⚠ Tranches sum to ${fmtFull(recon.sum)}, which doesn't match the ${fmtFull(recon.total)} advisory fee — check entry in Notion.`);
  }

  document.getElementById('drawer-body').innerHTML = `
    <div class="drawer-metric-row">
      <div class="drawer-metric"><div class="drawer-metric-label">Transaction Value</div><div class="drawer-metric-value tabular">${fmtFull(deal.transactionValue)}</div></div>
      <div class="drawer-metric"><div class="drawer-metric-label">Expected SDAHC Revenue</div><div class="drawer-metric-value tabular">${fmtFull(deal.sdahcRevenue)}</div></div>
      <div class="drawer-metric"><div class="drawer-metric-label">Probability</div><div class="drawer-metric-value tabular">${deal.probability == null ? '0%' : fmtPct(deal.probability)}</div></div>
      <div class="drawer-metric"><div class="drawer-metric-label">Weighted Revenue</div><div class="drawer-metric-value tabular">${fmtFull(deal.weightedRevenue)}</div></div>
    </div>

    ${deal.isPaused ? `<div class="drawer-section"><div class="drawer-section-label">Paused</div><div class="drawer-section-text">This deal is Paused and carries zero value in every pipeline/revenue total on this page.</div></div>` : ''}

    <div class="drawer-section">
      <div class="drawer-section-label">Deal Type</div>
      <div class="drawer-chip-list">${deal.dealType.length ? deal.dealType.map(t => `<span class="drawer-chip">${t}</span>`).join('') : '<span class="drawer-section-text">.</span>'}</div>
    </div>

    ${trancheLines.length ? `<div class="drawer-section"><div class="drawer-section-label">Advisory Tranches</div><div class="drawer-section-text">${trancheLines.join('<br/>')}</div></div>` : ''}

    ${statusBlock}

    <div class="drawer-section">
      <div class="drawer-section-label" style="opacity:.65">Live data note</div>
      <div class="drawer-section-text" style="opacity:.65">Stage history, organisations and properties aren't part of the current Notion sync, so they aren't shown here.</div>
    </div>
  `;

  document.getElementById('drawer').classList.add('open');
  document.getElementById('drawer-overlay').classList.add('open');
}

/* ============================================================================
   REVENUE PAGE — REAL DATA (Supabase)
   Reads REAL_DEALS / RealAggregates. Every KPI/chart here is fully supported
   by analytics.deals except Revenue Composition, which shows only Brokerage
   + Advisory (Conjunction/Referral aren't tracked in the real schema — see
   supabase-data.js).
   ============================================================================ */

let revenueTimeChartInstance = null;
let revenueSourceChartInstance = null;
let cumulativeChartInstance = null;

function renderRevenuePage() {
  if (RealData.status === 'loading') {
    renderRealDataStatusPanel('view-revenue');
    /* Only delete from renderedViews when we DIDN'T just do a real render
       (view navigated away before the fetch resolved) — that leaves this
       page's chart instance vars untouched (still null) so a future visit
       renders them for the first time. If we're still active, render now
       and leave the Set entry initNav() already added alone: deleting it
       here would make a later click call renderRevenuePage() a SECOND time
       with the chart vars now non-null, which reuses each ECharts instance
       against the freshly-rebuilt (so already-detached) old container
       instead of the new one — a blank chart. See the Pipeline hang fix
       above for the same bug in a different shape. */
    initRealData().then(() => {
      if (document.getElementById('view-revenue').classList.contains('active')) renderRevenuePage();
      else renderedViews.delete('revenue');
    });
    return;
  }
  if (renderRealDataStatusPanel('view-revenue')) return;

  const root = document.getElementById('view-revenue');
  root.innerHTML = `
    <div class="kpi-row kpi-row-7" id="revenue-kpi-row"></div>

    <div class="chart-grid section-gap">
      <div class="panel">
        <div class="panel-head">
          <div>
            <h3 class="panel-title">Revenue Over Time${infoIcon('rev-time-chart')}</h3>
            <div class="panel-sub">Actual settled vs. target vs. forecast · FY${fiscalYearLabel(TODAY)} · *Forecast month is simulated</div>
          </div>
        </div>
        <div class="chart-body"><div class="chart-canvas tall" id="revenue-time-chart"></div></div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div>
            <h3 class="panel-title">Revenue Composition${infoIcon('rev-source-chart')}</h3>
            <div class="panel-sub">By fee source · Won + active pipeline · Brokerage + Advisory only</div>
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

    <div class="panel section-gap">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">Forecast vs Actual (Cumulative)${infoIcon('rev-cumulative')}</h3>
          <div class="panel-sub">Business-plan pace · FY${fiscalYearLabel(TODAY)} · target split evenly across 12 months*</div>
        </div>
      </div>
      <div class="kpi-row kpi-row-3" id="cumulative-kpi-row" style="padding:0 24px 6px; margin-top:14px;"></div>
      <div class="chart-body"><div class="chart-canvas tall" id="cumulative-chart"></div></div>
    </div>
  `;

  renderRevenueKpiRow();
  renderRevenueTimeChart();
  renderRevenueSourceChart();
  renderConcentration();
  renderRevenueByStageList();
  renderCumulativeSection();
}

function renderRevenueKpiRow() {
  const t = RealAggregates.revenueTargetSummary();
  const openPipeline = RealAggregates.expectedOpenPipelineRevenue();
  const cards = [
    { label: 'Settled Revenue', value: fmtCompact(t.settled), foot: 'YTD, realised', infoKey: 'rev-settled' },
    { label: 'Unconditional Contracted', value: fmtCompact(t.unconditional), foot: 'Under Contract — ~99% certain', infoKey: 'rev-contracted-unconditional' },
    { label: 'Contracted (Conditional)', value: fmtCompact(t.conditional), foot: 'Contract Issued + committed tranches', infoKey: 'rev-contracted-conditional' },
    { label: 'Weighted Forecast', value: fmtCompact(t.weighted), foot: 'active pipeline, probability-adjusted', infoKey: 'rev-weighted-forecast' },
    { label: 'Open Revenue Pipeline', value: fmtCompact(openPipeline), foot: 'active pipeline, full value', infoKey: 'rev-open-pipeline' },
    { label: 'Revenue Target', value: fmtCompact(t.target), foot: `FY${fiscalYearLabel(TODAY)}`, infoKey: 'rev-target' },
    { label: 'Gap to Target', value: fmtCompact(t.gap), foot: t.onTrack ? 'on track — potential covers target' : `${fmtPct(t.totalPotential / t.target)} of target covered`, footClass: t.onTrack ? 'pos' : 'neg', infoKey: 'rev-gap' },
  ];
  renderKpiCards('revenue-kpi-row', cards);
}

function renderCumulativeSection() {
  renderCumulativeKpis();
  renderCumulativeChart();
}

function renderCumulativeKpis() {
  const c = RealAggregates.cumulativeForecastVsActual();
  const cards = [
    { label: 'Cumulative Actual', value: fmtCompact(c.actualToDate), foot: 'settled, FY to date', infoKey: 'rev-cumulative-actual' },
    { label: 'Cumulative Target', value: fmtCompact(c.targetToDate), foot: 'plan, FY to date', infoKey: 'rev-cumulative-target' },
    {
      label: 'Variance',
      value: `${c.variance >= 0 ? '+' : ''}${fmtCompact(c.variance)}`,
      foot: `${c.aheadOfPlan ? 'Ahead of plan' : 'Behind plan'} · ${c.variance >= 0 ? '+' : ''}${fmtPct(c.variancePct, 1)}`,
      footClass: c.aheadOfPlan ? 'pos' : 'neg',
      infoKey: 'rev-cumulative-variance',
    },
  ];
  renderKpiCards('cumulative-kpi-row', cards);
}

function renderCumulativeChart() {
  const el = document.getElementById('cumulative-chart');
  if (!cumulativeChartInstance) cumulativeChartInstance = echarts.init(el);
  const { rows } = RealAggregates.cumulativeForecastVsActual();

  cumulativeChartInstance.setOption({
    grid: { left: 8, right: 16, top: 38, bottom: 28, containLabel: true },
    legend: { top: 0, right: 0, textStyle: { fontSize: 11, color: '#6B7688', fontFamily: 'IBM Plex Sans' }, itemWidth: 14, itemHeight: 3 },
    tooltip: {
      trigger: 'axis',
      formatter: (params) => {
        const idx = params[0].dataIndex;
        const r = rows[idx];
        let lines = `<strong>${r.label} ${r.year}</strong><br/>Cumulative Target: ${fmtFull(r.cumTarget)}`;
        if (r.cumActual !== null) {
          const v = r.cumActual - r.cumTarget;
          lines += `<br/>Cumulative Actual: ${fmtFull(r.cumActual)}`;
          lines += `<br/>Variance: ${v >= 0 ? '+' : ''}${fmtFull(v)}`;
        }
        return lines;
      },
      backgroundColor: '#0A1E36', borderWidth: 0, textStyle: { color: '#fff', fontSize: 12 },
    },
    xAxis: {
      type: 'category', data: rows.map(r => r.label),
      axisLine: { lineStyle: { color: '#E3E8F0' } }, axisTick: { show: false },
      axisLabel: { color: '#6B7688', fontSize: 11, fontFamily: 'IBM Plex Sans' },
    },
    yAxis: {
      type: 'value', axisLabel: { formatter: (v) => fmtCompact(v), color: '#97A1B0', fontSize: 10.5 },
      splitLine: { lineStyle: { color: '#EDF0F6' } },
    },
    series: [
      {
        name: 'Cumulative Target*', type: 'line', data: rows.map(r => r.cumTarget),
        symbol: 'circle', symbolSize: 6, lineStyle: { color: '#E0A82E', width: 2.5, type: 'dashed' },
        itemStyle: { color: '#E0A82E' }, connectNulls: true,
      },
      {
        name: 'Cumulative Actual', type: 'line', data: rows.map(r => r.cumActual),
        symbol: 'circle', symbolSize: 6, lineStyle: { color: '#2FB37A', width: 3 },
        itemStyle: { color: '#2FB37A' },
        areaStyle: { color: 'rgba(47,179,122,0.10)' },
      },
    ],
  });
}

function renderRevenueTimeChart() {
  const el = document.getElementById('revenue-time-chart');
  if (!revenueTimeChartInstance) revenueTimeChartInstance = echarts.init(el);
  const months = RealAggregates.monthlyRevenueSeries();

  revenueTimeChartInstance.setOption({
    grid: { left: 8, right: 16, top: 38, bottom: 28, containLabel: true },
    legend: { top: 0, right: 0, textStyle: { fontSize: 11, color: '#6B7688', fontFamily: 'IBM Plex Sans' }, itemWidth: 12, itemHeight: 8 },
    tooltip: {
      trigger: 'axis',
      formatter: (params) => {
        const idx = params[0].dataIndex;
        const m = months[idx];
        let lines = `<strong>${m.label} ${m.year}</strong>`;
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
  const { totals, total } = RealAggregates.revenueBySource();
  const rows = [
    { name: 'Brokerage / Sale', value: totals.brokerage, color: '#0476D9' },
    { name: 'Paid Advisory', value: totals.advisory, color: '#7A5CC7' },
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
  const c = RealAggregates.revenueConcentration(3);
  const maxVal = c.top.length ? c.top[0].sdahcRevenue : 1;
  const rows = c.top.map((d, i) => {
    const rev = d.sdahcRevenue;
    const pct = c.total ? rev / c.total : 0;
    const stage = getStage(d.stage);
    return `
      <div class="concentration-row">
        <div class="concentration-rank">#${i + 1}</div>
        <div class="concentration-info">
          <div class="concentration-name">${d.name}</div>
          <div class="concentration-sub">${d.owner || '.'} · ${(stage && stage.short) || d.stageLabel}</div>
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
  const rows = RealAggregates.byStage('revenue').filter(r => r.count > 0);
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
   the Overview hero bar — Paid IS settled cash (green). WIP and Invoiced are
   BOTH the contracted, not-yet-cash state (blue) — a WIP tranche means the
   engagement is under a signed contract with work underway, so it's
   committed even though it isn't invoiced yet. Only "Not started" is still
   just pipeline (gray). */
const MILESTONE_STATUS_COLOR = { 'Not started': '#8592A6', WIP: '#0476D9', Invoiced: '#0476D9', Paid: '#2FB37A' };

function renderDeliveryPage() {
  /* Advisory (below) reads REAL_DEALS/RealAggregates — the same shared,
     single-fetch cache Overview/Pipeline/Revenue use, never a second fetch
     (see supabase-data.js). Brokerage stays 100% mock/DEALS and doesn't
     need this at all, but Delivery is a lazy page (rendered once, the first
     time its nav item opens — see LAZY_PAGE_RENDERERS) and reusing the same
     loading/error gate as the other real-data pages is what keeps this from
     ever landing in the same stuck-forever state Pipeline was in before its
     fix: without it, a visit that happens to land before the shared fetch
     resolves would render the Advisory section empty with nothing left to
     ever re-render it, since nothing else re-triggers a lazy page's first
     render. In practice the fetch already kicked off when the dashboard
     booted, several clicks before a user can reach Delivery, so this branch
     essentially never shows — it's here for correctness, not because it's
     expected to fire. */
  if (RealData.status === 'loading') {
    renderRealDataStatusPanel('view-delivery');
    initRealData().then(() => {
      if (document.getElementById('view-delivery').classList.contains('active')) renderDeliveryPage();
      else renderedViews.delete('delivery');
    });
    return;
  }
  if (renderRealDataStatusPanel('view-delivery')) return;

  const root = document.getElementById('view-delivery');
  root.innerHTML = `
    <div class="delivery-subtitle">Engagements, milestones &amp; revenue unlock</div>

    <div class="panel-sub" style="font-size:13px; margin-bottom:6px;"><span class="scope-tag real">Real — Supabase</span> Advisory engagements below are sourced live from analytics.deals' tranche fields — see the Assumptions Register.</div>
    <div class="kpi-row kpi-row-4" id="advisory-kpi-row"></div>

    <div class="panel section-gap">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">Advisory Engagements <span class="scope-tag real">Real</span>${infoIcon('del-advisory-real')}</h3>
          <div class="panel-sub">Every deal with a real advisory fee and at least one tranche field loaded in Notion · Paused deals shown, zero-weighted · click a card for full deal detail</div>
        </div>
      </div>
      <div class="chart-body" style="padding:8px 20px 22px;"><div class="engagement-grid" id="advisory-engagement-grid"></div></div>
    </div>

    <div class="panel-sub" style="font-size:13px; margin:28px 0 6px;"><span class="scope-tag dashboard">Illustrative / Mock</span> Everything below (Brokerage engagements, Milestone Timeline, Delivery Insights) is dashboard-owned modelling — Notion has no deliverables/milestone/health data for brokerage deals yet. See ASSUMPTIONS 'delivery-milestone-model'.</div>
    <div class="kpi-row" id="delivery-kpi-row"></div>

    <div class="panel section-gap">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">Brokerage Engagements <span class="scope-tag dashboard">Mock</span></h3>
          <div class="panel-sub">Derived from the Brokerage deals already in the pipeline, with a modelled deliverable/milestone structure · click a card for full delivery detail</div>
        </div>
      </div>
      <div class="chart-body" style="padding:8px 20px 22px;"><div class="engagement-grid" id="engagement-grid"></div></div>
    </div>

    <div class="panel section-gap">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">Milestone Timeline${infoIcon('del-timeline')}</h3>
          <div class="panel-sub">Every billing milestone across Brokerage engagements, by due date · mock, see above</div>
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
          <div class="panel-sub"><span class="ai-badge">✦ Simulated AI — prototype</span> Hardcoded insights computed live from this page's (Brokerage) data — no model is called.</div>
        </div>
      </div>
      <div class="chart-body" style="padding:8px 20px 22px;"><div class="ai-card-list" id="delivery-ai-list"></div></div>
    </div>

    <div class="revenue-recognition-note">
      <strong>Invoiced ≠ paid.</strong> A tranche marked "Invoiced" is committed, high-confidence revenue (the same status this page treats as Contracted) — it is not yet cash. Only "Paid" tranches are cash (Settled). Whether revenue is recognised on a milestone basis or a % -of-completion basis is a finance decision, not asserted here — confirm treatment with finance before reporting externally. Applies to both sections above. See the Assumptions Register.
    </div>
  `;

  renderAdvisoryKpis();
  renderAdvisoryEngagementGrid();
  renderDeliveryKpis();
  renderEngagementGrid();
  renderDeliveryTimeline();
  renderDeliveryAi();
}

/* ADVISORY (REAL) — reads RealAggregates from supabase-data.js, same shared
   REAL_DEALS cache as Overview/Pipeline/Revenue, never a second fetch. See
   RealAggregates.advisoryDeliveryKpis()/advisoryEngagements() for the
   qualifying rule and the Locked/Unlocked mapping. */
function renderAdvisoryKpis() {
  const k = RealAggregates.advisoryDeliveryKpis();
  const cards = [
    { label: 'Advisory Settled', value: fmtCompact(k.settledRevenue), foot: 'Paid tranches', infoKey: 'del-advisory-real' },
    { label: 'Advisory Contracted', value: fmtCompact(k.contractedRevenue), foot: 'WIP + Invoiced tranches', infoKey: 'del-advisory-real' },
    { label: 'Advisory Locked', value: fmtCompact(k.lockedRevenue), foot: 'Not started — not yet committed', infoKey: 'del-advisory-real' },
    { label: 'Active Engagements', value: String(k.activeEngagements), foot: 'real advisory deals, Paused excluded', infoKey: 'del-advisory-real' },
  ];
  renderKpiCards('advisory-kpi-row', cards);
}

function renderAdvisoryEngagementGrid() {
  const engagements = RealAggregates.advisoryEngagements();
  document.getElementById('advisory-engagement-grid').innerHTML = engagements.map(d => {
    const stage = getStage(d.stage) || { short: d.stageLabel, group: 'prospecting' };
    const meta = STAGE_GROUPS[stage.group];
    const locked = RealAggregates.advisoryEngagementLocked(d);
    const unlocked = RealAggregates.advisoryEngagementUnlocked(d);
    const total = locked + unlocked;
    const recon = RealAggregates.advisoryTrancheReconciliation(d);
    const t1 = d.tranche1Status != null ? `${fmtFull(d.tranche1Amount)} · ${d.tranche1Status}` : 'Not set';
    const t2 = d.tranche2Status != null ? `${fmtFull(d.tranche2Amount)} · ${d.tranche2Status}` : 'Not set';

    return `
      <div class="engagement-card" data-id="${d.id}">
        <div class="engagement-card-top">
          <div>
            <div class="engagement-card-name">${d.name}</div>
            <span class="stage-chip" style="background:${hexToRgba(meta.color, 0.12)}; color:${meta.color}"><span class="dot" style="background:${meta.color}"></span>${stage.short}</span>
          </div>
          ${d.isPaused ? '<span class="paused-tag">Paused</span>' : '<span class="scope-tag real">Real</span>'}
        </div>

        <div class="engagement-split-track">
          <div class="engagement-split-locked" style="width:${total ? (locked / total) * 100 : 0}%"></div>
          <div class="engagement-split-unlocked" style="width:${total ? (unlocked / total) * 100 : 0}%"></div>
        </div>
        <div class="engagement-split-legend">
          <span><span class="dot locked"></span>Locked <strong class="tabular">${fmtCompact(locked)}</strong></span>
          <span><span class="dot unlocked"></span>Unlocked <strong class="tabular">${fmtCompact(unlocked)}</strong></span>
        </div>

        <div class="real-tranche-lines">
          <div class="real-tranche-line"><span>Tranche 1</span><span class="tabular">${t1}</span></div>
          <div class="real-tranche-line"><span>Tranche 2</span><span class="tabular">${t2}</span></div>
          <div class="real-tranche-line"><span>Advisory Fee</span><span class="tabular">${fmtFull(d.advisoryFee)}</span></div>
        </div>
        <div class="tranche-recon ${recon.ok ? 'ok' : 'mismatch'}">${recon.ok ? '✓ Tranches reconcile with advisory fee' : '⚠ Tranches don’t match advisory fee total'}</div>
      </div>
    `;
  }).join('');

  document.querySelectorAll('#advisory-engagement-grid .engagement-card').forEach(card => {
    card.addEventListener('click', () => openRealDealDrawer(card.dataset.id));
  });
}

function renderDeliveryKpis() {
  const k = Aggregates.deliveryKpis();
  const { end: qEnd } = quarterBounds(TODAY);
  const nm = k.nextMilestone;
  const cards = [
    { label: 'Locked Revenue', value: fmtCompact(k.lockedRevenue), foot: 'Not started — not yet committed', infoKey: 'del-locked' },
    { label: 'Unlockable This Quarter', value: fmtCompact(k.unlockableThisQuarter), foot: `due by ${fmtDateObj(qEnd)}`, infoKey: 'del-unlockable' },
    { label: 'Revenue At Risk', value: fmtCompact(k.revenueAtRisk), foot: 'locked milestones on at-risk engagements', footClass: k.revenueAtRisk > 0 ? 'neg' : 'pos', infoKey: 'del-at-risk' },
    { label: 'Active Engagements', value: String(k.activeEngagements), foot: 'brokerage engagements (mock)', infoKey: 'del-active-engagements' },
    { label: 'Next Milestone', value: nm ? fmtCompact(nm.milestone.amount) : '$0', foot: nm ? `${fmtDate(nm.milestone.dueDate)} · ${nm.deal.name}` : 'none scheduled', infoKey: 'del-next-milestone' },
  ];
  renderKpiCards('delivery-kpi-row', cards);
}

function healthBadgeClass(health) {
  return 'health-' + health.toLowerCase().replace(/\s+/g, '-');
}

function renderEngagementGrid() {
  const engagements = Aggregates.brokerageEngagements();
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
  const engagementNames = Aggregates.brokerageEngagements().map(d => d.name);
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
   payment schedule, tranche reconciliation — never has to branch inside the
   existing openDrawer() used by the other 8 pages. */

function openEngagementDrawer(id) {
  const deal = DEALS.find(d => d.id === id);
  if (!deal || !Aggregates.brokerageEngagements().includes(deal)) return;
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

  /* Soft note only — NOT a modelled dependency or estimate. Steve confirmed
     brokerage is not formally gated on advisory completing. */
  const gatingHtml = deal.advisoryToBrokerageNote ? `
    <div class="drawer-note">${deal.advisoryToBrokerageNote}</div>
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

/* 9 entries, 1:1 with FUNNEL_TIERS (data.js) — no "Market / Relationships"
   entry: that estimate row is gone from the real funnel (see
   RealAggregates.funnelStages() in supabase-data.js). */
const FUNNEL_TIER_COLORS = [
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
  /* Conversion Funnel / Stage Conversion (below) read REAL_DEALS/
     RealAggregates — the same shared, single-fetch cache Overview/Pipeline/
     Revenue/Delivery use, never a second fetch. Sales Funnel is a lazy page
     (LAZY_PAGE_RENDERERS), so this gate exists for the same reason Delivery's
     does — see that page's render function for the full rationale; in
     practice the shared fetch has almost always already resolved by the
     time a user reaches this page. */
  if (RealData.status === 'loading') {
    renderRealDataStatusPanel('view-funnel');
    initRealData().then(() => {
      if (document.getElementById('view-funnel').classList.contains('active')) renderFunnelPage();
      else renderedViews.delete('funnel');
    });
    return;
  }
  if (renderRealDataStatusPanel('view-funnel')) return;

  const root = document.getElementById('view-funnel');
  root.innerHTML = `
    <div class="panel-sub" style="font-size:13px; margin-bottom:6px;"><span class="scope-tag real">Real — Supabase</span> Stage counts and conversion below are computed live from analytics.deals — see the Assumptions Register.</div>
    <div class="chart-grid" style="grid-template-columns: 1fr 1.05fr;">
      <div class="panel">
        <div class="panel-head">
          <div>
            <h3 class="panel-title">Conversion Funnel <span class="scope-tag real">Real</span>${infoIcon('funnel-chart')}</h3>
            <div class="panel-sub">Prospect through to Settlement · real deal counts, Paused excluded</div>
          </div>
        </div>
        <div class="chart-body"><div class="chart-canvas" id="funnel-chart" style="height:430px;"></div></div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div><h3 class="panel-title">Stage Conversion <span class="scope-tag real">Real</span>${infoIcon('funnel-table')}</h3><div class="panel-sub">Conversion and drop-off between each stage</div></div>
        </div>
        <div id="funnel-table-body" style="padding:8px 24px 20px;"></div>
      </div>
    </div>

    <div class="panel-sub" style="font-size:13px; margin:28px 0 6px;"><span class="scope-tag dashboard">Illustrative / Mock</span> Everything below has no source field in the real Notion data today — see ASSUMPTIONS 'prospect-source-mock'.</div>

    <div class="panel section-gap">
      <div class="panel-head">
        <div><h3 class="panel-title">New vs. Lost Prospects <span class="scope-tag dashboard">Mock</span>${infoIcon('prospects-chart')}</h3><div class="panel-sub">Trailing 14 months · created vs. lost, by month</div></div>
      </div>
      <div class="chart-body"><div class="chart-canvas" id="prospects-chart"></div></div>
    </div>

    <div class="chart-grid section-gap">
      <div class="panel">
        <div class="panel-head">
          <div><h3 class="panel-title">Relationship-Led vs Marketing-Sourced <span class="scope-tag dashboard">Mock</span>${infoIcon('source-groups')}</h3><div class="panel-sub">Volume and qualification rate by channel</div></div>
        </div>
        <div id="source-group-body" style="padding:18px 24px 22px;"></div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div><h3 class="panel-title">Prospect Sources <span class="scope-tag dashboard">Mock</span>${infoIcon('source-detail')}</h3><div class="panel-sub">Individual channel performance</div></div>
        </div>
        <div id="source-detail-body" style="padding:6px 24px 18px;"></div>
      </div>
    </div>

    <div class="panel section-gap">
      <div class="panel-head">
        <div><h3 class="panel-title">Cohort Conversion by Quarter <span class="scope-tag dashboard">Mock</span>${infoIcon('cohort-table')}</h3><div class="panel-sub">Ultimate win rate of deals created each quarter · recent cohorts still undecided</div></div>
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

/* Advisory Proposal onward is click-through (see openFunnelTierModal()) —
   Prospects and Qualified Opportunities are too broad/early to be a useful
   "who are these deals" list and stay non-interactive. Checked by position
   in FUNNEL_TIERS (data.js), not a hardcoded index, so reordering that array
   can't silently shift the clickable boundary. */
function isFunnelTierClickable(tierKey) {
  const from = FUNNEL_TIERS.findIndex(t => t.key === 'advisoryProposal');
  const idx = FUNNEL_TIERS.findIndex(t => t.key === tierKey);
  return idx >= from;
}

function renderFunnelChart() {
  const el = document.getElementById('funnel-chart');
  if (!funnelChartInstance) funnelChartInstance = echarts.init(el);
  const rows = RealAggregates.funnelStages();
  const maxVal = rows[0].count;

  funnelChartInstance.setOption({
    tooltip: {
      trigger: 'item',
      formatter: (p) => {
        const row = rows[p.dataIndex];
        let s = `<strong>${row.label}</strong><br/>${row.count} deals`;
        if (row.conversionFromPrevious !== null) s += `<br/>Converted from previous stage: ${fmtPct(row.conversionFromPrevious)}`;
        if (isFunnelTierClickable(row.key)) s += `<br/><span style="color:#94A3B8">Click to see the deals</span>`;
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
        name: r.label,
        itemStyle: { color: FUNNEL_TIER_COLORS[i] },
        cursor: isFunnelTierClickable(r.key) ? 'pointer' : 'default',
      })),
    }],
  });

  funnelChartInstance.off('click');
  funnelChartInstance.on('click', (params) => {
    const row = rows[params.dataIndex];
    if (row && isFunnelTierClickable(row.key)) openFunnelTierModal(row.key);
  });
}

function renderFunnelTable() {
  const rows = RealAggregates.funnelStages();
  const head = `<div class="funnel-table-head"><div>Stage</div><div style="text-align:right">Count</div><div style="text-align:right">Converted</div><div style="text-align:right">Dropped</div></div>`;
  const list = rows.map((r, i) => {
    const clickable = isFunnelTierClickable(r.key);
    return `
    <div class="funnel-row${clickable ? ' clickable' : ''}"${clickable ? ` data-tier-key="${r.key}"` : ''}>
      <div class="funnel-row-label"><span class="dot" style="background:${FUNNEL_TIER_COLORS[i]}"></span>${r.label}</div>
      <div class="funnel-row-count tabular">${r.count}</div>
      <div class="funnel-row-conv tabular">${r.conversionFromPrevious === null ? '0%' : fmtPct(r.conversionFromPrevious)}</div>
      <div class="funnel-row-drop tabular">${r.dropoffFromPrevious === null ? '0%' : fmtPct(r.dropoffFromPrevious)}</div>
    </div>
  `;
  }).join('');
  document.getElementById('funnel-table-body').innerHTML = head + list;

  document.querySelectorAll('#funnel-table-body .funnel-row.clickable').forEach(row => {
    row.addEventListener('click', () => openFunnelTierModal(row.dataset.tierKey));
  });
}

/* ---------------------- SALES FUNNEL — TIER DEAL LIST MODAL ----------------
   Reuses the same generic .modal-overlay/.modal markup/CSS as the
   Assumptions Register modal (a separate DOM instance, not the same one —
   see index.html) rather than inventing a new component. Lists just the
   deal NAMES for one funnel tier, using the exact `deals` array
   RealAggregates.funnelStages() already filtered for that tier's own count
   — the list length always matches the tier's displayed number by
   construction, never a second, potentially-diverging computation. Each
   name opens the existing real deal drawer (openRealDealDrawer) — this
   modal closes first, since the drawer and this modal would otherwise stack
   (the drawer sits at a lower z-index, meant to layer under the topbar/
   popovers, not under another modal's dimmed overlay). */
function openFunnelTierModal(tierKey) {
  const rows = RealAggregates.funnelStages();
  const row = rows.find(r => r.key === tierKey);
  if (!row || !isFunnelTierClickable(tierKey)) return;

  document.getElementById('funnel-tier-modal-title').textContent = row.label;
  document.getElementById('funnel-tier-modal-sub').textContent =
    `${row.count} deal${row.count === 1 ? '' : 's'} that reached this stage or later · Paused excluded`;

  const sorted = [...row.deals].sort((a, b) => a.name.localeCompare(b.name));
  document.getElementById('funnel-tier-modal-body').innerHTML = sorted.length
    ? `<div class="funnel-tier-deal-list">${sorted.map(d => `<button class="funnel-tier-deal-item" data-id="${d.id}">${d.name}</button>`).join('')}</div>`
    : `<div class="panel-sub">No deals currently qualify for this tier.</div>`;

  document.querySelectorAll('#funnel-tier-modal-body .funnel-tier-deal-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      closeFunnelTierModal();
      openRealDealDrawer(id);
    });
  });

  document.getElementById('funnel-tier-overlay').classList.add('open');
}
function closeFunnelTierModal() {
  document.getElementById('funnel-tier-overlay').classList.remove('open');
}
function initFunnelTierModal() {
  document.getElementById('funnel-tier-close').addEventListener('click', closeFunnelTierModal);
  document.getElementById('funnel-tier-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'funnel-tier-overlay') closeFunnelTierModal();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFunnelTierModal(); });
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
   The mock version of this drawer (DEALS-based, with stage journey/
   organisations/properties/source/lost-reason) is gone — its only caller was
   the Pipeline table, which is real-data-only now. See openRealDealDrawer()
   in the PIPELINE PAGE section above. This just wires open/close for the
   shared #drawer DOM, whichever render function fills its body.
   ============================================================================ */

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
const ASSUMPTION_PAGE_ORDER = ['Overview', 'Pipeline', 'Revenue', 'Delivery', 'Sales Funnel', 'SDA Report', 'Marketing', 'Market Intelligence', 'Playbook', 'Settings'];

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
        <div class="funnel-row-conv tabular">${s.conversionFromPrevious === null ? '0%' : fmtPct(s.conversionFromPrevious)}</div>
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
    { label: 'Return Multiple', value: roi.returnMultiple === null ? '0x' : roi.returnMultiple.toFixed(2) + 'x', foot: 'Settled Revenue ÷ Cost' },
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
   MARKETING PAGE
   Early scaffold for a future second origination channel — mostly structure
   with mock data, clearly flagged (see ASSUMPTIONS 'marketing-spend',
   'marketing-electronic-distribution'). Section 2 deliberately summarises
   and links to SDA Report's PRINTED inventory rather than recomputing it —
   only the electronic side (sent, website downloads, the Opened/Engaged
   funnel) is new here.
   ============================================================================ */

let marketingSpendChartInstance = null;

const MARKETING_SPEND_COLORS = {
  'Travel': '#E0A82E', 'Events': '#7A5CC7', 'Report Print/Production': '#14A8A0',
  'Digital': '#0476D9', 'Other': '#8592A6',
};

function renderMarketingPage() {
  const root = document.getElementById('view-marketing');
  root.innerHTML = `
    <div class="revenue-recognition-note" style="margin-top:0; margin-bottom:22px;">
      <strong>Marketing is an emerging area.</strong> This page is an early scaffold for a future second origination channel (alongside Steve's relationship network) — structure and mock data only, to be built out post-integration once real spend and distribution data exists. Every figure below is dashboard-owned or simulated; none of it is sourced from Notion. See the Assumptions Register for exactly which.
    </div>

    <div class="panel">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">Marketing Spend (Annual)${infoIcon('mkt-spend')}</h3>
          <div class="panel-sub">Dominated by relationship-building travel and events · <span class="scope-tag dashboard">Dashboard-owned</span> · not tracked in Notion</div>
        </div>
      </div>
      <div class="kpi-row kpi-row-3" id="marketing-spend-kpi-row" style="padding:0 24px 6px; margin-top:14px;"></div>
      <div class="chart-body" style="padding-bottom:20px;">
        <div class="chart-canvas" id="marketing-spend-chart" style="height:230px;"></div>
        <div class="legend-list" id="marketing-spend-legend"></div>
      </div>
    </div>

    <div class="panel section-gap">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">SDA Report — Electronic Distribution &amp; ROI${infoIcon('mkt-electronic')}</h3>
          <div class="panel-sub">Complements the SDA Report page's printed inventory · electronic side only, simulated</div>
        </div>
      </div>
      <div id="marketing-printed-summary" style="padding:16px 24px 4px;"></div>
      <div class="kpi-row kpi-row-3" id="marketing-electronic-kpi-row" style="padding:0 24px 6px; margin-top:14px;"></div>
      <div class="chart-grid" style="grid-template-columns: 1.2fr 1fr; padding:20px 24px 24px;">
        <div>
          <div class="panel-sub" style="font-weight:600; color:var(--ink-soft); margin-bottom:8px;">Electronic Funnel</div>
          <div id="marketing-electronic-funnel"></div>
        </div>
        <div>
          <div class="panel-sub" style="font-weight:600; color:var(--ink-soft); margin-bottom:8px;">Sent By Audience *</div>
          <div class="legend-list" id="marketing-audience-legend"></div>
        </div>
      </div>
    </div>
  `;

  renderMarketingSpend();
  renderMarketingElectronic();
}

function renderMarketingSpend() {
  const spend = Aggregates.marketingSpendBreakdown();
  const travelEvents = spend.rows.filter(r => r.label === 'Travel' || r.label === 'Events').reduce((s, r) => s + r.value, 0);

  const cards = [
    { label: 'Total Annual Spend', value: fmtCompact(spend.total), foot: 'across 5 categories', infoKey: 'mkt-spend-total' },
    { label: 'Largest Category', value: spend.largest.label, foot: `${fmtCompact(spend.largest.value)} · ${fmtPct(spend.largestPct)} of total`, infoKey: 'mkt-spend-largest' },
    { label: 'Travel + Events Share', value: fmtPct(spend.total ? travelEvents / spend.total : 0), foot: `${fmtCompact(travelEvents)} of ${fmtCompact(spend.total)}`, infoKey: 'mkt-spend-travel' },
  ];
  renderKpiCards('marketing-spend-kpi-row', cards);

  const el = document.getElementById('marketing-spend-chart');
  if (!marketingSpendChartInstance) marketingSpendChartInstance = echarts.init(el);
  marketingSpendChartInstance.setOption({
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
      data: spend.rows.map(r => ({ name: r.label, value: r.value, itemStyle: { color: MARKETING_SPEND_COLORS[r.label] } })),
    }],
  });

  document.getElementById('marketing-spend-legend').innerHTML = spend.rows.map(r => `
    <div class="legend-row">
      <div class="legend-left"><span class="legend-dot" style="background:${MARKETING_SPEND_COLORS[r.label]}"></span>${r.label}${r.label === 'Report Print/Production' ? ' <span class="scope-tag real" style="margin-left:4px;">from SDA Report</span>' : ''}</div>
      <div><span class="legend-amount tabular">${fmtCompact(r.value)}</span><span class="legend-pct tabular">${fmtPct(spend.total ? r.value / spend.total : 0)}</span></div>
    </div>
  `).join('');
}

function renderMarketingElectronic() {
  const inv = Aggregates.sdaReportInventory();
  document.getElementById('marketing-printed-summary').innerHTML = `
    <div class="channel-compare" style="grid-template-columns: repeat(3, 1fr);">
      <div class="channel-card">
        <div class="channel-card-label" style="color:var(--ink-mute);">Printed</div>
        <div class="channel-card-value tabular">${inv.printed}</div>
        <div class="channel-card-sub">reports · <span class="scope-tag real">Real, from SDA Report</span></div>
      </div>
      <div class="channel-card">
        <div class="channel-card-label" style="color:var(--ink-mute);">Delivered</div>
        <div class="channel-card-value tabular">${inv.delivered}</div>
        <div class="channel-card-sub">of ${inv.printed} printed</div>
      </div>
      <div class="channel-card">
        <div class="channel-card-label" style="color:var(--ink-mute);">Available</div>
        <div class="channel-card-value tabular">${inv.available}</div>
        <div class="channel-card-sub">still to distribute</div>
      </div>
    </div>
    <a href="#" class="notion-link" id="marketing-open-sda-report" style="background:var(--bg-inset); color:var(--ink-soft); margin-top:14px;">
      Full printed inventory on SDA Report →
    </a>
  `;
  document.getElementById('marketing-open-sda-report').addEventListener('click', (e) => {
    e.preventDefault();
    document.querySelector('.nav-item[data-view="sda-report"]').click();
  });

  const funnel = Aggregates.marketingElectronicFunnel();
  const cost = Aggregates.marketingElectronicCost();
  const cards = [
    { label: 'Electronic Sent', value: String(funnel.sent), foot: 'emailed copies *', infoKey: 'mkt-electronic-sent' },
    { label: 'Website Downloads', value: String(funnel.websiteDownloads), foot: 'from sdahc.com.au *', infoKey: 'mkt-electronic-downloads' },
    { label: 'Cost per Engaged Contact', value: cost.engaged ? '$' + cost.costPerEngaged.toFixed(2) : '$0', foot: `Digital spend ÷ ${cost.engaged} engaged`, infoKey: 'mkt-electronic-cost' },
  ];
  renderKpiCards('marketing-electronic-kpi-row', cards);

  const funnelHead = `<div class="funnel-table-head"><div>Stage</div><div style="text-align:right">Count</div><div style="text-align:right">Converted</div><div style="text-align:right">Source</div></div>`;
  const funnelStages = [
    { label: 'Electronic Sent', count: funnel.sent, isReal: true },
    { label: 'Opened / Downloaded', count: funnel.openedOrDownloaded, isReal: false },
    { label: 'Engaged', count: funnel.engaged, isReal: false },
  ];
  const funnelRows = funnelStages.map((s, i) => {
    const conv = i === 0 ? null : (funnelStages[i - 1].count === 0 ? 0 : s.count / funnelStages[i - 1].count);
    return `
      <div class="funnel-row">
        <div class="funnel-row-label">${s.label}</div>
        <div class="funnel-row-count tabular">${s.count}</div>
        <div class="funnel-row-conv tabular">${conv === null ? '0%' : fmtPct(conv)}</div>
        <div style="text-align:right;"><span class="scope-tag ${s.isReal ? 'real' : 'dashboard'}">${s.isReal ? 'Dashboard input' : 'Simulated'}</span></div>
      </div>
    `;
  }).join('');
  document.getElementById('marketing-electronic-funnel').innerHTML = funnelHead + funnelRows;

  const audienceTotal = funnel.sentByAudience.reduce((s, a) => s + a.value, 0);
  document.getElementById('marketing-audience-legend').innerHTML = funnel.sentByAudience.map((a, i) => `
    <div class="legend-row">
      <div class="legend-left"><span class="legend-dot" style="background:${['#0476D9', '#14A8A0', '#7A5CC7', '#8592A6'][i % 4]}"></span>${a.label}</div>
      <div><span class="legend-amount tabular">${a.value}</span><span class="legend-pct tabular">${fmtPct(audienceTotal ? a.value / audienceTotal : 0)}</span></div>
    </div>
  `).join('');
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
   AUTH GATE
   The whole app is gated behind a Supabase session (Sign in with Microsoft —
   Azure OAuth via supabase-data.js). bootDashboard() — everything the app used
   to do unconditionally at DOMContentLoaded, including the one real-data
   fetch — now runs only once a session is confirmed. See supabase-data.js's
   AUTH section for why the app relies on BOTH an initial getCurrentSession()
   call and an onAuthChange() subscription (not just one or the other), and
   for the RLS note on what actually secures analytics.deals — this gate
   controls what the UI SHOWS, not who the database allows to read it.
   ============================================================================ */

let dashboardBooted = false;

function showDashboard(session) {
  document.getElementById('login-screen').hidden = true;
  document.getElementById('app-shell').hidden = false;
  const email = session.user.email || session.user.user_metadata?.preferred_username || session.user.user_metadata?.name || 'Signed in';
  document.getElementById('user-email').textContent = email;
  document.getElementById('user-avatar').textContent = email.charAt(0).toUpperCase();
}

/* Everything below used to run unconditionally at DOMContentLoaded — moved
   here verbatim, unchanged, just gated behind a session and guarded so it
   only ever runs ONCE per page load (a token refresh or a second tab-visible
   auth event must never re-attach initNav()'s click listeners a second time,
   or re-init an ECharts instance against a container it's already bound to —
   see the Pipeline/Overview hang fixes elsewhere in this file for exactly
   that failure shape). */
function bootDashboard() {
  if (dashboardBooted) return;
  dashboardBooted = true;

  initSettings();
  initNav();
  initSyncStatus();
  initDrawer();
  initEngagementDrawer();
  initAssumptionsModal();
  initFunnelTierModal();
  initInfoIcons();

  // Overview is the only real-data page rendered here — it's the default
  // active view, so it needs to show *something* (its own loading
  // placeholder, then itself again once ready) before any nav click ever
  // fires. This mirrors exactly what initNav()'s click handler does for
  // every lazy page (call the renderer, then mark it in renderedViews), so
  // Overview's own "re-render once data arrives, only if still active"
  // callback plays by the same rules as Pipeline/Revenue's. Do NOT also
  // chain a re-render here — a second .then() on the same initRealData()
  // promise double-renders Overview, leaving the first ECharts instance
  // bound to a now-detached container while the visible (second) container
  // stays empty. Pipeline and Revenue are NOT called here: they're lazy
  // (see LAZY_PAGE_RENDERERS) and render themselves the first time their
  // nav item is opened.
  //
  // initRealData() below kicks off the ONE Supabase fetch for the whole
  // session immediately (now that we know a session exists) — by the time
  // the user clicks Pipeline or Revenue, REAL_DEALS is very likely already
  // populated (from this call, not a fresh one), so those pages render
  // synchronously from cache with no visible spinner. See supabase-data.js:
  // fetchRealDeals() only ever runs once per session (realDataPromise memoizes it).
  renderOverview();
  renderedViews.add('overview');
  initRealData();

  window.addEventListener('resize', () => {
    [waterfallChartInstance, pipelineChartInstance, revenueTimeChartInstance, revenueSourceChartInstance, cumulativeChartInstance, deliveryTimelineChartInstance, funnelChartInstance, prospectsChartInstance, marketingSpendChartInstance, ...sdaDistChartInstances, ...gaugeChartInstances]
      .forEach(c => c && c.resize());
  });
}

function initAuthGate() {
  const statusText = document.getElementById('login-status-text');
  const signInBtn = document.getElementById('login-microsoft-btn');
  const errorBox = document.getElementById('login-error');

  signInBtn.addEventListener('click', async () => {
    errorBox.hidden = true;
    signInBtn.disabled = true;
    statusText.textContent = 'Redirecting to Microsoft…';
    try {
      const { error } = await signInWithMicrosoft();
      if (error) throw error;
      // Success navigates the browser away to Microsoft's login page — there
      // is nothing left to do here. The redirect back to this same origin is
      // what the onAuthChange() listener below picks up.
    } catch (err) {
      signInBtn.disabled = false;
      statusText.textContent = 'Sign in to continue';
      errorBox.textContent = err.message || 'Sign-in failed — please try again.';
      errorBox.hidden = false;
    }
  });

  document.getElementById('sign-out-btn').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    await signOutUser();
    // No manual UI reset here — the SIGNED_OUT event this fires reaches the
    // onAuthChange() listener below, which reloads. See that handler's
    // comment for why a reload, not a soft reset back to the login screen.
  });

  /* Called both from the onAuthChange() subscription below (on every future
     sign-in/out/token-refresh) and once directly from getCurrentSession() —
     session is the real session object, or null. */
  const onAuthEvent = (session) => {
    if (session) {
      showDashboard(session);
      bootDashboard();
    } else if (dashboardBooted) {
      // The session disappeared AFTER the dashboard was already up — either
      // the sign-out button above, or an externally invalidated/expired
      // session. Reload rather than hand-rolling a teardown of
      // bootDashboard()'s listeners and chart instances: a fresh page load
      // re-runs this whole gate from a clean slate and correctly lands on
      // the login screen once getCurrentSession() resolves null.
      location.reload();
    } else {
      // Definitive "no session" with nothing booted yet — reveal the actual
      // sign-in button (until now the screen just says "Checking session…",
      // so a visitor who already has a valid session never sees this flash).
      statusText.textContent = 'Sign in to continue';
      signInBtn.hidden = false;
    }
  };

  try {
    onAuthChange(onAuthEvent);
    getCurrentSession().then(({ data: { session } }) => onAuthEvent(session));
  } catch (err) {
    statusText.textContent = 'Sign in to continue';
    errorBox.textContent = err.message || 'Could not reach Supabase Auth — check the browser console.';
    errorBox.hidden = false;
  }
}

/* ============================================================================
   INIT
   ============================================================================ */

window.addEventListener('DOMContentLoaded', initAuthGate);
