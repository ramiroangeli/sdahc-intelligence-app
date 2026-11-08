// Server-side read of ONE Notion property for the editor. Read only. It reads the full page (Notion cannot filter a
// single page's properties by name), uses the internal fields only to (a) detect leaks and discrepancies and (b) compute
// hashes, and returns an explicit allowlist. Address, price, yield and income NEVER leave this module as values.
import { createHash } from 'node:crypto';
import { maskStreetNumber, NotionApiError, publicIdFor, readText, mapWebStatus } from './notion.js';

const PICKER_PROPS = ['Name', 'State/ Territory', 'Design Category', 'Build Type', 'Web Listing Status'];
const num = (p) => (p?.type === 'number' && typeof p.number === 'number' ? p.number : null);
const multi = (p) => (p?.type === 'multi_select' ? p.multi_select.map((o) => o.name) : p?.type === 'select' && p.select ? [p.select.name] : []);
const sha = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);

async function notionFetch(cfg, method, path, body, fetchImpl, sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetchImpl(`https://api.notion.com${path}`, {
      method,
      headers: { Authorization: `Bearer ${cfg.token}`, 'Notion-Version': cfg.version, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) return res.json();
    let code; try { code = (await res.json()).code; } catch { /* non-JSON */ }
    const retry = res.status === 429 || res.status === 529 || res.status >= 500;
    if (!retry || attempt >= 2) throw new NotionApiError(res.status, code); // no headers, no bodies
    await sleep(500 * 2 ** attempt);
  }
}

let listCache = null;
/** Every Properties row, minimal columns, cached briefly. Used by the picker and to resolve a public id to a page. */
export async function listAllProperties(cfg, { fetchImpl = fetch, now = Date.now, ttlMs = 60_000 } = {}) {
  if (listCache && listCache.key === cfg.dataSourceId && now() - listCache.at < ttlMs) return listCache.rows;
  const qs = PICKER_PROPS.map((n) => `filter_properties=${encodeURIComponent(n)}`).join('&');
  const rows = [];
  let cursor;
  for (let i = 0; i < 30; i += 1) {
    const data = await notionFetch(cfg, 'POST', `/v1/data_sources/${encodeURIComponent(cfg.dataSourceId)}/query?${qs}`, { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }, fetchImpl);
    if (data?.request_status?.type === 'incomplete') throw new Error('Notion returned an incomplete result');
    for (const page of data.results) {
      if (page.archived || page.in_trash) continue;
      const p = page.properties ?? {};
      const full = readText(p.Name).trim();
      rows.push({
        pageId: page.id,
        id: publicIdFor(page.id),
        fullName: full || '(untitled)',          // staff-only (picker and editor). Never in the dashboard response.
        label: maskStreetNumber(full) || '(untitled)',
        state: readText(p['State/ Territory']) || null,
        designCategories: multi(p['Design Category']),
        buildType: readText(p['Build Type']) || null,
        webStatus: readText(p['Web Listing Status']) || 'Not Published',
        webStatusKey: mapWebStatus(readText(p['Web Listing Status'])),
      });
    }
    if (!data.has_more) { listCache = { key: cfg.dataSourceId, at: now(), rows }; return rows; }
    cursor = data.next_cursor;
  }
  throw new Error('Notion query did not finish');
}
export const clearPropertyCache = () => { listCache = null; factCache.clear(); };

/** CRM free text such as "3 participant places; 2 occupied (2/3 physical occupancy ...". Returns null when not stated. */
export function parseOccupancy(text) {
  const t = String(text || '');
  let m = /(\d+)\s+participant places?[^0-9]{0,6}(\d+)\s+occupied/i.exec(t);
  if (m) return { places: Number(m[1]), occupied: Number(m[2]) };
  m = /(\d+)\s*\/\s*(\d+)\s+physical occupancy/i.exec(t);
  return m ? { places: Number(m[2]), occupied: Number(m[1]) } : null;
}

/** Pure: page -> facts. `internal` stays on the server. `facts` is the staff-visible allowlist. `hashes` detect change. */
export function mapFacts(page) {
  const p = page.properties ?? {};
  const full = readText(p.Name).trim();
  const address = readText(p.Address).trim();
  const crmDescription = readText(p.Description);
  const price = num(p.Price), yieldPct = num(p.Yield);
  const webPrice = num(p['Web Display Price']);
  const web = {
    title: readText(p['Web Title']).trim(),
    description: readText(p['Web Description']),
    publicAddress: readText(p['Web Public Address']).trim(),
    pricingMode: readText(p['Web Pricing Mode']),
    displayPrice: webPrice,
    featured: p['Web Featured']?.type === 'checkbox' && p['Web Featured'].checkbox === true,
  };
  const classification = { state: readText(p['State/ Territory']), design: multi(p['Design Category']), buildType: readText(p['Build Type']), buildClass: readText(p['Build Class.']), features: multi(p.Features) };
  const status = readText(p['Web Listing Status']) || 'Not Published';
  return {
    internal: { address, fullName: full, priceAud: price, yieldPct, occupancy: parseOccupancy(crmDescription) },
    facts: {
      id: publicIdFor(page.id),
      fullName: full || '(untitled)',
      label: maskStreetNumber(full) || '(untitled)',
      state: classification.state || null,
      designCategories: classification.design,
      buildType: classification.buildType || null,
      buildClass: classification.buildClass || null,
      features: classification.features,
      occupancy: parseOccupancy(crmDescription),
      webStatus: { label: status, key: mapWebStatus(status) },
      archived: page.archived === true || page.in_trash === true,
      editedAt: page.last_edited_time ?? null,
    },
    web,
    // a suggestion only: the CRM address with the house/unit number removed, used when it already fits the public format
    suggestedPublicAddress: maskStreetNumber(address || full),
    // hashes only: they reveal THAT something changed, never what
    hashes: {
      identity: sha({ full, address, archived: page.archived === true }),
      classification: sha(classification),
      web: sha({ web, status }),
      commercial: sha({ price, yieldPct, gross: num(p['Gross income']), mrrc: num(p['MRRC Income']), sda: num(p['SDA Income']), enrolled: num(p['Enrolled value']), lease: num(p['Private Rental/ Lease']), crmDescription }),
    },
  };
}

const factCache = new Map();
export async function getProperty(cfg, publicId, { fetchImpl = fetch, now = Date.now, ttlMs = 15_000 } = {}) {
  const hit = factCache.get(publicId);
  if (hit && now() - hit.at < ttlMs) return hit.value;
  const rows = await listAllProperties(cfg, { fetchImpl, now });
  const row = rows.find((r) => r.id === publicId);
  if (!row) return null;
  let page;
  try { page = await notionFetch(cfg, 'GET', `/v1/pages/${encodeURIComponent(row.pageId)}`, null, fetchImpl); } catch (e) { if (e instanceof NotionApiError && e.status === 404) return null; throw e; }
  if (page.archived || page.in_trash) return null;
  const value = { pageId: page.id, ...mapFacts(page) };
  factCache.set(publicId, { at: now(), value });
  return value;
}

/** Which groups of Notion facts differ from the baseline a draft was created against. Names only, never values. */
export function changedGroups(baseFacts, hashes) {
  return Object.keys(hashes).filter((k) => baseFacts?.[k] !== hashes[k]);
}
