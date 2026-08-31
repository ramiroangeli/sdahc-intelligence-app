/* ============================================================================
   SDAHC INTELLIGENCE — MOCK DATA LAYER
   ----------------------------------------------------------------------------
   This is the SINGLE SOURCE OF TRUTH for every number shown in the prototype.
   No view, KPI, chart or table may hardcode a figure that contradicts this
   file — every aggregate must be derived here or in the compute helpers below.

   Operating model: Notion is the real source of truth for deals in production.
   This file simulates a snapshot export of the Deals database. Dashboard-owned
   concepts (targets, thresholds, settings) are simulated via localStorage and
   seeded from the DEFAULT_SETTINGS object at the bottom of this file.
   ============================================================================ */

/* ----------------------------- STAGES --------------------------------- */
/* Ordered exactly as the real Notion pipeline. `defaultProbability` is the
   probability used to compute weighted revenue when a deal does not carry
   an explicit override. Settings (future phase) will allow editing these. */

const STAGES = [
  { id: '0',  label: '0. Prospect',                        short: 'Prospect',            group: 'prospecting', defaultProbability: 0.05 },
  { id: '1',  label: '1. Contacted',                        short: 'Contacted',           group: 'prospecting', defaultProbability: 0.10 },
  { id: 'A1', label: 'A1. Information Requested',           short: 'Info Requested',      group: 'advisory',    defaultProbability: 0.15 },
  { id: 'A2', label: 'A2. Advisory Proposal Sent',          short: 'Proposal Sent',       group: 'advisory',    defaultProbability: 0.25 },
  { id: 'A3', label: 'A3. Advisory / DD Engaged',           short: 'DD Engaged',          group: 'advisory',    defaultProbability: 0.40 },
  { id: 'A4', label: 'A4. DD / Advisory In Progress',       short: 'DD In Progress',      group: 'advisory',    defaultProbability: 0.55 },
  { id: 'A5', label: 'A5. Advisory Complete',                short: 'Advisory Complete',   group: 'advisory',    defaultProbability: 0.70 },
  { id: 'B1', label: 'B1. Information Request',             short: 'Info Request',        group: 'brokerage',   defaultProbability: 0.15 },
  { id: 'B2', label: 'B2. Brokerage Proposal Sent',         short: 'Proposal Sent',       group: 'brokerage',   defaultProbability: 0.25 },
  { id: 'B3', label: 'B3. Appointed & Market Preparation',  short: 'Appointed',           group: 'brokerage',   defaultProbability: 0.35 },
  { id: 'B4', label: 'B4. Buyer Outreach / IM Sent',        short: 'Buyer Outreach',      group: 'brokerage',   defaultProbability: 0.45 },
  { id: 'B5', label: 'B5. Buyer Follow-up',                  short: 'Buyer Follow-up',     group: 'brokerage',   defaultProbability: 0.55 },
  { id: 'B6', label: 'B6. Negotiation',                      short: 'Negotiation',         group: 'negotiation', defaultProbability: 0.70 },
  { id: 'B7', label: 'B7. Contract Issued',                  short: 'Contract Issued',     group: 'negotiation', defaultProbability: 0.85 },
  { id: 'B8', label: 'B8. Under Contract',                   short: 'Under Contract',      group: 'negotiation', defaultProbability: 0.92 },
  { id: '9',  label: '9. Settlement',                        short: 'Settlement',          group: 'settlement',  defaultProbability: 1.00 },
];

const STAGE_GROUPS = {
  prospecting: { label: 'Prospecting',            color: '#8592A6' },
  advisory:    { label: 'Advisory',                color: '#7A5CC7' },
  brokerage:   { label: 'Brokerage',               color: '#14A8A0' },
  negotiation: { label: 'Negotiation & Contract',  color: '#E0A82E' },
  settlement:  { label: 'Settlement',              color: '#2FB37A' },
};

const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s.id, i]));
function getStage(id) { return STAGES.find(s => s.id === id); }

/* ----------------------------- TAXONOMY --------------------------------- */

const OUTCOMES = ['Won', 'Lost', 'In Progress', 'Paused'];

const DEAL_TYPES = [
  'Paid advisory / DD',
  'Brokerage / Divestment',
  'Strategic Partnership / Agency Collaboration',
  'Referral',
];

const ENTITIES = ['SDA Home Choices', '3DSDA'];

const LOST_REASONS = [
  'Price too high',
  'Timing not right',
  'Investor found alternative',
  'Property sold elsewhere',
  'Compliance issues',
  'Project rejected from us',
  'Vendor chose other REA',
  'Vendor chose direct buyer',
  'Others',
];

const PROSPECT_SOURCES = [
  { id: 'Steve Relationship Network', group: 'relationship' },
  { id: 'Referral',                   group: 'relationship' },
  { id: 'Existing Client',            group: 'relationship' },
  { id: 'Valuer / Adviser',           group: 'relationship' },
  { id: 'SDA Report',                 group: 'marketing' },
  { id: 'LinkedIn / Marketing',       group: 'marketing' },
  { id: 'Other',                      group: 'relationship' },
];
function sourceGroup(source) {
  const s = PROSPECT_SOURCES.find(p => p.id === source);
  return s ? s.group : 'relationship';
}

