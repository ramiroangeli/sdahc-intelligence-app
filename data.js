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
/* Ordered exactly as the real Notion pipeline. Probability is NOT derived
   from stage — it comes from each deal's own `probability` field, exactly
   as Steve sets it in Notion (see DEALS below). There is no stage-based
   default or fallback anywhere in this file. */

const STAGES = [
  { id: '0',  label: '0. Prospect',                        short: 'Prospect',            group: 'prospecting' },
  { id: '1',  label: '1. Contacted',                        short: 'Contacted',           group: 'prospecting' },
  { id: 'A1', label: 'A1. Information Requested',           short: 'Info Requested',      group: 'advisory' },
  { id: 'A2', label: 'A2. Advisory Proposal Sent',          short: 'Proposal Sent',       group: 'advisory' },
  { id: 'A3', label: 'A3. Advisory / DD Engaged',           short: 'DD Engaged',          group: 'advisory' },
  { id: 'A4', label: 'A4. DD / Advisory In Progress',       short: 'DD In Progress',      group: 'advisory' },
  { id: 'A5', label: 'A5. Advisory Complete',                short: 'Advisory Complete',   group: 'advisory' },
  { id: 'B1', label: 'B1. Information Request',             short: 'Info Request',        group: 'brokerage' },
  { id: 'B2', label: 'B2. Brokerage Proposal Sent',         short: 'Proposal Sent',       group: 'brokerage' },
  { id: 'B3', label: 'B3. Appointed & Market Preparation',  short: 'Appointed',           group: 'brokerage' },
  { id: 'B4', label: 'B4. Buyer Outreach / IM Sent',        short: 'Buyer Outreach',      group: 'brokerage' },
  { id: 'B5', label: 'B5. Buyer Follow-up',                  short: 'Buyer Follow-up',     group: 'brokerage' },
  { id: 'B6', label: 'B6. Negotiation',                      short: 'Negotiation',         group: 'negotiation' },
  { id: 'B7', label: 'B7. Contract Issued',                  short: 'Contract Issued',     group: 'negotiation' },
  { id: 'B8', label: 'B8. Under Contract',                   short: 'Under Contract',      group: 'negotiation' },
  { id: '9',  label: '9. Settlement',                        short: 'Settlement',          group: 'settlement' },
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
   flat AUD amounts. `probability` is a per-deal Notion value Steve sets
   directly on the deal — never a stage-based default. `score` is a mock
   stand-in for the Score Notion computes as a formula (see ASSUMPTIONS
   'pipeline-score-mock') — it drives the Pipeline table's fixed sort order. */

const DEALS = [
  {
    id: 'D-01', name: 'SDA Abodes / Socia', stage: 'B8', outcome: 'In Progress',
    dealType: ['Brokerage / Divestment'], entity: 'SDA Home Choices', owner: 'Steve Harrington',
    source: 'Steve Relationship Network', transactionValue: 3200000, commissionPct: 0.025,
    advisoryFee: 0, conjunctionFee: 0, referralFee: 0, probability: 0.92, score: 78,
    lostReason: null, nextAction: 'Finalise settlement statement with vendor solicitor', daysStale: 4,
    organisations: ['Socia'], properties: ['12 Bellbird Cres, Logan QLD'],
    createdDate: '2026-03-10', closeDate: null,
    stageHistory: [
      { stage: '0', enteredDate: '2026-03-09' },
      { stage: '1', enteredDate: '2026-03-28' },
      { stage: 'B1', enteredDate: '2026-04-17' },
      { stage: 'B2', enteredDate: '2026-05-06' },
      { stage: 'B3', enteredDate: '2026-05-25' },
      { stage: 'B4', enteredDate: '2026-06-14' },
      { stage: 'B5', enteredDate: '2026-07-03' },
      { stage: 'B6', enteredDate: '2026-07-22' },
      { stage: 'B7', enteredDate: '2026-08-11' },
      { stage: 'B8', enteredDate: '2026-08-30' },
    ],
    progressPct: 88, health: 'On track',
    deliverables: [
      { name: 'Contract Execution', acceptanceCriteria: 'Contract of sale executed by both parties', status: 'Accepted' },
      { name: 'Settlement Statement', acceptanceCriteria: 'Settlement statement prepared and agreed with vendor solicitor', status: 'In progress' },
      { name: 'Final Settlement Coordination', acceptanceCriteria: 'Funds cleared and title transferred', status: 'Not started' },
    ],
    milestones: [
      { name: 'Exchange Fee (10%)', dueDate: '2026-07-20', amount: 8000, status: 'Paid', unlockCondition: 'Contract exchanged' },
      { name: 'Settlement Commission (90%)', dueDate: '2026-09-05', amount: 72000, status: 'WIP', unlockCondition: 'Settlement completes and funds clear to trust account' },
    ],
  },
  {
    id: 'D-02', name: 'Paramount Disability Homes', stage: 'A4', outcome: 'In Progress',
    dealType: ['Paid advisory / DD'], entity: 'SDA Home Choices', owner: 'Emma Voss',
    source: 'Referral', transactionValue: 8500000, commissionPct: 0,
    conjunctionFee: 0, referralFee: 0, probability: 0.55, score: 53,
    lostReason: null, nextAction: 'Deliver draft due-diligence report to investment committee', daysStale: 9,
    organisations: ['Paramount Disability Homes Pty Ltd'], properties: ['Portfolio — 6 SDA dwellings, Ipswich'],
    createdDate: '2026-02-01', closeDate: null,
    stageHistory: [
      { stage: '0', enteredDate: '2026-01-31' },
      { stage: '1', enteredDate: '2026-03-14' },
      { stage: 'A1', enteredDate: '2026-04-25' },
      { stage: 'A2', enteredDate: '2026-06-07' },
      { stage: 'A3', enteredDate: '2026-07-19' },
      { stage: 'A4', enteredDate: '2026-08-30' },
    ],
    progressPct: 55, health: 'On track',
    deliverables: [
      { name: 'Data Room Review', acceptanceCriteria: 'All vendor-supplied financial and occupancy data reviewed', status: 'Delivered' },
      { name: 'Income & Occupancy Analysis', acceptanceCriteria: 'Actual vs theoretical income and occupancy normalised', status: 'Delivered' },
      { name: 'Draft DD Report', acceptanceCriteria: 'Draft due-diligence report drafted for client review', status: 'In progress' },
      { name: 'Investment Committee Sign-off', acceptanceCriteria: 'Report accepted by client investment committee', status: 'Not started' },
    ],
    /* Explicit advisory billing tranches — manually entered, mirroring the
       Notion fields these will become (see ASSUMPTIONS 'delivery-tranche-fields').
       Not a fixed 50/50 split: this engagement was billed 60/40. */
    consultancyFeeTotal: 65000,
    tranche1Amount: 39000, tranche1Status: 'Paid', tranche1Date: '2026-02-15',
    tranche2Amount: 26000, tranche2Status: 'WIP', tranche2Date: '2026-09-20',
  },
  {
    id: 'D-03', name: 'Evergreen Built', stage: 'B3', outcome: 'In Progress',
    dealType: ['Brokerage / Divestment', 'Strategic Partnership / Agency Collaboration'], entity: 'SDA Home Choices', owner: 'Daniel Reyes',
    source: 'SDA Report', transactionValue: 4100000, commissionPct: 0.0275,
    advisoryFee: 0, conjunctionFee: 20000, referralFee: 0, probability: 0.35, score: 56,
    lostReason: null, nextAction: 'Finalise marketing collateral ahead of buyer outreach', daysStale: 15,
    organisations: ['Evergreen Built Pty Ltd'], properties: ['4 dwellings, Caboolture QLD'],
    createdDate: '2026-05-01', closeDate: null,
    stageHistory: [
      { stage: '0', enteredDate: '2026-04-30' },
      { stage: '1', enteredDate: '2026-05-31' },
      { stage: 'B1', enteredDate: '2026-06-30' },
      { stage: 'B2', enteredDate: '2026-07-31' },
      { stage: 'B3', enteredDate: '2026-08-30' },
    ],
    progressPct: 30, health: 'At risk',
    deliverables: [
      { name: 'Data Room Setup', acceptanceCriteria: 'Data room structured and populated with vendor documents', status: 'Delivered' },
      { name: 'Marketing Collateral', acceptanceCriteria: 'Teaser, IM and campaign collateral finalised', status: 'In progress' },
      { name: 'Buyer Target List', acceptanceCriteria: 'Target buyer segments identified and prioritised', status: 'Not started' },
    ],
    milestones: [
      { name: 'Conjunction Fee (on buyer engagement)', dueDate: '2026-09-08', amount: 20000, status: 'Not started', unlockCondition: 'Conjunction agent engages a qualified buyer' },
      { name: 'Brokerage Commission (on settlement)', dueDate: '2026-11-15', amount: 112750, status: 'Not started', unlockCondition: 'Settlement completes' },
    ],
  },
  {
    id: 'D-04', name: 'LVP Logan', stage: 'B6', outcome: 'In Progress',
    dealType: ['Brokerage / Divestment'], entity: 'SDA Home Choices', owner: 'Steve Harrington',
    source: 'Steve Relationship Network', transactionValue: 2650000, commissionPct: 0.03,
    advisoryFee: 0, conjunctionFee: 0, referralFee: 0, probability: 0.75, score: 70,
    lostReason: null, nextAction: 'Review buyer counter-offer with vendor', daysStale: 3,
    organisations: ['LVP Investments'], properties: ['8 Kingfisher St, Logan QLD'],
    createdDate: '2026-04-12', closeDate: null,
    stageHistory: [
      { stage: '0', enteredDate: '2026-04-12' },
      { stage: '1', enteredDate: '2026-04-25' },
      { stage: 'B1', enteredDate: '2026-05-08' },
      { stage: 'B2', enteredDate: '2026-05-22' },
      { stage: 'B3', enteredDate: '2026-06-05' },
      { stage: 'B4', enteredDate: '2026-06-19' },
      { stage: 'B5', enteredDate: '2026-07-03' },
      { stage: 'B6', enteredDate: '2026-07-20' },
      { stage: 'B4', enteredDate: '2026-08-05' },
      { stage: 'B5', enteredDate: '2026-08-15' },
      { stage: 'B6', enteredDate: '2026-08-28' },
    ],
  },
  {
    id: 'D-05', name: 'Living Well Solutions', stage: 'A2', outcome: 'In Progress',
    dealType: ['Paid advisory / DD'], entity: 'SDA Home Choices', owner: 'Priya Nathan',
    source: 'LinkedIn / Marketing', transactionValue: 5000000, commissionPct: 0,
    advisoryFee: 28000, conjunctionFee: 0, referralFee: 0, probability: 0.25, score: 28,
    lostReason: null, nextAction: 'Follow up on advisory proposal sent 8 days ago', daysStale: 12,
    organisations: ['Living Well Solutions'], properties: ['Portfolio under review — 3 assets'],
    createdDate: '2026-06-20', closeDate: null,
    stageHistory: [
      { stage: '0', enteredDate: '2026-06-19' },
      { stage: '1', enteredDate: '2026-07-13' },
      { stage: 'A1', enteredDate: '2026-08-06' },
      { stage: 'A2', enteredDate: '2026-08-30' },
    ],
  },
  {
    id: 'D-06', name: 'Skychest', stage: 'B2', outcome: 'In Progress',
    dealType: ['Strategic Partnership / Agency Collaboration', 'Brokerage / Divestment'], entity: '3DSDA', owner: 'Chris Bell',
    source: 'Valuer / Adviser', transactionValue: 6300000, commissionPct: 0.0225,
    advisoryFee: 0, conjunctionFee: 15000, referralFee: 0, probability: 0.20, score: 50,
    lostReason: null, nextAction: 'Present brokerage proposal to fund board', daysStale: 20,
    organisations: ['Skychest Capital'], properties: ['Portfolio — 5 SDA assets, SE QLD'],
    createdDate: '2026-05-15', closeDate: null,
    stageHistory: [
      { stage: '0', enteredDate: '2026-05-14' },
      { stage: '1', enteredDate: '2026-06-19' },
      { stage: 'B1', enteredDate: '2026-07-25' },
      { stage: 'B2', enteredDate: '2026-08-30' },
    ],
  },
  {
    id: 'D-07', name: 'Williams Landing', stage: '9', outcome: 'Won',
    dealType: ['Brokerage / Divestment'], entity: 'SDA Home Choices', owner: 'Steve Harrington',
    source: 'Existing Client', transactionValue: 2900000, commissionPct: 0.0275,
    advisoryFee: 0, conjunctionFee: 0, referralFee: 0, probability: 1.0, score: 84,
    lostReason: null, nextAction: 'Archived — settled', daysStale: 0,
    organisations: ['Williams Landing SDA Trust'], properties: ['3 Grevillea Ct, Williams Landing VIC'],
    createdDate: '2025-11-02', closeDate: '2026-02-10',
    stageHistory: [
      { stage: '0', enteredDate: '2025-11-01' },
      { stage: '1', enteredDate: '2025-11-11' },
      { stage: 'B1', enteredDate: '2025-11-21' },
      { stage: 'B2', enteredDate: '2025-12-01' },
      { stage: 'B3', enteredDate: '2025-12-11' },
      { stage: 'B4', enteredDate: '2025-12-21' },
      { stage: 'B5', enteredDate: '2025-12-31' },
      { stage: 'B6', enteredDate: '2026-01-10' },
      { stage: 'B7', enteredDate: '2026-01-20' },
      { stage: 'B8', enteredDate: '2026-01-30' },
      { stage: '9', enteredDate: '2026-02-09' },
    ],
  },
  {
    id: 'D-08', name: 'Horizon SDA Fund', stage: 'A5', outcome: 'In Progress',
    dealType: ['Paid advisory / DD'], entity: 'SDA Home Choices', owner: 'Emma Voss',
    source: 'Existing Client', transactionValue: 12000000, commissionPct: 0,
    conjunctionFee: 0, referralFee: 0, probability: 0.70, score: 66,
    lostReason: null, nextAction: 'Awaiting client go-ahead to proceed to brokerage mandate', daysStale: 6,
    organisations: ['Horizon SDA Fund'], properties: ['Portfolio — 9 SDA dwellings, QLD-wide'],
    createdDate: '2026-01-20', closeDate: null,
    stageHistory: [
      { stage: '0', enteredDate: '2026-01-19' },
      { stage: '1', enteredDate: '2026-02-25' },
      { stage: 'A1', enteredDate: '2026-04-03' },
      { stage: 'A2', enteredDate: '2026-05-11' },
      { stage: 'A3', enteredDate: '2026-06-17' },
      { stage: 'A4', enteredDate: '2026-07-24' },
      { stage: 'A5', enteredDate: '2026-08-30' },
    ],
    progressPct: 95, health: 'On track',
    deliverables: [
      { name: 'Data Room Review', acceptanceCriteria: 'All vendor-supplied financial and occupancy data reviewed', status: 'Delivered' },
      { name: 'Commercial DD Report', acceptanceCriteria: 'Final commercial due-diligence report delivered to client', status: 'Accepted' },
      { name: 'Investment Committee Presentation', acceptanceCriteria: 'Findings presented and accepted by client investment committee', status: 'Accepted' },
    ],
    /* Explicit advisory billing tranches — manually entered, mirroring the
       Notion fields these will become (see ASSUMPTIONS 'delivery-tranche-fields').
       Billed 70/30, not a fixed split. */
    consultancyFeeTotal: 80000,
    tranche1Amount: 56000, tranche1Status: 'Invoiced', tranche1Date: '2026-01-25',
    tranche2Amount: 24000, tranche2Status: 'Not started', tranche2Date: '2026-09-10',
    /* Soft, unquantified note only — NOT a modelled dependency. Steve
       confirmed brokerage is not formally gated on advisory completing; it's
       only a tendency (a deal can be advisory-only, brokerage-only, or a
       sequence). No estimated dollar figure, no "condition" to satisfy. */
    advisoryToBrokerageNote: 'Advisory engagements like this one can sometimes lead to a later brokerage mandate on the same asset — that\'s a tendency, not a dependency; this deal may never become a brokerage listing.',
  },
  {
    id: 'D-09', name: 'Northline Community Housing', stage: 'B7', outcome: 'In Progress',
    dealType: ['Brokerage / Divestment'], entity: 'SDA Home Choices', owner: 'Daniel Reyes',
    source: 'Referral', transactionValue: 3750000, commissionPct: 0.025,
    advisoryFee: 0, conjunctionFee: 0, referralFee: 0, probability: 0.85, score: 78,
    lostReason: null, nextAction: 'Awaiting signed contract return from buyer', daysStale: 2,
    organisations: ['Northline Community Housing Ltd'], properties: ['6 Wattle Ave, Ipswich QLD'],
    createdDate: '2026-03-25', closeDate: null,
    stageHistory: [
      { stage: '0', enteredDate: '2026-03-24' },
      { stage: '1', enteredDate: '2026-04-13' },
      { stage: 'B1', enteredDate: '2026-05-03' },
      { stage: 'B2', enteredDate: '2026-05-23' },
      { stage: 'B3', enteredDate: '2026-06-12' },
      { stage: 'B4', enteredDate: '2026-07-01' },
      { stage: 'B5', enteredDate: '2026-07-21' },
      { stage: 'B6', enteredDate: '2026-08-10' },
      { stage: 'B7', enteredDate: '2026-08-30' },
    ],
    progressPct: 80, health: 'On track',
    deliverables: [
      { name: 'Contract Preparation', acceptanceCriteria: 'Contract of sale prepared and issued to buyer', status: 'Delivered' },
      { name: 'Buyer Signature', acceptanceCriteria: 'Signed contract returned by buyer', status: 'In progress' },
      { name: 'Settlement Coordination', acceptanceCriteria: 'Settlement date confirmed with all parties', status: 'Not started' },
    ],
    milestones: [
      { name: 'Brokerage Commission (on settlement)', dueDate: '2026-09-25', amount: 93750, status: 'WIP', unlockCondition: 'Signed contract returned and settlement completes' },
    ],
  },
  {
    id: 'D-10', name: 'Riverside Accessible Homes', stage: '1', outcome: 'In Progress',
    dealType: ['Referral'], entity: 'SDA Home Choices', owner: 'Priya Nathan',
    source: 'Referral', transactionValue: 1800000, commissionPct: 0,
    advisoryFee: 0, conjunctionFee: 0, referralFee: 9000, probability: 0.10, score: 19,
    lostReason: null, nextAction: 'Qualify opportunity and confirm investor intent', daysStale: 7,
    organisations: ['Riverside Accessible Homes'], properties: ['2 dwellings, Redbank Plains QLD'],
    createdDate: '2026-08-24', closeDate: null,
    stageHistory: [
      { stage: '0', enteredDate: '2026-08-23' },
      { stage: '1', enteredDate: '2026-08-30' },
    ],
  },
  {
    id: 'D-11', name: 'Bellbird Park SDA', stage: 'B4', outcome: 'In Progress',
    dealType: ['Brokerage / Divestment'], entity: 'SDA Home Choices', owner: 'Steve Harrington',
    source: 'Steve Relationship Network', transactionValue: 4600000, commissionPct: 0.025,
    advisoryFee: 0, conjunctionFee: 0, referralFee: 0, probability: 0.45, score: 59,
    lostReason: null, nextAction: 'Follow up with shortlisted buyers post IM distribution', daysStale: 11,
    organisations: ['Bellbird Park Holdings'], properties: ['5 dwellings, Bellbird Park QLD'],
    createdDate: '2026-05-28', closeDate: null,
    stageHistory: [
      { stage: '0', enteredDate: '2026-05-27' },
      { stage: '1', enteredDate: '2026-06-15' },
      { stage: 'B1', enteredDate: '2026-07-04' },
      { stage: 'B2', enteredDate: '2026-07-23' },
      { stage: 'B3', enteredDate: '2026-08-11' },
      { stage: 'B4', enteredDate: '2026-08-30' },
    ],
    progressPct: 45, health: 'On track',
    deliverables: [
      { name: 'IM Distribution', acceptanceCriteria: 'Information memorandum distributed to shortlisted buyers', status: 'Delivered' },
      { name: 'Buyer Follow-up', acceptanceCriteria: 'Shortlisted buyers followed up post-distribution', status: 'In progress' },
      { name: 'Offer Collection', acceptanceCriteria: 'Formal offers collected from interested buyers', status: 'Not started' },
    ],
    milestones: [
      { name: 'Brokerage Commission (on settlement)', dueDate: '2026-10-20', amount: 115000, status: 'WIP', unlockCondition: 'Buyer signs contract and settlement completes' },
    ],
  },
  {
    id: 'D-12', name: 'Wattle Grove Residences', stage: '0', outcome: 'In Progress',
    dealType: ['Paid advisory / DD'], entity: 'SDA Home Choices', owner: 'Chris Bell',
    source: 'SDA Report', transactionValue: 2200000, commissionPct: 0,
    advisoryFee: 0, conjunctionFee: 0, referralFee: 0, probability: 0.05, score: 16,
    lostReason: null, nextAction: 'Initial outreach call to gauge appetite', daysStale: 4,
    organisations: ['Wattle Grove Residences'], properties: ['Single dwelling, Wattle Grove NSW'],
    createdDate: '2026-08-27', closeDate: null,
    stageHistory: [
      { stage: '0', enteredDate: '2026-08-26' },
    ],
  },
  {
    id: 'D-13', name: 'Coomera SDA Portfolio', stage: 'B5', outcome: 'In Progress',
    dealType: ['Brokerage / Divestment'], entity: '3DSDA', owner: 'Emma Voss',
    source: 'Valuer / Adviser', transactionValue: 7200000, commissionPct: 0.0225,
    advisoryFee: 0, conjunctionFee: 0, referralFee: 0, probability: 0.55, score: 74,
    lostReason: null, nextAction: 'Chase buyer finance approval status', daysStale: 8,
    organisations: ['Coomera SDA Portfolio Trust'], properties: ['Portfolio — 4 SDA assets, Coomera QLD'],
    createdDate: '2026-04-02', closeDate: null,
    stageHistory: [
      { stage: '0', enteredDate: '2026-04-01' },
      { stage: '1', enteredDate: '2026-04-26' },
      { stage: 'B1', enteredDate: '2026-05-21' },
      { stage: 'B2', enteredDate: '2026-06-16' },
      { stage: 'B4', enteredDate: '2026-08-05' },
      { stage: 'B5', enteredDate: '2026-08-30' },
    ],
  },
  {
    id: 'D-14', name: 'Sunshine Coast Disability Housing', stage: 'A1', outcome: 'In Progress',
    dealType: ['Paid advisory / DD'], entity: '3DSDA', owner: 'Daniel Reyes',
    source: 'LinkedIn / Marketing', transactionValue: 3400000, commissionPct: 0,
    advisoryFee: 0, conjunctionFee: 0, referralFee: 0, probability: 0.15, score: 20,
    lostReason: null, nextAction: 'Send information pack and engagement scope', daysStale: 6,
    organisations: ['Sunshine Coast Disability Housing Co-op'], properties: ['3 dwellings, Sippy Downs QLD'],
    createdDate: '2026-07-18', closeDate: null,
    stageHistory: [
      { stage: '0', enteredDate: '2026-07-17' },
      { stage: '1', enteredDate: '2026-08-08' },
      { stage: 'A1', enteredDate: '2026-08-30' },
    ],
  },
  {
    id: 'D-15', name: 'Ipswich Central SDA', stage: '9', outcome: 'Won',
    dealType: ['Brokerage / Divestment'], entity: 'SDA Home Choices', owner: 'Steve Harrington',
    source: 'Steve Relationship Network', transactionValue: 1950000, commissionPct: 0.03,
    advisoryFee: 0, conjunctionFee: 0, referralFee: 0, probability: 1.0, score: 79,
    lostReason: null, nextAction: 'Archived — settled', daysStale: 0,
    organisations: ['Ipswich Central SDA Holdings'], properties: ['2 dwellings, Ipswich Central QLD'],
    createdDate: '2025-09-10', closeDate: '2025-12-18',
    stageHistory: [
      { stage: '0', enteredDate: '2025-09-09' },
      { stage: '1', enteredDate: '2025-09-19' },
      { stage: 'B1', enteredDate: '2025-09-29' },
      { stage: 'B2', enteredDate: '2025-10-09' },
      { stage: 'B3', enteredDate: '2025-10-19' },
      { stage: 'B4', enteredDate: '2025-10-29' },
      { stage: 'B5', enteredDate: '2025-11-07' },
      { stage: 'B6', enteredDate: '2025-11-17' },
      { stage: 'B7', enteredDate: '2025-11-27' },
      { stage: 'B8', enteredDate: '2025-12-07' },
      { stage: '9', enteredDate: '2025-12-17' },
    ],
  },
  {
    id: 'D-16', name: 'Meadowbrook Supported Living', stage: 'A3', outcome: 'Lost',
    dealType: ['Paid advisory / DD'], entity: 'SDA Home Choices', owner: 'Priya Nathan',
    source: 'Referral', transactionValue: 2750000, commissionPct: 0,
    advisoryFee: 18000, conjunctionFee: 0, referralFee: 0, probability: 0.40, score: 39,
    lostReason: 'Investor found alternative', nextAction: 'Closed — no further action', daysStale: 0,
    organisations: ['Meadowbrook Supported Living'], properties: ['3 dwellings, Meadowbrook QLD'],
    createdDate: '2026-01-08', closeDate: '2026-03-15',
    stageHistory: [
      { stage: '0', enteredDate: '2026-01-07' },
      { stage: '1', enteredDate: '2026-01-24' },
      { stage: 'A1', enteredDate: '2026-02-09' },
      { stage: 'A2', enteredDate: '2026-02-26' },
      { stage: 'A3', enteredDate: '2026-03-14' },
    ],
  },
  {
    id: 'D-17', name: 'Caboolture SDA Development', stage: 'B3', outcome: 'Lost',
    dealType: ['Brokerage / Divestment'], entity: 'SDA Home Choices', owner: 'Chris Bell',
    source: 'SDA Report', transactionValue: 5500000, commissionPct: 0.025,
    advisoryFee: 0, conjunctionFee: 0, referralFee: 0, probability: 0.35, score: 65,
    lostReason: 'Price too high', nextAction: 'Closed — no further action', daysStale: 0,
    organisations: ['Caboolture SDA Development Co'], properties: ['Portfolio — 5 dwellings, Caboolture QLD'],
    createdDate: '2026-02-12', closeDate: '2026-04-22',
    stageHistory: [
      { stage: '0', enteredDate: '2026-02-11' },
      { stage: '1', enteredDate: '2026-02-28' },
      { stage: 'B1', enteredDate: '2026-03-18' },
      { stage: 'B2', enteredDate: '2026-04-04' },
      { stage: 'B3', enteredDate: '2026-04-21' },
    ],
  },
  {
    id: 'D-18', name: 'Redland Bay Accessible Homes', stage: 'A2', outcome: 'Paused',
    dealType: ['Referral'], entity: 'SDA Home Choices', owner: 'Emma Voss',
    source: 'Referral', transactionValue: 1600000, commissionPct: 0,
    advisoryFee: 0, conjunctionFee: 0, referralFee: 6500, probability: 0.25, score: 14,
    lostReason: null, nextAction: 'On hold — investor reviewing finance position', daysStale: 45,
    organisations: ['Redland Bay Accessible Homes'], properties: ['2 dwellings, Redland Bay QLD'],
    createdDate: '2026-02-14', closeDate: null,
    stageHistory: [
      { stage: '0', enteredDate: '2026-02-13' },
      { stage: '1', enteredDate: '2026-04-20' },
      { stage: 'A1', enteredDate: '2026-06-25' },
      { stage: 'A2', enteredDate: '2026-08-30' },
    ],
  },
  {
    id: 'D-19', name: 'Springfield Lakes SDA', stage: 'B1', outcome: 'In Progress',
    dealType: ['Brokerage / Divestment'], entity: 'SDA Home Choices', owner: 'Daniel Reyes',
    source: 'Existing Client', transactionValue: 3100000, commissionPct: 0.025,
    advisoryFee: 0, conjunctionFee: 0, referralFee: 0, probability: 0.15, score: 35,
    lostReason: null, nextAction: 'Gather property information pack from vendor', daysStale: 11,
    organisations: ['Springfield Lakes SDA Group'], properties: ['3 dwellings, Springfield Lakes QLD'],
    createdDate: '2026-08-20', closeDate: null,
    stageHistory: [
      { stage: '0', enteredDate: '2026-08-19' },
      { stage: '1', enteredDate: '2026-08-25' },
      { stage: 'B1', enteredDate: '2026-08-30' },
    ],
  },
  {
    id: 'D-20', name: 'Toowoomba Disability Housing Trust', stage: '9', outcome: 'Won',
    dealType: ['Paid advisory / DD'], entity: 'SDA Home Choices', owner: 'Priya Nathan',
    source: 'Valuer / Adviser', transactionValue: 9800000, commissionPct: 0,
    advisoryFee: 72000, conjunctionFee: 0, referralFee: 0, probability: 1.0, score: 82,
    lostReason: null, nextAction: 'Archived — settled', daysStale: 0,
    organisations: ['Toowoomba Disability Housing Trust'], properties: ['Portfolio — 7 SDA dwellings, Toowoomba QLD'],
    createdDate: '2025-10-05', closeDate: '2026-01-22',
    stageHistory: [
      { stage: '0', enteredDate: '2025-10-04' },
      { stage: '1', enteredDate: '2025-10-11' },
      { stage: 'A1', enteredDate: '2025-10-19' },
      { stage: 'A2', enteredDate: '2025-10-26' },
      { stage: 'A3', enteredDate: '2025-11-02' },
      { stage: 'A4', enteredDate: '2025-11-09' },
      { stage: 'A5', enteredDate: '2025-11-17' },
      { stage: 'B1', enteredDate: '2025-11-24' },
      { stage: 'B2', enteredDate: '2025-12-01' },
      { stage: 'B3', enteredDate: '2025-12-08' },
      { stage: 'B4', enteredDate: '2025-12-16' },
      { stage: 'B5', enteredDate: '2025-12-23' },
      { stage: 'B6', enteredDate: '2025-12-30' },
      { stage: 'B7', enteredDate: '2026-01-07' },
      { stage: 'B8', enteredDate: '2026-01-14' },
      { stage: '9', enteredDate: '2026-01-21' },
    ],
  },
  {
    id: 'D-21', name: 'Gold Coast SDA Collective', stage: 'B6', outcome: 'Lost',
    dealType: ['Strategic Partnership / Agency Collaboration'], entity: 'SDA Home Choices', owner: 'Steve Harrington',
    source: 'Steve Relationship Network', transactionValue: 6900000, commissionPct: 0.02,
    advisoryFee: 0, conjunctionFee: 10000, referralFee: 0, probability: 0.70, score: 85,
    lostReason: 'Vendor chose direct buyer', nextAction: 'Closed — no further action', daysStale: 0,
    organisations: ['Gold Coast SDA Collective'], properties: ['Portfolio — 6 SDA assets, Gold Coast QLD'],
    createdDate: '2026-01-05', closeDate: '2026-06-05',
    stageHistory: [
      { stage: '0', enteredDate: '2026-01-04' },
      { stage: '1', enteredDate: '2026-01-26' },
      { stage: 'B1', enteredDate: '2026-02-16' },
      { stage: 'B2', enteredDate: '2026-03-10' },
      { stage: 'B3', enteredDate: '2026-03-31' },
      { stage: 'B4', enteredDate: '2026-04-22' },
      { stage: 'B5', enteredDate: '2026-05-14' },
      { stage: 'B6', enteredDate: '2026-06-04' },
    ],
  },
  {
    id: 'D-22', name: 'Logan Reserve Homes', stage: 'B8', outcome: 'In Progress',
    dealType: ['Brokerage / Divestment'], entity: 'SDA Home Choices', owner: 'Chris Bell',
    source: 'Referral', transactionValue: 2450000, commissionPct: 0.03,
    advisoryFee: 0, conjunctionFee: 0, referralFee: 0, probability: 0.92, score: 76,
    lostReason: null, nextAction: 'Coordinate settlement date with all parties', daysStale: 5,
    organisations: ['Logan Reserve Homes Pty Ltd'], properties: ['3 Ironbark Way, Logan Reserve QLD'],
    createdDate: '2026-05-10', closeDate: null,
    stageHistory: [
      { stage: '0', enteredDate: '2026-05-09' },
      { stage: '1', enteredDate: '2026-05-22' },
      { stage: 'B1', enteredDate: '2026-06-03' },
      { stage: 'B2', enteredDate: '2026-06-16' },
      { stage: 'B3', enteredDate: '2026-06-28' },
      { stage: 'B4', enteredDate: '2026-07-11' },
      { stage: 'B5', enteredDate: '2026-07-23' },
      { stage: 'B6', enteredDate: '2026-08-05' },
      { stage: 'B7', enteredDate: '2026-08-18' },
      { stage: 'B8', enteredDate: '2026-08-30' },
    ],
  },
  {
    id: 'D-23', name: 'Bayview SDA Portfolio', stage: '9', outcome: 'Won',
    dealType: ['Brokerage / Divestment'], entity: 'SDA Home Choices', owner: 'Steve Harrington',
    source: 'Steve Relationship Network', transactionValue: 5200000, commissionPct: 0.025,
    advisoryFee: 0, conjunctionFee: 0, referralFee: 0, probability: 1.0, score: 95,
    lostReason: null, nextAction: 'Archived — settled', daysStale: 0,
    organisations: ['Bayview SDA Holdings'], properties: ['Portfolio — 4 SDA dwellings, Bayview VIC'],
    createdDate: '2025-12-20', closeDate: '2026-05-05',
    stageHistory: [
      { stage: '0', enteredDate: '2025-12-19' },
      { stage: '1', enteredDate: '2026-01-02' },
      { stage: 'B1', enteredDate: '2026-01-15' },
      { stage: 'B2', enteredDate: '2026-01-29' },
      { stage: 'B3', enteredDate: '2026-02-11' },
      { stage: 'B4', enteredDate: '2026-02-25' },
      { stage: 'B5', enteredDate: '2026-03-11' },
      { stage: 'B6', enteredDate: '2026-03-24' },
      { stage: 'B7', enteredDate: '2026-04-07' },
      { stage: 'B8', enteredDate: '2026-04-20' },
      { stage: '9', enteredDate: '2026-05-04' },
    ],
  },
  {
    id: 'D-24', name: 'Kallangur Supported Homes', stage: '9', outcome: 'Won',
    dealType: ['Paid advisory / DD'], entity: 'SDA Home Choices', owner: 'Emma Voss',
    source: 'Existing Client', transactionValue: 6000000, commissionPct: 0,
    advisoryFee: 45000, conjunctionFee: 0, referralFee: 0, probability: 1.0, score: 76,
    lostReason: null, nextAction: 'Archived — settled', daysStale: 0,
    organisations: ['Kallangur Supported Homes'], properties: ['Portfolio — 3 SDA dwellings, Kallangur QLD'],
    createdDate: '2026-02-18', closeDate: '2026-06-20',
    stageHistory: [
      { stage: '0', enteredDate: '2026-02-17' },
      { stage: '1', enteredDate: '2026-02-25' },
      { stage: 'A1', enteredDate: '2026-03-05' },
      { stage: 'A2', enteredDate: '2026-03-13' },
      { stage: 'A3', enteredDate: '2026-03-22' },
      { stage: 'A4', enteredDate: '2026-03-30' },
      { stage: 'A5', enteredDate: '2026-04-07' },
      { stage: 'B1', enteredDate: '2026-04-15' },
      { stage: 'B2', enteredDate: '2026-04-23' },
      { stage: 'B3', enteredDate: '2026-05-01' },
      { stage: 'B4', enteredDate: '2026-05-09' },
      { stage: 'B5', enteredDate: '2026-05-18' },
      { stage: 'B6', enteredDate: '2026-05-26' },
      { stage: 'B7', enteredDate: '2026-06-03' },
      { stage: 'B8', enteredDate: '2026-06-11' },
      { stage: '9', enteredDate: '2026-06-19' },
    ],
  },
  {
    id: 'D-25', name: 'Marsden Park SDA', stage: '9', outcome: 'Won',
    dealType: ['Brokerage / Divestment', 'Referral'], entity: '3DSDA', owner: 'Chris Bell',
    source: 'Referral', transactionValue: 3400000, commissionPct: 0.0275,
    advisoryFee: 0, conjunctionFee: 0, referralFee: 8000, probability: 1.0, score: 89,
    lostReason: null, nextAction: 'Archived — settled', daysStale: 0,
    organisations: ['Marsden Park SDA Group'], properties: ['4 dwellings, Marsden Park NSW'],
    createdDate: '2026-03-30', closeDate: '2026-08-15',
    stageHistory: [
      { stage: '0', enteredDate: '2026-03-29' },
      { stage: '1', enteredDate: '2026-04-12' },
      { stage: 'B1', enteredDate: '2026-04-26' },
      { stage: 'B2', enteredDate: '2026-05-09' },
      { stage: 'B3', enteredDate: '2026-05-23' },
      { stage: 'B4', enteredDate: '2026-06-06' },
      { stage: 'B5', enteredDate: '2026-06-20' },
      { stage: 'B6', enteredDate: '2026-07-04' },
      { stage: 'B7', enteredDate: '2026-07-17' },
      { stage: 'B8', enteredDate: '2026-07-31' },
      { stage: '9', enteredDate: '2026-08-14' },
    ],
  },
];

/* --------------------------- COMPUTE HELPERS ----------------------------- */

/* Advisory/consultancy revenue component. Most deals still carry a flat
   advisoryFee literal. A deal billed via the explicit tranche fields (see
   PART A rework in the DELIVERY section below, and ASSUMPTIONS
   'delivery-tranche-fields') has no advisoryFee field at all — its advisory
   revenue reads from tranche1Amount + tranche2Amount instead, so there is
   still exactly one number for "this deal's advisory revenue," never two
   that could drift apart. */
function advisoryRevenue(deal) {
  return deal.tranche1Amount != null ? deal.tranche1Amount + deal.tranche2Amount : (deal.advisoryFee || 0);
}

function sdahcRevenue(deal) {
  return deal.transactionValue * deal.commissionPct + advisoryRevenue(deal) + deal.conjunctionFee + deal.referralFee;
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

/* Full fiscal year containing `date`, per Settings → Financial Year Start
   (defaults to July — the Australian FY — see DEFAULT_SETTINGS.fyStartMonth).
   start is inclusive, end is exclusive (the first day of the NEXT FY) so
   `(date - start) / (end - start)` gives a clean 0-1 pace fraction. */
function fiscalYearBounds(date) {
  const fyStartMonth = getSettings().fyStartMonth ?? 6;
  let y = date.getFullYear();
  if (date.getMonth() < fyStartMonth) y -= 1;
  const start = new Date(y, fyStartMonth, 1);
  const end = new Date(y + 1, fyStartMonth, 1);
  return { start, end };
}

/* Display label for the fiscal year containing `date` — just the year
   portion, e.g. "2026" when FY = calendar year (fyStartMonth 0, start and
   end fall in the same calendar year), or "2026–27" when it spans two
   calendar years (e.g. the Jul-Jun Australian FY). Callers prefix "FY"
   themselves so both read naturally: "FY2026", "FY2026–27". */
function fiscalYearLabel(date) {
  const { start, end } = fiscalYearBounds(date);
  const startY = start.getFullYear();
  const endY = new Date(end.getTime() - 86400000).getFullYear();
  return startY === endY ? `${startY}` : `${startY}–${String(endY).slice(2)}`;
}

function periodRange(periodKey) {
  const end = TODAY;
  let start;
  if (periodKey === '7d') { start = new Date(end); start.setDate(start.getDate() - 6); }
  else if (periodKey === '30d') { start = new Date(end); start.setDate(start.getDate() - 29); }
  else if (periodKey === 'quarter') { const q = Math.floor(end.getMonth() / 3); start = new Date(end.getFullYear(), q * 3, 1); }
  else {
    // ytd -> fiscal-year-to-date, using the same FY window as fiscalYearBounds().
    start = fiscalYearBounds(end).start;
  }
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
   service line" rather than counting it as drop-off.

   SHARED CONFIG, not mock data: this ladder is used by the real Sales Funnel
   page now (RealAggregates.funnelStages(), supabase-data.js) — the mock
   Aggregates.funnelStages() that used to read it has been removed (see
   ASSUMPTIONS 'funnel-tier-mapping'). Kept here, not in supabase-data.js,
   because STAGE_INDEX/STAGES themselves already live here and both mock and
   real deals resolve to the same stage ids. */
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

  /* Committed-but-not-cash revenue, split into two confidence tiers so the
     hero bar and Revenue KPIs never conflate "as good as done" with
     "committed but still has a condition attached":

       UNCONDITIONAL — deals at Under Contract (B8) only. Nothing left to
       negotiate; ~99% certain. Counted at FULL sdahcRevenue(deal).

       CONDITIONAL — everything else that's committed but not unconditional:
         (a) deals at Contract Issued (B7) — signed, but conditions
             (finance, due diligence, etc.) can still be live — at FULL
             sdahcRevenue(deal), same treatment B7/B8 always had.
         (b) Delivery engagements' own WIP/Invoiced tranches (see
             isTrancheContracted — a WIP tranche means the engagement is
             under a signed contract with work underway, so that money is
             committed even though it isn't invoiced yet) — but ONLY for
             engagements not already counted whole via (a) or unconditional,
             so a deal at B7/B8 that also carries engagement tranches (e.g.
             SDA Abodes / Socia, Northline Community Housing) isn't counted
             twice — its tranches are a breakdown of revenue already
             included whole.

     unconditional + conditional together equal exactly what the single
     "Contracted" figure was before this tier split — see
     contractedRevenue() below, kept as a thin total for callers (like
     revenueTargetSummary) that just need the combined committed figure. */
  contractedTierBreakdown: () => {
    const unconditionalDeals = DEALS.filter(d => d.outcome === 'In Progress' && d.stage === 'B8');
    const unconditional = unconditionalDeals.reduce((sum, d) => sum + sdahcRevenue(d), 0);
    const unconditionalIds = new Set(unconditionalDeals.map(d => d.id));

    const conditionalStageDeals = DEALS.filter(d => d.outcome === 'In Progress' && d.stage === 'B7' && !unconditionalIds.has(d.id));
    const conditionalStageTotal = conditionalStageDeals.reduce((sum, d) => sum + sdahcRevenue(d), 0);

    const countedIds = new Set([...unconditionalIds, ...conditionalStageDeals.map(d => d.id)]);
    const conditionalTrancheTotal = Aggregates.engagements()
      .filter(d => !countedIds.has(d.id))
      .reduce((sum, d) => sum + engagementTranches(d)
        .filter(m => isTrancheContracted(m.status))
        .reduce((s, m) => s + m.amount, 0), 0);

    const conditional = conditionalStageTotal + conditionalTrancheTotal;
    return { unconditional, conditional, total: unconditional + conditional };
  },

  contractedRevenue: () => Aggregates.contractedTierBreakdown().total,

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
    const tiers = Aggregates.contractedTierBreakdown();
    const contracted = tiers.total;
    const weighted = Aggregates.weightedPipelineRevenue();
    const totalPotential = settled + contracted + weighted;
    const gap = Math.max(0, target - totalPotential);
    const onTrack = totalPotential >= target;
    return {
      target, settled, contracted, weighted, totalPotential, gap, onTrack,
      unconditional: tiers.unconditional, conditional: tiers.conditional,
    };
  },

  /* Revenue composition by fee source. Scoped to Won + In Progress only —
     Lost never generates revenue, and Paused is explicitly zero monetary
     value / out of active pipeline (see ASSUMPTIONS 'paused-exclusion').
     Fully real — each component reads a distinct per-deal fee field
     (advisory via advisoryRevenue(), which is tranche-aware — see PART A
     rework). */
  revenueBySource: () => {
    const deals = DEALS.filter(d => d.outcome === 'Won' || d.outcome === 'In Progress');
    const totals = { brokerage: 0, advisory: 0, conjunction: 0, referral: 0 };
    deals.forEach(d => {
      totals.brokerage += d.transactionValue * d.commissionPct;
      totals.advisory += advisoryRevenue(d);
      totals.conjunction += d.conjunctionFee;
      totals.referral += d.referralFee;
    });
    const total = totals.brokerage + totals.advisory + totals.conjunction + totals.referral;
    return { totals, total, dealCount: deals.length };
  },

  /* Concentration risk: what share of expected revenue sits in the top N
     deals. Same scope as revenueBySource for consistency. */
  revenueConcentration: (n = 3) => {
    const deals = DEALS.filter(d => d.outcome === 'Won' || d.outcome === 'In Progress');
    const sorted = [...deals].sort((a, b) => sdahcRevenue(b) - sdahcRevenue(a));
    const total = sorted.reduce((s, d) => s + sdahcRevenue(d), 0);
    const top = sorted.slice(0, n);
    const topTotal = top.reduce((s, d) => s + sdahcRevenue(d), 0);
    return { top, topTotal, total, pct: total === 0 ? 0 : topTotal / total, n };
  },

  /* Average size of a paid advisory engagement — mean advisory/consultancy
     fee (advisoryRevenue(), tranche-aware) across every deal that carries
     one, regardless of outcome or stage. Not scoped to In Progress only:
     this is a "how big is a typical engagement" size metric, not a revenue
     forecast, so Won and Lost deals' historical fee sizes count too. */
  avgConsultancyValue: () => {
    const deals = DEALS.filter(d => advisoryRevenue(d) > 0);
    const total = deals.reduce((s, d) => s + advisoryRevenue(d), 0);
    return { count: deals.length, avg: deals.length === 0 ? 0 : total / deals.length, deals };
  },

  /* Average size of a brokerage/divestment listing — mean transactionValue
     (the underlying asset price, NOT SDAHC revenue) across every deal
     tagged 'Brokerage / Divestment', regardless of outcome or stage. */
  avgListingValue: () => {
    const deals = DEALS.filter(d => d.dealType.includes('Brokerage / Divestment'));
    const total = deals.reduce((s, d) => s + d.transactionValue, 0);
    return { count: deals.length, avg: deals.length === 0 ? 0 : total / deals.length, deals };
  },

  /* Monthly Actual vs Forecast vs Target for the current fiscal year, running
     in FY order (Jul→Jun by default; whatever Settings → Financial Year
     Start is set to) rather than always Jan→Dec, so the axis matches every
     other "YTD" figure on this page. Actual (past + current month) is real,
     read from closeDate. Forecast (current + future months) buckets active
     deals by estimatedCloseDate() — the simulated projection defined above —
     so treat it as directional, not a Notion-sourced figure. Target is
     annualTarget / 12, an even mock distribution (no seasonality modelled). */
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
        month: monthStart.getMonth(), year: monthStart.getFullYear(), label: monthStart.toLocaleDateString('en-AU', { month: 'short' }),
        actual, forecast, target: monthlyTarget, isCurrent, isFuture, isPast,
      });
    }
    return months;
  },

  /* "Forecast vs Actual (cumulative)" — a business-plan-style plan-vs-actual
     read, not the same thing as the Revenue Over Time chart above. That chart
     shows PER-MONTH actual/forecast/target bars; this accumulates target and
     actual month over month across the FY so far, the way a startup tracks
     cumulative plan vs cumulative actual for investors. Reuses
     monthlyRevenueSeries() (single source of truth for per-month actual/
     target) rather than re-deriving them.

     cumActual only accumulates through the CURRENT month (null for future
     months — there is nothing to plot yet) and, at that last defined point,
     is exactly Aggregates.settledRevenueYTD(): both sum the SDAHC Revenue of
     Won deals with closeDate inside [FY start, today]. cumTarget accumulates
     the full 12 months regardless, since the plan line runs the whole year.

     "Forecast" here means the flat annual-target/12 plan line, not the
     weighted-pipeline forecast bars used elsewhere — see ASSUMPTIONS
     'cumulative-target-split' for why an even monthly split is a modelling
     simplification, not a real phased plan. */
  cumulativeForecastVsActual: () => {
    const months = Aggregates.monthlyRevenueSeries();
    let cumTarget = 0, cumActual = 0;
    let latestActualRow = null;

    const rows = months.map(m => {
      cumTarget += m.target;
      if (m.isPast || m.isCurrent) {
        cumActual += m.actual || 0;
      }
      const row = {
        label: m.label, year: m.year,
        cumTarget,
        cumActual: (m.isPast || m.isCurrent) ? cumActual : null,
        isCurrent: m.isCurrent, isPast: m.isPast, isFuture: m.isFuture,
      };
      if (row.cumActual !== null) latestActualRow = row;
      return row;
    });

    const targetToDate = latestActualRow ? latestActualRow.cumTarget : 0;
    const actualToDate = latestActualRow ? latestActualRow.cumActual : 0;
    const variance = actualToDate - targetToDate;
    const variancePct = targetToDate === 0 ? 0 : variance / targetToDate;

    return { rows, targetToDate, actualToDate, variance, variancePct, aheadOfPlan: variance >= 0 };
  },

  /* funnelStages() (mock) removed — the Sales Funnel page's Conversion
     Funnel / Stage Conversion panels now read RealAggregates.funnelStages()
     instead (supabase-data.js), which reuses FUNNEL_TIERS above unchanged.
     See ASSUMPTIONS 'funnel-tier-mapping'. */

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

  /* SDA Report inventory — entirely dashboard-owned (see ASSUMPTIONS). Pending
     and Available are always calculated, never stored, so they can never
     drift from the underlying counters. */
  sdaReportInventory: () => {
    const s = getSettings().sdaReport;
    const printed = s.initialPrintRun + s.additionalPrintRun;
    const pending = Math.max(0, s.allocated - s.delivered - s.damaged - s.internalUse - s.returned);
    const available = Math.max(0, printed - s.delivered - s.damaged - s.internalUse + s.returned + s.manualAdjustment);
    return {
      printed, allocated: s.allocated, delivered: s.delivered, pending, available,
      damaged: s.damaged, internalUse: s.internalUse, returned: s.returned, manualAdjustment: s.manualAdjustment,
      adjustmentLog: s.adjustmentLog, campaignCost: s.campaignCost,
    };
  },

  /* SDA Report commercial funnel. Reports Delivered / Deal / Pipeline
     Generated / Settled Revenue are REAL — the last three read directly from
     the deals in DEALS tagged source === 'SDA Report' (the same 3 deals
     counted in prospectSourceBreakdown). Followed Up / Response / Meeting /
     Opportunity are simulated — see ASSUMPTIONS. */
  sdaReportFunnel: () => {
    const s = getSettings().sdaReport;
    const delivered = s.delivered;
    const followedUp = Math.round(delivered * SDA_REPORT_FUNNEL_RATES.followedUpRate);
    const response = Math.round(followedUp * SDA_REPORT_FUNNEL_RATES.responseRate);
    const meeting = Math.round(response * SDA_REPORT_FUNNEL_RATES.meetingRate);
    const opportunity = Math.round(meeting * SDA_REPORT_FUNNEL_RATES.opportunityRate);

    const sourcedDeals = DEALS.filter(d => d.source === 'SDA Report');
    const dealCount = sourcedDeals.length;
    const pipelineGenerated = sourcedDeals.filter(d => d.outcome === 'In Progress').reduce((sum, d) => sum + sdahcRevenue(d), 0);
    const settledRevenue = sourcedDeals.filter(d => d.outcome === 'Won').reduce((sum, d) => sum + sdahcRevenue(d), 0);

    const raw = [
      { label: 'Reports Delivered', count: delivered, kind: 'count', isReal: true },
      { label: 'Followed Up', count: followedUp, kind: 'count', isReal: false },
      { label: 'Response', count: response, kind: 'count', isReal: false },
      { label: 'Meeting', count: meeting, kind: 'count', isReal: false },
      { label: 'Opportunity', count: opportunity, kind: 'count', isReal: false },
      { label: 'Deal', count: dealCount, kind: 'count', isReal: true },
      { label: 'Pipeline Generated', count: pipelineGenerated, kind: 'currency', isReal: true },
      { label: 'Settled Revenue', count: settledRevenue, kind: 'currency', isReal: true },
    ];
    const stages = raw.map((row, i) => ({
      ...row,
      conversionFromPrevious: i === 0 || row.kind !== raw[i - 1].kind ? null : (raw[i - 1].count === 0 ? 0 : row.count / raw[i - 1].count),
    }));

    return { stages, sourcedDeals, dealCount, pipelineGenerated, settledRevenue, meeting, opportunity, followedUp, response, delivered, campaignCost: s.campaignCost };
  },

  /* Campaign ROI. Cost ratios divide the real campaignCost by a mix of real
     (delivered, dealCount, settledRevenue) and simulated (meeting,
     opportunity) counts — see ASSUMPTIONS for which is which. */
  sdaReportRoi: () => {
    const f = Aggregates.sdaReportFunnel();
    const s = getSettings().sdaReport;
    const costPerDelivered = f.delivered === 0 ? 0 : f.campaignCost / f.delivered;
    const costPerMeeting = f.meeting === 0 ? 0 : f.campaignCost / f.meeting;
    const costPerOpportunity = f.opportunity === 0 ? 0 : f.campaignCost / f.opportunity;
    const returnMultiple = f.campaignCost === 0 ? null : (f.settledRevenue === 0 ? 0 : f.settledRevenue / f.campaignCost);
    return {
      campaignCost: f.campaignCost, costPerDelivered, costPerMeeting, costPerOpportunity,
      pipelineGenerated: f.pipelineGenerated, settledRevenue: f.settledRevenue, returnMultiple,
      targetMeetings: s.targetMeetings, targetOpportunities: s.targetOpportunities, targetPipeline: s.targetPipeline,
      meeting: f.meeting, opportunity: f.opportunity,
    };
  },

  /* Marketing Spend (annual) — entirely dashboard-owned/mock (see ASSUMPTIONS
     'marketing-spend'). "Report Print/Production" is NOT a second stored
     number — it reads sdaReportInventory()'s campaignCost live, so the two
     pages can never disagree about what the print campaign cost. */
  marketingSpendBreakdown: () => {
    const m = getSettings().marketing.spend;
    const reportPrintProduction = getSettings().sdaReport.campaignCost;
    const rows = [
      { label: 'Travel', value: m.travel },
      { label: 'Events', value: m.events },
      { label: 'Report Print/Production', value: reportPrintProduction },
      { label: 'Digital', value: m.digital },
      { label: 'Other', value: m.other },
    ].sort((a, b) => b.value - a.value);
    const total = rows.reduce((s, r) => s + r.value, 0);
    const largest = rows[0];
    return { rows, total, largest, largestPct: total === 0 ? 0 : largest.value / total };
  },

  /* Electronic distribution "funnel" — Sent and Website Downloads are the
     two dashboard-owned inputs; Opened and Engaged are simulated conversion
     rates applied to them (see ASSUMPTIONS 'marketing-electronic-distribution').
     Distinct from, and NOT a duplicate of, SDA Report's PRINTED inventory —
     the printed side is summarised, not recomputed, via sdaReportInventory(). */
  marketingElectronicFunnel: () => {
    const e = getSettings().marketing.electronic;
    const opened = Math.round(e.sent * MARKETING_ELECTRONIC_FUNNEL_RATES.openedRate);
    const openedOrDownloaded = opened + e.websiteDownloads;
    const engaged = Math.round(openedOrDownloaded * MARKETING_ELECTRONIC_FUNNEL_RATES.engagedRate);
    return {
      sent: e.sent, opened, websiteDownloads: e.websiteDownloads, openedOrDownloaded, engaged,
      sentByAudience: e.sentByAudience,
    };
  },

  /* Simple cost view for the electronic channel — divides the Digital spend
     category (not the whole Marketing Spend total) by electronic reach, on
     the same logic as SDA Report's cost-per-delivered/meeting figures. */
  marketingElectronicCost: () => {
    const digital = Aggregates.marketingSpendBreakdown().rows.find(r => r.label === 'Digital').value;
    const funnel = Aggregates.marketingElectronicFunnel();
    const reach = funnel.sent + funnel.websiteDownloads;
    return {
      digitalSpend: digital,
      costPerReach: reach === 0 ? 0 : digital / reach,
      costPerEngaged: funnel.engaged === 0 ? 0 : digital / funnel.engaged,
      engaged: funnel.engaged,
    };
  },
};

