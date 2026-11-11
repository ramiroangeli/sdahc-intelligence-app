// Final UX polish: copy, buttons and the list's property line. No publishing, status, withdrawal or data behaviour is touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pickSnapshot } from '../api/_lib/site.js';
import { combine } from '../api/_lib/listings-service.js';

const code = readFileSync(new URL('../listings.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../listings.css', import.meta.url), 'utf8');
const raw = (over = {}) => ({ listingId: 'lst_a', version: 2, commercialStatus: 'available', content: { slug: 'sheppard-street-shepparton-vic', title: 'Sheppard Street, Shepparton VIC 3630', description: ['x'], address: { street: 'Sheppard Street', suburb: 'Shepparton', state: 'VIC', postcode: '3630' }, sda: { designCategories: ['IL'], buildingType: 'House' }, pricing: { mode: 'contact_agent' }, photos: [], ...over } });

test('LIST: state, design category and build type come from the CRM, and from the approved listing when the CRM record is not matched', () => {
  const snap = pickSnapshot(raw());
  assert.equal(snap.state, 'VIC'); assert.deepEqual(snap.designCategories, ['IL']); assert.equal(snap.buildType, 'House');
  const noCrm = combine({ notion: null, snapshot: snap, withdrawn: false, live: { state: 'live', httpStatus: 200, checkedAt: 'x' }, url: 'u' });
  assert.equal(noCrm.state, 'VIC'); assert.deepEqual(noCrm.designCategories, ['IL']); assert.equal(noCrm.buildType, 'House');
  const crm = { id: 'lst_a', name: 'N', state: 'NSW', designCategories: ['HPS'], buildType: 'Villa', webStatus: { key: 'published', label: 'Published' }, archived: false, editedAt: 'e' };
  const withCrm = combine({ notion: crm, snapshot: snap, withdrawn: false, live: { state: 'live', httpStatus: 200, checkedAt: 'x' }, url: 'u' });
  assert.equal(withCrm.state, 'NSW', 'the CRM wins when it has a value'); assert.deepEqual(withCrm.designCategories, ['HPS']); assert.equal(withCrm.buildType, 'Villa');
});

test('LIST: nothing is invented when the approved listing has no such fields', () => {
  const snap = pickSnapshot(raw({ sda: {} }));
  const row = combine({ notion: null, snapshot: snap, withdrawn: false, live: null, url: 'u' });
  assert.deepEqual(row.designCategories, []); assert.equal(row.buildType, null);
});

test('COPY: the approved wording, exactly', () => {
  assert.match(code, /description: 'Text published\. Separate paragraphs with a blank line\.'/);
  assert.match(code, /text: 'The first photograph is the cover; floorplans are always last\.' \}/);
  assert.ok(!/Private: only signed-in staff/.test(code));
  assert.ok(!/is changed above, not here/.test(code));
  assert.match(code, /\/ once the website has checked it\.' \}\)\);/);
  assert.ok(!/shown as Live here only after that/.test(code));
  assert.match(code, /\/opportunities\/' \+ \(v\.slug \|\| '\.\.\.'\)/, 'the address in the publish sentence stays dynamic');
  assert.match(code, /text: 'Image description \(accessibility\)'/);
  assert.match(code, /Helps screen readers and search engines understand the photograph\./);
});

test('BUTTONS: Back to Listings is a light-blue button with an arrow; View the live page is one dark button used everywhere', () => {
  assert.match(code, /const back = \(text, hash\) => lsEl\('a', \{ class: 'ls-back-btn'/);
  assert.match(code, /const liveButton = /);
  assert.equal((code.match(/text: 'View the live page'/g) || []).length, 0, 'no plain "View the live page" links remain');
  assert.equal((code.match(/liveButton\(/g) || []).length, 2, 'defined once, used on Manage and on the Publish step');
  assert.match(css, /\.ls-live-btn \{[^}]*background: var\(--navy\)[^}]*color: #fff/);
  assert.match(css, /\.ls-manage-head \{[^}]*justify-content: space-between/);
  assert.match(css, /@media \(max-width: 560px\) \{ \.ls-live-btn \{ width: 100%/);
  assert.match(code, /target: '_blank', rel: 'noopener noreferrer' \}, 'View the live page'/);
});

test('HEADINGS: one system, existing tokens, no new font', () => {
  assert.match(code, /class: 'panel-title ls-page-title', text: 'Listings'/);
  assert.match(css, /\.ls-page-title \{[^}]*font-family: var\(--font-body\)[^}]*font-weight: 700/);
  assert.ok(!/fonts\.googleapis|@import|@font-face/.test(css), 'no new font dependency');
});

test('SAFETY CONTROLS: the withdrawal safeguards are untouched', () => {
  assert.match(code, /lsWithdrawReady/); assert.match(code, /Yes, withdraw this listing/); assert.match(code, /Permanently takes the listing out of public marketing/);
});
