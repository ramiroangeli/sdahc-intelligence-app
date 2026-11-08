// Draft photo gallery: upload, processing (metadata stripped), authorisation, persistence of order and cover, floorplan,
// privacy review reset, and proof that drafts never touch the public website. Real SQL (PGlite) and the real auth path.
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { draftPhotoRoute, draftPhotosRoute, draftRoute } from '../api/_lib/routes.js';
import { effectiveOrder, photoReadiness } from '../api/_lib/photos.js';
import { sniff } from '../api/_lib/photo-process.js';
import { authConfig, req as baseReq, res as makeRes } from './helpers.js';
import { ALI, database, ID_7B, VIEWER, call, resetCaches, world } from './drafts-harness.js';

const jpeg = (w, h, rgb, { exif = false } = {}) => {
  let img = sharp({ create: { width: w, height: h, channels: 3, background: rgb } }).jpeg();
  if (exif) img = img.withExif({ IFD0: { Copyright: 'Owner Name 27B Sheppard St', Software: 'Camera' }, IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '38/1 25/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '145/1 24/1 0/1' } });
  return img.toBuffer();
};
const png = (w, h, rgb) => sharp({ create: { width: w, height: h, channels: 3, background: rgb } }).png().toBuffer();

async function setup() {
  resetCaches();
  const w = world(); const db = await database();
  const c = await call(draftRoute, w, db, ALI, { method: 'POST', body: { propertyId: ID_7B } });
  return { w, db, v: c.json.draft.version };
}
const upload = (w, db, who, id, version, bytes, { type = 'image/jpeg', replace, kind } = {}) => call(draftPhotosRoute, w, db, who, {
  method: 'POST', body: bytes, headers: { 'x-image-type': type },
  url: `/api/listings/draft-photos?id=${id}&expectedVersion=${version}${replace ? `&replace=${replace}` : ''}${kind ? `&kind=${kind}` : ''}`,
});
const gallery = (w, db, who, id, version, photos, coverId) => call(draftPhotosRoute, w, db, who, { method: 'PUT', body: { id, expectedVersion: version, photos, ...(coverId !== undefined ? { coverId } : {}) } });
const open = (w, db, who = ALI) => call(draftRoute, w, db, who, { url: `/api/listings/draft?id=${ID_7B}` });
const ALT = 'Front of the house with a ramp and a wide entry';

test('an Editor uploads a photo: three WebP variants are staged privately, the draft version moves, history records it', async () => {
  const { w, db, v } = await setup();
  const r = await upload(w, db, ALI, ID_7B, v, await jpeg(2000, 1300, { r: 30, g: 120, b: 200 }));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.draft.version, v + 1);
  const [p] = r.json.photos.items;
  assert.match(p.id, /^[a-f0-9]{12}$/);
  assert.deepEqual(p.widths, [480, 960, 1600]);
  assert.equal(p.privacyReviewed, false);
  assert.equal(r.json.photos.coverId, p.id);
  assert.ok(r.json.history.some((h) => h.fields.includes('photos')));
  const keys = [...w.blob.mem.keys()];
  assert.equal(keys.length, 3);
  for (const k of keys) assert.match(k, new RegExp(`^listings-staging/${ID_7B}/${p.id}-(480|960|1600)\\.webp$`), 'opaque names only');
  assert.ok(!JSON.stringify(r.json).includes('listings-staging'), 'no storage path is ever sent to the browser');
});

test('EXIF and GPS are removed from every stored variant, and the original file name is never used', async () => {
  const { w, db, v } = await setup();
  const src = await jpeg(2000, 1300, { r: 200, g: 90, b: 20 }, { exif: true });
  assert.ok((await sharp(src).metadata()).exif, 'the test image really carries EXIF');
  const r = await upload(w, db, ALI, ID_7B, v, src);
  assert.equal(r.status, 200);
  for (const [k, buf] of w.blob.mem) {
    const m = await sharp(buf).metadata();
    assert.equal(m.format, 'webp', k);
    assert.ok(!m.exif && !m.xmp && !m.iptc && !m.icc, `${k} carries no metadata`);
    assert.ok(!buf.includes(Buffer.from('Owner Name')) && !buf.includes(Buffer.from('Sheppard')), 'no EXIF text survives');
  }
});

test('file validation: signature, declared type, size, dimensions, animated and corrupt files are refused and nothing is stored', async () => {
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
    const r = await upload(w, db, ALI, ID_7B, v, bytes, { type });
    assert.equal(r.status, status, `${name}: ${JSON.stringify(r.json)}`);
  }
  assert.equal(w.blob.mem.size, 0, 'no file is stored for a refused upload');
  assert.equal((await open(w, db)).json.draft.version, v, 'a refused upload does not move the draft');
  assert.equal(sniff(await png(1000, 1000, { r: 1, g: 1, b: 1 })), 'png');
  assert.equal(sniff(await sharp({ create: { width: 1000, height: 1000, channels: 3, background: { r: 1, g: 1, b: 1 } } }).webp().toBuffer()), 'webp');
});