/* -------------------------------- DELIVERY -------------------------------- */
/* Commercial delivery layer. NOT a task manager — granular subtasks, time
   tracking and kanban stay in Notion. This models the commercial rollup only:
   which deals have unfinished deliverables gating a billing milestone, and
   how much revenue sits behind that work.

   Engagements are DERIVED from the existing DEALS array — a deal becomes an
   "engagement" by carrying either a `milestones` array (brokerage deals: a
   generic list of billing tranches with their own status) or the explicit
   consultancyFeeTotal/tranche1.../tranche2... fields (advisory deals — see
   the PART A rework below). There is no parallel dataset.

   BROKERAGE-ONLY VIEW, for the Delivery PAGE specifically, as of the
   ADVISORY → real-data migration (see supabase-data.js's
   advisoryEngagements() and the report given alongside that change):
   brokerageEngagements() below returns only the `milestones`-array deals.
   The Delivery page's own render functions (and deliveryKpis/
   deliveryTimelinePoints/deliveryInsights/nextMilestone, which back them)
   were switched to call brokerageEngagements() instead of engagements() —
   the real Delivery page now has its own separate, real Advisory section
   sourced from analytics.deals, so showing the 2 advisory deals a second
   time here, mock health/progress% and all, would be confusing at best.

   engagements() ITSELF IS UNCHANGED and still returns both shapes — it has
   an existing caller outside Delivery, Revenue's mock contractedTierBreakdown()
   (which needs the advisory deals' WIP/Invoiced tranches to correctly
   compute mock Contracted Revenue), and narrowing it there would have
   silently changed mock Overview/Revenue numbers as a side effect of a
   Delivery-only change — well outside this task's scope.

   PART A REWORK: advisory engagements used to have their two milestone
   amounts hardcoded as an implicit 50/50 split of sdahcRevenue(deal). That's
   now inverted — consultancyFeeTotal, tranche1Amount/Status/Date and
   tranche2Amount/Status/Date are the manually-entered, single source of
   truth (mirroring fields to be created in Notion — see ASSUMPTIONS
   'delivery-tranche-fields'), and advisoryRevenue() (compute helpers, above)
   reads sdahcRevenue()'s advisory component FROM tranche1+tranche2. Brokerage
   engagements are untouched: their milestones[] amounts still sum to exactly
   sdahcRevenue(deal), same as before.

   Because two different shapes now exist, everything below reads through
   engagementTranches(deal), which normalises either shape into the same
   {name, dueDate, amount, status, unlockCondition} list.

   TRANCHE STATES: every tranche/milestone status is one of exactly four
   values, mirroring the real Notion field — "Not started", "WIP",
   "Invoiced", "Paid". Each carries real financial meaning:
     Paid        → Settled (cash)
     Invoiced    → Contracted (committed, not yet cash)
     WIP         → Contracted (committed — the engagement is under a signed
                   contract and work is underway, so that money is
                   committed even though it hasn't been invoiced yet)
     Not started → neither (not committed — still open/weighted pipeline only)
   isTrancheLocked() / isTrancheContracted() / isTrancheSettled() below apply
   this mapping everywhere: Delivery's Locked/Unlocked split, and the real
   Contracted Revenue aggregate (contractedRevenue(), compute helpers above —
   see its comment for how tranche-committed amounts are merged with the
   stage-based B7/B8 rule without double-counting). Never derived from stage. */

