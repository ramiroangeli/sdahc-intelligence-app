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

/* ---------------------------------- AUTH ----------------------------------
   One shared Supabase client for the whole app — both auth (Microsoft/Azure
   sign-in, session checks, sign-out) and the analytics.deals fetch below run
   through this single instance. `db.schema` only scopes .from() queries;
   .auth.* is schema-agnostic, so one client safely serves both.

   Security note: the anon key here is the public client key, same as
   before — it's meant to ship to the browser. What actually gates real data
   is a Supabase RLS policy on analytics.deals restricted to the
   'authenticated' role (see the SQL given alongside this file, applied by
   hand in the Supabase dashboard, not from this code). Until that policy is
   applied, an anon (logged-out) request would still succeed at the database
   level — this app-side gate (login screen + initRealData() only ever
   called after a session exists — see app.js) is what keeps a logged-out
   visitor from seeing the dashboard in the meantime, but it is not itself
   the security boundary. */
let _supabaseClient = null;
function getSupabaseClient() {
  if (_supabaseClient) return _supabaseClient;
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    throw new Error('Supabase client library did not load — check the CDN <script> tag in index.html.');
  }
  if (!SUPABASE_URL || SUPABASE_URL === 'SUPABASE_URL' || !SUPABASE_ANON_KEY || SUPABASE_ANON_KEY === 'SUPABASE_ANON_KEY') {
    throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY are still placeholders — fill them in at the top of supabase-data.js.');
  }
  _supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { db: { schema: 'analytics' } });
  return _supabaseClient;
}

/* redirectTo is the app's OWN origin, read at click time rather than
   hardcoded — window.location.origin resolves to whichever one the user is
   actually on (http://localhost:8080 in dev, the Vercel URL in production),
   so the same code works unchanged in both places. Supabase JS parses the
   OAuth redirect's URL fragment automatically on the page it lands back on
   (detectSessionInUrl defaults to true) — nothing extra is needed here for
   that; see onAuthChange() below for how app.js picks up the resulting
   session on return. */
function signInWithMicrosoft() {
  return getSupabaseClient().auth.signInWithOAuth({
    provider: 'azure',
    options: { scopes: 'email', redirectTo: window.location.origin },
  });
}

function signOutUser() {
  return getSupabaseClient().auth.signOut();
}

function getCurrentSession() {
  return getSupabaseClient().auth.getSession();
}

/* Fires `callback(session)` once for the CURRENT auth state and again on
   every future sign-in/sign-out. app.js's initAuthGate() needs both this AND
   a direct getCurrentSession() call at startup, not just one or the other:
   getSession() alone can race the OAuth redirect flow (it may resolve
   before Supabase JS finishes parsing the token out of the URL fragment and
   read `null`), and onAuthStateChange alone gives no way to show an initial
   "checking session" state before its first event fires. Together: show
   "checking…", ask getSession() once, and let this listener correct the
   answer (in either direction) whenever the real state settles. */
function onAuthChange(callback) {
  getSupabaseClient().auth.onAuthStateChange((_event, session) => callback(session));
}

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
    /* close_date/next_action_date are Postgres `date` columns, so Supabase
       already hands them back as bare "YYYY-MM-DD" strings — what data.js's
       parseDate()/inRange() expect. created_time is `timestamptz` (it's
       Notion's page.created_time, synced with the full time-of-day — see
       sync/sync-deals.js), so it comes back as a full ISO datetime
       ("2026-08-31T02:14:00+00:00"). Feeding that whole string into
       parseDate() (which appends its own "T00:00:00") produces an Invalid
       Date and every date-based KPI below would silently read as 0 — so it's
       truncated to the UTC calendar date here, once, at the boundary. */
    createdDate: row.created_time ? row.created_time.slice(0, 10) : null,
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
  const client = getSupabaseClient();
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
   against REAL_DEALS/RealAggregates instead of DEALS/Aggregates.

   newProspectsThisMonth / commercialFlow / activitySummary all key off
   createdDate (mapped from row.created_time — requires the analytics.deals
   view to expose created_time; see the view SQL given alongside this file).
   avgConsultancyValue / avgListingValue don't actually need a date at all
   (they never did) and are included below too.

   activitySummary's qualifiedOpportunities/proposalsSent/engagementsWon only
   need each deal's CURRENT stage (via STAGE_INDEX, from data.js) compared
   against a threshold — same as byStage() elsewhere in this file — so unlike
   advisoryToBrokerageConversion (removed app-wide, mock included — see
   ASSUMPTIONS 'advisory-brokerage-conversion' in data.js) it never needed
   real stage-HISTORY (when a deal crossed stages) to begin with. That KPI
   stays off every page — mock or real — until history.deal_stage_events
   (sync/schema.sql, now capturing nightly) has matured enough to compute a
   genuine conversion date per deal. */
