// The browser's movement rules (listings.js), exercised exhaustively: whatever the arrows or drag-and-drop allow must keep the
// cover first and the floorplans last; everything else must be refused. The server enforces the same rules (photos.test.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync('listings.js', 'utf8');
const ctx = { window: { addEventListener() {}, __lsPhotoTimings: [] }, document: { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null }, console, URL, performance, setTimeout, clearTimeout };
vm.createContext(ctx);
vm.runInContext(`${code}\n;globalThis.__rules = { lsMoveAllowed, lsDropAllowed, lsApplyMove, lsApplyDrop, lsGroup };`, ctx);
const R = ctx.__rules;

/** every canonical gallery up to 5 images: photographs first, floorplans last, in every combination */
function galleries() {
  const out = [];
  for (let n = 1; n <= 5; n += 1) for (let plans = 0; plans <= n; plans += 1) {
    out.push(Array.from({ length: n }, (_, i) => ({ id: 'p' + i, kind: i >= n - plans ? 'floorplan' : 'photo' })));
  }
  return out;
}
const plain = (g) => g.map((x) => ({ ...x }));
const ok = (g) => {
  const firstPlan = g.findIndex((x) => x.kind === 'floorplan');
  const floorsLast = firstPlan === -1 || g.slice(firstPlan).every((x) => x.kind === 'floorplan');
  return floorsLast;
};

test('arrow moves: every allowed move keeps the cover at index 0 and floorplans last; the cover has no movement at all', () => {
  let allowed = 0; let refused = 0;
  for (const g of galleries()) for (const it of g) for (const delta of [-1, 1]) {
    const can = R.lsMoveAllowed(g, it.id, delta);
    if (!can) { refused += 1; continue; }
    allowed += 1;
    const next = R.lsApplyMove(plain(g), it.id, delta);
    assert.ok(ok(next), `floorplans last after ${it.id} ${delta} in ${JSON.stringify(g)}`);
    if (g[0].kind === 'photo') assert.equal(next[0].id, g[0].id, `cover stays first: ${it.id} ${delta} in ${JSON.stringify(g)}`);
    assert.equal(next.length, g.length);
    assert.deepEqual(next.map((x) => x.id).sort(), g.map((x) => x.id).sort());
  }
  assert.ok(allowed > 20 && refused > 20, 'both outcomes are exercised');
  for (const g of galleries().filter((x) => x[0].kind === 'photo')) {
    assert.equal(R.lsMoveAllowed(g, g[0].id, 1), false, 'the cover cannot move down');
    if (g.length > 1 && g[1].kind === 'photo') assert.equal(R.lsMoveAllowed(g, g[1].id, -1), false, 'nothing goes above the cover');
  }
});

test('arrow moves never cross between photographs and floorplans, or leave the gallery', () => {
  for (const g of galleries()) for (const [i, it] of g.entries()) {
    assert.equal(R.lsMoveAllowed(g, it.id, -1) && i === 0, false, 'first item cannot move up');
    assert.equal(R.lsMoveAllowed(g, it.id, 1) && i === g.length - 1, false, 'last item cannot move down');
    if (g[i + 1] && g[i + 1].kind !== it.kind) assert.equal(R.lsMoveAllowed(g, it.id, 1), false, 'no crossing down');
    if (g[i - 1] && g[i - 1].kind !== it.kind) assert.equal(R.lsMoveAllowed(g, it.id, -1), false, 'no crossing up');
  }
});

test('drag and drop: every allowed drop keeps the invariants; invalid drops (onto the cover, from the cover, across groups) are refused', () => {
  let allowed = 0; let refused = 0;
  for (const g of galleries()) for (const a of g) for (const b of g) {
    const can = R.lsDropAllowed(g, a.id, b.id);
    const coverFirst = g[0].kind === 'photo';
    const mustRefuse = a.id === b.id || a.kind !== b.kind || (coverFirst && (a.id === g[0].id || b.id === g[0].id));
    if (mustRefuse) { assert.equal(can, false, `${a.id} onto ${b.id} in ${JSON.stringify(g)} must be refused`); refused += 1; continue; }
    assert.equal(can, true, `${a.id} onto ${b.id} in ${JSON.stringify(g)} is a valid drop`);
    allowed += 1;
    const next = R.lsApplyDrop(plain(g), a.id, b.id);
    assert.ok(ok(next));
    if (coverFirst) assert.equal(next[0].id, g[0].id, 'cover still first');
    assert.deepEqual(next.map((x) => x.id).sort(), g.map((x) => x.id).sort());
    // everything else keeps its relative order
    const others = (arr) => arr.filter((x) => x.id !== a.id).map((x) => x.id);
    assert.deepEqual(others(next), others(g));
  }
  assert.ok(allowed > 10 && refused > 50);
});

test('the UI hides or disables invalid controls: no move or drag handle on the cover, no "Make cover" on a floorplan', () => {
  const card = code.slice(code.indexOf('function photoCard'), code.indexOf('function photosSection'));
  assert.match(card, /canDrag = !ro && !cover && !busy/);
  assert.match(card, /cover \|\| plan \? null : lsEl\('button'[^]*Make cover/);
  assert.match(card, /cover \? null : lsEl\('button'[^]*Move earlier/);
  assert.match(card, /disabled: busy \|\| !lsMoveAllowed\(items, p\.id, -1\)/);
  assert.match(card, /disabled: ro \|\| busy \|\| cover, onchange/, 'the cover cannot be turned into a floorplan');
});

test('no per-photo privacy checkbox remains in the browser code', () => {
  assert.ok(!/privacyReviewed|Privacy reviewed|privacy review/i.test(code.replace(/[^\n]*Gallery[^\n]*/g, '')), 'no per-photo privacy review UI');
  assert.ok(!/function reviewBar|lsOpenReview|draft-gallery-review|Review gallery/.test(code), 'no gallery review UI remains');
});