const DELIVERABLE_STATUSES = ['Not started', 'In progress', 'Delivered', 'Accepted'];
const MILESTONE_STATUSES = ['Not started', 'WIP', 'Invoiced', 'Paid'];
const ENGAGEMENT_HEALTH = ['On track', 'At risk', 'Slipped'];

function isTrancheLocked(status) {
  return status === 'Not started';
}
function isTrancheContracted(status) {
  return status === 'WIP' || status === 'Invoiced';
}
function isTrancheSettled(status) {
  return status === 'Paid';
}

/* Full calendar-quarter window containing `date` (not quarter-to-date — this
   page needs the forward-looking end of the current quarter to test whether
   a milestone's due date falls inside it). Distinct from periodRange('quarter')
   above, which is deliberately quarter-to-date for the Overview waterfall. */
function quarterBounds(date) {
  const q = Math.floor(date.getMonth() / 3);
  const start = new Date(date.getFullYear(), q * 3, 1);
  const end = new Date(date.getFullYear(), q * 3 + 3, 0);
  return { start, end };
}

/* Normalises an engagement's billing structure into a flat tranche list,
   regardless of which of the two shapes it's stored as. Brokerage deals pass
   their milestones[] straight through unchanged. Advisory deals synthesize
   two entries from the explicit tranche fields, labelled with the actual
   manually-entered split (e.g. "60%") rather than an assumed 50/50. */
