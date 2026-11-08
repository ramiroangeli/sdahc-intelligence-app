// Draft photo gallery: upload, processing (metadata stripped), authorisation, one-array ordering (cover first, floorplans last),
// the single gallery review, performance guards, and proof that drafts never touch the public website.
// Real SQL (PGlite) and the real auth path.
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { draftGalleryReviewRoute, draftPhotoRoute, draftPhotosRoute, draftRoute, listRoute } from '../api/_lib/routes.js';
import { altPrivacyIssues, canonical, photoReadiness } from '../api/_lib/photos.js';
import { processImage, sniff } from '../api/_lib/photo-process.js';
import { authConfig, req as baseReq, res as makeRes } from './helpers.js';
import { ALI, EDITOR, ID_7B, PUBLISHER, VIEWER, call, database, resetCaches, world } from './drafts-harness.js';

const jpeg = (w, h, rgb, { exif = false } = {}) => {
  let img = sharp({ create: { width: w, height: h, channels: 3, background: rgb } }).jpeg();
  if (exif) img = img.withExif({ IFD0: { Copyright: 'Owner Name 7B Wattle St', Software: 'Camera' }, IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '38/1 25/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '145/1 24/1 0/1' } });
  return img.toBuffer();
};
const png = (w, h, rgb) => sharp({ create: { width: w, height: h, channels: 3, background: rgb } }).png().toBuffer();
const col = (n) => ({ r: (n * 37) % 255, g: (n * 91) % 255, b: (n * 151) % 255 });

async function setup() {
  resetCaches();
  const w = world(); const db = await database();
  const c = await call(draftRoute, w, db, ALI, { method: 'POST', body: { propertyId: ID_7B } });
  return { w, db, v: c.json.draft.version };
}
const upload = (w, db, who, id, bytes, { type = 'image/jpeg', replace, kind } = {}) => call(draftPhotosRoute, w, db, who, {
  method: 'POST', body: bytes, headers: { 'x-image-type': type },
  url: `/api/listings/draft-photos?id=${id}${replace ? `&replace=${replace}` : ''}${kind ? `&kind=${kind}` : ''}`,
});
const gallery = (w, db, who, id, version, photos, coverId) => call(draftPhotosRoute, w, db, who, { method: 'PUT', body: { id, expectedVersion: version, photos, ...(coverId !== undefined ? { coverId } : {}) } });
const review = (w, db, who, id, ids, version) => call(draftGalleryReviewRoute, w, db, who, { method: 'POST', body: { id, ids, ...(version ? { expectedVersion: version } : {}) } });
const open = (w, db, who = ALI) => call(draftRoute, w, db, who, { url: `/api/listings/draft?id=${ID_7B}` });
const stored = async (db) => (await db.unsafe('select photos, photo_review from listings.drafts where public_id = $1', [ID_7B]))[0];
const ids = (r) => r.json.photos.items.map((p) => p.id);
const ALT = 'Front of the house with a ramp and a wide entry';
const alts = (items) => items.map((p) => ({ id: p.id, alt: ALT, kind: p.kind }));

async function fill(w, db, n, { plan = false } = {}) {
  let last;
  for (let i = 0; i < n; i += 1) { last = await upload(w, db, ALI, ID_7B, await jpeg(1600 + i * 10, 1000, col(i + 1))); assert.equal(last.status, 200, JSON.stringify(last.json)); }
  if (plan) { last = await upload(w, db, ALI, ID_7B, await jpeg(1700, 1100, col(99)), { kind: 'floorplan' }); assert.equal(last.status, 200); }
  return last;
}

test('an Editor uploads a photo: three WebP variants are staged privately, the draft version moves, history records it', async () => {
  const { w, db, v } = await setup();
  const r = await upload(w, db, ALI, ID_7B, await jpeg(2000, 1300, { r: 30, g: 120, b: 200 }));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.draft.version, v + 1);
  const [p] = r.json.photos.items;
  assert.match(p.id, /^[a-f0-9]{12}$/);
  assert.deepEqual(p.widths, [480, 960, 1600]);
  assert.equal(r.json.photos.coverId, p.id);
  assert.ok((await open(w, db)).json.history.some((h) => h.fields.includes('photos')));
  const keys = [...w.blob.mem.keys()];
  assert.equal(keys.length, 3);
  for (const k of keys) assert.match(k, new RegExp(`^listings-staging/${ID_7B}/${p.id}-(480|960|1600)\\.webp$`), 'opaque names only');
  assert.ok(!JSON.stringify(r.json).includes('listings-staging'), 'no storage path is ever sent to the browser');
  assert.ok(!('privacyReviewed' in p), 'there is no per-photo privacy flag any more');
});

test('EXIF and GPS are removed from every stored variant, and the original file name is never used', async () => {
  const { w, db } = await setup();
  const src = await jpeg(2000, 1300, { r: 200, g: 90, b: 20 }, { exif: true });
  assert.ok((await sharp(src).metadata()).exif, 'the test image really carries EXIF');
  assert.equal((await upload(w, db, ALI, ID_7B, src)).status, 200);
  for (const [k, buf] of w.blob.mem) {
    const m = await sharp(buf).metadata();
    assert.equal(m.format, 'webp', k);
    assert.ok(!m.exif && !m.xmp && !m.iptc && !m.icc, `${k} carries no metadata`);
    assert.ok(!buf.includes(Buffer.from('Owner Name')) && !buf.includes(Buffer.from('Wattle')), 'no EXIF text survives');
  }
});

test('an EXIF-rotated phone photo is stored upright: dimensions swap once, and the minimum width applies after rotation', async () => {
  const { w, db } = await setup();
  const mk = (W, H) => sharp({ create: { width: W, height: H, channels: 3, background: { r: 10, g: 80, b: 160 } } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const ok = await upload(w, db, ALI, ID_7B, await mk(2000, 1200));
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.photos.items[0].width, 1200); assert.equal(ok.json.photos.items[0].height, 2000);
  const v960 = [...w.blob.mem].find(([k]) => k.endsWith('-960.webp'))[1];
  const m = await sharp(v960).metadata();
  assert.equal(m.width, 960); assert.equal(m.height, 1600, 'stored portrait, not sideways');
  const tooNarrow = await upload(w, db, ALI, ID_7B, await mk(2000, 800));
  assert.equal(tooNarrow.status, 422, 'only 800 px wide once rotated');
});

test('file validation: signature, declared type, size, dimensions and corrupt files are refused and nothing is stored', async () => {
  const { w, db, v } = await setup();
  const good = await jpeg(1600, 1000, { r: 1, g: 2, b: 3 });
  const bad = [
    ['not an image', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/jpeg', 415],
    ['declared type does not match the signature', await png(1600, 1000, { r: 1, g: 2, b: 3 }), 'image/jpeg', 415],
    ['executable named as an image', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]), 'image/png', 415],
    ['too small', await jpeg(600, 400, { r: 1, g: 2, b: 3 }), 'image/jpeg', 422],
    ['over 4 MB', Buffer.concat([good.subarray(0, 4), Buffer.alloc(4_100_000)]), 'image/jpeg', 413],
    ['truncated file', good.subarray(0, 300), 'image/jpeg', 422],
  ];
  for (const [name, bytes, type, status] of bad) {
    const r = await upload(w, db, ALI, ID_7B, bytes, { type });
    assert.equal(r.status, status, `${name}: ${JSON.stringify(r.json)}`);
  }
  assert.equal(w.blob.mem.size, 0, 'no file is stored for a refused upload');
  assert.equal((await open(w, db)).json.draft.version, v, 'a refused upload does not move the draft');
  assert.equal(sniff(await png(1000, 1000, { r: 1, g: 1, b: 1 })), 'png');
});

test('a PNG and a WebP are accepted; the same image twice is a duplicate and costs no processing or storage', async () => {
  const { w, db } = await setup();
  const a = await upload(w, db, ALI, ID_7B, await png(1700, 1100, { r: 10, g: 200, b: 100 }), { type: 'image/png' });
  assert.equal(a.status, 200);
  const putsBefore = w.blob.mem.size; let puts = 0; const orig = w.blob.put; w.blob.put = async (...x) => { puts++; return orig(...x); };
  const dup = await upload(w, db, ALI, ID_7B, await png(1700, 1100, { r: 10, g: 200, b: 100 }), { type: 'image/png' });
  assert.equal(dup.status, 409); assert.equal(puts, 0); assert.equal(w.blob.mem.size, putsBefore);
  const b = await upload(w, db, ALI, ID_7B, await sharp({ create: { width: 1700, height: 1100, channels: 3, background: { r: 200, g: 10, b: 10 } } }).webp().toBuffer(), { type: 'image/webp' });
  assert.equal(b.status, 200);
  assert.equal(b.json.photos.items.length, 2);
});

test('AUTHORISATION: no token is 401; a viewer cannot upload, edit or review (403); only staff can read an image', async () => {
  const { w, db, v } = await setup();
  const up = await upload(w, db, ALI, ID_7B, await jpeg(1600, 1000, { r: 5, g: 5, b: 90 }));
  const photoId = up.json.photos.items[0].id;
  for (const [route, rq] of [[draftPhotoRoute, { method: 'GET', url: `/api/listings/draft-photo?id=${ID_7B}&photo=${photoId}&w=480` }], [draftPhotosRoute, { method: 'POST', url: `/api/listings/draft-photos?id=${ID_7B}`, body: Buffer.alloc(10) }], [draftPhotosRoute, { method: 'PUT', body: { id: ID_7B } }], [draftGalleryReviewRoute, { method: 'POST', body: { id: ID_7B, ids: [photoId] } }]]) {
    const r = makeRes();
    await route({ authConfig: authConfig([ALI]), fetch: w.fetch, db, blob: w.blob })({ ...baseReq(rq), headers: {}, ...rq }, r);
    assert.equal(r.statusCode, 401, `${rq.method} ${rq.url ?? ''}`);
    assert.ok(!Buffer.isBuffer(r.body), 'no image bytes without authentication');
  }
  const stored0 = w.blob.mem.size;
  assert.equal((await upload(w, db, VIEWER, ID_7B, await jpeg(1600, 1000, { r: 9, g: 9, b: 9 }))).status, 403);
  assert.equal((await gallery(w, db, VIEWER, ID_7B, v + 1, [])).status, 403);
  assert.equal((await review(w, db, VIEWER, ID_7B, [photoId])).status, 403);
  assert.equal((await review(w, db, EDITOR, ID_7B, [photoId])).status, 403, 'an Editor without the Publisher capability cannot review');
  assert.equal(w.blob.mem.size, stored0, 'a refused upload stores nothing');
  const read = await call(draftPhotoRoute, w, db, VIEWER, { url: `/api/listings/draft-photo?id=${ID_7B}&photo=${photoId}&w=480` });
  assert.equal(read.status, 200, 'a viewer may look at the staged image');
  assert.equal(read.headers['content-type'], 'image/webp');
  assert.match(read.headers['cache-control'], /no-store/);
  assert.equal((await sharp(read.raw).metadata()).width, 480);
  for (const bad of ['../../etc/passwd', 'ffffffffffff', `${photoId}/../x`]) assert.equal((await call(draftPhotoRoute, w, db, ALI, { url: `/api/listings/draft-photo?id=${ID_7B}&photo=${encodeURIComponent(bad)}&w=480` })).status, 404);
});

test('COVER RULE: index 0 is always the cover; new photographs go after it and before floorplans; floorplans are always last', async () => {
  const { w, db } = await setup();
  const r = await fill(w, db, 3, { plan: true });
  const [a, b, c, f] = ids(r);
  assert.deepEqual(r.json.photos.items.map((p) => p.kind), ['photo', 'photo', 'photo', 'floorplan']);
  assert.equal(r.json.photos.coverId, a);
  assert.deepEqual(r.json.photos.publicOrder, [a, b, c, f]);
  // a photograph uploaded AFTER the floorplan still lands before it
  const d = await upload(w, db, ALI, ID_7B, await jpeg(1650, 1000, col(50)));
  assert.deepEqual(d.json.photos.items.map((p) => p.kind), ['photo', 'photo', 'photo', 'photo', 'floorplan']);
  assert.equal(d.json.photos.items.at(-1).id, f);
  // nothing stored is a separate cover flag: the array order alone says it
  const row = await stored(db);
  assert.ok(row.photos.every((p) => !('cover' in p) && !('privacyReviewed' in p)), JSON.stringify(row.photos.map((p) => Object.keys(p))));
});

test('Make cover moves that photo to index 0, the others keep their relative order, and it persists after reload', async () => {
  const { w, db } = await setup();
  const r = await fill(w, db, 4, { plan: true });
  const [a, b, c, d, f] = ids(r);
  const items = (order) => order.map((id) => ({ id, alt: ALT, kind: id === f ? 'floorplan' : 'photo' }));
  const s = await gallery(w, db, ALI, ID_7B, r.json.draft.version, items([a, b, c, d, f]), c);
  assert.equal(s.status, 200, JSON.stringify(s.json));
  assert.deepEqual(s.json.photos.publicOrder, [c, a, b, d, f], 'new cover first; the rest keep their order; floorplan last');
  assert.equal(s.json.photos.coverId, c);
  const reload = await open(w, db);
  assert.deepEqual(ids(reload), [c, a, b, d, f]);
  assert.deepEqual(reload.json.photos.publicOrder, [c, a, b, d, f]);
  assert.equal(reload.json.photos.items.filter((p) => p.cover).length, 1);
  assert.deepEqual((await stored(db)).photos.map((p) => p.id), [c, a, b, d, f], 'the stored array IS the public order');
});

test('INVALID MOVES are refused by the server: the cover cannot be moved down, nothing goes above it, a floorplan cannot be the cover', async () => {
  const { w, db } = await setup();
  const r = await fill(w, db, 3, { plan: true });
  const [a, b, c, f] = ids(r); const v = r.json.draft.version;
  const items = (order) => order.map((id) => ({ id, alt: ALT, kind: id === f ? 'floorplan' : 'photo' }));
  assert.equal((await gallery(w, db, ALI, ID_7B, v, items([b, a, c, f]))).json.error, 'cover_must_stay_first', 'cover moved down');
  assert.equal((await gallery(w, db, ALI, ID_7B, v, items([c, a, b, f]))).json.error, 'cover_must_stay_first', 'another photo moved above the cover');
  assert.equal((await gallery(w, db, ALI, ID_7B, v, items([a, b, c, f]), f)).json.error, 'cover_is_floorplan');
  assert.equal((await gallery(w, db, ALI, ID_7B, v, items([a, b, c, f]), 'aaaaaaaaaaaa')).status, 400);
  assert.equal((await gallery(w, db, ALI, ID_7B, v, [{ id: 'aaaaaaaaaaaa' }])).status, 400);
  assert.equal((await gallery(w, db, ALI, ID_7B, v - 1, items([a, b, c, f]))).status, 409, 'a stale version is refused');
  // a floorplan placed first or in the middle is pulled to the end, never an error and never the cover
  const ok = await gallery(w, db, ALI, ID_7B, v, items([a, f, b, c]));
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json.photos.publicOrder, [a, b, c, f]);
  // reordering the NON-cover photographs is allowed
  const re = await gallery(w, db, ALI, ID_7B, ok.json.draft.version, items([a, c, b, f]));
  assert.deepEqual(re.json.photos.publicOrder, [a, c, b, f]);
  // removing the cover promotes the next photograph; marking the cover a floorplan does too
  const rm = await gallery(w, db, ALI, ID_7B, re.json.draft.version, items([c, b, f]));
  assert.equal(rm.status, 200); assert.equal(rm.json.photos.coverId, c);
  const asPlan = await gallery(w, db, ALI, ID_7B, rm.json.draft.version, [{ id: c, alt: ALT, kind: 'floorplan' }, { id: b, alt: ALT, kind: 'photo' }, { id: f, alt: ALT, kind: 'floorplan' }]);
  assert.equal(asPlan.status, 200); assert.deepEqual(asPlan.json.photos.publicOrder, [b, c, f]); assert.equal(asPlan.json.photos.coverId, b);
});

