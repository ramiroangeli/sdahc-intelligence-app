// Optional public fields of a listing: physical facts, three SDA facts, the commercial block (lease, occupancy, income, yield) and the marketing agency.
//
// PRIVATE BY DEFAULT. The values a person types are stored in the draft, but nothing here is published until it is approved:
//   * Physical facts, SDA facts and the agency need no approval (they are ordinary descriptive facts the person enters for this listing).
//   * The commercial block is published ONLY while a Publisher's approval is attached to its exact values.
//
// THE APPROVAL (why a browser cannot forge it)
//   The approval record lives in the draft's `verification` column (the same server-written store as the commercial verification records), under
//   `investment_disclosure`: { valuesHash, provider, by, at }. It is written ONLY by approveInvestment(), called from the Publisher-only verify route.
//   - The hash is computed on the SERVER from the values stored in the database. The request carries no hash, no record, no identity.
//   - `by` and `at` come from the signed-in session and the server clock.
//   - The save path never reads `verification` from a request, and cleanContent() drops any `approval` or hash typed into the commercial values.
//   - Any change to a value changes the hash, so the record stops matching (and the save path also removes it, visibly, in the history).
//   - Publishing re-checks the record against the current values and builds the block from the stored values, never from the browser.
//   The website then verifies the same hash again, and its safety checks apply (Victorian restriction, text scan). The payload itself is signed.
//   No database change is needed: `verification` is an existing jsonb column and 'verify' an existing history action.
import * as core from './vendor/listings-core.mjs';
import { HttpError } from './http.js';

export const APPROVAL_KEY = 'investment_disclosure';
const PLACEHOLDER_HASH = '0'.repeat(64);

const bad = (message) => Object.assign(new Error(message), { status: 400, code: 'invalid_content' });
const num = (v, k, { int = false } = {}) => {
  if (v == null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim());
  if (!Number.isFinite(n)) throw bad(`${k} must be a number`);
  if (int && !Number.isInteger(n)) throw bad(`${k} must be a whole number`);
  return n;
};
const txt = (v, k, max) => {
  if (v == null || v === '') return undefined;
  if (typeof v !== 'string') throw bad(`${k} must be text`);
  const s = v.replace(/\s+/g, ' ').trim();
  if (!s) return undefined;
  if (s.length > max) throw bad(`${k} is too long`);
  return s;
};
const oneOf = (v, k, list) => {
  if (v == null || v === '') return undefined;
  if (!list.includes(v)) throw bad(`${k} is not a valid choice`);
  return v;
};
const pack = (o) => { const out = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)); return Object.keys(out).length ? out : undefined; };

/**
 * Normalises the optional groups of a draft's content to the stored shape. Absent or empty groups are omitted (so an existing draft's content is unchanged).
 * Unknown keys are dropped, and so is anything resembling an approval or a hash inside the commercial values.
 */
export function cleanOptional(input) {
  const c = input && typeof input === 'object' ? input : {};
  const p = c.property && typeof c.property === 'object' ? c.property : {};
  const s = c.sdaFacts && typeof c.sdaFacts === 'object' ? c.sdaFacts : {};
  const i = c.investment && typeof c.investment === 'object' ? c.investment : {};
  const m = c.marketing && typeof c.marketing === 'object' ? c.marketing : {};
  const out = {};
  const property = pack({ bathrooms: num(p.bathrooms, 'bathrooms', { int: true }), carSpaces: num(p.carSpaces, 'car spaces', { int: true }), floorAreaM2: num(p.floorAreaM2, 'floor area'), landAreaM2: num(p.landAreaM2, 'land area'), parking: txt(p.parking, 'parking', 80), municipality: txt(p.municipality, 'municipality', 60) });
  const sdaFacts = pack({ bedrooms: num(s.bedrooms, 'bedrooms', { int: true }), residentPlaces: num(s.residentPlaces, 'participant places', { int: true }), ooa: txt(s.ooa, 'OOA', 120) });
  const investment = pack({
    leaseStatus: oneOf(i.leaseStatus, 'lease status', core.LEASE_STATUSES), occupancyStatus: oneOf(i.occupancyStatus, 'occupancy status', core.OCCUPANCY_STATUSES),
    tenure: txt(i.tenure, 'tenure', 120), annualIncomeAud: num(i.annualIncomeAud, 'annual income', { int: true }), incomeType: oneOf(i.incomeType, 'income type', core.INCOME_TYPES),
    yieldPct: num(i.yieldPct, 'yield'), yieldType: oneOf(i.yieldType, 'yield type', core.INCOME_TYPES), basis: oneOf(i.basis, 'basis', core.FIGURE_BASES),
    providerArrangement: txt(i.providerArrangement, 'provider arrangement', 200),
  });
  const marketing = pack({ agency: txt(m.agency, 'agency', 40) });
  if (property) out.property = property;
  if (sdaFacts) out.sdaFacts = sdaFacts;
  if (investment) out.investment = investment;
  if (marketing) out.marketing = marketing;
  return out;
}

/** The hash of the commercial values (the website's own function), so the approval means the same thing on both sides. */
export const hashOfValues = (inv) => core.investmentValuesHash({ ...inv, approval: { valuesHash: PLACEHOLDER_HASH } });