test('a PNG and a WebP are accepted; the same image twice is a duplicate', async () => {
  const { w, db, v } = await setup();
  const a = await upload(w, db, ALI, ID_7B, v, await png(1700, 1100, { r: 10, g: 200, b: 100 }), { type: 'image/png' });
  assert.equal(a.status, 200);
  const dup = await upload(w, db, ALI, ID_7B, a.json.draft.version, await png(1700, 1100, { r: 10, g: 200, b: 100 }), { type: 'image/png' });
  assert.equal(dup.status, 409);
  const b = await upload(w, db, ALI, ID_7B, a.json.draft.version, await sharp({ create: { width: 1700, height: 1100, channels: 3, background: { r: 200, g: 10, b: 10 } } }).webp().toBuffer(), { type: 'image/webp' });
  assert.equal(b.status, 200);
  assert.equal(b.json.photos.items.length, 2);
});

test('AUTHORISATION: no token is 401; a viewer cannot upload or edit (403); only staff can read an image', async () => {
  const { w, db, v } = await setup();
  const up = await upload(w, db, ALI, ID_7B, v, await jpeg(1600, 1000, { r: 5, g: 5, b: 90 }));
  const photoId = up.json.photos.items[0].id;
  // no Authorization header at all, through the real auth path
  for (const [route, rq] of [[draftPhotoRoute, { method: 'GET', url: `/api/listings/draft-photo?id=${ID_7B}&photo=${photoId}&w=480` }], [draftPhotosRoute, { method: 'POST', url: `/api/listings/draft-photos?id=${ID_7B}&expectedVersion=1`, body: Buffer.alloc(10) }], [draftPhotosRoute, { method: 'PUT', body: { id: ID_7B } }]]) {
    const r = makeRes();
    await route({ authConfig: authConfig([ALI]), fetch: w.fetch, db, blob: w.blob })({ ...baseReq(rq), headers: {}, ...rq }, r);
    assert.equal(r.statusCode, 401, JSON.stringify(rq.method));
    assert.ok(!Buffer.isBuffer(r.body), 'no image bytes without authentication');
  }
  const stored = w.blob.mem.size;
  assert.equal((await upload(w, db, VIEWER, ID_7B, v + 1, await jpeg(1600, 1000, { r: 9, g: 9, b: 9 }))).status, 403);
  assert.equal((await gallery(w, db, VIEWER, ID_7B, v + 1, [])).status, 403);
  assert.equal(w.blob.mem.size, stored, 'a refused upload stores nothing');
  const read = await call(draftPhotoRoute, w, db, VIEWER, { url: `/api/listings/draft-photo?id=${ID_7B}&photo=${photoId}&w=480` });
  assert.equal(read.status, 200, 'a viewer may look at the staged image');
  assert.equal(read.headers['content-type'], 'image/webp');
  assert.match(read.headers['cache-control'], /no-store/);
  assert.equal((await sharp(read.raw).metadata()).width, 480);
  // the client cannot choose a storage path: an unknown photo id, or a path-like id, is a plain 404
  for (const bad of ['../../etc/passwd', 'ffffffffffff', `${photoId}/../x`]) assert.equal((await call(draftPhotoRoute, w, db, ALI, { url: `/api/listings/draft-photo?id=${ID_7B}&photo=${encodeURIComponent(bad)}&w=480` })).status, 404);
});