test('legacy data (cover flag, per-photo review fields) is shown in the same order the old preview used and cleaned on the next save', async () => {
  const { w, db } = await setup();
  const r = await fill(w, db, 3);
  const [a, b, c] = ids(r);
  const raw = (await stored(db)).photos.map((p) => (p.id === c ? { ...p, cover: true, privacyReviewed: true, reviewedBy: 'x@y' } : { ...p, privacyReviewed: false }));
  await db.unsafe('update listings.drafts set photos = $1::text::jsonb where public_id = $2', [JSON.stringify(raw), ID_7B]);
  const v = await open(w, db);
  assert.deepEqual(v.json.photos.publicOrder, [c, a, b], 'legacy cover first');
  assert.ok(v.json.photos.items.every((p) => !('privacyReviewed' in p)));
  const s = await gallery(w, db, ALI, ID_7B, v.json.draft.version, v.json.photos.items.map((p) => ({ id: p.id, alt: ALT, kind: p.kind })));
  assert.equal(s.status, 200);
  assert.ok((await stored(db)).photos.every((p) => !('cover' in p) && !('privacyReviewed' in p) && !('reviewedBy' in p)));
  assert.deepEqual(canonical([{ id: 'x', kind: 'floorplan', files: [] }, { id: 'y', files: [] }]).map((p) => p.id), ['y', 'x']);
});

