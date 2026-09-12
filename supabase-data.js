/* ============================================================================
   SDAHC INTELLIGENCE — REAL DATA LAYER (Supabase)
   ----------------------------------------------------------------------------
   Overview, Pipeline and Revenue read through REAL_DEALS / RealAggregates
   here instead of data.js's mock DEALS / Aggregates. Every other page
   (Delivery, Sales Funnel, SDA Report, Marketing, Market Intelligence,
   Playbook, Settings) is untouched and keeps reading data.js.

   This file reads ONLY the "analytics.deals" VIEW, via the public anon key.
   It must NEVER use a service_role key and must NEVER touch the "raw" schema
   (raw is locked to service_role by RLS — anon reading it should fail, and
   that failure is correct, not a bug).

   Fill in the two constants below with your Supabase project URL and its
   anon (public) key — Supabase dashboard → Settings → API. Do not put a
   service_role key here; this file ships to the browser.
   ============================================================================ */

const SUPABASE_URL = 'https://yngfaykhvegavzueukmc.supabase.co';
const SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InluZ2ZheWtodmVnYXZ6dWV1a21jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5MTIyMzEsImV4cCI6MjEwNDQ4ODIzMX0.bY8wJl28cDSYm-UAL9cf7HGNhwhmdtY6CiuuryYmkVM';

/* ---------------------------- FETCH + TRANSFORM --------------------------- */

/* analytics.deals.stage carries the full Notion label, e.g. "A4. DD /
   Advisory In Progress" or "B8. Unconditional Contract". The wording after
   the id can differ from data.js's STAGES labels (that file's B8 is "Under
   Contract"), so stages are matched by the id prefix (before the first "."),
   never by comparing full label text. */
function extractStageId(label) {
  if (!label) return null;
  const dot = label.indexOf('.');
  return (dot === -1 ? label : label.slice(0, dot)).trim();
}

function resolveStage(label) {
  const id = extractStageId(label);
  const stage = id != null ? getStage(id) : null;
  if (stage) return stage;
  console.warn('[supabase-data] Unrecognized stage from analytics.deals (no matching STAGES id) — falling back to a generic display:', label);
  return { id: id || '?', label: label || 'Unknown stage', short: label || 'Unknown', group: 'prospecting' };
}

/* Maps one analytics.deals row (snake_case, precomputed financial columns)
   to the shape Overview/Pipeline/Revenue's render functions read. Two
   deliberate choices, made after inspecting live data — see the report given
   alongside this file:
     - "in progress" is computed here as !paused && !won && !lost, NOT read
       from the view's own is_active column (that column's definition also
       counts Won deals as active, which doesn't match how every other page
       in this app uses "active pipeline").
     - advisory_settled / advisory_contracted (precomputed server-side) are
       used as-is rather than re-deriving them from tranche1_status /
       tranche2_status client-side, because the real tranche-status text
       ("Not Started") doesn't exactly match data.js's mock predicates
       ("Not started") — reimplementing that matching here would silently
       reintroduce the exact casing bug the view was built to avoid. */
function mapDealRow(row) {
  const stage = resolveStage(row.stage);
  return {
    id: row.notion_page_id,
    name: row.name || '(untitled)',
    stage: stage.id,
    stageLabel: row.stage,
    outcome: row.outcome,
    dealType: Array.isArray(row.deal_type) ? row.deal_type : [],
    entity: row.entity,
    owner: row.owner,
    probability: row.probability, // may be null — ~70-75% of real deals have no financials yet
    score: row.score ?? 0,
    closeDate: row.close_date,
    nextAction: row.next_action,
    nextActionDate: row.next_action_date,
    daysStale: row.days_stale ?? 0,
    pipelineStatus: row.pipeline_status,
    transactionValue: row.transaction_value || 0,
    commissionPct: row.commission_pct || 0,
    advisoryFee: row.advisory_fee || 0,
    sdahcRevenue: row.sdahc_revenue || 0,
    weightedRevenue: row.weighted_revenue || 0,
    tranche1Amount: row.tranche1_amount || 0,
    tranche1Status: row.tranche1_status,
    tranche2Amount: row.tranche2_amount || 0,
    tranche2Status: row.tranche2_status,
    advisorySettled: row.advisory_settled || 0,
    advisoryContracted: row.advisory_contracted || 0,
    isPaused: !!row.is_paused,
    isWon: !!row.is_won,
    isLost: !!row.is_lost,
    isInProgress: !row.is_paused && !row.is_won && !row.is_lost,
  };
}

