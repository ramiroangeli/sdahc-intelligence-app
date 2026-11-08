import test from 'node:test';
import assert from 'node:assert/strict';
import { draftRoute, draftVerifyRoute, listRoute, propertiesRoute } from '../api/_lib/routes.js';
import { ALI, database, EDITOR, ID_7A, ID_7B, ID_RG, PUBLISHER, SECRETS, VIEWER, call, page7B, resetCaches, world } from './drafts-harness.js';

const GOOD = { title: 'Established Improved Liveability SDA Investment', description: 'An improved liveability SDA house in Exampleton with three participant places and onsite overnight assistance.', publicAddress: 'Wattle Street, Exampleton VIC 3999', pricingMode: 'contact_agent', displayPrice: '', featured: false };

async function setup() {
  resetCaches();
  const w = world(); const db = await database();
  return { w, db };
}
const create = (w, db, who = ALI, id = ID_7B) => call(draftRoute, w, db, who, { method: 'POST', body: { propertyId: id } });
const save = (w, db, who, id, expectedVersion, content, extra = {}) => call(draftRoute, w, db, who, { method: 'PUT', body: { id, expectedVersion, content, ...extra } });
const open = (w, db, who = ALI, id = ID_7B) => call(draftRoute, w, db, who, { url: `/api/listings/draft?id=${id}` });

test('Editor creates the Exampleton draft: safe public address suggested, no number, facts shown, nothing published', async () => {
  const { w, db } = await setup();
  const r = await create(w, db);
  assert.equal(r.status, 200);
  assert.equal(r.json.draft.version, 1);
  assert.equal(r.json.draft.content.publicAddress, 'Wattle Street, Exampleton VIC 3999');
  assert.ok(!/\d/.test(r.json.draft.content.publicAddress.split(',')[0]), 'street has no number');
  assert.equal(r.json.property.fullName, '7B Wattle Street, Exampleton VIC 3999', 'staff see which property it is (7B, not 7A)');
  assert.deepEqual(r.json.property.designCategories, ['IL']);
  assert.equal(r.json.property.buildType, 'House');
  assert.equal(r.json.validation.complete, false, 'empty description and mode');
  assert.ok(r.json.validation.fieldErrors.description && r.json.validation.fieldErrors.pricingMode);
  assert.equal(r.json.draft.label, 'Wattle Street, Exampleton VIC 3999', 'stored label has no number');
  // the Notion and GitHub traffic of a draft is read only
  for (const c of w.calls.filter((c) => /notion|github/.test(c.url))) assert.ok(c.method === 'GET' || /\/query/.test(c.url), `${c.method} ${c.url}`);
  assert.ok(!w.calls.some((c) => /blob|vercel\.com/.test(c.url)));
});

test('the CRM occupancy discrepancy is flagged for verification and blocks publication, not saving', async () => {
  const { w, db } = await setup();
  const c = await create(w, db);
  const item = c.json.verification.system.find((i) => i.code === 'occupancy_not_full');
  assert.ok(item && item.status === 'open');
  assert.match(item.text, /2 of 3 places/);
  const s = await save(w, db, ALI, ID_7B, 1, GOOD);
  assert.equal(s.status, 200, 'an unfinished/unverified draft can be saved');
  assert.ok(s.json.validation.blockers.some((b) => b.code === 'verification'));
  assert.equal(s.json.validation.publishable, false);
});

test('wording that says fully leased contradicts the CRM and is an error', async () => {
  const { w, db } = await setup();
  await create(w, db);
  const s = await save(w, db, ALI, ID_7B, 1, { ...GOOD, description: 'A fully leased SDA house in Exampleton with three tenants and onsite overnight assistance.' });
  assert.equal(s.status, 200);
  assert.ok(s.json.validation.errors.some((e) => e.code === 'public_text_claims_full'));
  assert.equal(s.json.validation.complete, false);
});