test('GALLERY REVIEW: one Publisher action records who and when; adding, replacing or removing an image invalidates it; reordering does not', async () => {
  const { w, db } = await setup();
  const r = await fill(w, db, 2, { plan: true });
  const all = ids(r);
  // alt text first (automated checks still apply)
  const withAlt = await gallery(w, db, ALI, ID_7B, r.json.draft.version, alts(r.json.photos.items));
  assert.equal(withAlt.json.photos.review.state, 'none');
  assert.ok((await open(w, db)).json.validation.blockers.some((b) => b.code === 'photo_review'), 'review pending is a publication blocker');
  // wrong set of ids is refused: the reviewer must have been shown every image
  assert.equal((await review(w, db, ALI, ID_7B, all.slice(1))).json.error, 'gallery_changed');
  assert.equal((await review(w, db, ALI, ID_7B, [...all, 'ffffffffffff'])).json.error, 'gallery_changed');
  const ok = await review(w, db, PUBLISHER, ID_7B, all);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.photos.review.reviewed, true);
  assert.equal(ok.json.photos.review.by, PUBLISHER.email); assert.ok(ok.json.photos.review.at); assert.equal(ok.json.photos.review.count, 3);
  assert.ok(!(await open(w, db)).json.validation.blockers.some((b) => b.code === 'photo_review'));
  const hist = (await open(w, db)).json.history; assert.ok(hist.some((h) => h.action === 'verify' && h.fields.includes('photoReview') && h.by === PUBLISHER.email));
  // reorder + alt edit do not invalidate (the same images were inspected)
  const [a, b, f] = all; const v1 = ok.json.draft.version;
  const re = await gallery(w, db, ALI, ID_7B, v1, [{ id: a, alt: 'A new description of the front', kind: 'photo' }, { id: b, alt: ALT, kind: 'photo' }, { id: f, alt: ALT, kind: 'floorplan' }]);
  assert.equal(re.json.photos.review.reviewed, true);
  // adding an image invalidates
  const add = await upload(w, db, ALI, ID_7B, await jpeg(1800, 1100, col(70)));
  assert.equal(add.json.photos.review.reviewed, false); assert.equal(add.json.photos.review.state, 'none');
  assert.equal((await stored(db)).photo_review, null);
  // review again, then replace
  const alt2 = await gallery(w, db, ALI, ID_7B, add.json.draft.version, alts(add.json.photos.items));
  const ok2 = await review(w, db, ALI, ID_7B, ids(alt2));
  assert.equal(ok2.json.photos.review.reviewed, true);
  const rep = await upload(w, db, ALI, ID_7B, await jpeg(1900, 1200, col(71)), { replace: a });
  assert.equal(rep.status, 200); assert.equal(rep.json.photos.review.reviewed, false);
  // review again, then remove
  const ok3 = await review(w, db, ALI, ID_7B, ids(rep));
  assert.equal(ok3.json.photos.review.reviewed, true);
  const rm = await gallery(w, db, ALI, ID_7B, ok3.json.draft.version, alts(ok3.json.photos.items).slice(1));
  assert.equal(rm.json.photos.review.reviewed, false);
});