const OWNERS = ['Steve Harrington', 'Emma Voss', 'Daniel Reyes', 'Priya Nathan', 'Chris Bell'];

/* ------------------------------- DEALS ----------------------------------- */
/* transactionValue: underlying asset/portfolio price — NOT SDAHC income.
   commissionPct is a decimal fraction (0.025 = 2.5%). All fee fields are
   flat AUD amounts. `probability` defaults to the stage's defaultProbability
   but may be overridden per-deal to reflect deal-specific confidence. */

const DEALS = [
  {
    id: 'D-01', name: 'SDA Abodes / Socia', stage: 'B8', outcome: 'In Progress',
    dealType: ['Brokerage / Divestment'], entity: 'SDA Home Choices', owner: 'Steve Harrington',
    source: 'Steve Relationship Network', transactionValue: 3200000, commissionPct: 0.025,
    advisoryFee: 0, conjunctionFee: 0, referralFee: 0, probability: 0.92,
    lostReason: null, nextAction: 'Finalise settlement statement with vendor solicitor', daysStale: 4,
    organisations: ['Socia'], properties: ['12 Bellbird Cres, Logan QLD'],
    createdDate: '2026-03-10', closeDate: null,
  },
  {
    id: 'D-02', name: 'Paramount Disability Homes', stage: 'A4', outcome: 'In Progress',
    dealType: ['Paid advisory / DD'], entity: 'SDA Home Choices', owner: 'Emma Voss',
    source: 'Referral', transactionValue: 8500000, commissionPct: 0,
    advisoryFee: 65000, conjunctionFee: 0, referralFee: 0, probability: 0.55,
    lostReason: null, nextAction: 'Deliver draft due-diligence report to investment committee', daysStale: 9,
    organisations: ['Paramount Disability Homes Pty Ltd'], properties: ['Portfolio — 6 SDA dwellings, Ipswich'],
    createdDate: '2026-02-01', closeDate: null,
  },
  {
    id: 'D-03', name: 'Evergreen Built', stage: 'B3', outcome: 'In Progress',
    dealType: ['Brokerage / Divestment', 'Strategic Partnership / Agency Collaboration'], entity: 'SDA Home Choices', owner: 'Daniel Reyes',
    source: 'SDA Report', transactionValue: 4100000, commissionPct: 0.0275,
    advisoryFee: 0, conjunctionFee: 20000, referralFee: 0, probability: 0.35,
    lostReason: null, nextAction: 'Finalise marketing collateral ahead of buyer outreach', daysStale: 15,
    organisations: ['Evergreen Built Pty Ltd'], properties: ['4 dwellings, Caboolture QLD'],
    createdDate: '2026-05-01', closeDate: null,
  },
  {
    id: 'D-04', name: 'LVP Logan', stage: 'B6', outcome: 'In Progress',
    dealType: ['Brokerage / Divestment'], entity: 'SDA Home Choices', owner: 'Steve Harrington',
    source: 'Steve Relationship Network', transactionValue: 2650000, commissionPct: 0.03,
    advisoryFee: 0, conjunctionFee: 0, referralFee: 0, probability: 0.75,
    lostReason: null, nextAction: 'Review buyer counter-offer with vendor', daysStale: 3,
    organisations: ['LVP Investments'], properties: ['8 Kingfisher St, Logan QLD'],
    createdDate: '2026-04-12', closeDate: null,
  },
  {
    id: 'D-05', name: 'Living Well Solutions', stage: 'A2', outcome: 'In Progress',
    dealType: ['Paid advisory / DD'], entity: 'SDA Home Choices', owner: 'Priya Nathan',
    source: 'LinkedIn / Marketing', transactionValue: 5000000, commissionPct: 0,
    advisoryFee: 28000, conjunctionFee: 0, referralFee: 0, probability: 0.25,
    lostReason: null, nextAction: 'Follow up on advisory proposal sent 8 days ago', daysStale: 12,
    organisations: ['Living Well Solutions'], properties: ['Portfolio under review — 3 assets'],
    createdDate: '2026-06-20', closeDate: null,
  },
  {
    id: 'D-06', name: 'Skychest', stage: 'B2', outcome: 'In Progress',
    dealType: ['Strategic Partnership / Agency Collaboration', 'Brokerage / Divestment'], entity: '3DSDA', owner: 'Chris Bell',
    source: 'Valuer / Adviser', transactionValue: 6300000, commissionPct: 0.0225,
    advisoryFee: 0, conjunctionFee: 15000, referralFee: 0, probability: 0.20,
    lostReason: null, nextAction: 'Present brokerage proposal to fund board', daysStale: 20,
    organisations: ['Skychest Capital'], properties: ['Portfolio — 5 SDA assets, SE QLD'],
    createdDate: '2026-05-15', closeDate: null,
  },
  {
    id: 'D-07', name: 'Williams Landing', stage: '9', outcome: 'Won',
    dealType: ['Brokerage / Divestment'], entity: 'SDA Home Choices', owner: 'Steve Harrington',
    source: 'Existing Client', transactionValue: 2900000, commissionPct: 0.0275,
    advisoryFee: 0, conjunctionFee: 0, referralFee: 0, probability: 1.0,
    lostReason: null, nextAction: 'Archived — settled', daysStale: 0,
    organisations: ['Williams Landing SDA Trust'], properties: ['3 Grevillea Ct, Williams Landing VIC'],
    createdDate: '2025-11-02', closeDate: '2026-02-10',
  },
  {
    id: 'D-08', name: 'Horizon SDA Fund', stage: 'A5', outcome: 'In Progress',
    dealType: ['Paid advisory / DD'], entity: 'SDA Home Choices', owner: 'Emma Voss',
    source: 'Existing Client', transactionValue: 12000000, commissionPct: 0,
    advisoryFee: 80000, conjunctionFee: 0, referralFee: 0, probability: 0.70,
    lostReason: null, nextAction: 'Awaiting client go-ahead to proceed to brokerage mandate', daysStale: 6,
    organisations: ['Horizon SDA Fund'], properties: ['Portfolio — 9 SDA dwellings, QLD-wide'],
    createdDate: '2026-01-20', closeDate: null,
  },
  {
    id: 'D-09', name: 'Northline Community Housing', stage: 'B7', outcome: 'In Progress',
    dealType: ['Brokerage / Divestment'], entity: 'SDA Home Choices', owner: 'Daniel Reyes',
    source: 'Referral', transactionValue: 3750000, commissionPct: 0.025,
    advisoryFee: 0, conjunctionFee: 0, referralFee: 0, probability: 0.85,
    lostReason: null, nextAction: 'Awaiting signed contract return from buyer', daysStale: 2,
    organisations: ['Northline Community Housing Ltd'], properties: ['6 Wattle Ave, Ipswich QLD'],
    createdDate: '2026-03-25', closeDate: null,
  },
  {
    id: 'D-10', name: 'Riverside Accessible Homes', stage: '1', outcome: 'In Progress',
    dealType: ['Referral'], entity: 'SDA Home Choices', owner: 'Priya Nathan',
    source: 'Referral', transactionValue: 1800000, commissionPct: 0,
    advisoryFee: 0, conjunctionFee: 0, referralFee: 9000, probability: 0.10,
    lostReason: null, nextAction: 'Qualify opportunity and confirm investor intent', daysStale: 7,
    organisations: ['Riverside Accessible Homes'], properties: ['2 dwellings, Redbank Plains QLD'],
    createdDate: '2026-08-24', closeDate: null,
  },
  {
    id: 'D-11', name: 'Bellbird Park SDA', stage: 'B4', outcome: 'In Progress',
    dealType: ['Brokerage / Divestment'], entity: 'SDA Home Choices', owner: 'Steve Harrington',
    source: 'Steve Relationship Network', transactionValue: 4600000, commissionPct: 0.025,
    advisoryFee: 0, conjunctionFee: 0, referralFee: 0, probability: 0.45,
    lostReason: null, nextAction: 'Follow up with shortlisted buyers post IM distribution', daysStale: 11,
    organisations: ['Bellbird Park Holdings'], properties: ['5 dwellings, Bellbird Park QLD'],
    createdDate: '2026-05-28', closeDate: null,
  },
  {
    id: 'D-12', name: 'Wattle Grove Residences', stage: '0', outcome: 'In Progress',
    dealType: ['Paid advisory / DD'], entity: 'SDA Home Choices', owner: 'Chris Bell',
    source: 'SDA Report', transactionValue: 2200000, commissionPct: 0,
    advisoryFee: 0, conjunctionFee: 0, referralFee: 0, probability: 0.05,
    lostReason: null, nextAction: 'Initial outreach call to gauge appetite', daysStale: 4,
    organisations: ['Wattle Grove Residences'], properties: ['Single dwelling, Wattle Grove NSW'],
    createdDate: '2026-08-27', closeDate: null,
  },
  {
    id: 'D-13', name: 'Coomera SDA Portfolio', stage: 'B5', outcome: 'In Progress',
    dealType: ['Brokerage / Divestment'], entity: '3DSDA', owner: 'Emma Voss',
    source: 'Valuer / Adviser', transactionValue: 7200000, commissionPct: 0.0225,
    advisoryFee: 0, conjunctionFee: 0, referralFee: 0, probability: 0.55,
    lostReason: null, nextAction: 'Chase buyer finance approval status', daysStale: 8,
    organisations: ['Coomera SDA Portfolio Trust'], properties: ['Portfolio — 4 SDA assets, Coomera QLD'],
    createdDate: '2026-04-02', closeDate: null,
  },
  {
    id: 'D-14', name: 'Sunshine Coast Disability Housing', stage: 'A1', outcome: 'In Progress',
    dealType: ['Paid advisory / DD'], entity: '3DSDA', owner: 'Daniel Reyes',
    source: 'LinkedIn / Marketing', transactionValue: 3400000, commissionPct: 0,
    advisoryFee: 0, conjunctionFee: 0, referralFee: 0, probability: 0.15,
    lostReason: null, nextAction: 'Send information pack and engagement scope', daysStale: 6,
    organisations: ['Sunshine Coast Disability Housing Co-op'], properties: ['3 dwellings, Sippy Downs QLD'],
    createdDate: '2026-07-18', closeDate: null,
  },
  {
    id: 'D-15', name: 'Ipswich Central SDA', stage: '9', outcome: 'Won',
    dealType: ['Brokerage / Divestment'], entity: 'SDA Home Choices', owner: 'Steve Harrington',
    source: 'Steve Relationship Network', transactionValue: 1950000, commissionPct: 0.03,
    advisoryFee: 0, conjunctionFee: 0, referralFee: 0, probability: 1.0,
    lostReason: null, nextAction: 'Archived — settled', daysStale: 0,
    organisations: ['Ipswich Central SDA Holdings'], properties: ['2 dwellings, Ipswich Central QLD'],
    createdDate: '2025-09-10', closeDate: '2025-12-18',
  },
  {
    id: 'D-16', name: 'Meadowbrook Supported Living', stage: 'A3', outcome: 'Lost',
    dealType: ['Paid advisory / DD'], entity: 'SDA Home Choices', owner: 'Priya Nathan',
    source: 'Referral', transactionValue: 2750000, commissionPct: 0,
    advisoryFee: 18000, conjunctionFee: 0, referralFee: 0, probability: 0.40,
    lostReason: 'Investor found alternative', nextAction: 'Closed — no further action', daysStale: 0,
    organisations: ['Meadowbrook Supported Living'], properties: ['3 dwellings, Meadowbrook QLD'],
    createdDate: '2026-01-08', closeDate: '2026-03-15',
  },
  {
    id: 'D-17', name: 'Caboolture SDA Development', stage: 'B3', outcome: 'Lost',
    dealType: ['Brokerage / Divestment'], entity: 'SDA Home Choices', owner: 'Chris Bell',
    source: 'SDA Report', transactionValue: 5500000, commissionPct: 0.025,
    advisoryFee: 0, conjunctionFee: 0, referralFee: 0, probability: 0.35,
    lostReason: 'Price too high', nextAction: 'Closed — no further action', daysStale: 0,
    organisations: ['Caboolture SDA Development Co'], properties: ['Portfolio — 5 dwellings, Caboolture QLD'],
    createdDate: '2026-02-12', closeDate: '2026-04-22',
  },
  {
    id: 'D-18', name: 'Redland Bay Accessible Homes', stage: 'A2', outcome: 'Paused',
    dealType: ['Referral'], entity: 'SDA Home Choices', owner: 'Emma Voss',
    source: 'Referral', transactionValue: 1600000, commissionPct: 0,
    advisoryFee: 0, conjunctionFee: 0, referralFee: 6500, probability: 0.25,
    lostReason: null, nextAction: 'On hold — investor reviewing finance position', daysStale: 45,
    organisations: ['Redland Bay Accessible Homes'], properties: ['2 dwellings, Redland Bay QLD'],
    createdDate: '2026-02-14', closeDate: null,
  },
  {
    id: 'D-19', name: 'Springfield Lakes SDA', stage: 'B1', outcome: 'In Progress',
    dealType: ['Brokerage / Divestment'], entity: 'SDA Home Choices', owner: 'Daniel Reyes',
    source: 'Existing Client', transactionValue: 3100000, commissionPct: 0.025,
    advisoryFee: 0, conjunctionFee: 0, referralFee: 0, probability: 0.15,
    lostReason: null, nextAction: 'Gather property information pack from vendor', daysStale: 11,
    organisations: ['Springfield Lakes SDA Group'], properties: ['3 dwellings, Springfield Lakes QLD'],
    createdDate: '2026-08-20', closeDate: null,
  },
  {
    id: 'D-20', name: 'Toowoomba Disability Housing Trust', stage: '9', outcome: 'Won',
    dealType: ['Paid advisory / DD'], entity: 'SDA Home Choices', owner: 'Priya Nathan',
    source: 'Valuer / Adviser', transactionValue: 9800000, commissionPct: 0,
    advisoryFee: 72000, conjunctionFee: 0, referralFee: 0, probability: 1.0,
    lostReason: null, nextAction: 'Archived — settled', daysStale: 0,
    organisations: ['Toowoomba Disability Housing Trust'], properties: ['Portfolio — 7 SDA dwellings, Toowoomba QLD'],
    createdDate: '2025-10-05', closeDate: '2026-01-22',
  },
  {
    id: 'D-21', name: 'Gold Coast SDA Collective', stage: 'B6', outcome: 'Lost',
    dealType: ['Strategic Partnership / Agency Collaboration'], entity: 'SDA Home Choices', owner: 'Steve Harrington',
    source: 'Steve Relationship Network', transactionValue: 6900000, commissionPct: 0.02,
    advisoryFee: 0, conjunctionFee: 10000, referralFee: 0, probability: 0.70,
    lostReason: 'Vendor chose direct buyer', nextAction: 'Closed — no further action', daysStale: 0,
    organisations: ['Gold Coast SDA Collective'], properties: ['Portfolio — 6 SDA assets, Gold Coast QLD'],
    createdDate: '2026-01-05', closeDate: '2026-06-05',
  },
  {
    id: 'D-22', name: 'Logan Reserve Homes', stage: 'B8', outcome: 'In Progress',
    dealType: ['Brokerage / Divestment'], entity: 'SDA Home Choices', owner: 'Chris Bell',
    source: 'Referral', transactionValue: 2450000, commissionPct: 0.03,
    advisoryFee: 0, conjunctionFee: 0, referralFee: 0, probability: 0.92,
    lostReason: null, nextAction: 'Coordinate settlement date with all parties', daysStale: 5,
    organisations: ['Logan Reserve Homes Pty Ltd'], properties: ['3 Ironbark Way, Logan Reserve QLD'],
    createdDate: '2026-05-10', closeDate: null,
  },
  {
    id: 'D-23', name: 'Bayview SDA Portfolio', stage: '9', outcome: 'Won',
    dealType: ['Brokerage / Divestment'], entity: 'SDA Home Choices', owner: 'Steve Harrington',
    source: 'Steve Relationship Network', transactionValue: 5200000, commissionPct: 0.025,
    advisoryFee: 0, conjunctionFee: 0, referralFee: 0, probability: 1.0,
    lostReason: null, nextAction: 'Archived — settled', daysStale: 0,
    organisations: ['Bayview SDA Holdings'], properties: ['Portfolio — 4 SDA dwellings, Bayview VIC'],
    createdDate: '2025-12-20', closeDate: '2026-05-05',
  },
  {
    id: 'D-24', name: 'Kallangur Supported Homes', stage: '9', outcome: 'Won',
    dealType: ['Paid advisory / DD'], entity: 'SDA Home Choices', owner: 'Emma Voss',
    source: 'Existing Client', transactionValue: 6000000, commissionPct: 0,
    advisoryFee: 45000, conjunctionFee: 0, referralFee: 0, probability: 1.0,
    lostReason: null, nextAction: 'Archived — settled', daysStale: 0,
    organisations: ['Kallangur Supported Homes'], properties: ['Portfolio — 3 SDA dwellings, Kallangur QLD'],
    createdDate: '2026-02-18', closeDate: '2026-06-20',
  },
  {
    id: 'D-25', name: 'Marsden Park SDA', stage: '9', outcome: 'Won',
    dealType: ['Brokerage / Divestment', 'Referral'], entity: '3DSDA', owner: 'Chris Bell',
    source: 'Referral', transactionValue: 3400000, commissionPct: 0.0275,
    advisoryFee: 0, conjunctionFee: 0, referralFee: 8000, probability: 1.0,
    lostReason: null, nextAction: 'Archived — settled', daysStale: 0,
    organisations: ['Marsden Park SDA Group'], properties: ['4 dwellings, Marsden Park NSW'],
    createdDate: '2026-03-30', closeDate: '2026-08-15',
  },
];