function engagementTranches(deal) {
  if (Array.isArray(deal.milestones)) return deal.milestones;
  if (deal.tranche1Amount != null) {
    const pct1 = deal.consultancyFeeTotal ? Math.round((deal.tranche1Amount / deal.consultancyFeeTotal) * 100) : null;
    const pct2 = pct1 !== null ? 100 - pct1 : null;
    return [
      { name: `Tranche 1 — Engagement Retainer${pct1 !== null ? ` (${pct1}%)` : ''}`, dueDate: deal.tranche1Date, amount: deal.tranche1Amount, status: deal.tranche1Status, unlockCondition: 'Engagement letter signed' },
      { name: `Tranche 2 — Completion Payment${pct2 !== null ? ` (${pct2}%)` : ''}`, dueDate: deal.tranche2Date, amount: deal.tranche2Amount, status: deal.tranche2Status, unlockCondition: 'Final deliverable accepted by client' },
    ];
  }
  return [];
}

/* Notion "Tranche Reconciliation" formula equivalent — flags if the
   manually-entered tranche1+tranche2 no longer matches the manually-entered
   consultancyFeeTotal (e.g. someone fat-fingered a tranche amount). Returns
   null for deals with no explicit tranche fields (brokerage engagements —
   their milestones[] have no separate "total" to check against). */
function trancheReconciliation(deal) {
  if (deal.consultancyFeeTotal == null) return null;
  const sum = deal.tranche1Amount + deal.tranche2Amount;
  return { ok: Math.abs(sum - deal.consultancyFeeTotal) < 0.01, sum, total: deal.consultancyFeeTotal };
}