test('the gallery review cannot be used to skip checks: needs a photograph, and alt text must pass the automated checks first', async () => {
  const { w, db } = await setup();
  assert.equal((await review(w, db, ALI, ID_7B, [])).json.error, 'no_photographs');
  const r = await fill(w, db, 1);
  assert.equal((await review(w, db, ALI, ID_7B, ids(r))).json.error, 'photos_not_ready', 'blank alt text');
  const leak = await gallery(w, db, ALI, ID_7B, r.json.draft.version, [{ id: ids(r)[0], alt: 'The house at 7B Wattle Street from the road', kind: 'photo' }]);
  assert.equal(leak.status, 200, 'saving is never blocked');
  assert.ok(leak.json.photos.items[0].issues.some((i) => i.code === 'alt_private'));
  assert.equal((await review(w, db, ALI, ID_7B, ids(leak))).json.error, 'photos_not_ready');
  const full = await open(w, db);
  assert.equal(full.json.validation.publishable, false);
  assert.ok(full.json.validation.blockers.some((b) => b.code === 'photo_alt' && /house or unit number/.test(b.message)));
});

test('alt text rules: file names, short text, a house number next to the street name, prices and contact details are flagged', () => {
  const r = photoReadiness([{ id: 'aaaaaaaaaaaa', alt: 'IMG_2231.jpg', files: [] }, { id: 'bbbbbbbbbbbb', alt: 'short', files: [] }], { street: 'Wattle Street' });
  assert.ok(r.items[0].issues.some((i) => i.code === 'alt_filename'));
  assert.ok(r.items[1].issues.some((i) => i.code === 'alt_missing'));
  assert.equal(r.ready, false);
  assert.equal(altPrivacyIssues('The house at 7B Wattle Street from the road', 'Wattle Street').length, 1);
  assert.equal(altPrivacyIssues('Wattle Street frontage with ramp', 'Wattle Street').length, 0);
  assert.equal(altPrivacyIssues('Call 0412 345 678 or a@b.com', 'Wattle Street').length, 1);
  assert.equal(altPrivacyIssues('Priced at $695,000 with a 7% yield', 'Wattle Street').length, 1);
});

