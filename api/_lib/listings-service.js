// Builds the Listings screen's data. Three separate facts are kept apart on purpose:
//   notion      the CRM record (its Web Listing Status is reference only, never the authority)
//   snapshot    the approved version committed to the website repository: what the next build contains
//   deployment  whether the public page actually answers on the website right now: the TRUTH
import { fetchManagedProperties } from './notion.js';
import { checkLive, listingUrl, loadSnapshots } from './site.js';
import { changesSincePublished } from './changes.js';

const COMMERCIAL_BY_STATUS = { published: 'available', under_offer: 'under_offer', sold: 'sold' };
const LIVE_INTENT = new Set(['published', 'under_offer', 'sold']);

/**
 * The PUBLICATION state of a listing, separate from its selling status: draft, ready, publishing, live, live_changes (the saved draft differs from the
 * website), withdrawn. Also how many changes are waiting and whether something needs attention (the last real job did not complete). Pure.
 *   draftRow    the raw draft row (content, photos) or null; snapshot the website's summary from site.js or null; lastJob the listing's latest real job or null
 */
export function publicationFor({ draftRow, snapshot, withdrawn, lastJob }) {
  const active = lastJob && ['queued', 'dispatched', 'running'].includes(lastJob.status);
  const failed = !!(lastJob && lastJob.status === 'failed');
  if (withdrawn) return { state: 'withdrawn', changesCount: 0, attention: failed && lastJob.kind === 'withdraw' && lastJob.result?.merged === true };
  if (active) return { state: 'publishing', changesCount: 0, attention: false };
  if (snapshot) {
    const changes = draftRow && snapshot.public ? changesSincePublished(draftRow, { ...snapshot.public, address: snapshot.address }).count : 0;
    return { state: changes > 0 ? 'live_changes' : 'live', changesCount: changes, attention: failed };
  }
  const c = draftRow?.content ?? {};
  const photos = Array.isArray(draftRow?.photos) ? draftRow.photos.filter((p) => p.kind !== 'floorplan').length : 0;
  const ready = !!(c.description && c.publicAddress && c.pricingMode && photos > 0);
  return { state: ready ? 'ready' : 'draft', changesCount: 0, attention: failed };
}

/** Pure: combine the three facts into one row and say plainly whether they agree. */
export function combine({ notion, snapshot, withdrawn, live, url }) {
  let deployment;
  if (withdrawn) deployment = { state: 'withdrawn' };
  else if (!snapshot) deployment = { state: 'not_published' };
  else if (!live || live.state === 'unknown') deployment = { state: 'unknown', ...(live ? { httpStatus: live.httpStatus, checkedAt: live.checkedAt } : {}) };
  else deployment = { state: live.state, httpStatus: live.httpStatus, checkedAt: live.checkedAt };

  // Notion is the CRM, not the authority for public marketing: its Web Listing Status never raises a warning here. Only the website's own state does.
  const notes = [];
  if (deployment.state === 'not_live') notes.push('The page is not responding on the website. A deployment may be pending or failed.');
  if (deployment.state === 'unknown' && snapshot) notes.push('The live check could not confirm the page. Try again shortly.');

  return {
    id: notion?.id ?? snapshot.listingId,
    name: notion?.name ?? snapshot?.title ?? '(unknown)',
    state: notion?.state ?? null,
    designCategories: notion?.designCategories ?? [],
    buildType: notion?.buildType ?? null,
    notion: notion ? { status: notion.webStatus.label, statusKey: notion.webStatus.key, archived: notion.archived, editedAt: notion.editedAt } : null,
    website: snapshot ? { version: snapshot.version, slug: snapshot.slug, title: snapshot.title, commercialStatus: snapshot.commercialStatus, approvedAt: snapshot.approvedAt, firstPublishedAt: snapshot.firstPublishedAt, url } : null,
    deployment,
    inSync: notes.length === 0,
    notes,
  };
}

/** Attach saved drafts to their rows, or add a draft-only row. A draft never changes the website/deployment columns. */
export function attachDrafts(listings, drafts, { rows = [], snaps = null, lastJobs = new Map() } = {}) {
  const rawById = new Map(rows.map((r) => [r.public_id, r]));
  const byId = new Map(listings.map((l) => [l.id, l]));
  for (const d of drafts) {
    const row = byId.get(d.id);
    if (row) { row.draft = d; continue; }
    listings.push({ id: d.id, name: d.label, state: null, designCategories: [], buildType: null, notion: null, website: null, deployment: { state: 'not_published' }, inSync: true, notes: [], draft: d });
  }
  for (const l of listings) l.publication = publicationFor({ draftRow: rawById.get(l.id) ?? null, snapshot: snaps?.approved.get(l.id) ?? null, withdrawn: l.deployment.state === 'withdrawn', lastJob: lastJobs.get(l.id) ?? null });
  return listings.sort((a, b) => a.name.localeCompare(b.name));
}

export async function buildListings(cfg, { fetchImpl = fetch, now = () => new Date(), drafts = null, draftRows = [], lastJobs = new Map() } = {}) {
  const sources = { notion: { state: 'ok' }, website: { state: 'ok' }, drafts: drafts ? { state: drafts.state } : { state: 'not_configured' } };

  let properties = [];
  if (!cfg.notion) sources.notion = { state: 'not_configured' };
  else {
    try { properties = await fetchManagedProperties(cfg.notion, { fetchImpl }); } catch (e) {
      sources.notion = { state: 'error', message: e?.status ? `Notion answered HTTP ${e.status}` : 'Notion could not be read' };
    }
  }

  let snaps = { approved: new Map(), withdrawn: new Set(), problems: [] };
  try { snaps = await loadSnapshots(cfg, { fetchImpl }); } catch {
    sources.website = { state: 'error', message: 'The website repository could not be read' };
  }
  if (snaps.problems.length) sources.website = { state: 'warning', message: snaps.problems.join('; ') };

  const byId = new Map(properties.map((p) => [p.id, p]));
  const ids = new Set([...byId.keys(), ...snaps.approved.keys()]);
  const rows = await Promise.all([...ids].map(async (id) => {
    const notion = byId.get(id) ?? null;
    const snapshot = snaps.approved.get(id) ?? null;
    if (notion && notion.webStatus.key === 'not_published' && !snapshot) return null;
    const withdrawn = snaps.withdrawn.has(id);
    const url = snapshot ? listingUrl(cfg, snapshot.slug) : null;
    const live = snapshot && !withdrawn && sources.website.state !== 'error' ? await checkLive(cfg, snapshot.slug, { fetchImpl }) : null;
    return combine({ notion, snapshot: sources.website.state === 'error' ? null : snapshot, withdrawn, live, url });
  }));
  const listings = attachDrafts(rows.filter(Boolean), drafts?.items ?? [], { rows: draftRows, snaps: sources.website.state === 'error' ? null : snaps, lastJobs });
  return { generatedAt: now().toISOString(), sources, listings };
}