Object.assign(Aggregates, {
  engagements: () => DEALS.filter(d => (Array.isArray(d.milestones) && d.milestones.length > 0) || d.tranche1Amount != null),
  brokerageEngagements: () => DEALS.filter(d => Array.isArray(d.milestones) && d.milestones.length > 0),

  engagementLocked: (deal) => engagementTranches(deal).filter(m => isTrancheLocked(m.status)).reduce((s, m) => s + m.amount, 0),
  engagementUnlocked: (deal) => engagementTranches(deal).filter(m => !isTrancheLocked(m.status)).reduce((s, m) => s + m.amount, 0),
  trancheReconciliation,

  /* Soonest UPCOMING not-yet-paid milestone across all engagements — used
     for the "Next Milestone" KPI. Prefers a future due date; a tranche can
     now sit unpaid past its due date (e.g. Invoiced but not yet collected —
     see Horizon SDA Fund's retainer), and that overdue item is real but
     isn't "next", so it's only surfaced as a fallback when nothing upcoming
     exists (soonest-overdue first, i.e. closest to today). */
  nextMilestone: () => {
    const all = [];
    Aggregates.brokerageEngagements().forEach(d => {
      engagementTranches(d).forEach(m => { if (m.status !== 'Paid') all.push({ deal: d, milestone: m }); });
    });
    const upcoming = all.filter(x => parseDate(x.milestone.dueDate) >= TODAY)
      .sort((a, b) => parseDate(a.milestone.dueDate) - parseDate(b.milestone.dueDate));
    if (upcoming.length) return upcoming[0];
    const overdue = all.sort((a, b) => parseDate(b.milestone.dueDate) - parseDate(a.milestone.dueDate));
    return overdue[0] || null;
  },

  deliveryKpis: () => {
    const engagements = Aggregates.brokerageEngagements();
    const { end: quarterEnd } = quarterBounds(TODAY);

    let lockedRevenue = 0, unlockableThisQuarter = 0, revenueAtRisk = 0;
    engagements.forEach(d => {
      engagementTranches(d).forEach(m => {
        if (!isTrancheLocked(m.status)) return;
        lockedRevenue += m.amount;
        const due = parseDate(m.dueDate);
        if (due <= quarterEnd) unlockableThisQuarter += m.amount;
        if (d.health === 'At risk' || d.health === 'Slipped') revenueAtRisk += m.amount;
      });
    });

    return {
      lockedRevenue, unlockableThisQuarter, revenueAtRisk,
      activeEngagements: engagements.length,
      nextMilestone: Aggregates.nextMilestone(),
    };
  },

  /* Flat list of every milestone across every engagement, for the timeline
     view — one point per milestone, not one bar per engagement, since a
     billing milestone is a due date, not a worked date range. */
  deliveryTimelinePoints: () => {
    const points = [];
    Aggregates.brokerageEngagements().forEach(d => {
      engagementTranches(d).forEach(m => points.push({
        dealId: d.id, dealName: d.name, owner: d.owner, health: d.health,
        name: m.name, dueDate: m.dueDate, amount: m.amount, status: m.status,
      }));
    });
    return points.sort((a, b) => parseDate(a.dueDate) - parseDate(b.dueDate));
  },

  /* Simulated AI panel — see ASSUMPTIONS 'delivery-ai-insights'. The insight
     selection and phrasing are hardcoded (a real model would rank these);
     every number inside is read live from the deal/milestone data above,
     so an insight can never assert a figure that contradicts the rest of
     the page. */
  deliveryInsights: () => {
    const insights = [];
    const engagements = Aggregates.brokerageEngagements();

    const atRiskDeal = engagements.find(d => d.health === 'At risk');
    if (atRiskDeal) {
      const soonMilestone = engagementTranches(atRiskDeal).filter(m => isTrancheLocked(m.status))
        .sort((a, b) => parseDate(a.dueDate) - parseDate(b.dueDate))[0];
      if (soonMilestone) {
        const days = Math.round((parseDate(soonMilestone.dueDate) - TODAY) / 86400000);
        insights.push({
          key: 'risk',
          text: `${soonMilestone.name} on ${atRiskDeal.name} is due in ${days} day${days === 1 ? '' : 's'} and its gating deliverable is still in progress — ${fmtFullDelivery(soonMilestone.amount)} at risk of slipping into next quarter.`,
        });
      }
    }

    /* An "advisory near-complete" insight used to live here (which
       near-complete advisory engagement still has consultancy revenue to
       collect). Removed, not just left dead: engagements() above is now
       brokerage-only (see this section's header comment) — that insight's
       own real Advisory equivalent belongs on, and now lives on, the real
       Delivery Advisory section instead (Settled/Contracted KPI cards,
       supabase-data.js). Steve separately confirmed brokerage is not
       formally gated on advisory completing anyway (see
       advisoryToBrokerageNote on the deal for the soft note that replaced a
       modelled gating figure). */

    const onTrackCount = engagements.filter(d => d.health === 'On track').length;
    const kpis = Aggregates.deliveryKpis();
    insights.push({
      key: 'portfolio',
      text: `${onTrackCount} of ${engagements.length} engagements are on track. ${fmtFullDelivery(kpis.revenueAtRisk)} of locked revenue sits behind at-risk deliverables — the rest (${fmtFullDelivery(kpis.lockedRevenue - kpis.revenueAtRisk)}) is locked but on schedule.`,
    });

    return insights;
  },
});

/* Local currency formatter — data.js has no dependency on app.js's fmtFull,
   and Delivery's insight strings are assembled here so their numbers can
   never drift from the aggregates above. */
function fmtFullDelivery(n) { return '$' + Math.round(n).toLocaleString('en-AU'); }

/* ----------------------------- STAGE HISTORY ------------------------------ */
/* PART B. Notion's Stage field is a single select — it only ever holds the
   CURRENT stage, with no transition log. `stageHistory[]` on each deal is a
   simulated backfill for this prototype (see ASSUMPTIONS
   'delivery-stage-history'): every deal's past stages and entry dates,
   interpolated between its createdDate and closeDate/today. Most journeys
   are clean and sequential; two (LVP Logan, Coomera SDA Portfolio) are
   deliberately irregular to exercise the anomaly detector below.

   Used by the Pipeline deal drawer for the vertical stage-journey timeline
   and the "stage anomaly" flag — display-only, it flags an unusual journey
   for review, it never blocks or corrects one. */

/* A deal's own track can mix groups (e.g. an advisory engagement that later
   converted to brokerage), so "did this jump a stage" can't be judged
   against the full 16-stage STAGES array — that would flag every pure
   brokerage deal for "skipping" A1-A5, which it never entered. Instead this
   builds a LOCAL order using only the groups this deal's own history
   actually passed through, re-indexed from 0 — adjacent stages in that
   filtered list are exactly the ones this deal's real journey should have
   passed through one at a time. */
function localStageOrder(stageHistory) {
  const groupsPresent = new Set(stageHistory.map(h => getStage(h.stage).group));
  const localSeq = STAGES.filter(s => groupsPresent.has(s.group));
  return Object.fromEntries(localSeq.map((s, i) => [s.id, i]));
}

function detectStageAnomaly(stageHistory) {
  if (!Array.isArray(stageHistory) || stageHistory.length < 2) return { skipped: false, backward: false };
  const order = localStageOrder(stageHistory);
  let skipped = false, backward = false;
  for (let i = 1; i < stageHistory.length; i++) {
    const diff = order[stageHistory[i].stage] - order[stageHistory[i - 1].stage];
    if (diff < 0) backward = true;
    else if (diff > 1) skipped = true;
  }
  return { skipped, backward };
}

Object.assign(Aggregates, {
  /* { skipped, backward } — either or both may be true; a deal with a clean
     journey (the overwhelming majority) gets { skipped: false, backward: false }. */
  stageAnomaly: (deal) => detectStageAnomaly(deal.stageHistory),

  /* Stage journey enriched with time-in-stage and a per-transition anomaly
     flag, for the drawer timeline. Time-in-stage is the gap to the NEXT
     entry, or to closeDate/today for the current (last) stage — always
     computed here, never stored. transitionFlag on entry i describes the
     hop INTO that stage from entry i-1 ('skip' | 'backward' | null), so the
     drawer can call out exactly where the journey went off the clean path. */
  stageJourney: (deal) => {
    const history = deal.stageHistory || [];
    const order = localStageOrder(history);
    const end = deal.closeDate ? parseDate(deal.closeDate) : TODAY;
    return history.map((h, i) => {
      const entered = parseDate(h.enteredDate);
      const next = i < history.length - 1 ? parseDate(history[i + 1].enteredDate) : end;
      const daysInStage = Math.max(0, Math.round((next - entered) / 86400000));
      let transitionFlag = null;
      if (i > 0) {
        const diff = order[h.stage] - order[history[i - 1].stage];
        if (diff < 0) transitionFlag = 'backward';
        else if (diff > 1) transitionFlag = 'skip';
      }
      return { ...h, stageMeta: getStage(h.stage), isCurrent: i === history.length - 1, daysInStage, transitionFlag };
    });
  },
});

/* ------------------------------ SETTINGS --------------------------------- */
/* Dashboard-owned data. Simulated with localStorage so the Settings page can
   edit it without touching Notion. Seeded once on first load; edits persist
   and merge over the defaults below (so adding a new default field later
   never breaks an existing saved settings blob). */

const DEFAULT_SETTINGS = {
  // Business — real FY target (Jul-Jun), confirmed with Steve. Change ONLY
  // here (and, if a viewer already has a stale cached value, via Settings →
  // Reset to Defaults) — every page reads it through getSettings().annualTarget.
  annualTarget: 1250000,
  monthlyTarget: Math.round(1250000 / 12),
  fyStartMonth: 6, // Australian Financial Year (1 Jul - 30 Jun) by default. 0=Jan, 3=Apr, 9=Oct.

  // Pipeline
  highValueDealThreshold: 4000000,
  staleWarningDays: 21,

  // SDA Report — dashboard-owned print/campaign inventory
  sdaReport: {
    initialPrintRun: 200,
    additionalPrintRun: 0,
    allocated: 190,
    delivered: 122,
    damaged: 0,
    internalUse: 0,
    returned: 0,
    manualAdjustment: 0,
    campaignCost: 3335,
    targetMeetings: 30,
    targetOpportunities: 15,
    targetPipeline: 900000,
    adjustmentLog: [],
  },

  /* Marketing — dashboard-owned, mock (see ASSUMPTIONS). Deliberately does
     NOT duplicate sdaReport's print inventory or campaignCost above; the
     Marketing page's spend breakdown reads campaignCost live as its "Report
     Print/Production" category rather than storing a second number. */
  marketing: {
    spend: { travel: 42000, events: 18500, digital: 6200, other: 4000 },
    electronic: {
      sent: 340,
      sentByAudience: [
        { label: 'Investors', value: 140 },
        { label: 'Referral Partners / Advisers', value: 95 },
        { label: 'Existing Clients', value: 70 },
        { label: 'Prospects (LinkedIn / Web enquiry)', value: 35 },
      ],
      websiteDownloads: 85,
    },
  },

  syncStatus: { connected: true, lastSyncMinutesAgo: 2 },
};

const SETTINGS_KEY = 'sdahc_intelligence_settings_v1';

function initSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(DEFAULT_SETTINGS));
      return structuredCloneSettings(DEFAULT_SETTINGS);
    }
    const saved = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS, ...saved,
      sdaReport: { ...DEFAULT_SETTINGS.sdaReport, ...(saved.sdaReport || {}) },
      marketing: { ...DEFAULT_SETTINGS.marketing, ...(saved.marketing || {}) },
      syncStatus: { ...DEFAULT_SETTINGS.syncStatus, ...(saved.syncStatus || {}) },
    };
  } catch (e) {
    return structuredCloneSettings(DEFAULT_SETTINGS);
  }
}

function structuredCloneSettings(obj) { return JSON.parse(JSON.stringify(obj)); }

function getSettings() { return initSettings(); }

/* Deep-merges `patch` over the current saved settings and persists. Nested
   objects (sdaReport) are merged key-by-key rather than replaced wholesale,
   so a partial patch never clobbers sibling fields. */
function updateSettings(patch) {
  const current = getSettings();
  const next = { ...current, ...patch };
  if (patch.sdaReport) next.sdaReport = { ...current.sdaReport, ...patch.sdaReport };
  if (patch.marketing) next.marketing = { ...current.marketing, ...patch.marketing };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

function resetSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(DEFAULT_SETTINGS));
  return structuredCloneSettings(DEFAULT_SETTINGS);
}

/* ---------------------------- SDA REPORT MOCKS ---------------------------- */
/* Individual report recipients are not tracked as Notion records, so this
   distribution and the upper-funnel conversion rates are simulated — see
   ASSUMPTIONS. Distribution figures sum to the 122-report delivered baseline,
   which is fixed in this prototype (not one of the five editable adjustment
   actions), so they never drift out of sync with the live inventory. */

const SDA_REPORT_FUNNEL_RATES = { followedUpRate: 0.79, responseRate: 0.43, meetingRate: 0.46, opportunityRate: 0.47 };

const SDA_REPORT_DISTRIBUTION = {
  byCity: [
    { label: 'Brisbane', value: 46 }, { label: 'Sydney', value: 24 }, { label: 'Melbourne', value: 20 },
    { label: 'Adelaide', value: 12 }, { label: 'Perth', value: 10 }, { label: 'Other', value: 10 },
  ],
  byChannel: [
    { label: 'In-person', value: 74 }, { label: 'Post', value: 48 },
  ],
  byPriority: [
    { label: 'A1', value: 54 }, { label: 'A2', value: 68 },
  ],
  byRelationshipType: [
    { label: 'Existing Relationship', value: 58 }, { label: 'Referral Partner', value: 31 },
    { label: 'Cold / New Contact', value: 23 }, { label: 'Other', value: 10 },
  ],
};

/* ------------------------------- MARKETING -------------------------------- */
/* Early scaffold (see ASSUMPTIONS 'marketing-spend', 'marketing-electronic-
   distribution') — structure and mock data only, to be built out once
   Marketing is a real second origination channel worth integrating. */

const MARKETING_ELECTRONIC_FUNNEL_RATES = { openedRate: 0.58, engagedRate: 0.15 };

/* ------------------------------- MARKET INTEL ----------------------------- */

const MARKET_PULSE = [
  { key: 'institutional-appetite', label: 'Institutional Appetite', value: 72, sentiment: 'positive', summary: 'Institutional capital continues to actively pursue completed SDA assets at compressed yields.' },
  { key: 'completed-asset-demand', label: 'Completed Asset Demand', value: 65, sentiment: 'positive', summary: 'Demand for settled, tenanted SDA dwellings remains firm across metro-fringe locations.' },
  { key: 'regional-vacancy-risk', label: 'Regional Vacancy Risk', value: 28, sentiment: 'positive', summary: 'Vacancy risk is low across core catchments — participant demand continues to outstrip new supply.' },
  { key: 'capital-yield-pressure', label: 'Capital / Yield Pressure', value: 58, sentiment: 'neutral', summary: 'Funding costs remain elevated, moderating some buyer underwriting appetite at the margin.' },
  { key: 'provider-market-conditions', label: 'Provider Market Conditions', value: 70, sentiment: 'positive', summary: 'SDA provider operating conditions are stable, supporting continued portfolio expansion.' },
];

const MARKET_INTEL_CATEGORIES = [
  { key: 'transaction-evidence', label: 'Transaction Evidence', summary: 'Settled SDA transaction prices and terms across comparable dwelling and portfolio sales.' },
  { key: 'comparable-sales', label: 'Comparable Sales', summary: 'Like-for-like sales evidence used to benchmark pricing on active mandates.' },
  { key: 'buyer-underwriting', label: 'Buyer Underwriting', summary: 'How institutional and private buyers are underwriting SDA income streams and vacancy risk.' },
  { key: 'cap-rates-yield', label: 'Cap Rates / Yield Evidence', summary: 'Observed capitalisation rates and yield movements across SDA asset classes.' },
  { key: 'supply-demand', label: 'Supply & Demand', summary: 'Regional SDA supply pipeline against participant demand and NDIS plan growth.' },
  { key: 'sda-ndis-data', label: 'SDA / NDIS Data', summary: 'NDIS participant and SDA enrolment data informing where new stock is needed.' },
  { key: 'provider-intelligence', label: 'Provider Intelligence', summary: 'Provider expansion plans, portfolio strategy shifts and operating performance signals.' },
  { key: 'investor-appetite', label: 'Investor Appetite', summary: 'Which investor types are active, their return hurdles and preferred asset profiles.' },
  { key: 'alternative-use-evidence', label: 'Alternative Use Evidence', summary: 'Fallback value evidence for SDA assets under alternative residential-use scenarios.' },
];

const MARKET_INTEL_SIGNALS = [
  {
    dealName: 'SDA Abodes / Socia',
    signal: 'Brisbane SDA vacancy tightened ~40bps quarter-on-quarter across the Logan and southern corridor catchments.',
    implication: 'Supports pricing resilience through to settlement — limited downside risk from participant vacancy.',
  },
  {
    dealName: 'LVP Logan',
    signal: 'Institutional buyer appetite for completed, tenanted SDA assets has firmed over the last two quarters.',
    implication: 'Positions this asset favourably in the current negotiation — buyer competitive tension is a live lever.',
  },
  {
    dealName: 'Coomera SDA Portfolio',
    signal: 'Gold Coast corridor showing above-average NDIS plan growth relative to new SDA stock approvals.',
    implication: 'Reinforces the case for holding firm on portfolio pricing during buyer follow-up.',
  },
];

/* --------------------------------- PLAYBOOK -------------------------------- */
/* Distilled from the SDAHC Capability & Operating Manual (v1.0, 26 Aug 2026)
   and the Identity & Direction Briefing (v1.0, 27 Aug 2026) — internal source
   documents, not shipped with this app (see 00_context/, gitignored). This is
   condensed reference copy, not a reproduction — see the Assumptions Register
   for the "verify against source" note. */

const PLAYBOOK_WHAT_WE_ARE = "SDA Home Choices is a specialist Specialist Disability Accommodation (SDA) transaction and commercial advisory business. Its core economic engine is successful SDA real estate transactions — property and portfolio sales to investors — supported by paid sell-side preparation, SDA-specific commercial analysis, investor relationships, market intelligence, and an increasingly systematised operating platform. One market, several disciplines applied to it: functionally, pieces of the work resemble real estate capital markets, transaction advisory, and — in a real but still-maturing way — M&A-style and special-situations work.";

