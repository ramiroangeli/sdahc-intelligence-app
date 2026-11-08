// Measures the server image pipeline: the pipeline on `main` (before) against the current one (after), on photographs of the
// size the browser actually sends (it shrinks to 2800 px). CPU stages only; network and storage are measured separately.
//   node scripts/bench-photo-pipeline.mjs [runs] [baseline-ref, default main]
// The baseline is read from git (not kept in the repo) into a temporary folder next to a copy of http.js.
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as NEW from '../api/_lib/photo-process.js';

const ref = process.argv[3] || 'main';
// inside node_modules (git-ignored) so the old file can resolve `sharp`
const tmp = mkdtempSync(join(new URL('../node_modules/', import.meta.url).pathname, '.bench-old-'));
writeFileSync(join(tmp, 'photo-process.mjs'), execFileSync('git', ['show', `${ref}:api/_lib/photo-process.js`]));
copyFileSync(new URL('../api/_lib/http.js', import.meta.url), join(tmp, 'http.js'));
const OLD = await import(pathToFileURL(join(tmp, 'photo-process.mjs')).href);

const runs = Number(process.argv[2] || 7);
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

/** A photograph-like image: smooth gradients, texture and mild noise, so the JPEG size is realistic. */
async function sample(w, h, quality, exifOrientation) {
  const base = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 120, g: 150, b: 180 } } })
    .composite([{ input: await sharp({ create: { width: w, height: h, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 14 } } }).blur(0.4).png().toBuffer(), blend: 'overlay' }])
    .jpeg({ quality, mozjpeg: false }).withMetadata(exifOrientation ? { orientation: exifOrientation } : {}).toBuffer();
  return base;
}
const cases = [
  ['2800x2100 (browser-shrunk camera photo)', await sample(2800, 2100, 90)],
  ['2800x2100 rotated (EXIF orientation 6)', await sample(2100, 2800, 90, 6)],
  ['1600x1200 (small export)', await sample(1600, 1200, 85)],
];
console.log(`runs per case: ${runs}, sharp ${sharp.versions.sharp}, libvips ${sharp.versions.vips}, cpus ${(await import('node:os')).cpus().length}\n`);
console.log('case'.padEnd(44), 'bytes'.padStart(8), 'before ms'.padStart(10), 'after ms'.padStart(9), 'speed-up'.padStart(9));
for (const [name, buf] of cases) {
  const before = []; const after = []; const afterDup = [];
  for (let i = 0; i < runs + 1; i += 1) {
    let t = performance.now(); const o = await OLD.processImage(buf, 'image/jpeg'); const tb = performance.now() - t;
    t = performance.now(); const pre = NEW.inspectUpload(buf, 'image/jpeg'); const n = await NEW.processImage(buf, 'image/jpeg', pre); const ta = performance.now() - t;
    if (i === 0) continue; // warm-up
    before.push(tb); after.push(ta);
    if (o.variants.length !== n.variants.length || o.width !== n.width || o.height !== n.height) throw new Error('outputs differ in shape');
  }
  const dupT = []; for (let i = 0; i < 20; i += 1) { const t = performance.now(); NEW.inspectUpload(buf, 'image/jpeg'); dupT.push(performance.now() - t); }
  console.log(name.padEnd(44), String(buf.length).padStart(8), med(before).toFixed(0).padStart(10), med(after).toFixed(0).padStart(9), (med(before) / med(after)).toFixed(2).padStart(8) + 'x', `  (duplicate detected in ${med(dupT).toFixed(1)} ms, no pixel work)`);
}