test('replacing an image keeps its position and description, deletes the old files from staging, and invalidates the review', async () => {
  const { w, db } = await setup();
  const r = await fill(w, db, 2);
  const [a, b] = ids(r);
  const rep = await upload(w, db, ALI, ID_7B, await jpeg(1800, 1200, col(88)), { replace: b });
  assert.equal(rep.status, 200, JSON.stringify(rep.json));
  assert.equal(rep.json.photos.items.length, 2);
  assert.equal(rep.json.photos.items[0].id, a);
  assert.notEqual(rep.json.photos.items[1].id, b);
  assert.ok([...w.blob.mem.keys()].every((k) => !k.includes(b)), 'the replaced image files are removed from staging');
  assert.equal((await call(draftPhotoRoute, w, db, ALI, { url: `/api/listings/draft-photo?id=${ID_7B}&photo=${b}&w=480` })).status, 404);
});

test('PRIVATE PREVIEW CONSISTENCY: the preview order is the stored array order, and the light responses expose no storage path', async () => {
  const { w, db } = await setup();
  const r = await fill(w, db, 3, { plan: true });
  const [a, b, c, f] = ids(r);
  const s = await gallery(w, db, ALI, ID_7B, r.json.draft.version, [{ id: a, alt: ALT, kind: 'photo' }, { id: c, alt: ALT, kind: 'photo' }, { id: b, alt: ALT, kind: 'photo' }, { id: f, alt: ALT, kind: 'floorplan' }]);
  const full = await open(w, db);
  const dbOrder = (await stored(db)).photos.map((p) => p.id);
  assert.deepEqual(full.json.photos.publicOrder, dbOrder);
  assert.deepEqual(ids(full), dbOrder);
  assert.deepEqual(s.json.photos.publicOrder, dbOrder);
  assert.equal(full.json.photos.coverId, dbOrder[0]);
  assert.equal(full.json.photos.items.at(-1).kind, 'floorplan');
  for (const body of [r.raw, s.raw, JSON.stringify(full.json)]) assert.ok(!String(body).includes('listings-staging'));
});