test('Victorian compliance and missing photographs are publication blockers for this listing', async () => {
  const { w, db } = await setup();
  await create(w, db);
  const s = await save(w, db, ALI, ID_7B, 1, GOOD);
  const codes = s.json.validation.blockers.map((b) => b.code);
  assert.ok(codes.includes('victoria_compliance'), 'Rutherford determination does not cover Exampleton');
  assert.ok(codes.includes('photos_required'));
  assert.equal(s.json.validation.slug, 'wattle-street-exampleton-vic');
});

test('drafts persist after a browser refresh and keep who saved what', async () => {
  const { w, db } = await setup();
  await create(w, db);
  await save(w, db, ALI, ID_7B, 1, GOOD);
  const again = await open(w, db, PUBLISHER);
  assert.equal(again.json.draft.content.title, GOOD.title);
  assert.equal(again.json.draft.version, 2);
  assert.equal(again.json.draft.updatedBy, ALI.email);
  assert.deepEqual(again.json.history.map((h) => [h.action, h.by]), [['update', ALI.email], ['create', ALI.email]]);
  assert.deepEqual(again.json.history[0].fields.sort(), ['description', 'title', 'pricingMode'].sort());
});

test('Viewer can read but not create, save, verify or use the picker; Publisher-only cannot edit', async () => {
  const { w, db } = await setup();
  await create(w, db);
  assert.equal((await open(w, db, VIEWER)).status, 200);
  assert.equal((await create(w, db, VIEWER)).status, 403);
  assert.equal((await save(w, db, VIEWER, ID_7B, 1, GOOD)).status, 403);
  assert.equal((await call(propertiesRoute, w, db, VIEWER)).status, 403);
  assert.equal((await save(w, db, PUBLISHER, ID_7B, 1, GOOD)).status, 403, 'publish capability alone does not allow editing');
  assert.equal((await call(draftVerifyRoute, w, db, EDITOR, { method: 'POST', body: { id: ID_7B, expectedVersion: 1, code: 'occupancy_not_full', note: 'checked with provider' } })).status, 403, 'editors cannot verify');
  assert.equal((await call(draftRoute, w, db, VIEWER, { method: 'DELETE', body: { id: ID_7B, expectedVersion: 1 } })).status, 403);
  const stored = await db.unsafe('select version from listings.drafts');
  assert.equal(stored[0].version, 1, 'nothing changed');
});

test('unauthorised callers reach neither Notion nor the database', async () => {
  const { w, db } = await setup();
  const before = w.calls.length;
  let r = await (async () => { w.state.user = null; const { res, req } = await import('./helpers.js'); const rs = res(); await draftRoute({ authConfig: (await import('./helpers.js')).authConfig(), fetch: w.fetch, db })({ method: 'GET', headers: {}, url: '/api/listings/draft?id=' + ID_7B }, rs); return rs; })();
  assert.equal(r.statusCode, 401);
  const stranger = { email: 'stranger@sdahomechoices.com.au', capabilities: ['listings.view'], active: true, authUserId: null };
  const { authConfig } = await import('./helpers.js');
  w.state.user = (await import('./drafts-harness.js')).userFor(stranger);
  const rs2 = (await import('./helpers.js')).res();
  await draftRoute({ authConfig: authConfig([ALI]), fetch: w.fetch, db })({ method: 'GET', headers: { authorization: 'Bearer ' + 'a'.repeat(40) }, url: '/api/listings/draft?id=' + ID_7B }, rs2);
  assert.equal(rs2.statusCode, 403);
  assert.equal(w.calls.slice(before).filter((c) => /notion|github/.test(c.url)).length, 0);
  assert.equal((await db.unsafe('select count(*)::int c from listings.drafts'))[0].c, 0);
});

test('private data never leaves: no CRM money or income values in any draft or dashboard response', async () => {
  const { w, db } = await setup();
  const outputs = [];
  outputs.push((await create(w, db)).raw);
  outputs.push((await save(w, db, ALI, ID_7B, 1, GOOD)).raw);
  outputs.push((await open(w, db)).raw);
  outputs.push((await call(listRoute, w, db, VIEWER)).raw);
  outputs.push((await call(propertiesRoute, w, db, ALI)).raw);
  for (const o of outputs) for (const s of SECRETS) assert.ok(!o.includes(s), `leaked ${s}`);
  const dash = (await call(listRoute, w, db, VIEWER)).raw;
  assert.ok(!dash.includes('7B') && !dash.includes('7A'), 'dashboard never shows house numbers');
  assert.ok(!dash.includes('Address'), 'no address field');
});

