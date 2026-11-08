// Builds the Listings screen's data. Three separate facts are kept apart on purpose:
//   notion      the commercial decision recorded in Notion (Web Listing Status): an INTENT
//   snapshot    the approved version committed to the website repository: what the next build contains
//   deployment  whether the public page actually answers on the website right now: the TRUTH
import { fetchManagedProperties } from './notion.js';
import { checkLive, listingUrl, loadSnapshots } from './site.js';

const COMMERCIAL_BY_STATUS = { published: 'available', under_offer: 'under_offer', sold: 'sold' };
const LIVE_INTENT = new Set(['published', 'under_offer', 'sold']);

/** Pure: combine the three facts into one row and say plainly whether they agree. */
export function combine({ notion, snapshot, withdrawn, live, url }) {
  let deployment;
  if (withdrawn) deployment = { state: 'withdrawn' };
  else if (!snapshot) deployment = { state: 'not_published' };
  else if (!live || live.state === 'unknown') deployment = { state: 'unknown', ...(live ? { httpStatus: live.httpStatus, checkedAt: live.checkedAt } : {}) };
  else deployment = { state: live.state, httpStatus: live.httpStatus, checkedAt: live.checkedAt };

  const intent = notion?.webStatus.key;
  const notes = [];
  if (!notion) notes.push('Approved on the website, but no Notion row has a Web Listing Status.');
  else if (notion.archived) notes.push('The Notion row is archived.');
  if (intent && LIVE_INTENT.has(intent) && deployment.state === 'not_published') notes.push('Notion says this is live, but no approved version exists on the website.');
  if (intent && LIVE_INTENT.has(intent) && deployment.state === 'not_live') notes.push('Notion says this is live, but the website page is not responding. A deployment may be pending or failed.');
  if (intent && !LIVE_INTENT.has(intent) && deployment.state === 'live') notes.push(`The page is live on the website while Notion shows ${notion.webStatus.label}.`);
  if (snapshot && intent && COMMERCIAL_BY_STATUS[intent] && COMMERCIAL_BY_STATUS[intent] !== snapshot.commercialStatus) notes.push('Notion commercial status differs from the published one. A status update is pending.');
  if (withdrawn && intent && LIVE_INTENT.has(intent)) notes.push('An explicit withdrawal overrides the Notion status.');
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

export async function buildListings(cfg, { fetchImpl = fetch, now = () => new Date() } = {}) {
  const sources = { notion: { state: 'ok' }, website: { state: 'ok' } };

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
  const listings = rows.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  return { generatedAt: now().toISOString(), sources, listings };
}