test('PERFORMANCE: a photo change makes no Notion or GitHub call, and the three variants are stored in parallel', async () => {
  const { w, db } = await setup();
  w.calls.length = 0;
  let live = 0; let peak = 0; const orig = w.blob.put;
  w.blob.put = async (p, b) => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 40)); live--; return orig(p, b); };
  const up = await upload(w, db, ALI, ID_7B, await jpeg(2000, 1300, col(5)));
  assert.equal(up.status, 200);
  assert.equal(peak, 3, 'variants are written concurrently');
  const g = await gallery(w, db, ALI, ID_7B, up.json.draft.version, alts(up.json.photos.items));
  await review(w, db, ALI, ID_7B, ids(g));
  assert.deepEqual(w.calls.filter((c) => !c.url.includes('/auth/v1/user')), [], 'photo changes never call Notion, GitHub or the website');
  assert.ok(up.json.timings && up.json.timings.total >= 0 && 'process' in up.json.timings && 'store' in up.json.timings && 'persist' in up.json.timings, 'stage timings are returned');
});

test('PERFORMANCE: several uploads in parallel all succeed with no lost update', async () => {
  const { w, db } = await setup();
  const files = await Promise.all([1, 2, 3, 4].map((n) => jpeg(1600 + n * 10, 1000, col(n + 20))));
  const results = await Promise.all(files.map((f) => upload(w, db, ALI, ID_7B, f)));
  assert.deepEqual(results.map((r) => r.status), [200, 200, 200, 200], JSON.stringify(results.map((r) => r.json?.error)));
  const row = await stored(db);
  assert.equal(row.photos.length, 4, 'every parallel upload is in the gallery');
  assert.equal(new Set(row.photos.map((p) => p.id)).size, 4);
  assert.equal(w.blob.mem.size, 12);
});

