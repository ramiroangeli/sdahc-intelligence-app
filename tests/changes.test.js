// "Changes since live": the real difference between the saved draft and the version on the website. Values are compared, never edit events.
import test from 'node:test';
import assert from 'node:assert/strict';
import { changesSincePublished } from '../api/_lib/changes.js';
import { pickSnapshot } from '../api/_lib/site.js';

const PUB = {
  title: 'Established Improved Liveability SDA Investment',
  description: ['First paragraph about the house.', 'Second paragraph about the place.'],
  address: 'Rutherford Grove, Armstrong Creek VIC 3217', pricingMode: 'asking_price', displayPrice: '$695,000', featured: false,
  photos: [{ id: 'aaaaaaaaaaaa', alt: 'Front of the house', kind: 'photo' }, { id: 'bbbbbbbbbbbb', alt: 'Kitchen', kind: 'photo' }, { id: 'cccccccccccc', alt: 'Floorplan', kind: 'floorplan' }],
};
const draft = (over = {}, photos = PUB.photos) => ({
  content: { title: PUB.title, description: 'First paragraph about the house.\n\nSecond paragraph about the place.', publicAddress: PUB.address, pricingMode: 'asking_price', displayPrice: '695000', featured: false, ...over },
  photos: photos.map((p) => ({ ...p })),
});
const fields = (d, p = PUB) => changesSincePublished(d, p).items.map((i) => i.field);

test('CHANGES: a draft identical to the website has no changes (whitespace, blank-line and formatting differences are not changes)', () => {
  assert.deepEqual(changesSincePublished(draft(), PUB), { count: 0, items: [] });
  assert.equal(changesSincePublished(draft({ description: '  First   paragraph about the house.\n\n\n  Second paragraph about the place.  ', publicAddress: ' Rutherford Grove,  Armstrong Creek VIC 3217 ', displayPrice: '$695,000' }), PUB).count, 0);
});

test('CHANGES: each public field is reported by name, and only when its VALUE differs', () => {
  assert.deepEqual(fields(draft({ title: PUB.title + ' now' })), ['title']);
  assert.deepEqual(fields(draft({ description: 'Only one paragraph now.' })), ['description']);
  assert.deepEqual(fields(draft({ publicAddress: 'Other Street, Armstrong Creek VIC 3217' })), ['address']);
  assert.deepEqual(fields(draft({ displayPrice: '700000' })), ['price']);
  assert.deepEqual(fields(draft({ pricingMode: 'contact_agent' })), ['price']);
  assert.deepEqual(fields(draft({ featured: true })), ['featured']);
});

test('CHANGES REFINEMENT: a field changed and then restored to its published value is NOT a change', () => {
  const edited = draft({ title: 'Something else', description: 'x', displayPrice: '1' });
  assert.equal(changesSincePublished(edited, PUB).count, 3);
  const restored = draft({ title: 'Something else' }); restored.content.title = PUB.title;
  assert.equal(changesSincePublished(restored, PUB).count, 0, 'restoring the published value leaves nothing to publish');
});

test('CHANGES: a blank title means "use the default", so it is not a difference; a price in a mode that shows none is not a difference', () => {
  assert.equal(changesSincePublished(draft({ title: '' }), PUB).count, 0);
  const guide = { ...PUB, pricingMode: 'contact_agent', displayPrice: null };
  assert.equal(changesSincePublished(draft({ pricingMode: 'contact_agent', displayPrice: '999999' }), guide).count, 0);
});

test('CHANGES: photographs are compared by what visitors would see: added, removed, order, written descriptions and floorplan', () => {
  const [a, b, c] = PUB.photos;
  const plus = { id: 'dddddddddddd', alt: '', kind: 'photo' };
  assert.deepEqual(changesSincePublished(draft({}, [a, b, plus, c]), PUB).items, [{ field: 'photos', label: 'Photos', detail: '1 added' }]);
  assert.equal(changesSincePublished(draft({}, [a, c]), PUB).items[0].detail, '1 removed');
  assert.equal(changesSincePublished(draft({}, [b, a, c]), PUB).items[0].detail, 'order changed', 'a new cover is a new order');
  assert.equal(changesSincePublished(draft({}, [a, { ...b, alt: 'A different description' }, c]), PUB).items[0].detail, '1 description changed');
  assert.equal(changesSincePublished(draft({}, [a, { ...b, alt: '' }, c]), PUB).count, 0, 'a blank description means the neutral text: not a change');
  assert.equal(changesSincePublished(draft({}, [a, { ...b, kind: 'floorplan' }, c]), PUB).items[0].detail.includes('floorplan'), true);
  assert.equal(changesSincePublished(draft({}, [c, a, b]), PUB).count, 0, 'floorplans are always last: the stored order is normalised the way publication does it');
  assert.equal(changesSincePublished(draft({}, [b, a, plus, c]), PUB).items[0].detail, '1 added, order changed');
});

test('CHANGES: the website summary is read from the approved snapshot (public fields only) and ignores malformed parts', () => {
  const snap = pickSnapshot({
    listingId: 'lst_454f05d21f', version: 2, commercialStatus: 'available', featured: true,
    content: { slug: 'rutherford-grove-armstrong-creek-vic', title: 'T', description: ['One', 5, 'Two'], address: { street: 'Rutherford Grove', suburb: 'Armstrong Creek', state: 'VIC', postcode: '3217' },
      pricing: { mode: 'asking_price', display: '$695,000' }, photos: [{ id: 'aaaaaaaaaaaa', alt: 'Front', variants: [] }, { nope: true }, { id: 'bbbbbbbbbbbb', kind: 'floorplan' }] },
  });
  assert.deepEqual(snap.public, { title: 'T', description: ['One', 'Two'], pricingMode: 'asking_price', displayPrice: '$695,000', featured: true, photos: [{ id: 'aaaaaaaaaaaa', alt: 'Front', kind: 'photo' }, { id: 'bbbbbbbbbbbb', alt: '', kind: 'floorplan' }] });
  assert.equal(snap.address, 'Rutherford Grove, Armstrong Creek VIC 3217');
});