async function fetchRealDeals() {
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    throw new Error('Supabase client library did not load — check the CDN <script> tag in index.html.');
  }
  if (!SUPABASE_URL || SUPABASE_URL === 'SUPABASE_URL' || !SUPABASE_ANON_KEY || SUPABASE_ANON_KEY === 'SUPABASE_ANON_KEY') {
    throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY are still placeholders — fill them in at the top of supabase-data.js.');
  }
  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { db: { schema: 'analytics' } });
  const { data, error } = await client.from('deals').select('*');
  if (error) throw new Error(error.message);
  return data || [];
}

const RealData = { status: 'loading', error: null };
let REAL_DEALS = [];
let realDataPromise = null;

/* Fetches once; safe to call more than once (returns the same in-flight/
   resolved promise). Never throws — failures land in RealData.status/error
   so the UI can show a clear message instead of crashing. */
function initRealData() {
  if (realDataPromise) return realDataPromise;
  realDataPromise = fetchRealDeals()
    .then(rows => {
      REAL_DEALS = rows.map(mapDealRow);
      RealData.status = 'ready';
    })
    .catch(err => {
      console.error('[supabase-data] Failed to load analytics.deals:', err);
      RealData.status = 'error';
      RealData.error = err.message || String(err);
    });
  return realDataPromise;
}

/* Renders a loading/error placeholder into `rootId` and returns true if it
   did (caller should stop rendering its normal content); returns false once
   data is ready. Reuses the .placeholder-page/.placeholder-card classes
   already used elsewhere in this app (see index.html's old Revenue/Funnel
   placeholders). */
function renderRealDataStatusPanel(rootId) {
  const root = document.getElementById(rootId);
  if (RealData.status === 'loading') {
    root.innerHTML = `
      <div class="placeholder-page">
        <div class="placeholder-card">
          <h2>Loading live data…</h2>
          <p>Fetching deals from Supabase (analytics.deals).</p>
        </div>
      </div>`;
    return true;
  }
  if (RealData.status === 'error') {
    root.innerHTML = `
      <div class="placeholder-page">
        <div class="placeholder-card">
          <h2>Couldn't load live data</h2>
          <p>${RealData.error}</p>
          <p>Check the SUPABASE_URL / SUPABASE_ANON_KEY placeholders in supabase-data.js, and that analytics.deals is reachable.</p>
        </div>
      </div>`;
    return true;
  }
  return false;
}

/* ------------------------------- AGGREGATES -------------------------------
   Mirrors data.js's Aggregates API (same method names) so Overview/Pipeline/
   Revenue's render functions read almost identically to before — just
   against REAL_DEALS/RealAggregates instead of DEALS/Aggregates. Not every
   mock aggregate has a real counterpart: newProspectsThisMonth,
   activitySummary and commercialFlow all key off a deal creation date that
   analytics.deals does not expose (confirmed absent from raw.deals too — the
   Notion page's created_time was never synced), so they have no equivalent
   here and are intentionally omitted from the real-data pages rather than
   guessed at. avgConsultancyValue / avgListingValue / advisoryToBrokerageConversion
   are omitted for the same reason (the conversion KPI also needs stage
   history, which isn't synced either). See the report given alongside this
   file. */