test('house numbers, amounts and contradictions typed into public fields are rejected', async () => {
  const { w, db } = await setup();
  await create(w, db);
  const bad = async (content, expect) => { const r = await call(draftRoute, w, db, ALI, { method: 'PUT', body: { id: ID_7B, content: { ...GOOD, ...content }, dryRun: true } }); assert.equal(r.status, 200); expect(r.json.validation); };
  await bad({ publicAddress: '7B Wattle Street, Exampleton VIC 3999' }, (v) => assert.ok(v.fieldErrors.publicAddress));
  await bad({ publicAddress: 'Wattle Street, Exampleton NSW 3999' }, (v) => assert.match(v.fieldErrors.publicAddress.join(' '), /differs from the CRM state/));
  await bad({ description: 'The property is at 7B Wattle Street in Exampleton with three places.' }, (v) => assert.ok(v.errors.some((e) => e.code === 'private_address')));
  await bad({ description: 'Strong net income of $98,765 per year from three participant places in Exampleton.' }, (v) => assert.ok(v.errors.some((e) => e.code === 'private_financial')));
  await bad({ description: 'Contact the owner on 0412 345 678 about this Exampleton SDA house for more.' }, (v) => assert.ok(v.errors.some((e) => e.code === 'personal_data')));
  await bad({ title: 'abc' }, (v) => assert.ok(v.fieldErrors.title));
});

test('pricing: single amounts only, per mode, and the preview shows the exact public price line', async () => {
  const { w, db } = await setup();
  await create(w, db);
  const v = async (content) => (await call(draftRoute, w, db, ALI, { method: 'PUT', body: { id: ID_7B, content: { ...GOOD, ...content }, dryRun: true } })).json;
  assert.ok((await v({ pricingMode: 'asking_price', displayPrice: '' })).validation.fieldErrors.displayPrice);
  assert.match((await v({ pricingMode: 'asking_price', displayPrice: '$650,000 to $700,000' })).validation.fieldErrors.displayPrice[0], /not supported/);
  assert.match((await v({ pricingMode: 'price_guide', displayPrice: '650000 - 700000' })).validation.fieldErrors.displayPrice[0], /not supported/);
  assert.ok((await v({ pricingMode: 'contact_agent', displayPrice: '500000' })).validation.fieldErrors.displayPrice);
  const ok = await v({ pricingMode: 'asking_price', displayPrice: '695000' });
  assert.equal(ok.validation.fieldErrors.displayPrice, undefined);
  assert.equal(ok.preview.pricing, 'Asking Price $695,000 AUD');
  assert.equal(ok.preview.addressLine, 'Wattle Street, Exampleton VIC 3999');
  assert.deepEqual(ok.preview.design, ['Improved Liveability']);
});

test('dry run validates without saving', async () => {
  const { w, db } = await setup();
  await create(w, db);
  const r = await call(draftRoute, w, db, ALI, { method: 'PUT', body: { id: ID_7B, content: GOOD, dryRun: true } });
  assert.equal(r.json.draft.version, 1);
  assert.equal((await db.unsafe('select content from listings.drafts'))[0].content.title ?? '', '');
  assert.equal((await db.unsafe('select count(*)::int c from listings.draft_history'))[0].c, 1);
});

