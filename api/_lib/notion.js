// READ-ONLY Notion adapter for the Properties data source. This slice has no write operations at all.
//
// Privacy by construction: only the properties in LISTED_PROPERTIES are requested from Notion, and the mapper
// copies only named fields into the result. Address, Price, Yield, Description, Features, Listing Agent,
// Sharepoint Link and Deals are never requested and never returned.
import { createHash } from 'node:crypto';

export const NOTION_FIELDS = Object.freeze({
  name: 'Name',
  state: 'State/ Territory',
  designCategory: 'Design Category',
  buildType: 'Build Type',
  webStatus: 'Web Listing Status',
  webTitle: 'Web Title',
  webPricingMode: 'Web Pricing Mode',
  webFeatured: 'Web Featured',
});
export const LISTED_PROPERTIES = Object.freeze(Object.values(NOTION_FIELDS));

const MAX_PAGES = 30;

export class NotionApiError extends Error {
  constructor(status, code) {
    super(`Notion request failed: HTTP ${status}${code ? ` (${code})` : ''}`);
    this.status = status;
    this.code = code;
  }
}

const plain = (rt) => (rt ?? []).map((t) => t?.plain_text ?? '').join('');

export const readText = (p) => {
  if (!p) return '';
  switch (p.type) {
    case 'title': return plain(p.title);
    case 'rich_text': return plain(p.rich_text);
    case 'select': return p.select?.name ?? '';
    case 'status': return p.status?.name ?? '';
    case 'multi_select': return (p.multi_select ?? []).map((o) => o.name).join(', ');
    default: return '';
  }
};
const readMulti = (p) => (p?.type === 'multi_select' ? (p.multi_select ?? []).map((o) => o.name) : p?.type === 'select' && p.select ? [p.select.name] : []);

/** Same derivation as the website adapter (src/data/listings/notion.ts publicIdFor): the raw page id never leaves Notion. */
export const publicIdFor = (notionPageId) => `lst_${createHash('sha256').update(notionPageId).digest('hex').slice(0, 10)}`;

const STATUS_BY_LABEL = {
  'not published': 'not_published', draft: 'draft', 'in review': 'in_review', approved: 'approved',
  published: 'published', 'under offer': 'under_offer', sold: 'sold', withdrawn: 'withdrawn',
};
export const mapWebStatus = (raw) => STATUS_BY_LABEL[String(raw).trim().toLowerCase()] ?? (String(raw).trim() === '' ? 'not_published' : 'unrecognised');

/**
 * The CRM Name is often a full street address. The website never shows a house or unit number, and this app's
 * repository and screenshots are public, so the number is removed before anything leaves the server. A future
 * detail view can reveal the full address with an explicit, audited action.
 */
export const maskStreetNumber = (name) =>
  String(name).replace(/^\s*(?:(?:unit|apt|apartment|lot)\s*)?\d+[a-z]?(?:\s*[/-]\s*\d+[a-z]?)*\s+(?=\p{L})/iu, '').trim();

/** The ONLY place a Notion page becomes API output. */
export function mapPage(page) {
  const p = page.properties ?? {};
  const label = readText(p[NOTION_FIELDS.webStatus]);
  return {
    id: publicIdFor(page.id),
    name: maskStreetNumber(readText(p[NOTION_FIELDS.name])) || '(untitled)',
    state: readText(p[NOTION_FIELDS.state]) || null,
    designCategories: readMulti(p[NOTION_FIELDS.designCategory]),
    buildType: readText(p[NOTION_FIELDS.buildType]) || null,
    webStatus: { label: label || 'Not Published', key: mapWebStatus(label) },
    webTitle: readText(p[NOTION_FIELDS.webTitle]).trim() || null,
    pricingMode: readText(p[NOTION_FIELDS.webPricingMode]) || null,
    featured: p[NOTION_FIELDS.webFeatured]?.type === 'checkbox' && p[NOTION_FIELDS.webFeatured].checkbox === true,
    archived: page.archived === true || page.in_trash === true,
    editedAt: page.last_edited_time ?? null,
  };
}

/**
 * Rows the website team manages: Web Listing Status is set. Read only (POST /query reads, never writes).
 * A capped or partial result is an error, never a quiet truncation.
 */
export async function fetchManagedProperties(cfg, { fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const qs = LISTED_PROPERTIES.map((n) => `filter_properties=${encodeURIComponent(n)}`).join('&');
  const url = `https://api.notion.com/v1/data_sources/${encodeURIComponent(cfg.dataSourceId)}/query?${qs}`;
  const out = [];
  let cursor;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = {
      page_size: 100,
      filter: { property: NOTION_FIELDS.webStatus, select: { is_not_empty: true } },
      ...(cursor ? { start_cursor: cursor } : {}),
    };
    let data;
    for (let attempt = 0; ; attempt += 1) {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.token}`, 'Notion-Version': cfg.version, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) { data = await res.json(); break; }
      let code;
      try { code = (await res.json()).code; } catch { /* non-JSON body */ }
      const retryable = res.status === 429 || res.status === 529 || res.status >= 500;
      if (!retryable || attempt >= 2) throw new NotionApiError(res.status, code); // never carries headers or bodies
      await sleep(500 * 2 ** attempt);
    }
    if (data?.request_status?.type === 'incomplete') throw new Error('Notion returned an incomplete result');
    out.push(...data.results);
    if (!data.has_more) return out.map(mapPage);
    cursor = data.next_cursor;
  }
  throw new Error('Notion query did not finish');
}