const RealAggregates = {
  won: () => REAL_DEALS.filter(d => d.isWon),
  lost: () => REAL_DEALS.filter(d => d.isLost),
  paused: () => REAL_DEALS.filter(d => d.isPaused),
  active: () => REAL_DEALS.filter(d => d.isInProgress),

  /* Deals created in the current calendar month, by Notion's created_time
     (see the view SQL update needed for this column — schema.sql doesn't
     have it yet). Paused excluded per the non-negotiable rule. */
  newProspectsThisMonth: () => {
    const start = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
    return REAL_DEALS.filter(d => !d.isPaused && inRange(d.createdDate, start, TODAY)).length;
  },

  /* Mean advisory/consultancy fee across every non-Paused deal that carries
     one, any outcome (Won, Lost or In Progress) — a typical engagement size,
     not a revenue forecast. Unlike the mock's advisoryRevenue() this doesn't
     need a tranche-aware branch: the view's advisory_fee already IS the full
     fee regardless of whether it's tranche-billed (see the double-counting
     note on settledRevenueYTD above). */
  avgConsultancyValue: () => {
    const deals = REAL_DEALS.filter(d => !d.isPaused && d.advisoryFee > 0);
    const total = deals.reduce((s, d) => s + d.advisoryFee, 0);
    return { count: deals.length, avg: deals.length === 0 ? 0 : total / deals.length, deals };
  },

  /* Mean Transaction Value (the underlying asset price, never SDAHC revenue)
     across every non-Paused deal tagged 'Brokerage / Divestment'. */
  avgListingValue: () => {
    const deals = REAL_DEALS.filter(d => !d.isPaused && d.dealType.includes('Brokerage / Divestment'));
    const total = deals.reduce((s, d) => s + d.transactionValue, 0);
    return { count: deals.length, avg: deals.length === 0 ? 0 : total / deals.length, deals };
  },

  /* "Settled" = money actually in the bank, from two non-overlapping sources:
       (a) Won deals' full sdahcRevenue, closeDate in FY-to-date (as before).
       (b) Paid advisory tranches (advisory_settled) on every OTHER
           (non-Paused, non-Won) deal — this is real cash collected even
           though the deal itself hasn't closed/isn't Won.
     Why (b) excludes Won deals specifically: for every tranche-billed deal
     inspected live, advisory_fee == tranche1_amount + tranche2_amount (the
     tranche split is just a billing/status breakdown of the SAME fee, not a
     separate revenue stream) — so a Won deal's sdahcRevenue already embeds
     100% of that fee whether or not part of it happens to also be marked
     "Paid" in the tranche fields. Adding advisory_settled on top of a Won
     deal's sdahcRevenue would double-count that fee. No Won deal currently
     has a Paid tranche (verified live), so today this guard is a no-op in
     practice — it's here so the formula stays correct if that changes.
     Caveat (can't be fixed without a new field, so it's disclosed instead of
     hidden): advisory_settled has no "paid on" date, so component (b) is a
     present-day snapshot, not truly "YTD" — the Revenue-Over-Time /
     Cumulative charts (which bucket by month) intentionally do NOT include
     it, since there's no honest month to place it in. That means this KPI
     can legitimately read higher than "Cumulative Actual" on the Revenue
     page — see that chart's info tooltip. */
  settledRevenueYTD: () => {
    const { start, end } = periodRange('ytd');
    const wonInFY = REAL_DEALS.filter(d => d.isWon && inRange(d.closeDate, start, end))
      .reduce((sum, d) => sum + d.sdahcRevenue, 0);
    const paidTranches = REAL_DEALS.filter(d => !d.isPaused && !d.isWon)
      .reduce((sum, d) => sum + d.advisorySettled, 0);
    return wonInFY + paidTranches;
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

  /* Commercial flow waterfall — same shape as data.js's mock commercialFlow()
     (see that function's header comment for the full rationale), now backed
     by real createdDate/closeDate/probability/revenue instead of mock ones.
     "Value Added" still has no real source (no stage-history to diff against
     a prior period) so it stays an EXPLICIT MOCK FIGURE, flagged via
     valueAddedIsMock — this was true in the mock version too, it isn't a
     regression introduced by the real-data switch. Paused deals never enter
     any of the four inputs: active()/weightedPipelineRevenue() already
     exclude them, and isWon/isLost are both false for a Paused deal. */
  commercialFlow: (periodKey) => {
    const { start, end } = periodRange(periodKey);
    const periodDays = (end - start) / 86400000 + 1;
    const MOCK_VALUE_ADDED_ANNUAL_RATE = 0.35;

    const closingPipeline = RealAggregates.weightedPipelineRevenue();

    const newDeals = RealAggregates.active().filter(d => inRange(d.createdDate, start, end));
    const newOpportunities = newDeals.reduce((s, d) => s + d.weightedRevenue, 0);

    const settledDeals = REAL_DEALS.filter(d => d.isWon && inRange(d.closeDate, start, end));
    const settled = settledDeals.reduce((s, d) => s + d.sdahcRevenue, 0);

    const lostDeals = REAL_DEALS.filter(d => d.isLost && inRange(d.closeDate, start, end));
    const lost = lostDeals.reduce((s, d) => s + d.sdahcRevenue * (d.probability ?? 0), 0);

    const valueAdded = closingPipeline * MOCK_VALUE_ADDED_ANNUAL_RATE * (periodDays / 365);

    const opening = Math.max(0, closingPipeline - newOpportunities - valueAdded + lost + settled);

    return { opening, newOpportunities, valueAdded, lost, settled, closing: closingPipeline, valueAddedIsMock: true };
  },

  /* Deal Activity — same definition and same shared overviewPeriod control
     as the mock's activitySummary() (data.js): the cohort is every deal
     CREATED in the period (Paused excluded, per the non-negotiable rule);
     qualified/proposals/engagements read how far that cohort has progressed
     AS OF TODAY, using each deal's CURRENT stage (isTrack()/STAGE_INDEX,
     both from data.js, unchanged) — never stage history, so this was always
     safe to compute from real data once createdDate existed. Lost/Settled
     use each deal's own closeDate instead of the cohort, exactly like the
     mock; both naturally exclude Paused since isLost/isWon are false for a
     Paused deal. */
  activitySummary: (periodKey) => {
    const { start, end } = periodRange(periodKey);
    const cohort = REAL_DEALS.filter(d => !d.isPaused && inRange(d.createdDate, start, end));
    const reached = (d, advisoryStage, brokerageStage) => {
      if (isTrack(d, 'advisory')) return STAGE_INDEX[d.stage] >= STAGE_INDEX[advisoryStage] && STAGE_INDEX[d.stage] < STAGE_INDEX['B1'];
      if (isTrack(d, 'brokerage')) return STAGE_INDEX[d.stage] >= STAGE_INDEX[brokerageStage];
      return STAGE_INDEX[d.stage] >= STAGE_INDEX['A1'];
    };
    return {
      newProspects: cohort.length,
      qualifiedOpportunities: cohort.filter(d => reached(d, 'A1', 'B1')).length,
      proposalsSent: cohort.filter(d => reached(d, 'A2', 'B2')).length,
      engagementsWon: cohort.filter(d => reached(d, 'A3', 'B3')).length,
      dealsLost: REAL_DEALS.filter(d => d.isLost && inRange(d.closeDate, start, end)).length,
      dealsSettled: REAL_DEALS.filter(d => d.isWon && inRange(d.closeDate, start, end)).length,
    };
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

  /* ---------------------------- DELIVERY: ADVISORY -------------------------
     Real counterpart to data.js's mock Delivery "engagements" concept — see
     the report given alongside this change for the full rationale. Scope:
     ADVISORY only. Brokerage delivery (health %, deliverables, milestone due
     dates) has no Notion source (ASSUMPTIONS 'delivery-milestone-model') and
     stays entirely on the mock DEALS/Aggregates.engagements(), now narrowed
     to brokerage-only in data.js.

     QUALIFYING RULE: advisory_fee > 0 AND at least one tranche STATUS is
     non-null. Status, not amount, is the "is there real tranche data" signal
     — the view coalesces every *_amount column to 0, so a genuinely-zero
     amount and a field Notion has never had filled in are indistinguishable
     once mapped; *_status is passed through un-coalesced, so null there
     really does mean "Notion has nothing here yet." A deal with advisory_fee
     but no tranche fields at all doesn't qualify — it isn't hidden data, it
     simply isn't tranche-tracked yet, and it keeps counting normally
     everywhere else (Overview, Revenue) via its flat advisoryFee.

     LOCKED vs UNLOCKED reuses the exact mapping already established for real
     advisory money everywhere else in this app (see settledRevenueYTD()
     above and the view's own advisory_settled/advisory_contracted columns):
     Paid → Settled, WIP/Invoiced → Contracted, Not started → neither (still
     just open/weighted pipeline). "Locked" here means the Not-started
     portion — not yet committed; "Unlocked" is Contracted + Settled
     combined, same two-bucket split the mock's own engagement cards use.

     Paused deals: per the non-negotiable rule they contribute zero to every
     sum, but they're NOT filtered out of advisoryEngagements() itself — the
     list may still show them, clearly marked, at zero. */
  advisoryEngagements: () => REAL_DEALS
    .filter(d => d.advisoryFee > 0 && (d.tranche1Status != null || d.tranche2Status != null))
    .sort((a, b) => b.advisoryFee - a.advisoryFee),

  advisoryEngagementLocked: (d) => {
    if (d.isPaused) return 0;
    let sum = 0;
    if (d.tranche1Status === 'Not started') sum += d.tranche1Amount;
    if (d.tranche2Status === 'Not started') sum += d.tranche2Amount;
    return sum;
  },

  advisoryEngagementUnlocked: (d) => {
    if (d.isPaused) return 0;
    let sum = 0;
    if (d.tranche1Status != null && d.tranche1Status !== 'Not started') sum += d.tranche1Amount;
    if (d.tranche2Status != null && d.tranche2Status !== 'Not started') sum += d.tranche2Amount;
    return sum;
  },

  /* Same check as the mock's trancheReconciliation(), against advisory_fee
     (the view's own single source of truth for "this deal's total advisory
     revenue") instead of a separate consultancyFeeTotal field — the real
     schema only has the one. */
  advisoryTrancheReconciliation: (d) => {
    const sum = d.tranche1Amount + d.tranche2Amount;
    return { ok: Math.abs(sum - d.advisoryFee) < 0.01, sum, total: d.advisoryFee };
  },

  /* KPI strip equivalent to the mock's deliveryKpis() — deliberately NOT a
     1:1 match. "Unlockable This Quarter", "Revenue At Risk" and "Next
     Milestone" all key off a milestone DUE DATE and/or the health flag,
     neither of which exists in the real schema (tranches have an amount and
     a status, never a date) — fabricating one would be a guess dressed up
     as a real number, so those three are dropped rather than faked. What's
     left is fully real: Settled/Contracted (from the view's own
     advisory_settled/advisory_contracted, summed only across non-Paused
     qualifying deals) and Locked (Not-started tranches, same deals). */
  advisoryDeliveryKpis: () => {
    const engagements = RealAggregates.advisoryEngagements().filter(d => !d.isPaused);
    let lockedRevenue = 0, settledRevenue = 0, contractedRevenue = 0;
    engagements.forEach(d => {
      lockedRevenue += RealAggregates.advisoryEngagementLocked(d);
      settledRevenue += d.advisorySettled;
      contractedRevenue += d.advisoryContracted;
    });
    return { lockedRevenue, settledRevenue, contractedRevenue, activeEngagements: engagements.length };
  },
};