test('PERFORMANCE: processing a typical photo stays within budget and produces the expected outputs', async () => {
  const noise = Buffer.alloc(2800 * 1870 * 3); for (let i = 0; i < noise.length; i += 1) noise[i] = (i * 2654435761 >>> 24) ^ (((i / 9000) | 0) & 255);
  const big = await sharp(noise, { raw: { width: 2800, height: 1870, channels: 3 } }).jpeg({ quality: 70 }).toBuffer();
  assert.ok(big.length < 4_000_000, 'test image fits the upload limit');
  const t = performance.now();
  const out = await processImage(big, 'image/jpeg');
  const ms = performance.now() - t;
  assert.ok(ms < 4000, `processing took ${Math.round(ms)} ms (budget 4000 ms on any CI machine; about 150 ms locally)`);
  assert.deepEqual(out.variants.map((v) => v.w), [480, 960, 1600]);
  assert.equal(out.width, 2800); assert.equal(out.height, 1870);
  assert.match(out.id, /^[a-f0-9]{12}$/);
  assert.ok(['blue', 'teal', 'amber', 'slate'].includes(out.accent));
  assert.ok(out.ms.variants >= 0 && out.ms.total >= out.ms.variants);
});

test('DRAFT PHOTOS NEVER TOUCH THE PUBLIC WEBSITE: no GitHub or Notion writes, no public store, published listing unchanged', async () => {
  const { w, db } = await setup();
  w.calls.length = 0;
  const up = await upload(w, db, ALI, ID_7B, await jpeg(1600, 1000, { r: 40, g: 140, b: 40 }));
  const g = await gallery(w, db, ALI, ID_7B, up.json.draft.version, alts(up.json.photos.items));
  await review(w, db, ALI, ID_7B, ids(g));
  await call(draftPhotoRoute, w, db, ALI, { url: `/api/listings/draft-photo?id=${ID_7B}&photo=${ids(g)[0]}&w=480` });
  await open(w, db);
  assert.ok(w.calls.every((c) => c.method === 'GET'), 'only reads: ' + JSON.stringify(w.calls.filter((c) => c.method !== 'GET')));
  assert.ok([...w.blob.mem.keys()].every((k) => k.startsWith('listings-staging/')), 'only the private staging prefix is written');
  const list = await call(listRoute, w, db, ALI, { url: '/api/listings' });
  const rg = list.json.listings.find((l) => l.website);
  assert.ok(rg && rg.website.version >= 1, 'published listing still listed unchanged');
});