test('reorder, cover and floorplan persist after reload; the public order puts the cover first and floorplans last', async () => {
  const { w, db, v } = await setup();
  let ver = v; const ids = [];
  for (const [i, c] of [{ r: 200, g: 20, b: 20 }, { r: 20, g: 200, b: 20 }, { r: 20, g: 20, b: 200 }, { r: 200, g: 200, b: 20 }].entries()) {
    const r = await upload(w, db, ALI, ID_7B, ver, await jpeg(1600 + i * 10, 1000, c));
    assert.equal(r.status, 200); ver = r.json.draft.version; ids.push(r.json.photos.items[i].id);
  }
  const [a, b, c, d] = ids;
  // floorplan = a (first uploaded), order c, a, d, b, cover = d
  const items = [c, a, d, b].map((id) => ({ id, alt: ALT, kind: id === a ? 'floorplan' : 'photo', privacyReviewed: true }));
  const s = await gallery(w, db, ALI, ID_7B, ver, items, d);
  assert.equal(s.status, 200, JSON.stringify(s.json));
  assert.deepEqual(s.json.photos.publicOrder, [d, c, b, a], 'cover, then photographs in order, floorplan last');
  assert.equal(s.json.photos.coverId, d);
  const reload = await open(w, db);
  assert.deepEqual(reload.json.photos.items.map((p) => p.id), [c, a, d, b], 'order persisted');
  assert.deepEqual(reload.json.photos.publicOrder, [d, c, b, a]);
  assert.equal(reload.json.photos.items.find((p) => p.id === a).kind, 'floorplan');
  assert.equal(reload.json.photos.items.find((p) => p.id === d).cover, true);
  assert.equal(reload.json.photos.items.find((p) => p.id === c).alt, ALT);
  // a floorplan cannot be the cover, and unknown ids are refused
  assert.equal((await gallery(w, db, ALI, ID_7B, reload.json.draft.version, items, a)).status, 400);
  assert.equal((await gallery(w, db, ALI, ID_7B, reload.json.draft.version, [{ id: 'aaaaaaaaaaaa' }])).status, 400);
  // a stale version is refused
  assert.equal((await gallery(w, db, ALI, ID_7B, ver, items, d)).status, 409);
});

test('privacy review is recorded with who and when, and resets when an image is replaced', async () => {
  const { w, db, v } = await setup();
  const up = await upload(w, db, ALI, ID_7B, v, await jpeg(1600, 1000, { r: 80, g: 80, b: 80 }));
  const id = up.json.photos.items[0].id;
  assert.equal(up.json.photos.items[0].issues.some((i) => i.code === 'privacy_unreviewed'), true);
  const rev = await gallery(w, db, ALI, ID_7B, up.json.draft.version, [{ id, alt: ALT, privacyReviewed: true }]);
  const p = rev.json.photos.items[0];
  assert.equal(p.privacyReviewed, true); assert.equal(p.reviewedBy, ALI.email); assert.ok(p.reviewedAt);
  assert.equal(p.issues.length, 0);
  assert.equal(rev.json.photos.readiness.ready, true);
  // replace it with a different image: new id, review reset, alt kept for editing, old files deleted
  const rep = await upload(w, db, ALI, ID_7B, rev.json.draft.version, await jpeg(1800, 1200, { r: 150, g: 40, b: 90 }), { replace: id });
  assert.equal(rep.status, 200, JSON.stringify(rep.json));
  const np = rep.json.photos.items[0];
  assert.notEqual(np.id, id);
  assert.equal(np.privacyReviewed, false); assert.equal(np.reviewedBy, null);
  assert.equal(np.alt, ALT);
  assert.equal(rep.json.photos.items.length, 1, 'replaced in place, not added');
  assert.ok([...w.blob.mem.keys()].every((k) => !k.includes(id)), 'the replaced image files are removed from staging');
  assert.equal(rep.json.photos.readiness.ready, false);
});