test('conflicting Notion change is detected (names the group, never values) and must be acknowledged', async () => {
  const { w, db } = await setup();
  await create(w, db);
  w.state.page7B = page7B({ 'Gross income': { type: 'number', number: 150000 } });
  resetCaches();
  const open1 = await open(w, db);
  assert.deepEqual(open1.json.notion.changed, ['commercial']);
  assert.ok(!open1.raw.includes('150000') && !open1.raw.includes('123456'));
  const blocked = await save(w, db, ALI, ID_7B, 1, GOOD);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json.error, 'notion_changed');
  assert.deepEqual(blocked.json.changed, ['commercial']);
  assert.equal((await db.unsafe('select version from listings.drafts'))[0].version, 1, 'blocked save wrote nothing');
  const ok = await save(w, db, ALI, ID_7B, 1, GOOD, { acknowledgeNotionChange: true });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json.notion.changed, []);
  assert.equal(ok.json.history[0].action, 'refresh_base');
  resetCaches();
  assert.equal((await save(w, db, ALI, ID_7B, 2, { ...GOOD, featured: true })).status, 200, 'no repeat conflict');
});

test('two people saving at once: the second is told, nothing is overwritten', async () => {
  const { w, db } = await setup();
  await create(w, db);
  assert.equal((await save(w, db, ALI, ID_7B, 1, { ...GOOD, title: 'Version from Ali one' })).status, 200);
  const second = await save(w, db, EDITOR, ID_7B, 1, { ...GOOD, title: 'Version from someone else' });
  assert.equal(second.status, 409);
  assert.equal(second.json.error, 'draft_changed');
  assert.equal((await db.unsafe('select content from listings.drafts'))[0].content.title, 'Version from Ali one');
});

test('cannot create a draft for a published property (Rutherford Grove) or a second draft for the same property', async () => {
  const { w, db } = await setup();
  const rg = await create(w, db, ALI, ID_RG);
  assert.equal(rg.status, 409); assert.equal(rg.json.error, 'already_published');
  await create(w, db);
  const dup = await create(w, db);
  assert.equal(dup.status, 409);
  assert.equal(dup.json.error, 'draft_exists');
  assert.equal((await create(w, db, ALI, 'lst_zzzz')).status, 400);
});

test('a Publisher acknowledges the occupancy discrepancy with a note; it reopens if the CRM fact changes', async () => {
  const { w, db } = await setup();
  await create(w, db);
  const v = await call(draftVerifyRoute, w, db, PUBLISHER, { method: 'POST', body: { id: ID_7B, expectedVersion: 1, code: 'occupancy_not_full', note: 'Confirmed with provider: third participant moves in next month' } });
  assert.equal(v.status, 200);
  const item = v.json.verification.system.find((i) => i.code === 'occupancy_not_full');
  assert.equal(item.status, 'verified'); assert.equal(item.verifiedBy, PUBLISHER.email);
  assert.equal(v.json.history[0].action, 'verify');
  assert.equal((await call(draftVerifyRoute, w, db, PUBLISHER, { method: 'POST', body: { id: ID_7B, expectedVersion: 2, code: 'occupancy_not_full', note: 'x' } })).status, 400, 'note required');
  // the CRM now says 1 of 3
  w.state.page7B = page7B({ Description: { type: 'rich_text', rich_text: [{ plain_text: 'Operating SDA property. 3 participant places; 1 occupied (1/3 physical occupancy)' }] } });
  resetCaches();
  const re = await open(w, db);
  assert.equal(re.json.verification.system.find((i) => i.code === 'occupancy_not_full').status, 'open', 'a changed fact reopens the item');
});

test('staff notes record commercial checks (such as an advertised income that differs) and block publication until resolved', async () => {
  const { w, db } = await setup();
  await create(w, db);
  await save(w, db, ALI, ID_7B, 1, GOOD);
  const n = await save(w, db, ALI, ID_7B, 2, GOOD, { addNote: 'The Realcommercial advertisement shows different income figures from the CRM. Verify before publishing.' });
  assert.equal(n.status, 200);
  assert.equal(n.json.verification.notes.length, 1);
  assert.equal(n.json.history[0].action, 'note');
  const id = n.json.verification.notes[0].id;
  assert.ok(n.json.validation.blockers.some((b) => b.code === 'verification_note'));
  const r = await call(draftVerifyRoute, w, db, PUBLISHER, { method: 'POST', body: { id: ID_7B, expectedVersion: n.json.draft.version, noteId: id, note: 'Income confirmed from the signed statements' } });
  assert.equal(r.json.verification.notes[0].status, 'resolved');
  assert.equal(r.json.verification.notes[0].resolvedBy, PUBLISHER.email);
});