/* --------------------------- COMPUTE HELPERS ----------------------------- */

function sdahcRevenue(deal) {
  return deal.transactionValue * deal.commissionPct + deal.advisoryFee + deal.conjunctionFee + deal.referralFee;
}

function weightedRevenue(deal) {
  return sdahcRevenue(deal) * deal.probability;
}

function isTrack(deal, track) {
  // track: 'advisory' | 'brokerage'
  return deal.dealType.some(t =>
    track === 'advisory' ? t === 'Paid advisory / DD' : t === 'Brokerage / Divestment'
  );
}

function parseDate(d) { return d ? new Date(d + 'T00:00:00') : null; }

const TODAY = new Date('2026-08-31T00:00:00');

function inRange(dateStr, start, end) {
  const d = parseDate(dateStr);
  if (!d) return false;
  return d >= start && d <= end;
}

function periodRange(periodKey) {
  const end = TODAY;
  let start;
  if (periodKey === '7d') { start = new Date(end); start.setDate(start.getDate() - 6); }
  else if (periodKey === '30d') { start = new Date(end); start.setDate(start.getDate() - 29); }
  else if (periodKey === 'quarter') { const q = Math.floor(end.getMonth() / 3); start = new Date(end.getFullYear(), q * 3, 1); }
  else { start = new Date(end.getFullYear(), 0, 1); } // ytd
  return { start, end };
}