const RealAggregates = {
  won: () => REAL_DEALS.filter(d => d.isWon),
  lost: () => REAL_DEALS.filter(d => d.isLost),
  paused: () => REAL_DEALS.filter(d => d.isPaused),
  active: () => REAL_DEALS.filter(d => d.isInProgress),

  settledRevenueYTD: () => {
    const { start, end } = periodRange('ytd');
    return REAL_DEALS.filter(d => d.isWon && inRange(d.closeDate, start, end))
      .reduce((sum, d) => sum + d.sdahcRevenue, 0);
  },

  /* Same two-tier split as the mock (see data.js contractedTierBreakdown),
     but the "conditional tranche" leg reuses the view's precomputed
     advisory_contracted column directly instead of re-deriving it from
     tranche1_status/tranche2_status. */
  contractedTierBreakdown: () => {
    const unconditionalDeals = RealAggregates.active().filter(d => d.stage === 'B8');
    const unconditional = unconditionalDeals.reduce((sum, d) => sum + d.sdahcRevenue, 0);
    const unconditionalIds = new Set(unconditionalDeals.map(d => d.id));

    const conditionalStageDeals = RealAggregates.active().filter(d => d.stage === 'B7' && !unconditionalIds.has(d.id));
    const conditionalStageTotal = conditionalStageDeals.reduce((sum, d) => sum + d.sdahcRevenue, 0);

    const countedIds = new Set([...unconditionalIds, ...conditionalStageDeals.map(d => d.id)]);
    const conditionalTrancheTotal = RealAggregates.active()
      .filter(d => !countedIds.has(d.id))
      .reduce((sum, d) => sum + d.advisoryContracted, 0);

    const conditional = conditionalStageTotal + conditionalTrancheTotal;
    return { unconditional, conditional, total: unconditional + conditional };
  },

  contractedRevenue: () => RealAggregates.contractedTierBreakdown().total,

  expectedOpenPipelineRevenue: () => RealAggregates.active().reduce((s, d) => s + d.sdahcRevenue, 0),
  weightedPipelineRevenue: () => RealAggregates.active().reduce((s, d) => s + d.weightedRevenue, 0),

  winRate: () => {
    const won = RealAggregates.won().length, lost = RealAggregates.lost().length;
    return (won + lost) === 0 ? 0 : won / (won + lost);
  },

  /* Non-negotiable rule: Paused deals never contribute to any financial or
     pipeline total, including this chart's per-stage totals — so unlike the
     mock's byStage() (which intentionally includes Paused for a structural
     picture — see INFO_TEXT 'ov-pipeline-chart' in the mock), Paused rows are
     filtered out here entirely, not just zero-valued. */
  byStage: (metric) => {
    return STAGES.map(stage => {
      const deals = REAL_DEALS.filter(d => d.stage === stage.id && !d.isPaused);
      const count = deals.length;
      const transactionValue = deals.reduce((s, d) => s + d.transactionValue, 0);
      const revenue = deals.reduce((s, d) => s + d.sdahcRevenue, 0);
      const weighted = deals.reduce((s, d) => s + d.weightedRevenue, 0);
      let value;
      if (metric === 'count') value = count;
      else if (metric === 'transactionValue') value = transactionValue;
      else if (metric === 'weighted') value = weighted;
      else value = revenue;
      return { stage, deals, count, transactionValue, revenue, weighted, value };
    });
  },

  revenueTargetSummary: () => {
    const target = getSettings().annualTarget;
    const settled = RealAggregates.settledRevenueYTD();
    const tiers = RealAggregates.contractedTierBreakdown();
    const contracted = tiers.total;
    const weighted = RealAggregates.weightedPipelineRevenue();
    const totalPotential = settled + contracted + weighted;
    const gap = Math.max(0, target - totalPotential);
    const onTrack = totalPotential >= target;
    return { target, settled, contracted, weighted, totalPotential, gap, onTrack, unconditional: tiers.unconditional, conditional: tiers.conditional };
  },

  /* Only 2 categories, not the mock's 4: analytics.deals' own sdahc_revenue
     formula (defined server-side in schema.sql) is transaction_value ×
     commission_pct + advisory_fee — there is no conjunction_fee or
     referral_fee column anywhere in raw.deals or the view, so those two
     mock categories simply don't exist in the real schema yet. */
  revenueBySource: () => {
    const deals = REAL_DEALS.filter(d => d.isWon || d.isInProgress);
    const totals = { brokerage: 0, advisory: 0 };
    deals.forEach(d => {
      totals.brokerage += d.transactionValue * d.commissionPct;
      totals.advisory += d.advisoryFee;
    });
    const total = totals.brokerage + totals.advisory;
    return { totals, total, dealCount: deals.length };
  },

  revenueConcentration: (n = 3) => {
    const deals = REAL_DEALS.filter(d => d.isWon || d.isInProgress);
    const sorted = [...deals].sort((a, b) => b.sdahcRevenue - a.sdahcRevenue);
    const total = sorted.reduce((s, d) => s + d.sdahcRevenue, 0);
    const top = sorted.slice(0, n);
    const topTotal = top.reduce((s, d) => s + d.sdahcRevenue, 0);
    return { top, topTotal, total, pct: total === 0 ? 0 : topTotal / total, n };
  },

  /* Same estimated-close-date heuristic as data.js's estimatedCloseDate(),
     applied to the real probability field (treating a null probability —
     not yet set in Notion — as 0, i.e. "furthest out", rather than guessing
     a value). */
  monthlyRevenueSeries: () => {
    const monthlyTarget = getSettings().annualTarget / 12;
    const { start: fyStart } = fiscalYearBounds(TODAY);
    const months = [];
    for (let i = 0; i < 12; i++) {
      const monthStart = new Date(fyStart.getFullYear(), fyStart.getMonth() + i, 1);
      const monthEnd = new Date(fyStart.getFullYear(), fyStart.getMonth() + i + 1, 0);
      const isFuture = monthStart > TODAY;
      const isPast = monthEnd < TODAY;
      const isCurrent = !isFuture && !isPast;

      let actual = null;
      if (isPast || isCurrent) {
        actual = REAL_DEALS.filter(d => d.isWon && inRange(d.closeDate, monthStart, monthEnd))
          .reduce((s, d) => s + d.sdahcRevenue, 0);
      }

      let forecast = null;
      if (isFuture || isCurrent) {
        forecast = RealAggregates.active().filter(d => {
          const p = d.probability == null ? 0 : d.probability;
          const monthsOut = Math.max(0, Math.min(7, Math.round((1 - p) * 6)));
          const close = new Date(TODAY);
          close.setMonth(close.getMonth() + monthsOut);
          return close >= monthStart && close <= monthEnd;
        }).reduce((s, d) => s + d.weightedRevenue, 0);
      }

      months.push({
        month: monthStart.getMonth(), year: monthStart.getFullYear(), label: monthStart.toLocaleDateString('en-AU', { month: 'short' }),
        actual, forecast, target: monthlyTarget, isCurrent, isFuture, isPast,
      });
    }
    return months;
  },

  cumulativeForecastVsActual: () => {
    const months = RealAggregates.monthlyRevenueSeries();
    let cumTarget = 0, cumActual = 0;
    let latestRow = null;

    const rows = months.map(m => {
      cumTarget += m.target;
      if (m.isPast || m.isCurrent) {
        cumActual += (m.actual || 0);
        const row = { ...m, cumTarget, cumActual };
        latestRow = row;
        return row;
      }
      return { ...m, cumTarget, cumActual: null };
    });

    const actualToDate = latestRow ? latestRow.cumActual : 0;
    const targetToDate = latestRow ? latestRow.cumTarget : 0;
    const variance = actualToDate - targetToDate;
    const variancePct = targetToDate === 0 ? 0 : variance / targetToDate;
    return { rows, actualToDate, targetToDate, variance, variancePct, aheadOfPlan: variance >= 0 };
  },
};
