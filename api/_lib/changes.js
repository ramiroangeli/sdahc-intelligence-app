// "Changes since live": the real difference between the saved draft and the version the website shows, field by field. It compares VALUES, not
// edit events, so a field that was changed and then restored to its published value is not a change. The rules mirror how the website job
// builds a snapshot from an approved draft (descriptions split into paragraphs, the price formatted as dollars, a blank title meaning "default"),
// so "no changes" here means the website job would find nothing to publish.
import { canonical } from './photos.js';
import { publicOptional, stable } from './optional-fields.js';

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
// blocks keep their line breaks (bullet lists), exactly as the website reads them
const normBlock = (b) => String(b ?? '').split('\n').map(norm).filter(Boolean).join('\n');
const paragraphs = (raw) => String(raw ?? '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(normBlock).filter(Boolean);
/** The price text the website would show for this draft, or '' when the pricing mode shows no amount. */
const priceText = (mode, display) => {
  if (mode !== 'asking_price' && mode !== 'price_guide') return '';
  const n = Number(String(display ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? '$' + Math.round(n).toLocaleString('en-AU') : '';
};

/**
 * @param draft     the draft row ({ content, photos })
 * @param published the website's version ({ title, description[], address, pricingMode, displayPrice, featured, photos[] }), from site.js
 * @returns { count, items: [{ field, label, detail? }] }
 */
export function changesSincePublished(draft, published) {
  const c = (draft && draft.content) || {};
  const items = [];
  // a blank title means "use the default": the website derives it, so a blank draft title is not a difference
  if (norm(c.title) && norm(c.title) !== norm(published.title)) items.push({ field: 'title', label: 'Title' });
  if (JSON.stringify(paragraphs(c.description)) !== JSON.stringify((published.description || []).map(normBlock))) items.push({ field: 'description', label: 'Description' });
  if (norm(c.publicAddress) !== norm(published.address)) items.push({ field: 'address', label: 'Address shown on the website' });
  if (norm(c.pricingMode) !== norm(published.pricingMode) || priceText(c.pricingMode, c.displayPrice) !== norm(published.displayPrice)) items.push({ field: 'price', label: 'Price shown' });
  if ((c.featured === true) !== (published.featured === true)) items.push({ field: 'featured', label: 'Shown first on the website' });

  // optional groups: what the draft would publish (the commercial block only while approved) against what is published, group by group
  {
    const want = publicOptional(draft, { state: published.state, status: published.status }) ?? {};
    const have = published.optional ?? {};
    const strip = (g) => (g ? (({ approval: _a, ...v }) => v)(g) : undefined);
    const same = (a, b) => stable(a) === stable(b);
    if (!same(want.property, have.property)) items.push({ field: 'property', label: 'Property details' });
    if (!same(want.sda, have.sda)) items.push({ field: 'sdaFacts', label: 'SDA details' });
    if (!same(strip(want.investment), have.investment)) items.push({ field: 'investment', label: 'Investment details' });
    if (!same(want.marketing, have.marketing)) items.push({ field: 'marketing', label: 'Marketing agency' });
  }

  const now = canonical(draft && draft.photos);
  const was = published.photos || [];
  const nowIds = now.map((p) => p.id); const wasIds = was.map((p) => p.id);
  const added = nowIds.filter((id) => !wasIds.includes(id)).length;
  const removed = wasIds.filter((id) => !nowIds.includes(id)).length;
  // order is judged among the photographs that exist in both versions, so adding or removing one does not by itself count as a reorder
  const reordered = JSON.stringify(nowIds.filter((id) => wasIds.includes(id))) !== JSON.stringify(wasIds.filter((id) => nowIds.includes(id)));
  const wasById = new Map(was.map((p) => [p.id, p]));
  // a blank description means "use the neutral text": only a written description that differs is a change
  const described = now.filter((p) => wasById.has(p.id) && norm(p.alt) && norm(p.alt) !== norm(wasById.get(p.id).alt)).length;
  const floorplan = now.filter((p) => wasById.has(p.id) && ((p.kind === 'floorplan') !== (wasById.get(p.id).kind === 'floorplan'))).length;
  if (added || removed || reordered || described || floorplan) {
    const parts = [];
    if (added) parts.push(added + ' added');
    if (removed) parts.push(removed + ' removed');
    if (reordered) parts.push('order changed');
    if (described) parts.push(described === 1 ? '1 description changed' : described + ' descriptions changed');
    if (floorplan) parts.push('floorplan changed');
    items.push({ field: 'photos', label: 'Photos', detail: parts.join(', ') });
  }
  return { count: items.length, items };
}