/* Simulated projection: Notion does not track an expected close date, so one
   cannot be read from real data. This derives a rough one from stage
   probability — a higher-probability deal is assumed closer to closing —
   used only to bucket forecast revenue into months on the Revenue page.
   Clearly a modelling assumption, not an operational fact. */
function estimatedCloseDate(deal) {
  const monthsOut = Math.max(0, Math.min(7, Math.round((1 - deal.probability) * 6)));
  const d = new Date(TODAY);
  d.setMonth(d.getMonth() + monthsOut);
  return d;
}

/* Sales Funnel tiers. Each deal's `stage` reflects the furthest point it has
   reached (frozen at loss/pause, current if still active), so a global
   STAGE_INDEX threshold is a fully real, derivable "has this deal reached at
   least this depth" test — no fabricated per-deal history required. Because
   B-track stage indices always sit after every A-track index in STAGES, a
   brokerage deal automatically satisfies the advisory-milestone thresholds
   too, which correctly models "reached an equivalent depth via a different
   service line" rather than counting it as drop-off. */
const FUNNEL_TIERS = [
  { key: 'prospects',           label: 'Prospects',                minIndex: STAGE_INDEX['0'] },
  { key: 'qualified',           label: 'Qualified Opportunities',   minIndex: STAGE_INDEX['A1'] },
  { key: 'advisoryProposal',    label: 'Advisory Proposal',         minIndex: STAGE_INDEX['A2'] },
  { key: 'advisoryEngagement',  label: 'Advisory Engagement',       minIndex: STAGE_INDEX['A3'] },
  { key: 'transactionReady',    label: 'Transaction Ready',         minIndex: STAGE_INDEX['A5'] },
  { key: 'brokerageMandate',    label: 'Brokerage / Sale Mandate',  minIndex: STAGE_INDEX['B3'] },
  { key: 'negotiation',         label: 'Negotiation',               minIndex: STAGE_INDEX['B6'] },
  { key: 'contract',            label: 'Contract',                  minIndex: STAGE_INDEX['B7'] },
  { key: 'settlement',          label: 'Settlement',                minIndex: STAGE_INDEX['9'] },
];