const PLAYBOOK_ENGINES = [
  {
    key: 'deals-capital-markets', code: 'A', label: 'Deals & Capital Markets', status: 'Current',
    teaser: 'The commercial core — everything else in the business exists to make this engine run better.',
    body: 'Originate → qualify → analyse → prepare → position → structure → negotiate → transact. Relationship-led origination — Steve\'s network — remains the proven channel. A second, marketing-led channel (LinkedIn, website, events, outbound) is now being stood up under Ali, from a standing start. Both feed the same qualification bar: the channel changes where a prospect is found, not who decides.',
  },
  {
    key: 'transaction-advisory', code: 'B', label: 'Transaction Advisory', status: 'Current',
    teaser: 'Structurally central — the filter and preparation layer sitting in front of Engine A.',
    body: 'Vendor due diligence, transaction-readiness assessment and sale preparation — paid work, and a deliberate filter: it protects senior time, tests the commercial story before a buyer does, and is earned regardless of whether a transaction later proceeds.',
    subEngine: {
      label: 'Management Rights / M&A-style', status: 'Emerging',
      body: 'Not every engagement is really about a freehold. Where the asset is a management book — recurring fees, contracts, staff and systems rather than land — the question becomes what sustainable value the platform creates for a buyer, and what must transfer intact for that value to survive. Real, evidenced work exists here, including a strategic introduction that led to a completed provider combination — but the methodology is still being institutionalised, not yet a repeatable practice. See the Management Rights / M&A-style Work category below.',
    },
  },
  {
    key: 'special-situations', code: 'C', label: 'Special Situations', status: 'Emerging',
    teaser: 'Probably the least-named, most differentiating part of SDAHC\'s work.',
    body: 'Material vacancy and arrears, a failing or exiting provider, a concerned lender, debt approaching realisable value — several interacting at once, on a compressed timeline. This is coordination, triage, sequencing and disclosure — never a receiver, administrator, liquidator or insolvency-practitioner role unless someone else legally holds that appointment.',
  },
  {
    key: 'operating-platform', code: 'D', label: 'Operating Platform — Systems, Data & AI', status: 'Emerging',
    teaser: 'What makes the other three repeatable — not IT support bolted on the side.',
    body: 'The CRM\'s entity model, the Notion/SharePoint truth-layer split, the automation behind task creation, and AI-assisted workflows that draft, extract and summarise — always human-reviewed, never autonomous commercial authority. This is what turns "Steve knows how to do this" into "the business knows how to do this."',
  },
];

const VALUE_LOOP = [
  'Relationship / Intelligence', 'Opportunity', 'Qualification', 'Paid Advisory / DD', 'Transaction Ready',
  'Investor Campaign / Conjunction / Referral', 'Negotiation', 'Contract', 'Settlement', 'Revenue', 'New Market Intelligence',
];

const TEAM = [
  { name: 'Steve', role: 'Managing Director. Owns client and investor relationships, market judgement, negotiation, and listing go/no-go — the calls that carry real commercial weight.' },
  { name: 'Ramiro', role: 'BDM / Systems Lead. Owns the CRM, data architecture and AI-workflow layer, and supports commercial and market analysis — the engine that decides how far the other three can scale.' },
  { name: 'Ali', role: 'EA, Business Operations & Marketing. Runs CRM hygiene, information capture and follow-up, and now also owns SDAHC\'s outbound marketing and brand presence, built from a standing start.' },
  { name: 'Loretta', role: 'Finance / Accounts. Runs the financial administration behind every engagement and settled transaction — invoicing, payments, accounts.' },
];

/* Each category: a one-line teaser (shown collapsed) plus 3-4 sub-sections of
   condensed prose. Selective depth, not reproduction — see the manual chapter
   noted in each comment for the full source. */
const PLAYBOOK_MANUAL_CATEGORIES = [
  {
    key: 'business-model', label: 'Business Model',
    teaser: 'A funnel, not a menu — most relationships should never become a Deal.',
    sections: [
      { heading: 'The core engine', text: 'Relationship or market signal → potential opportunity → qualification → paid advisory/DD where needed → transaction-ready opportunity → listing, investor campaign, conjunction or referral path → offers and negotiation → contract → settlement. Completed transactions are what produce revenue; advisory, diligence and market intelligence exist to make those transactions more likely, better prepared and better priced — not as a separate business alongside them.' },
      { heading: 'Four revenue paths', text: 'Brokerage / sale (divestment) revenue is success-based and the largest of the four, because the size of the asset drives the outcome, not just time spent. Paid advisory revenue is fee income for defined DD or readiness work, earned regardless of whether a transaction later proceeds. Agency collaboration / conjunction revenue is a fee share earned working alongside another agency or adviser. Referral revenue is earned by referring an opportunity SDAHC isn\'t best placed to run itself.' },
      { heading: 'Why advisory is a filter, not the finish line', text: 'A vendor willing to pay for a proper commercial review has already shown a seriousness a free conversation doesn\'t. Advisory protects SDAHC\'s time and intellectual property and improves the information reaching buyers before a campaign starts — but it isn\'t intended to replace the larger economic opportunity a successful transaction creates.' },
      { heading: 'Why Steve\'s time is the scarce resource', text: 'The model exists to keep answering one question, continuously: where is the next hour of senior judgement best spent. Qualification and the advisory filter are the two mechanisms that protect it from being spread evenly across every enquiry regardless of quality.' },
    ],
  },
  {
    key: 'transaction-value-chain', label: 'Transaction Value Chain',
    teaser: 'One connected loop, not eight separate jobs.',
    sections: [
      { heading: 'The chain', text: 'Relationship / market intelligence → origination → qualification → paid advisory / commercial DD → transaction readiness → investment sales / investor engagement → negotiation → contract and execution → settlement — and back into relationship and market intelligence. A completed, or even a lost, transaction generates evidence and buyer intelligence that improves the next opportunity\'s qualification, pricing and buyer matching.' },
      { heading: 'Why the loop matters more than any one stage', text: 'A good CRM without commercial judgement won\'t close a transaction; strong relationships without reliable information create execution risk. Value comes from how the stages connect, not from any one of them in isolation — understanding what happens immediately before and after your own task is what makes the system work.' },
      { heading: 'Not every deal uses every stage', text: 'A standalone strategic review may stop well short of investment sales. A well-prepared listing may need little advisory work. A special situation adds provider-transition, lender or alternative-use analysis a clean transaction never touches.' },
      { heading: 'Where SDAHC\'s role ends', text: 'Legal advice, formal independent valuation, tax advice, accounting assurance, insolvency appointments, and technical or planning advice all sit outside SDAHC\'s role even when they materially affect a transaction it\'s managing. SDAHC\'s job is to identify that a specialist input is needed and coordinate it — not to replace that specialist.' },
    ],
  },
  {
    key: 'transaction-advisory-manual', label: 'Transaction Advisory',
    teaser: 'Testing whether the commercial story survives contact with a sophisticated buyer — before the campaign starts.',
    sections: [
      { heading: 'A ladder of terms, not synonyms', text: 'Transaction Advisory (the overall discipline), Transaction Readiness (is this asset fit to approach buyers?), Vendor Assistance / Sale Preparation (data room, materials, roadblock removal), and Vendor Commercial Due Diligence (testing income, occupancy, provider risk) sit on a ladder. Most engagements land in the middle two bands. Independent, bidder-facing VDD is a different, more formal undertaking and isn\'t the default description of SDAHC\'s advisory work.' },
      { heading: 'What the work actually tests', text: 'Actual versus theoretical income, vacancy and its likely persistence, provider and management risk, market depth, and net income after real — not assumed — operating costs. The goal is surfacing the gap between vendor expectation and buyer underwriting before a campaign starts, not during it.' },
      { heading: 'Risk sorted by what it demands', text: 'Fix before market, evidence before market, explain before market, price before market, or escalate to a specialist — legal, tax, technical, valuation or accounting. Recognising when a commercial issue has crossed into a regulated domain is as much a part of the job as the analysis itself.' },
      { heading: 'What this is not', text: 'Not a valuation — pricing-related outputs are described as market-evidence review or pricing analysis, never "valuation," unless a qualified, independently engaged valuer has issued a formal report. Not a guarantee of transaction success, and not a substitute for independent financial, legal or technical due diligence.' },
    ],
  },
  {
    key: 'investment-sales', label: 'Investment Sales',
    teaser: 'SDAHC\'s core economic engine — selling SDA property as an investment, not a home.',
    sections: [
      { heading: 'The process', text: 'Understand the asset as an investment → normalise the information (actual vs. theoretical income, current vs. forecast occupancy) → identify likely buyer underwriting → establish market position → select buyer segments and sale method → release information under confidentiality → negotiate → contract and settle → capture the evidence for next time.' },
      { heading: 'Pricing logic, and its boundary', text: 'A capitalisation rate converts a stabilised income stream into an indicative price (Value = Income ÷ Cap Rate) — that\'s a pricing mechanism, not proof the income figure or rate chosen is correct, and never a valuation unless an independently engaged valuer has delivered one. Which income figure sits in the numerator matters: a yield on enrolled income and a yield on sustainable income aren\'t comparable, even at an identical percentage.' },
      { heading: 'Buyer segmentation', text: 'Institutional capital typically brings different return hurdles, governance requirements and diligence expectations than private capital, which itself ranges from sophisticated family offices to first-time buyers. Matching the wrong buyer type to an opportunity wastes campaign time on both sides.' },
      { heading: 'Judging an offer', text: 'Price, conditions, funding certainty, the buyer\'s proposed diligence process, timing, deal structure and execution probability all factor in together — the highest headline price is not always the most executable offer.' },
    ],
  },
  {
    key: 'management-rights', label: 'Management Rights / M&A-style Work',
    teaser: 'A functional analogue to M&A and corporate finance — Emerging, not an institutional identity SDAHC holds.',
    sections: [
      { heading: 'A different question entirely', text: 'Selling a property asks what a building produces. A management-rights or business-divestment transaction asks what sustainable earnings or strategic value an operating platform creates for a buyer, and what exactly must transfer intact for that value to survive — because the value can sit in recurring fees, contracts, staff and systems rather than land.' },
      { heading: 'What\'s genuinely Current vs. Emerging', text: 'Distinguishing freehold value from operating value early in an engagement is Current. The deeper advisory that follows it — management-rights commercial review, strategic buyer mapping, confidential sell-side preparation — is Emerging: real engagements exist, but the methodology is still being institutionalised, not yet repeatable the way investment sales is.' },
      { heading: 'One verified, narrow proof point', text: 'SDAHC has facilitated a strategic introduction between two SDA providers that subsequently completed as an equity-based combination — genuine evidence the relationship network can create transactions beyond freehold property sales. That\'s an origination contribution, not the same thing as a full, repeatable M&A execution mandate, and the two are kept visibly distinct.' },
      { heading: 'The guardrails that matter most here', text: 'EBITDA is not cash and not property NOI. Reported earnings are rarely maintainable earnings once a buyer adjusts for founder costs and one-off items. Contract transferability is critical, not incidental — a management book with weak assignment protection may be worth far less than its current revenue implies. And SDAHC is never described as an investment bank or M&A adviser — only as using concepts commonly found in corporate finance and sell-side M&A.' },
    ],
  },
  {
    key: 'special-situations-manual', label: 'Special Situations',
    teaser: 'Strategic advisory under time pressure — coordination and triage, never a formal insolvency role.',
    sections: [
      { heading: 'Strategic advisory under normal conditions, first', text: 'Before urgency enters the picture, SDAHC compares whether an asset should stay as-is, be stabilised, sold now, grouped with others, separated, moved to alternative use, or need further analysis before capital is committed — a genuine standalone service, not always a precursor to a sale mandate.' },
      { heading: 'What actually makes it a special situation', text: 'Material vacancy and arrears, SDA income that\'s stopped or gone uncertain, a failing or exiting provider, a concerned lender, debt approaching or exceeding realisable value, or participants needing continuity through a change of ownership — often several of these interacting at once, on a compressed timeline.' },
      { heading: 'How SDAHC works it', text: 'Distressed portfolio triage sorts assets into tranches — saleable now, stabilise then sell, investigate a legal or planning issue, or alternative use / non-core exit. Buyer risk translation turns ambiguity — what\'s commercial, legal, temporary or structural — into something a buyer can actually underwrite and price.' },
      { heading: 'The boundary that matters most', text: 'SDAHC coordinates the real-estate and transaction response around distress, arrears and provider failure. It does not act as receiver, administrator, liquidator or insolvency practitioner, and none of those terms describe SDAHC\'s role — unless that formal appointment is legally held by someone else and evidenced.' },
    ],
  },
  {
    key: 'origination', label: 'Origination',
    teaser: 'A transaction rarely starts with a listing — it starts with a signal.',
    sections: [
      { heading: 'Where signals come from', text: 'An owner finding a portfolio hard to manage, a provider consolidating, a lender uneasy about an asset, an investor\'s return hurdle changing. Origination is noticing these signals and deciding whether they\'re worth pursuing; investor coverage is knowing the right buyers well enough to match an opportunity to them, rather than broadcasting it to everyone in the CRM.' },
      { heading: 'Two channels now, not one', text: 'Relationship-led origination — Steve\'s network — remains the proven channel. A second, marketing-led channel (LinkedIn, website, events, outbound) is being stood up under Ali from a standing start — no prior public brand presence existed before it. Both feed the same qualification bar: the channel changes where a prospect is found, not who decides. Ali generates and does first-pass screening; Steve still qualifies, prices and negotiates.' },
      { heading: 'Qualification is the gate', text: 'A genuine decision-maker, a real commercial problem, a credible asset, a realistic pathway to transaction, and enough economic value to justify SDAHC\'s time. Until that\'s confirmed, it stays a relationship or a contact in the CRM — not yet a Deal, which would otherwise inflate the pipeline and make it a less useful decision tool.' },
      { heading: 'Controlled release, not a mailing list', text: 'Teaser → signed NDA → Information Memorandum and controlled data-room access → direct follow-up by call or meeting → qualifying genuine interest. Sensitive IM or due-diligence material is not released before a signed NDA unless Steve personally approves an exception.' },
    ],
  },
  {
    key: 'market-intelligence-manual', label: 'Market Intelligence',
    teaser: 'Operating infrastructure, not a publishing exercise — it sharpens origination, advisory and negotiation.',
    sections: [
      { heading: 'The valuation boundary — the single most important rule here', text: 'Market-evidence review, pricing analysis, yield analysis and underwriting support are genuinely valuable commercial work — but none of it is a formal valuation unless a qualified, independently engaged valuer has delivered one under their own professional scope.' },
      { heading: 'Income has layers, and blending them causes disputes', text: 'Enrolled / theoretical income is a ceiling, not a cash flow. Actual / collected income is what\'s genuinely been received. Sustainable / underwritten income — after vacancy and provider risk are accounted for — is usually the figure that actually drives price. A vendor expecting a price based on theoretical income is routinely disappointed by an offer built on sustainable income; evidence is how that gap gets explained, not just asserted.' },
      { heading: 'Evidence is classified before it\'s reused', text: 'Public, Internal, Permission Required, or Do Not Publish. Off-market evidence — an off-market sale price, buyer feedback shared in confidence — is treated as at least Internal until its status is actually confirmed.' },
      { heading: 'The SDA Report and the quarterly cycle', text: 'NDIS releases new quarterly data → it\'s imported and indicators recalculated → Steve adds market interpretation and transaction evidence → outputs feed dashboards and client conversations → responses feed back into the CRM. Buyer underwriting — what a sophisticated buyer actually accepts or rejects on cap rate and vacancy — is treated as a first-class source of evidence, often more revealing than an asking price.' },
    ],
  },
  {
    key: 'execution', label: 'Execution',
    teaser: 'The practical playbook for a qualified opportunity actually moving through the market.',
    sections: [
      { heading: 'The sequence', text: 'Qualified Deal → sale preparation → target-buyer map → teaser → NDA → IM and controlled data-room access → buyer Q&A → offers → negotiation → contract → settlement → CRM close-out. Not every transaction uses every stage at the same intensity, but the sequence and its decision gates hold across the book.' },
      { heading: 'The confidentiality gate', text: 'Sensitive IM or due-diligence information is not released before NDA execution, unless Steve personally approves an exception — this is current SOP, treated as a hard gate by default, not a suggestion.' },
      { heading: 'Judging an offer is more than the headline number', text: 'What\'s preventing an offer from firming up, whether the real gap is price, structure or missing information, and who owns the next action. Negotiation authority sits with Steve; Ramiro and Ali support with analysis, comparison and coordination — not commitment.' },
      { heading: 'Close-out feeds the next deal', text: 'A settled Deal is closed in the CRM, not deleted — buyer and vendor records are updated with what was actually learned. Where a deal was lost rather than settled, the reason (pricing gap, buyer objection, funding failure) is recorded deliberately, because it\'s exactly the signal that improves the next buyer match.' },
    ],
  },
  {
    key: 'crm-systems', label: 'CRM & Systems',
    teaser: 'Notion is the operational truth layer. SharePoint is the document truth layer. They stay separate, on purpose.',
    sections: [
      { heading: 'Two sources of truth, not one', text: 'Notion holds current commercial activity — deals, relationships, status, next actions — and is not, and isn\'t meant to be, a complete historical transaction ledger. SharePoint is the controlled document repository and data room. A Deal record should point to its SharePoint folder rather than try to duplicate it.' },
      { heading: 'What the CRM is actually for', text: 'It should help answer five recurring questions: is this a real deal, is this contact or organisation credible, what\'s the next action and who owns it, what\'s the economic potential, and where should Steve or Ramiro spend time. A sparse record that clearly answers all five is doing its job better than a full one that answers none.' },
      { heading: 'The schema, briefly', text: 'Deals are the strategic layer, Tasks the action layer, Contacts the individuals, the organisation layer (Groups) the entities, Properties the assets. Deal Type is a multi-select field, so one Deal can legitimately carry more than one commercial pathway at once — an engagement that starts as paid advisory and converts to brokerage doesn\'t need a second record.' },
      { heading: 'AI as leverage, not authority', text: 'Summarising a call, extracting proposed CRM updates, and drafting a first-pass information request are already part of how the team works. Pricing conclusions, formal market claims, client advice, confidential release and negotiation strategy are never AI\'s call to make — trusted source data in, a defined and traceable AI transformation, human review scaled to risk, then an approved action.' },
    ],
  },
  {
    key: 'team-decision-rights', label: 'Team & Decision Rights',
    teaser: 'A small, deliberately non-hierarchical team — but every engine still needs someone who owns it.',
    sections: [
      { heading: 'Who owns what', text: 'Steve owns client and investor relationships, market judgement, negotiation, and listing go/no-go. Ramiro owns the CRM, data architecture, AI workflows and process design, and supports commercial and market analysis. Ali runs information capture, CRM hygiene and follow-up, and now also owns SDAHC\'s outbound marketing and brand presence, built from a standing start. Loretta runs invoicing, payments and accounts.' },
      { heading: 'What always escalates to Steve', text: 'Anything touching price, legal position, confidentiality release, counterparty selection, client advice, strategic direction, or a possible SDAHC / 3DSDA overlap. The underlying discipline is to escalate a decision or a risk rather than resolve it by assumption — a clearly labelled unknown is more useful than a confident guess.' },
      { heading: 'What should never land on Steve\'s desk', text: 'Chasing outstanding documents, basic CRM data entry, scheduling, organising an already-approved data room, or a first-pass summary for his own review. The test is whether it requires his judgement, not whether it\'s easy.' },
      { heading: 'Marketing content has one extra rule', text: 'No external-facing brand content — a LinkedIn post, website copy, an outbound message — goes out without being checked against the approved wording rules first. It\'s a genuinely new function with no established approval workflow yet, so every piece currently defaults to Steve\'s review before it publishes.' },
    ],
  },
  {
    key: 'sdahc-3dsda', label: 'SDAHC / 3DSDA',
    teaser: 'Separate legal entities, separate duties — the overlap is real, and so is the conflict risk.',
    sections: [
      { heading: 'Not "adviser vs. provider"', text: 'SDAHC is itself a currently registered NDIS SDA provider, so that old framing is out of date. The real boundary is separate legal entity, primary purpose, client duty, governance, assets and decision authority.' },
      { heading: 'Two different kinds of organisation', text: 'SDAHC is a specialist transaction and advisory business earning advisory, brokerage, conjunction and referral revenue. 3DSDA Holdings is a public company limited by guarantee and registered charity, oriented toward acquiring or supporting underperforming SDA assets — a genuinely different purpose, with its own board and a director-recusal rule for anyone with a material personal interest in a matter before it.' },
      { heading: 'Why the overlap is real risk, not just opportunity', text: 'SDAHC regularly encounters assets that might suit 3DSDA\'s mission better than a standard buyer pool — but SDAHC\'s vendor advice must never bend toward 3DSDA\'s acquisition interest, and confidential vendor information is never shared with 3DSDA simply because people or relationships overlap.' },
      { heading: 'The safe default, until a formal protocol exists', text: 'A written related-party and opportunity-allocation protocol isn\'t documented yet. Until it is, any plausible SDAHC / 3DSDA overlap is treated as an escalation to Steve — never a decision made informally.' },
    ],
  },
];