/** JSON with sorted keys: the database (jsonb) does not keep key order, so equal values must compare equal whatever order they came back in. */
export const stable = (v) => JSON.stringify(v ?? null, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

const hasFigures = (inv) => !!inv && core.hasFinancialFigures(inv);
export const stateOf = (publicAddress) => { try { return core.parsePublicAddress(publicAddress).state; } catch { return null; } };

/**
 * Checks the typed values with the website's own strict schema (a placeholder stands in for the approval). Returns plain messages by field.
 * These never block saving or publishing the rest of the listing: unapproved values are simply not published. They block APPROVAL.
 */
export function optionalIssues(content, { state } = {}) {
  const issues = [];
  const add = (field, message) => issues.push({ field, message });
  const inv = content.investment;
  const groups = {
    ...(content.property ? { property: content.property } : {}),
    ...(content.sdaFacts ? { sda: content.sdaFacts } : {}),
    ...(content.marketing ? { marketing: content.marketing } : {}),
    ...(inv ? { investment: { ...inv, approval: { valuesHash: PLACEHOLDER_HASH, ...(inv.providerArrangement ? { provider: true } : {}) } } } : {}),
  };
  const r = core.optionalGroupsSchema.safeParse(groups);
  if (!r.success) for (const e of r.error.issues) add(e.path[0] === 'sda' ? 'sdaFacts' : String(e.path[0] ?? 'investment'), e.message);
  if (content.marketing && !core.isApprovedAgency(content.marketing.agency)) add('marketing', 'Choose an approved marketing agency.');
  if (inv && state === 'VIC' && hasFigures(inv)) add('investment', core.VICTORIAN_FINANCIAL_RESTRICTION);
  return issues;
}

/**
 * The state of the commercial block's approval, from the stored values and the stored record. Pure.
 *   none        no commercial values
 *   unapproved  values exist, no valid record (never approved, or the provider wording lacks its own authorisation)
 *   stale       a record exists but the values changed since: it no longer counts
 *   approved    the record matches the values exactly
 */
export function approvalState(draft) {
  const inv = draft.content?.investment;
  if (!inv) return { state: 'none' };
  const rec = draft.verification?.[APPROVAL_KEY];
  if (!rec || typeof rec.valuesHash !== 'string') return { state: 'unapproved' };
  if (rec.valuesHash !== hashOfValues(inv)) return { state: 'stale', by: rec.by ?? null, at: rec.at ?? null };
  if (inv.providerArrangement && rec.provider !== true) return { state: 'unapproved' };
  return { state: 'approved', by: rec.by ?? null, at: rec.at ?? null, provider: rec.provider === true, imported: rec.imported === true };
}

/**
 * The public optional groups exactly as they would be published, or null. The commercial block is included only while approved, never for a Sold
 * listing, and never with income or yield on a Victorian listing. Built from the stored draft, never from a request.
 */
export function publicOptional(draft, { state, status } = {}) {
  const c = draft.content ?? {};
  const out = {};
  if (c.property) out.property = c.property;
  if (c.sdaFacts) out.sda = c.sdaFacts;
  if (c.marketing) out.marketing = c.marketing;
  const a = approvalState(draft);
  if (a.state === 'approved' && status !== 'sold' && !(state === 'VIC' && hasFigures(c.investment))) {
    out.investment = { ...c.investment, approval: { valuesHash: draft.verification[APPROVAL_KEY].valuesHash, ...(c.investment.providerArrangement ? { provider: true } : {}) } };
  }
  return Object.keys(out).length ? out : null;
}

/**
 * The approval record for the stored values, or an error saying why not. `actor` comes from the session and `now` from the server clock.
 * Nothing in the request is consulted except the Publisher's explicit confirmations.
 */
export function approveInvestment(draft, { actor, now = new Date(), state, provider = false, confirmed = false, crmOccupancy = null }) {
  const inv = draft.content?.investment;
  if (!inv) throw new HttpError(409, 'nothing_to_approve', { reasons: ['There are no commercial details to approve.'] });
  if (confirmed !== true) throw new HttpError(400, 'confirmation_required', { reasons: ['Confirm that these details are verified and approved for public advertising.'] });
  const problems = optionalIssues(draft.content, { state }).filter((i) => i.field === 'investment');
  if (state === 'VIC' && hasFigures(inv)) throw new HttpError(409, 'victorian_restriction', { reasons: [core.VICTORIAN_FINANCIAL_RESTRICTION + ' Remove the income and yield to approve the lease and occupancy details.'] });
  if (problems.length) throw new HttpError(409, 'invalid_values', { reasons: problems.map((p) => p.message) });
  if (inv.providerArrangement && provider !== true) throw new HttpError(409, 'provider_authorisation_needed', { reasons: ['Provider arrangement wording needs its own explicit authorisation.'] });
  if (inv.occupancyStatus === 'fully_occupied' && crmOccupancy && crmOccupancy.occupied < crmOccupancy.places) {
    throw new HttpError(409, 'occupancy_conflict', { reasons: [`The CRM records ${crmOccupancy.occupied} of ${crmOccupancy.places} places physically occupied. Correct the CRM or the occupancy status before approving.`] });
  }
  return { valuesHash: hashOfValues(inv), provider: !!inv.providerArrangement && provider === true, by: actor.email, at: now.toISOString() };
}

/** The verification object with the approval removed (a new object). */
export const withoutApproval = (verification) => { const { [APPROVAL_KEY]: _gone, ...rest } = verification ?? {}; return rest; };

/** The choices the editor offers, from the website's own lists (so they cannot drift). */
export const optionalChoices = () => ({
  lease: core.LEASE_STATUSES.map((k) => ({ key: k, label: core.LEASE_LABEL[k] })),
  occupancy: core.OCCUPANCY_STATUSES.map((k) => ({ key: k, label: core.OCCUPANCY_LABEL[k] })),
  incomeTypes: core.INCOME_TYPES.map((k) => ({ key: k, label: k === 'gross' ? 'Gross' : 'Net' })),
  bases: core.FIGURE_BASES.map((k) => ({ key: k, label: k === 'actual' ? 'Actual' : 'Projected' })),
  agencies: core.AGENCIES.map((a) => ({ key: a.key, name: a.name })),
  defaultAgency: core.DEFAULT_AGENCY_KEY,
});