/* NOT tracked in Notion. An editorial estimate of SDAHC's active relationship
   network (repeat clients, referral partners, valuers/advisers) that feeds
   the top of the funnel before anything becomes a tracked Prospect. Shown
   only to give the funnel its correct shape — always labelled as estimated. */
const MARKET_RELATIONSHIPS_ESTIMATE = 60;

/* Aggregate helpers — every KPI and chart in the app reads through these. */

const Aggregates = {
  won: () => DEALS.filter(d => d.outcome === 'Won'),
  lost: () => DEALS.filter(d => d.outcome === 'Lost'),
  active: () => DEALS.filter(d => d.outcome === 'In Progress'),
  paused: () => DEALS.filter(d => d.outcome === 'Paused'),

  settledRevenueYTD: () => {
    const { start, end } = periodRange('ytd');
    return DEALS.filter(d => d.outcome === 'Won' && inRange(d.closeDate, start, end))
      .reduce((sum, d) => sum + sdahcRevenue(d), 0);
  },

  contractedRevenue: () => {
    // High-confidence: active deals already at Contract Issued / Under Contract
    return DEALS.filter(d => d.outcome === 'In Progress' && (d.stage === 'B7' || d.stage === 'B8'))
      .reduce((sum, d) => sum + sdahcRevenue(d), 0);
  },

  expectedOpenPipelineRevenue: () => Aggregates.active().reduce((s, d) => s + sdahcRevenue(d), 0),

  weightedPipelineRevenue: () => Aggregates.active().reduce((s, d) => s + weightedRevenue(d), 0),

  winRate: () => {
    const won = Aggregates.won().length, lost = Aggregates.lost().length;
    return (won + lost) === 0 ? 0 : won / (won + lost);
  },

  newProspectsThisMonth: () => {
    const start = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
    return DEALS.filter(d => inRange(d.createdDate, start, TODAY)).length;
  },

  /* Deal activity summary for a period. New Prospects / Qualified / Proposals
     Sent / Engagements Won track the cohort of deals CREATED in the period and
     how far that cohort has progressed as of today. Deals Lost / Deals Settled
     use each deal's own closeDate, independent of when it was created. */
  activitySummary: (periodKey) => {
    const { start, end } = periodRange(periodKey);
    const cohort = DEALS.filter(d => inRange(d.createdDate, start, end));
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
      dealsLost: DEALS.filter(d => d.outcome === 'Lost' && inRange(d.closeDate, start, end)).length,
      dealsSettled: DEALS.filter(d => d.outcome === 'Won' && inRange(d.closeDate, start, end)).length,
    };
  },

  /* Commercial flow waterfall. New Opportunities / Lost / Settled / Closing
     are all read directly from real per-deal fields (createdDate, closeDate,
     probability, revenue). "Value Added" — the uplift in weighted pipeline
     value from deals progressing/re-scoping while they sit in the pipeline —
     has no real source: the mock dataset is a flat snapshot with no
     stage-history log, so there is nothing to diff against a prior period.
     It is therefore an EXPLICIT MOCK FIGURE: current weighted pipeline ×
     MOCK_VALUE_ADDED_ANNUAL_RATE, pro-rated to the selected period length.
     The rate is a simulated "typical annual re-rating" assumption, not a
     derived one — flagged via `valueAddedIsMock: true` so the UI can label
     it. Opening Pipeline is then derived algebraically so the bridge always
     balances exactly:
       Opening + New + ValueAdded − Lost − Settled = Closing               */
  commercialFlow: (periodKey) => {
    const { start, end } = periodRange(periodKey);
    const periodDays = (end - start) / 86400000 + 1;
    const MOCK_VALUE_ADDED_ANNUAL_RATE = 0.35;

    const closingPipeline = Aggregates.weightedPipelineRevenue();

    const newDeals = Aggregates.active().filter(d => inRange(d.createdDate, start, end));
    const newOpportunities = newDeals.reduce((s, d) => s + weightedRevenue(d), 0);

    const settledDeals = DEALS.filter(d => d.outcome === 'Won' && inRange(d.closeDate, start, end));
    const settled = settledDeals.reduce((s, d) => s + sdahcRevenue(d), 0);

    const lostDeals = DEALS.filter(d => d.outcome === 'Lost' && inRange(d.closeDate, start, end));
    const lost = lostDeals.reduce((s, d) => s + sdahcRevenue(d) * d.probability, 0);

    const valueAdded = closingPipeline * MOCK_VALUE_ADDED_ANNUAL_RATE * (periodDays / 365);

    const opening = Math.max(0, closingPipeline - newOpportunities - valueAdded + lost + settled);

    return { opening, newOpportunities, valueAdded, lost, settled, closing: closingPipeline, valueAddedIsMock: true };
  },

  byStage: (metric) => {
    // metric: 'count' | 'transactionValue' | 'revenue' | 'weighted'
    return STAGES.map(stage => {
      const deals = DEALS.filter(d => d.stage === stage.id);
      let value;
      if (metric === 'count') value = deals.length;
      else if (metric === 'transactionValue') value = deals.reduce((s, d) => s + d.transactionValue, 0);
      else if (metric === 'weighted') value = deals.reduce((s, d) => s + weightedRevenue(d), 0);
      else value = deals.reduce((s, d) => s + sdahcRevenue(d), 0);
      return {
        stage, deals,
        count: deals.length,
        transactionValue: deals.reduce((s, d) => s + d.transactionValue, 0),
        revenue: deals.reduce((s, d) => s + sdahcRevenue(d), 0),
        weighted: deals.reduce((s, d) => s + weightedRevenue(d), 0),
        value,
      };
    });
  },

  /* Shared by the Overview hero panel and the Revenue page KPIs/target bar —
     one computation so the two pages can never disagree on "are we on track". */
  revenueTargetSummary: () => {
    const target = getSettings().annualTarget;
    const settled = Aggregates.settledRevenueYTD();
    const contracted = Aggregates.contractedRevenue();
    const weighted = Aggregates.weightedPipelineRevenue();
    const totalPotential = settled + contracted + weighted;
    const gap = Math.max(0, target - totalPotential);
    const onTrack = totalPotential >= target;
    return { target, settled, contracted, weighted, totalPotential, gap, onTrack };
  },

  /* Revenue composition by fee source. Scoped to Won + In Progress + Paused
     (excludes Lost, which never generates revenue). Fully real — each
     component reads a distinct per-deal fee field. */
  revenueBySource: () => {
    const deals = DEALS.filter(d => d.outcome !== 'Lost');
    const totals = { brokerage: 0, advisory: 0, conjunction: 0, referral: 0 };
    deals.forEach(d => {
      totals.brokerage += d.transactionValue * d.commissionPct;
      totals.advisory += d.advisoryFee;
      totals.conjunction += d.conjunctionFee;
      totals.referral += d.referralFee;
    });
    const total = totals.brokerage + totals.advisory + totals.conjunction + totals.referral;
    return { totals, total, dealCount: deals.length };
  },

  /* Concentration risk: what share of expected revenue sits in the top N
     deals. Same scope as revenueBySource for consistency. */
  revenueConcentration: (n = 3) => {
    const deals = DEALS.filter(d => d.outcome !== 'Lost');
    const sorted = [...deals].sort((a, b) => sdahcRevenue(b) - sdahcRevenue(a));
    const total = sorted.reduce((s, d) => s + sdahcRevenue(d), 0);
    const top = sorted.slice(0, n);
    const topTotal = top.reduce((s, d) => s + sdahcRevenue(d), 0);
    return { top, topTotal, total, pct: total === 0 ? 0 : topTotal / total, n };
  },

  /* Monthly Actual vs Forecast vs Target for the current calendar year.
     Actual (past + current month) is real, read from closeDate. Forecast
     (current + future months) buckets active deals by estimatedCloseDate() —
     the simulated projection defined above — so treat it as directional,
     not a Notion-sourced figure. Target is annualTarget / 12, an even
     mock distribution (no seasonality modelled). */
  monthlyRevenueSeries: () => {
    const monthlyTarget = getSettings().annualTarget / 12;
    const year = TODAY.getFullYear();
    const months = [];
    for (let m = 0; m < 12; m++) {
      const monthStart = new Date(year, m, 1);
      const monthEnd = new Date(year, m + 1, 0);
      const isFuture = monthStart > TODAY;
      const isPast = monthEnd < TODAY;
      const isCurrent = !isFuture && !isPast;

      let actual = null;
      if (isPast || isCurrent) {
        actual = DEALS.filter(d => d.outcome === 'Won' && inRange(d.closeDate, monthStart, monthEnd))
          .reduce((s, d) => s + sdahcRevenue(d), 0);
      }

      let forecast = null;
      if (isFuture || isCurrent) {
        forecast = Aggregates.active().filter(d => {
          const close = estimatedCloseDate(d);
          return close >= monthStart && close <= monthEnd;
        }).reduce((s, d) => s + weightedRevenue(d), 0);
      }

      months.push({
        month: m, label: monthStart.toLocaleDateString('en-AU', { month: 'short' }),
        actual, forecast, target: monthlyTarget, isCurrent, isFuture, isPast,
      });
    }
    return months;
  },

  /* Sales Funnel — see FUNNEL_TIERS comment above for methodology. */
  funnelStages: () => {
    const tiers = FUNNEL_TIERS.map(tier => {
      const count = DEALS.filter(d => {
        const idx = STAGE_INDEX[d.stage];
        if (tier.key === 'settlement') return idx >= tier.minIndex && d.outcome === 'Won';
        return idx >= tier.minIndex;
      }).length;
      return { key: tier.key, label: tier.label, count };
    });
    const rows = [
      { key: 'market', label: 'Market / Relationships', count: MARKET_RELATIONSHIPS_ESTIMATE, isEstimate: true },
      ...tiers,
    ];
    return rows.map((row, i) => {
      const prev = i === 0 ? null : rows[i - 1].count;
      const conversion = prev ? row.count / prev : null;
      return { ...row, conversionFromPrevious: conversion, dropoffFromPrevious: conversion === null ? null : 1 - conversion };
    });
  },

  /* New prospects created vs. prospects lost, by month, over a trailing
     14-month window (covers every deal in the dataset). Real fields only. */
  prospectsOverTime: () => {
    const months = [];
    const endYear = TODAY.getFullYear(), endMonth = TODAY.getMonth();
    for (let i = 13; i >= 0; i--) {
      const ref = new Date(endYear, endMonth - i, 1);
      const monthStart = new Date(ref.getFullYear(), ref.getMonth(), 1);
      const monthEnd = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
      const newCount = DEALS.filter(d => inRange(d.createdDate, monthStart, monthEnd)).length;
      const lostCount = DEALS.filter(d => d.outcome === 'Lost' && inRange(d.closeDate, monthStart, monthEnd)).length;
      months.push({ label: monthStart.toLocaleDateString('en-AU', { month: 'short', year: '2-digit' }), newCount, lostCount });
    }
    return months;
  },

  /* Ultimate win-rate of each creation-quarter's cohort (Won / (Won + Lost)
     among deals that have been decided; still-open deals are excluded from
     the rate but not from `created`). Quarterly, not monthly, because
     monthly cohorts in a 25-deal dataset are too thin to read. */
  conversionByQuarter: () => {
    const quarters = {};
    DEALS.forEach(d => {
      const dt = parseDate(d.createdDate);
      const q = Math.floor(dt.getMonth() / 3) + 1;
      const key = `${dt.getFullYear()} Q${q}`;
      if (!quarters[key]) quarters[key] = { label: key, created: 0, won: 0, lost: 0 };
      quarters[key].created++;
      if (d.outcome === 'Won') quarters[key].won++;
      if (d.outcome === 'Lost') quarters[key].lost++;
    });
    return Object.values(quarters).sort((a, b) => a.label.localeCompare(b.label)).map(q => ({
      ...q,
      decided: q.won + q.lost,
      conversionRate: (q.won + q.lost) === 0 ? null : q.won / (q.won + q.lost),
    }));
  },

  /* Prospect source performance, individually and rolled up into
     Relationship-led vs Marketing-sourced (per the PROSPECT_SOURCES groups).
     "Qualified" = reached at least stage A1/B1 (STAGE_INDEX['A1']). */
  prospectSourceBreakdown: () => {
    const qualifiedMinIndex = STAGE_INDEX['A1'];
    const isQualified = (d) => STAGE_INDEX[d.stage] >= qualifiedMinIndex;

    const bySource = PROSPECT_SOURCES.map(src => {
      const deals = DEALS.filter(d => d.source === src.id);
      const qualified = deals.filter(isQualified).length;
      return { source: src.id, group: src.group, count: deals.length, qualified, qualifiedRate: deals.length === 0 ? 0 : qualified / deals.length };
    }).filter(row => row.count > 0);

    const groups = ['relationship', 'marketing'].map(g => {
      const deals = DEALS.filter(d => sourceGroup(d.source) === g);
      const qualified = deals.filter(isQualified).length;
      return { group: g, count: deals.length, qualified, qualifiedRate: deals.length === 0 ? 0 : qualified / deals.length };
    });

    return { bySource, groups };
  },
};

/* ------------------------------ SETTINGS --------------------------------- */
/* Dashboard-owned data. Simulated with localStorage so a future Settings page
   can edit it without touching Notion. Seeded once; never overwritten after. */

const DEFAULT_SETTINGS = {
  annualTarget: 1600000,
  syncStatus: { connected: true, lastSyncMinutesAgo: 2 },
};

const SETTINGS_KEY = 'sdahc_intelligence_settings_v1';

function initSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(DEFAULT_SETTINGS));
      return { ...DEFAULT_SETTINGS };
    }
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch (e) {
    return { ...DEFAULT_SETTINGS };
  }
}

function getSettings() { return initSettings(); }