test('removing an image deletes it from the draft and from private staging; unreviewed photos block readiness', async () => {
  const { w, db, v } = await setup();
  const a = await upload(w, db, ALI, ID_7B, v, await jpeg(1600, 1000, { r: 1, g: 90, b: 90 }));
  const b = await upload(w, db, ALI, ID_7B, a.json.draft.version, await jpeg(1610, 1000, { r: 90, g: 1, b: 90 }));
  const [pa, pb] = b.json.photos.items;
  assert.equal(b.json.validation.publishable, false);
  assert.ok(b.json.validation.blockers.some((x) => x.code === 'photo_review'));
  const rm = await gallery(w, db, ALI, ID_7B, b.json.draft.version, [{ id: pb.id, alt: ALT, privacyReviewed: true }]);
  assert.equal(rm.json.photos.items.length, 1);
  assert.ok([...w.blob.mem.keys()].every((k) => !k.includes(pa.id)));
  assert.equal((await call(draftPhotoRoute, w, db, ALI, { url: `/api/listings/draft-photo?id=${ID_7B}&photo=${pa.id}&w=480` })).status, 404);
});

test('alt text rules: file names, short text and a house number next to the street name are flagged', async () => {
  const items = [{ id: 'aaaaaaaaaaaa', alt: 'IMG_2231.jpg', privacyReviewed: true }, { id: 'bbbbbbbbbbbb', alt: 'short', privacyReviewed: true }];
  const r = photoReadiness(items);
  assert.ok(r.items[0].issues.some((i) => i.code === 'alt_filename'));
  assert.ok(r.items[1].issues.some((i) => i.code === 'alt_missing'));
  assert.equal(r.ready, false);
  const { w, db, v } = await setup();
  const up = await upload(w, db, ALI, ID_7B, v, await jpeg(1600, 1000, { r: 60, g: 60, b: 160 }));
  const id = up.json.photos.items[0].id;
  const leak = await gallery(w, db, ALI, ID_7B, up.json.draft.version, [{ id, alt: 'The house at 7B Wattle Street from the road', privacyReviewed: true }]);
  assert.equal(leak.status, 200, 'saving is never blocked');
  const it = leak.json.photos.items[0];
  assert.ok(it.issues.some((i) => i.code === 'alt_private'), JSON.stringify(it.issues));
  assert.equal(leak.json.photos.readiness.ready, false);
  assert.ok(leak.json.validation.blockers.some((b) => b.code === 'photo_review' && /house or unit number/.test(b.message)));
  assert.equal(leak.json.validation.publishable, false);
});

test('effectiveOrder: cover first, floorplans last, defaults to the first photograph', () => {
  const P = (id, o = {}) => ({ id, ...o });
  assert.deepEqual(effectiveOrder([P('f', { kind: 'floorplan' }), P('a'), P('b')]).map((p) => p.id), ['a', 'b', 'f']);
  assert.deepEqual(effectiveOrder([P('a'), P('b', { cover: true }), P('f', { kind: 'floorplan' })]).map((p) => p.id), ['b', 'a', 'f']);
  assert.deepEqual(effectiveOrder([]), []);
});

test('DRAFT PHOTOS NEVER TOUCH THE PUBLIC WEBSITE: no GitHub or Notion writes, no public store, published listing unchanged', async () => {
  const { w, db, v } = await setup();
  w.calls.length = 0;
  const up = await upload(w, db, ALI, ID_7B, v, await jpeg(1600, 1000, { r: 40, g: 140, b: 40 }));
  await gallery(w, db, ALI, ID_7B, up.json.draft.version, [{ id: up.json.photos.items[0].id, alt: ALT, privacyReviewed: true }]);
  await call(draftPhotoRoute, w, db, ALI, { url: `/api/listings/draft-photo?id=${ID_7B}&photo=${up.json.photos.items[0].id}&w=480` });
  assert.ok(w.calls.every((c) => c.method === 'GET'), 'only reads: ' + JSON.stringify(w.calls.filter((c) => c.method !== 'GET')));
  assert.ok(w.calls.every((c) => !/blob\.vercel-storage|api\.github\.com\/repos\/.*\/(contents|git|pulls)/.test(c.url) || c.method === 'GET'));
  assert.ok([...w.blob.mem.keys()].every((k) => k.startsWith('listings-staging/')), 'only the private staging prefix is written');
  // the already published Rutherford Grove snapshot is still what the website data says
  const list = await call((await import('../api/_lib/routes.js')).listRoute, w, db, ALI, { url: '/api/listings' });
  const rg = list.json.listings.find((l) => l.website);
  assert.ok(rg && rg.website.version >= 1, 'published listing still listed unchanged');
});