/* ---------------------------- ASSUMPTIONS REGISTER ------------------------- */
/* Every simulated, estimated or placeholder figure in this prototype, in one
   place. If something in the UI carries an asterisk, it has an entry here.
   Surfaced via the "Prototype — Mock Data" badge and in Settings.

   `pages` groups each entry under the page(s) it's used on, so the modal can
   render one heading per page (a user on a given page finds only that
   page's assumptions quickly) instead of one long flat list. An entry
   affecting more than one page (e.g. fiscal year) is listed — and shown —
   under all of them. Order here doesn't matter; ASSUMPTION_PAGE_ORDER
   (app.js) controls heading order in the modal. */

const ASSUMPTIONS = [
  {
    id: 'value-added-rate',
    label: 'Commercial Flow "Value Added" (35% annualised rate)',
    usedIn: 'Overview → Commercial Flow waterfall',
    pages: ['Overview'],
    category: 'Modelled',
    why: 'No stage-history log exists to measure how much carried-over pipeline gained value during a period. Modelled as a fixed annualised re-rating rate applied to the current weighted pipeline, pro-rated to the period length.',
  },
  {
    id: 'opening-pipeline-derivation',
    label: 'Commercial Flow "Opening Pipeline" (back-solved, not stored)',
    usedIn: 'Overview → Commercial Flow waterfall',
    pages: ['Overview'],
    category: 'Modelled',
    why: 'There is no historical snapshot of pipeline value at the start of a period. Opening is derived algebraically from Closing, New, Value Added, Lost and Settled so the bridge always balances exactly.',
  },
  {
    id: 'estimated-close-date',
    label: 'Estimated close month (derived from stage probability)',
    usedIn: 'Revenue → Revenue Over Time (Forecast bars)',
    pages: ['Revenue'],
    category: 'Modelled',
    why: 'Notion does not track an expected close date. A rough one is derived from each deal\'s probability so forecast revenue can be bucketed into months — directional only, not an operational fact.',
  },
  {
    id: 'monthly-target-split',
    label: 'Monthly Revenue Target (defaults to annual target ÷ 12, editable)',
    usedIn: 'Revenue → Revenue Over Time (Target line), Forecast vs Actual (Cumulative) (Target line + Variance); Settings → Business',
    pages: ['Revenue', 'Settings'],
    category: 'Dashboard-owned',
    why: 'No seasonality is modelled for the target — it assumes even monthly pacing (annual target ÷ 12) unless overridden in Settings. The cumulative Forecast vs Actual chart accumulates this same flat monthly figure month over month to build its Target line and the Variance readout, so a real phased plan (e.g. seasonally weighted, or built up deal-by-deal) would change both charts identically, not just one.',
  },
  {
    id: 'market-relationships-estimate',
    label: '"Market / Relationships" top-of-funnel = 60 — REMOVED',
    usedIn: 'None currently — previously Sales Funnel → Conversion Funnel (top tier), mock only',
    pages: ['Sales Funnel'],
    category: 'Estimated constant',
    why: 'Not tracked in Notion at all — was an editorial estimate of SDAHC\'s active relationship network, shown only so the mock funnel had the correct shape. Removed as part of the Sales Funnel real-data migration (see \'funnel-tier-mapping\'): carrying a flat, made-up constant into a page whose whole point is now real data would undermine that. The real Conversion Funnel starts at Prospects (stage 0) instead, whose own count is the chart\'s true max — no replacement estimate needed.',
  },
  {
    id: 'qualified-definition',
    label: '"Qualified Opportunity" definition (reached stage A1 / B1)',
    usedIn: 'Overview → Deal Activity (real); Sales Funnel → funnel tiers (real), Prospect Sources (mock)',
    pages: ['Overview', 'Sales Funnel'],
    category: 'Definitional',
    why: 'Notion has no "qualified" flag. A deal is treated as qualified once its current/frozen stage is A1, B1 or later — a threshold judgement call, not a stored field. Real on both Overview\'s Deal Activity and Sales Funnel\'s stage funnel (same STAGE_INDEX threshold, applied to real deals); still mock on Sales Funnel\'s Prospect Sources section specifically, since that section groups by prospect source — see \'prospect-source-mock\' — not by stage alone.',
  },
  {
    id: 'funnel-tier-mapping',
    label: 'Sales Funnel tier → stage-index mapping — now real',
    usedIn: 'Sales Funnel → Conversion Funnel, Stage Conversion table',
    pages: ['Sales Funnel'],
    category: 'Real (cross-page check)',
    why: 'The real 16-stage pipeline is collapsed into 9 simplified milestones for readability — a scoping/definitional choice, not a fabrication: a deal\'s furthest-reached global stage index (real; Notion\'s Stage field, frozen at loss/pause, current if still active) stands in for a true per-deal milestone history, which Notion does not store, exactly as this always worked. What changed: this now reads REAL_DEALS via RealAggregates.funnelStages() (supabase-data.js) instead of mock DEALS — same FUNNEL_TIERS thresholds, same 9 tiers, both defined once in data.js and shared by the removed mock function and the real one. Differences from the old mock version: Paused AND Lost deals are excluded from every tier — not just Settlement\'s existing Won-only check — per \'pipeline-funnel-lost-exclusion\' (a deal that reached "DD Engaged" and was later Lost no longer inflates that tier forever; the mock predates both exclusion rules and applied neither), and the "Market / Relationships" top estimate row is gone entirely (see \'market-relationships-estimate\') rather than carried over. Advisory Proposal onward is also click-through (openFunnelTierModal(), app.js), reusing the same deal-list modal now shared with Overview\'s Pipeline-by-Stage chart and Deal Activity cards. The page\'s other sections (Relationship-Led vs Marketing-Sourced, Prospect Sources, New vs. Lost Prospects, Cohort Conversion by Quarter) remain mock — see \'prospect-source-mock\' for why the source-based ones can\'t follow yet.',
  },
  {
    id: 'funnel-proposal-outcomes',
    label: 'Proposal Funnel — sent / progressed / lost',
    usedIn: 'Sales Funnel → Proposal Funnel',
    pages: ['Sales Funnel'],
    category: 'Real (cross-page check)',
    why: 'New KPI: of every deal that has EVER reached "proposal sent" (A2 Advisory Proposal Sent or B2 Brokerage Proposal Sent, whichever track the deal is on), how many subsequently progressed further vs. ended up Lost, as of today. Fully real — RealAggregates.proposalFunnel() (supabase-data.js) reuses the exact per-track STAGE_INDEX/isTrack() threshold shape activitySummary()\'s reached() helper already established (advisory bounded above by B1 so a deal that has moved into brokerage stages is read via the brokerage branch instead; deals tagged neither track fall back to the A1 threshold, same fallback activitySummary() uses) — no new mock concept or field. Paused deals never enter the "sent" cohort, same non-negotiable rule as everywhere else; Lost deals ARE counted, in their own "lost" bucket specifically, per the standing exception for measures whose whole point is to show what happened to deals, not to represent an in-play pipeline (see \'pipeline-funnel-lost-exclusion\'). "Progressed Further" checks isWon directly rather than stage index for the Won case, since a pure-advisory Won deal\'s stage can sit at A5 rather than the brokerage-only \'9\' Settlement id (see this file\'s FUNNEL_TIERS comment on the settlement tier) — a stage-index-only check would have under-counted advisory wins. Not period-scoped, same as Conversion Funnel above it on this page — a lifetime measure, not tied to Overview\'s period control. Every card is click-through (openDealListModal(), app.js, same shared modal as the rest of the app), each showing the exact array its own count was computed from.',
  },
  {
    id: 'prospect-source-mock',
    label: 'Prospect source (Relationship-led vs Marketing-sourced) — entirely mock',
    usedIn: 'Sales Funnel → Relationship-Led vs Marketing-Sourced, Prospect Sources',
    pages: ['Sales Funnel'],
    category: 'Modelled',
    why: 'No field in the real Notion Deals database captures where a prospect came from — PROSPECT_SOURCES (Steve Relationship Network, Referral, Existing Client, Valuer/Adviser, SDA Report, LinkedIn/Marketing, Other) and every deal\'s `source` value exist only in this mock dataset. Unlike the stage funnel alongside it (now real — see \'funnel-tier-mapping\'), there is no real-data equivalent to fall back to today, so this stays fully mock rather than being partially migrated or approximated. Future improvement: once an origination-tracking field exists in Notion (a Source select/multi-select on the Deals database, populated going forward — backfilling history would need Steve\'s recollection, not a sync), this section should move to real data the same way the stage funnel just did.',
  },
  {
    id: 'revenue-scope',
    label: 'Revenue Composition & Concentration scope (Won + In Progress, excludes Lost and Paused)',
    usedIn: 'Revenue → Revenue Composition, Revenue Concentration',
    pages: ['Revenue'],
    category: 'Definitional',
    why: 'A scoping choice for "what counts as revenue-generating." Lost never produced revenue; Paused is explicitly zero monetary value and out of active pipeline (see \'paused-exclusion\') — both are excluded so these two charts only ever total real or realistically-open revenue. Not a Notion-native filter.',
  },
  {
    id: 'paused-exclusion',
    label: 'Paused deals excluded from all pipeline/revenue totals',
    usedIn: 'Overview (KPI strip, hero, waterfall, Deal Activity, Pipeline by Stage), Revenue (KPIs, composition, concentration, Revenue by Stage), Pipeline (deals table stays unaffected — Paused rows still shown, colour-coded)',
    pages: ['Overview', 'Revenue', 'Pipeline'],
    category: 'Definitional',
    why: 'A Paused deal (on hold, e.g. investor reviewing finance) carries zero monetary value in every pipeline/revenue aggregate, with no exceptions — Active Deals, Expected Open Pipeline, Weighted Pipeline, Revenue Composition, Revenue Concentration, byStage() (both "Pipeline by Stage" charts and Revenue\'s "Revenue by Stage" list) and funnelStages() all exclude it. Prospect and Contacted-stage deals remain fully included — this is specifically about the Paused outcome, not early pipeline stages. Paused deals still appear, clearly marked, in the Pipeline page\'s deals TABLE and in the real deal drawer — this rule is about aggregates/charts, never about hiding a deal from a plain listing. See \'pipeline-funnel-lost-exclusion\' for the parallel rule about Lost deals on pipeline/funnel visualizations specifically (Paused is broader: every aggregate, not just those two).',
  },
  {
    id: 'pipeline-funnel-lost-exclusion',
    label: 'Lost deals excluded from pipeline/funnel VISUALIZATIONS (not from plain tables or Deal Activity)',
    usedIn: 'Overview (Pipeline by Stage), Pipeline (Pipeline by Stage cards), Revenue (Revenue by Stage), Sales Funnel (Conversion Funnel, Stage Conversion, Proposal Funnel)',
    pages: ['Overview', 'Pipeline', 'Revenue', 'Sales Funnel'],
    category: 'Definitional',
    why: 'A Lost deal is a finished, unsuccessful outcome — real history, not part of an active pipeline picture. Any chart meant to represent "the pipeline" or "the funnel" (deals still in play, or the funnel shape leading to a win) now excludes Lost deals from its totals, the same way Paused already was: Overview\'s and Pipeline\'s "Pipeline by Stage" (RealAggregates.byStage(metric, {excludeLost:true})), Revenue\'s "Revenue by Stage" (RealAggregates.byStage(\'revenue\', {excludeLost:true}) — previously a deliberate exception, scoped "across every outcome"; that exception has been removed so this list is now consistent with every other real pipeline visualization), every tier of Sales Funnel\'s Conversion Funnel/Stage Conversion (RealAggregates.funnelStages(), which excludes Lost from every tier, not just Settlement — a deal that reached "DD Engaged" and was later Lost no longer inflates that tier), and Sales Funnel\'s Proposal Funnel (RealAggregates.proposalFunnel() — Paused excluded from its "sent" cohort the same way; Lost isn\'t excluded from ITS OWN "lost" bucket, since counting how many proposal-sent deals ended up Lost is the entire point of that KPI, but Lost deals still never inflate the "sent" or "progressed" counts beyond their own Lost bucket). This is a NEW, narrower carve-out than \'paused-exclusion\': it applies only to these specific pipeline/funnel-shaped visualizations, not to every aggregate in the app. Deliberate non-exceptions, so this isn\'t applied more broadly than the standing instruction asked for: (1) the Pipeline page\'s deals TABLE still lists Lost deals, colour-coded red, exactly as before — a table is a record, not a funnel; (2) Overview\'s Deal Activity is a movement/activity summary, not a pipeline view, and keeps its own "Deals Lost" card by design. byStage()\'s `excludeLost` option still defaults to false and must be opted into explicitly by each caller this applies to.',
  },
  {
    id: 'cohort-conversion',
    label: 'Cohort conversion by creation-quarter',
    usedIn: 'Sales Funnel → Cohort Conversion by Quarter',
    pages: ['Sales Funnel'],
    category: 'Definitional',
    why: 'Win rate is grouped by the quarter a deal was created — not a stored "cohort" concept in Notion. Quarters with no decided deals yet show "Too early" rather than a fabricated rate.',
  },
  {
    id: 'sda-report-inventory',
    label: 'SDA Report inventory (Printed, Allocated, Delivered, Damaged, Internal Use, Returned)',
    usedIn: 'SDA Report → Inventory panel; Settings → SDA Report',
    pages: ['SDA Report', 'Settings'],
    category: 'Dashboard-owned',
    why: 'SDA Report print logistics are not tracked in Notion at all. The whole inventory block is dashboard-owned, seeded with plausible starting values, and editable via the five adjustment actions on that page.',
  },
  {
    id: 'sda-report-funnel-upper',
    label: 'SDA Report funnel — Followed Up / Response / Meeting / Opportunity counts',
    usedIn: 'SDA Report → Commercial Funnel',
    pages: ['SDA Report'],
    category: 'Estimated constant',
    why: 'Individual report recipients are not tracked as Notion records, so early-funnel campaign activity is simulated at plausible conversion rates from the real Reports Delivered count.',
  },
  {
    id: 'sda-report-distribution',
    label: 'SDA Report distribution mix (by City, Channel, Priority, Relationship Type)',
    usedIn: 'SDA Report → Distribution charts',
    pages: ['SDA Report'],
    category: 'Estimated constant',
    why: 'Individual report recipients are not tracked as Notion records, so the breakdown is simulated to sum to the 122 delivered reports.',
  },
  {
    id: 'sda-report-deal-link',
    label: 'SDA Report → Deal / Pipeline Generated / Settled Revenue',
    usedIn: 'SDA Report → Commercial Funnel (final three stages)',
    pages: ['SDA Report'],
    category: 'Real (cross-page check)',
    why: 'Unlike the rest of this page, these figures are NOT simulated — they read directly from the real deals in data.js tagged source = "SDA Report", the same 3 deals counted on Sales Funnel → Prospect Sources. Settled Revenue is currently $0 because none of the 3 have reached Settlement yet.',
  },
  {
    id: 'market-pulse-gauges',
    label: 'Market Pulse gauges (Institutional Appetite, Completed Asset Demand, Regional Vacancy Risk, Capital/Yield Pressure, Provider Market Conditions)',
    usedIn: 'Market Intelligence → Market Pulse',
    pages: ['Market Intelligence'],
    category: 'Estimated constant',
    why: 'No live market-data feed exists yet. Values are illustrative placeholders showing how a future data feed would be visualised.',
  },
  {
    id: 'market-intel-deal-signals',
    label: 'Intelligence signals linked to SDA Abodes / Socia, LVP Logan and Coomera SDA Portfolio',
    usedIn: 'Market Intelligence → Intelligence Impacting Active Deals',
    pages: ['Market Intelligence'],
    category: 'Estimated constant',
    why: 'Illustrative only — demonstrates how market intelligence would inform live deals, not a real signal-detection system. Deal names are real (from data.js); the signals themselves are not.',
  },
  {
    id: 'fiscal-year-scope',
    label: 'Financial Year start month — affects YTD window',
    usedIn: 'Settings → Business; Overview (Settled Revenue YTD, hero pace marker), Revenue (Settled Revenue, Revenue Over Time axis)',
    pages: ['Settings', 'Overview', 'Revenue'],
    category: 'Dashboard-owned',
    why: 'Changes when "YTD"/pace starts counting. Defaults to July — the Australian Financial Year (1 Jul-30 Jun) — not calendar year, so the app runs on FY out of the box; editable in Settings to any quarter start. Every "YTD" figure (Overview\'s hero + KPI, Revenue\'s Settled Revenue), the hero\'s pace marker (% of FY elapsed), and Revenue Over Time\'s 12-month axis all read the same fiscalYearBounds() window, so a change here re-windows everything together — the chart runs Jul→Jun (or whatever start month is set) rather than always Jan→Dec, and correctly labels months that fall in the following calendar year.',
  },
  {
    id: 'playbook-source-condensation',
    label: 'SDAHC Playbook copy — distilled from the Operating Manual',
    usedIn: 'SDAHC Playbook (all sections)',
    pages: ['Playbook'],
    category: 'Definitional',
    why: 'Distilled from the SDAHC Capability & Operating Manual and the Identity & Direction Briefing (internal source documents, not shipped with this app) — condensed to short reference sub-sections, not a reproduction. Verify against source before treating any sentence here as exact wording, a commitment, or a number to quote externally.',
  },
  {
    id: 'delivery-milestone-model',
    label: 'Delivery deliverables, milestones, progress % and health (brokerage engagements)',
    usedIn: 'Delivery — Brokerage Engagements section, Milestone Timeline, Delivery Insights — SDA Abodes / Socia, Evergreen Built, Northline Community Housing, Bellbird Park SDA',
    pages: ['Delivery'],
    category: 'Modelled',
    why: 'Notion does not track deliverables, billing milestones, % complete or a health flag — Deals holds current stage and next action only. This models a plausible billing-milestone structure (commission on settlement, sometimes with an exchange-fee or conjunction-fee tranche first) for the 4 brokerage engagements on this page. Every milestone amount still sums exactly to that deal\'s sdahcRevenue() figure, so this can only re-slice real revenue, never add to it — but the split, due dates, deliverable statuses, progress % and health are dashboard-owned judgement calls, not Notion facts. Advisory engagements no longer appear in this mock section at all — see \'delivery-advisory-real\': they moved to a separate, real Advisory Engagements section sourced from analytics.deals. Production would need a new Notion structure (a Milestones or Deliverables database) or dashboard-owned modelling with finance sign-off to bring brokerage delivery data current.',
  },
  {
    id: 'delivery-advisory-real',
    label: 'Delivery → Advisory Engagements — now real, sourced from analytics.deals tranche fields',
    usedIn: 'Delivery → Advisory Engagements section (KPI row, engagement grid) — reuses the Pipeline real-deal drawer for detail',
    pages: ['Delivery'],
    category: 'Real (cross-page check)',
    why: 'Sourced from the same analytics.deals view and the same REAL_DEALS cache as Overview/Pipeline/Revenue — no second fetch, no mock data. Qualifying rule: advisory_fee > 0 AND at least one tranche STATUS field is non-null (status, not amount, is the "is this deal tranche-tracked in Notion" signal — the view coalesces every *_amount to 0, so a real zero and a never-filled-in field are otherwise indistinguishable). Locked/Unlocked reuses the mapping already established for real advisory money everywhere else in this app: Paid → Settled, WIP/Invoiced → Contracted, Not started → neither. Paused deals appear in the list, clearly marked, contributing zero to every KPI sum — the non-negotiable rule. A deal with advisory_fee but no tranche fields at all does not qualify here yet; it is not missing or hidden, it simply is not tranche-tracked in Notion yet, and it keeps counting normally on Overview/Revenue via its flat advisory_fee. "Unlockable This Quarter", "Revenue At Risk" and "Next Milestone" — all present on the mock KPI strip — have no real advisory equivalent shown here: they key off a milestone due date and a health flag, and neither field exists for real tranches (amount + status only) — fabricating either would be a guess dressed up as a real number, so they were dropped rather than faked. Brokerage delivery (health %, deliverables, milestone dates) has no Notion source at all and stays entirely on the mock DEALS/Aggregates.brokerageEngagements() — see \'delivery-milestone-model\'. As raw.deals accumulates real stage/tranche history (see \'advisory-brokerage-conversion\' for the parallel effort on stage history specifically), more of the dropped mock-only fields may eventually get a real replacement here too — none should be faked in the meantime.',
  },
  {
    id: 'delivery-tranche-fields',
    label: 'Explicit MOCK advisory billing tranches (consultancyFeeTotal, tranche1/2 Amount/Status/Date) — Overview/Revenue only now',
    usedIn: 'Overview + Revenue (Contracted Revenue, for mock engagements not already at Contract Issued/Under Contract) — via the 2 mock advisory deals still in DEALS',
    pages: ['Overview', 'Revenue'],
    category: 'Modelled',
    why: 'These are NEW fields — they do not exist in Notion today. This entry used to also cover Delivery\'s own Engagements grid/drawer/KPI strip/Milestone Timeline for these 2 mock advisory deals; that usage is GONE — Delivery\'s Advisory section is now real (see \'delivery-advisory-real\'), and Aggregates.engagements() (which still includes these 2 deals) is no longer called anywhere on the Delivery page, only by Revenue\'s mock contractedTierBreakdown() below. That one remaining caller is why these mock fields and this deal pair still exist in DEALS at all — removing them would change mock Overview/Revenue\'s Contracted Revenue figure, which is out of scope for the real-data migration. Field values are NOT derived from a fixed 50/50 rule or from stage (Paramount is billed 60/40, Horizon 70/30 — real engagements are rarely an even split); field names map 1:1 to a future Notion schema, and statuses are exactly the four values the real field uses — "Not started", "WIP", "Invoiced", "Paid". They carry the same financial meaning as the real version: Paid → Settled; Invoiced and WIP → Contracted; Not started → neither. That mapping is what feeds the mock Contracted Revenue figure on Overview/Revenue: engagements not already counted via the Contract Issued/Under Contract stage rule contribute their WIP + Invoiced tranche amounts there too.',
  },
  {
    id: 'delivery-stage-history',
    label: 'Deal stage-journey history (stageHistory[]) and stage-anomaly flags',
    usedIn: 'Pipeline → Deal Detail Drawer (stage-journey timeline, anomaly flag)',
    pages: ['Pipeline'],
    category: 'Modelled',
    why: 'Notion\'s Stage field is a single select with no transition history — it only ever holds the deal\'s current stage. stageHistory[] here is simulated for this prototype: each deal\'s past stages and entry dates are backfilled/interpolated, not real recorded transitions. In production this would NOT be a manual data-entry burden and would NOT require any new Notion field: the Notion→Supabase sync already runs nightly, and diffing each night\'s Stage value against the previous snapshot is enough to build a real transition log automatically, entirely outside Notion. The skipped-stage and moved-backwards anomalies flagged here are deliberately seeded (2 of the 25 deals) to demonstrate the detector; the dashboard only flags an unusual journey for review — it does not block or enforce valid stage transitions.',
  },
  {
    id: 'delivery-ai-insights',
    label: 'Delivery "Simulated AI" insight cards',
    usedIn: 'Delivery → Simulated AI panel',
    pages: ['Delivery'],
    category: 'Estimated constant',
    why: 'Not a real model call — no API is invoked. The insight selection and phrasing are hardcoded, but every figure inside each card is read live from the same milestone/deliverable data as the rest of the page, so an insight can never assert a number that contradicts the KPI strip or timeline.',
  },
  {
    id: 'pipeline-score-mock',
    label: 'Deal Score (fixed Pipeline table sort order)',
    usedIn: 'Pipeline → Deals table (Score column, fixed descending sort)',
    pages: ['Pipeline'],
    category: 'Modelled',
    why: 'In Notion, Score is a formula field computed from other deal properties — the details of that formula aren\'t reproduced here, and formula RESULTS (not formula definitions) are what the API exposes, so a real sync could read the computed value but not recompute it independently. This prototype assigns each deal a plausible mock score (probability, revenue scale and recency blended, then clamped 0-100) purely to demonstrate Score-driven ordering. In production the sync would capture whatever value Notion\'s formula actually computes, unmodified.',
  },
  {
    id: 'advisory-brokerage-conversion',
    label: 'Advisory→Brokerage Conversion Rate — DEFERRED, removed app-wide',
    usedIn: 'None currently — previously Overview → KPI strip, on both the mock and real pages',
    pages: ['Overview'],
    category: 'Modelled',
    why: 'Removed everywhere (mock pages included), not just the real one: this KPI can only mean something if it reads real stage-history — when a deal actually crossed from an advisory stage into a brokerage one — and that history isn\'t reliably available yet. A literal dealType multi-select overlap (\'Paid advisory / DD\' AND \'Brokerage / Divestment\' together) is always 0, not a real signal (confirmed with Steve: dealType is never re-tagged on conversion). The mock version worked around that by simulating a stageHistory[] log, which made the number look real without being backed by anything — precisely the kind of fabricated-looking figure this register exists to flag, so it\'s safer removed everywhere than shown anywhere, mock or real. history.deal_stage_events (sync/schema.sql) is now being captured nightly from real Notion stage changes; once that history has matured enough to compute a genuine conversion date per deal, this KPI should be reactivated app-wide from that real data — not reintroduced as a mock or a current-stage proxy.',
  },
  {
    id: 'avg-consultancy-listing-value',
    label: 'Average Consultancy Value / Average Listing Value — historical scope, not "active only"',
    usedIn: 'Overview → KPI strip (Average Consultancy Value, Average Listing Value)',
    pages: ['Overview'],
    category: 'Definitional',
    why: 'Both are mean deal-size metrics ("how big is a typical engagement/listing"), not revenue forecasts — so unlike most other KPIs on this page they deliberately include every deal regardless of outcome (Won, Lost, In Progress), not just In Progress. Average Consultancy Value averages advisoryRevenue() (tranche-aware) across every deal with a nonzero advisory fee; Average Listing Value averages transactionValue (the underlying asset price, never SDAHC revenue) across every deal tagged \'Brokerage / Divestment\'. A scoping choice, not a Notion-native filter.',
  },
  {
    id: 'marketing-spend',
    label: 'Marketing Spend by category (Travel, Events, Digital, Other)',
    usedIn: 'Marketing → Marketing Spend (Annual)',
    pages: ['Marketing'],
    category: 'Dashboard-owned',
    why: 'Marketing/origination spend is not tracked in Notion at all — this is an early scaffold for a future second origination channel, seeded with plausible annual figures (dominated by travel and event costs, per how the business actually spends on relationship-building) so the page has the right shape before real numbers exist. "Report Print/Production" is the one category NOT duplicated here — it reads SDA Report\'s campaignCost live rather than storing a second figure. No Settings edit form exists for these yet (unlike SDA Report\'s five adjustment actions); editing would be a natural next step once this becomes a real workstream.',
  },
  {
    id: 'marketing-electronic-distribution',
    label: 'Electronic report distribution, website downloads, and the Opened/Engaged funnel',
    usedIn: 'Marketing → SDA Report (Electronic Distribution & ROI)',
    pages: ['Marketing'],
    category: 'Estimated constant',
    why: 'Electronic distribution and website downloads are not tracked in Notion today — there is no record of how many electronic copies were sent, to whom, or how many were downloaded from the website. Sent (340) and Website Downloads (85) are dashboard-owned mock inputs; the audience breakdown ("to whom") is a simulated split, not real recipient records; Opened and Engaged are simulated conversion rates applied to Sent/Downloads, the same style of estimate as SDA Report\'s own Followed Up/Response/Meeting/Opportunity figures (see \'sda-report-funnel-upper\'). This is deliberately separate from, and does not recompute, SDA Report\'s PRINTED inventory (sdaReportInventory()) — that figure is only summarised/linked here.',
  },
];
