// Long-form descriptions: saved and previewed freely, with a specific publication warning for text that cannot be published. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { draftPhotosRoute, draftPublishRoute, draftRoute } from '../api/_lib/routes.js';
import { ALI_N, EDITOR, ID_7B, PUBLISH_ENV, call, database, github, resetCaches, world } from './drafts-harness.js';

const jpeg = (n) => sharp({ create: { width: 1600 + n * 10, height: 1000, channels: 3, background: { r: (n * 37) % 255, g: (n * 91) % 255, b: (n * 151) % 255 } } }).jpeg().toBuffer();
const BASE = { title: 'Established Improved Liveability SDA Investment', publicAddress: 'Wattle Street, Exampleton NT 0800', pricingMode: 'contact_agent', displayPrice: '', featured: false };
const FIGURES = 'An opportunity to secure a fully occupied, established Improved Liveability (IL) Specialist Disability Accommodation investment in Armstrong Creek, within the growing Geelong region.\n\nInvestment summary:\n- Gross income: $164,435 p.a. (FY26)\n- Net operating income: $132,704 p.a. (FY26)\n- Net yield: 11.1%\n- 100% occupied with 3 SDA participants\n\nProperty summary:\n- Purpose-built Specialist Disability Accommodation\n- Improved Liveability (IL) design category\n- 3 participant places plus OOA';
const PLAIN = Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1} of a long commercial description for a synthetic property.`).join('\n\n') + '\n\nProperty summary:\n- Purpose-built accommodation\n- Wide doorways throughout\n\nLocation\n\nClose to shops, transport and parkland.';

async function ready(state = 'NT', address = BASE.publicAddress) {
  resetCaches();
  const w = world(); const db = await database(); const gh = github(w);
  w.state.page7B = { ...w.state.page7B, properties: { ...w.state.page7B.properties, 'State/ Territory': { type: 'select', select: { name: state } } } };
  const c = await call(draftRoute, w, db, ALI_N, { method: 'POST', body: { propertyId: ID_7B } });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  const up = (b, kind) => call(draftPhotosRoute, w, db, ALI_N, { method: 'POST', body: b, headers: { 'x-image-type': 'image/jpeg' }, url: `/api/listings/draft-photos?id=${ID_7B}${kind ? `&kind=${kind}` : ''}` });
  await up(await jpeg(1)); await up(await jpeg(2)); const p3 = await up(await jpeg(3), 'floorplan');
  const ids = p3.json.photos.items.map((p) => p.id);
  await call(draftPhotosRoute, w, db, ALI_N, { method: 'PUT', body: { id: ID_7B, expectedVersion: p3.json.draft.version, photos: [{ id: ids[0], alt: 'Kitchen', kind: 'photo' }, { id: ids[1], alt: '', kind: 'photo' }, { id: ids[2], alt: '', kind: 'floorplan' }] } });
  return { w, db, gh, address };
}
const version = async (db) => (await db.unsafe('select version from listings.drafts where public_id = $1', [ID_7B]))[0].version;
const save = async (c, description, extra = {}, who = ALI_N) => call(draftRoute, c.w, c.db, who, { method: 'PUT', body: { id: ID_7B, expectedVersion: await version(c.db), content: { ...BASE, publicAddress: c.address, description, ...extra } } });
const dry = async (c, who = ALI_N) => call(draftPublishRoute, c.w, c.db, who, { method: 'POST', fetch: c.gh.fetch, env: PUBLISH_ENV, body: { id: ID_7B, expectedVersion: await version(c.db), mode: 'dry_run' } });
const stored = async (db) => (await db.unsafe('select content from listings.drafts where public_id = $1', [ID_7B]))[0].content;

test('a long description with more than eight paragraphs, lists and headings saves, keeps every line break and previews', async () => {
  const c = await ready();
  const s = await save(c, PLAIN);
  assert.equal(s.status, 200, JSON.stringify(s.json));
  assert.equal(s.json.validation.fieldErrors.description, undefined, 'no description error');
  assert.equal((await stored(c.db)).description, PLAIN, 'the text is stored exactly as written (blank lines and list lines included)');
  const b = s.json.preview.blocks;
  assert.equal(b.filter((x) => x.type === 'p').length, 13, 'twelve paragraphs plus the closing line stay separate');
  assert.ok(b.some((x) => x.type === 'ul' && x.items.length === 2), 'a real list');
  assert.ok(b.some((x) => x.type === 'label' && x.text === 'Property summary:'));
  assert.ok(b.some((x) => x.type === 'h' && x.text === 'Location'));
  assert.equal(s.json.preview.summary, 'Paragraph 1 of a long commercial description for a synthetic property.');
});

test('the Armstrong Creek style description with dollar amounts, income and yield saves and previews without any error', async () => {
  const c = await ready();
  const s = await save(c, FIGURES);
  assert.equal(s.status, 200);
  assert.equal((await stored(c.db)).description, FIGURES, 'nothing is silently removed');
  assert.equal(s.json.validation.errors.length, 0, 'no editing error');
  assert.equal(s.json.validation.fieldErrors.description, undefined);
  assert.equal(s.json.validation.complete, true, 'the draft is complete enough to preview');
  assert.ok(s.json.preview.blocks.some((x) => x.type === 'ul' && x.items[0] === 'Gross income: $164,435 p.a. (FY26)'));
});

test('the same text carries a specific publication warning, not the old vague keyword error', async () => {
  const c = await ready();
  const s = await save(c, FIGURES);
  const w = s.json.validation.blockers.find((x) => x.code === 'description_financial');
  assert.ok(w, 'a publication warning is present');
  assert.match(w.message, /"\$164,435 p\.a\."/);
  assert.match(w.message, /"yield"/);
  assert.match(w.message, /Gross income: \$164,435 p\.a\. \(FY26\)/, 'it quotes a line so the person can find it');
  assert.match(w.message, /Investment details/, 'it says where the information belongs');
  assert.ok(!/outside the approved price/.test(JSON.stringify(s.json)), 'the vague wording is gone');
  assert.equal(s.json.validation.publishable, false);
});

test('Victoria: the warning says income and yield cannot be published at all for now', async () => {
  const c = await ready('VIC', 'Wattle Street, Exampleton VIC 3999');
  const s = await save(c, FIGURES);
  const w = s.json.validation.blockers.find((x) => x.code === 'description_financial');
  assert.match(w.message, /Victorian listing/);
  assert.match(w.message, /cannot be published at all/);
});

test('free text cannot get figures published: a publication request for such a description is refused and nothing is recorded', async () => {
  const c = await ready();
  await save(c, FIGURES);
  const r = await dry(c);
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(r.json.error, 'not_ready');
  assert.ok(r.json.reasons.some((x) => /yield/.test(x)), 'the refusal names the problem');
  assert.equal((await c.db.unsafe('select 1 from listings.publish_jobs')).length, 0);
  assert.equal(c.gh.dispatches.length, 0);
});

test('an unapproved yield in the text does not bypass the approval of the structured commercial block', async () => {
  const c = await ready();
  await save(c, 'A fine house in Exampleton.\n\nNet yield 11.1%', { investment: { leaseStatus: 'fully_leased', yieldPct: 11.1, yieldType: 'net', basis: 'actual' } });
  const r = await dry(c);
  assert.equal(r.status, 409, 'blocked by the text');
  await save(c, 'A fine house in Exampleton.', { investment: { leaseStatus: 'fully_leased', yieldPct: 11.1, yieldType: 'net', basis: 'actual' } });
  const r2 = await dry(c);
  assert.equal(r2.status, 200, JSON.stringify(r2.json));
  const p = (await c.db.unsafe('select payload from listings.publish_jobs'))[0].payload;
  assert.equal(p.content.optional?.investment, undefined, 'the structured figures still need a Publisher approval');
  assert.ok(!/11\.1/.test(JSON.stringify(p)), 'the unapproved yield is nowhere in the request');
});

test('a plain long description with lists is accepted for publication and travels exactly as written', async () => {
  const c = await ready();
  await save(c, PLAIN);
  const r = await dry(c);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const p = (await c.db.unsafe('select payload from listings.publish_jobs'))[0].payload;
  assert.equal(p.content.description, PLAIN);
});

test('an Editor can write and save any description, but only a Publisher can publish it', async () => {
  const c = await ready();
  const s = await save(c, FIGURES, {}, EDITOR);
  assert.equal(s.status, 200);
  assert.equal((await dry(c, EDITOR)).status, 403);
});

test('markup typed into a description is stored and previewed as plain text, never interpreted', async () => {
  const c = await ready();
  const text = 'A house. <script>alert(1)</script> and <img src=x onerror=alert(2)> are just words.';
  const s = await save(c, text);
  assert.equal(s.status, 200);
  assert.equal((await stored(c.db)).description, text);
  assert.equal(s.json.preview.blocks[0].text, text, 'delivered as data; the screen writes it with textContent');
});

test('the limits are technical only: 120 blocks, 6,000 characters a block, 30,000 in all', async () => {
  const c = await ready();
  assert.equal((await save(c, Array.from({ length: 120 }, (_, i) => `Block ${i}.`).join('\n\n'))).json.validation.fieldErrors.description, undefined);
  assert.ok((await save(c, Array.from({ length: 121 }, (_, i) => `Block ${i}.`).join('\n\n'))).json.validation.fieldErrors.description);
  assert.ok((await save(c, 'x'.repeat(6001))).json.validation.fieldErrors.description);
  assert.equal((await save(c, 'x'.repeat(5999))).json.validation.fieldErrors.description, undefined);
  assert.equal((await save(c, 'x'.repeat(30001), {})).status, 400, 'beyond the field limit the save is refused outright, as a clear 400');
});

test('private information is still refused as an error: a house number in the text, a phone number', async () => {
  const c = await ready();
  const a = await save(c, 'The property is at 7B Wattle Street in Exampleton with three places.');
  assert.ok(a.json.validation.errors.some((e) => e.code === 'private_address'));
  const p = await save(c, 'Call the owner on 0412 345 678 about this house.');
  assert.ok(p.json.validation.errors.some((e) => e.code === 'personal_data'));
});

test('an existing one-paragraph draft behaves exactly as before: no blocks beyond the paragraph, no warning', async () => {
  const c = await ready();
  const s = await save(c, 'An improved liveability SDA house in Exampleton with three participant places.');
  assert.deepEqual(s.json.preview.blocks, [{ type: 'p', text: 'An improved liveability SDA house in Exampleton with three participant places.' }]);
  assert.equal(s.json.validation.blockers.some((b) => b.code === 'description_financial'), false);
});