test('the dashboard shows the draft without touching Rutherford Grove or the website columns', async () => {
  const { w, db } = await setup();
  await create(w, db);
  await save(w, db, ALI, ID_7B, 1, GOOD);
  const d = (await call(listRoute, w, db, VIEWER)).json;
  const rg = d.listings.find((l) => l.id === ID_RG);
  assert.equal(rg.deployment.state, 'live'); assert.equal(rg.website.version, 1); assert.equal(rg.draft, undefined);
  const sh = d.listings.find((l) => l.id === ID_7B);
  assert.equal(sh.draft.version, 2); assert.equal(sh.draft.updatedBy, ALI.email); assert.equal(sh.draft.fieldsFilled, 4);
  assert.equal(sh.deployment.state, 'not_published'); assert.equal(sh.website, null);
  assert.equal(d.sources.drafts.state, 'ok');
});

test('without a database the dashboard still works and the draft endpoints answer 503', async () => {
  resetCaches();
  const w = world(); w.state.user = (await import('./drafts-harness.js')).userFor(ALI);
  const { authConfig, res } = await import('./helpers.js');
  const cfg = { notion: { token: 't', dataSourceId: 'ds', version: 'v' }, repo: 'o/r', ref: 'main', siteBase: 'https://sdahomechoices.com.au', githubReadToken: null };
  const a = res(); await listRoute({ authConfig: authConfig([ALI]), fetch: w.fetch, dataConfig: cfg, env: {} })({ method: 'GET', headers: { authorization: 'Bearer ' + 'a'.repeat(40) } }, a);
  assert.equal(a.statusCode, 200); assert.equal(JSON.parse(a.body).sources.drafts.state, 'not_configured');
  const b = res(); await draftRoute({ authConfig: authConfig([ALI]), fetch: w.fetch, dataConfig: cfg })({ method: 'GET', headers: { authorization: 'Bearer ' + 'a'.repeat(40) }, url: '/api/listings/draft?id=' + ID_7B }, b);
  assert.equal(b.statusCode, 503); assert.equal(JSON.parse(b.body).error, 'drafts_not_configured');
});

test('discarding keeps the history and frees the property', async () => {
  const { w, db } = await setup();
  await create(w, db);
  assert.equal((await call(draftRoute, w, db, ALI, { method: 'DELETE', body: { id: ID_7B, expectedVersion: 1 } })).status, 200);
  assert.equal((await open(w, db)).status, 404);
  assert.equal((await db.unsafe("select count(*)::int c from listings.draft_history where action='discard'"))[0].c, 1);
  assert.equal((await create(w, db)).status, 200, 'a new draft can start again');
});

test('picker lists Notion properties, marks 7A and 7B apart, and never offers published ones as new', async () => {
  const { w, db } = await setup();
  const r = await call(propertiesRoute, w, db, ALI, { url: '/api/listings/properties?q=wattle' });
  assert.deepEqual(r.json.properties.map((p) => p.name), ['7A Wattle Street, Exampleton VIC 3999', '7B Wattle Street, Exampleton VIC 3999']);
  assert.equal(r.json.properties[0].id, ID_7A);
  const all = await call(propertiesRoute, w, db, ALI);
  assert.equal(all.json.properties.find((p) => p.id === ID_RG).onWebsite, true);
  assert.ok(!all.raw.includes(PAGE_7B_ID_RAW()), 'Notion page ids stay on the server');
});
const PAGE_7B_ID_RAW = () => '402909c1-bb60-8100-8000-0000000007b0';

test('Notion unreachable: the draft endpoint fails closed with a clear error and changes nothing', async () => {
  const { w, db } = await setup();
  await create(w, db);
  w.state.notionDown = true; resetCaches();
  const r = await open(w, db);
  assert.ok(r.status >= 500);
  assert.ok(!r.raw.includes('internal_server_error') || r.status === 500);
});
