// Validation and processing of ONE uploaded image for a draft gallery. Mirrors the website's
// scripts/prepare-listing-photos.mjs (same widths, WebP quality, <id>-<width>.webp names, brand-accent snapping, no metadata)
// so a staged photo can later be promoted to the public store unchanged.
// Original file names are never read: the browser sends bytes only.
//
// Speed: the image is decoded once per output size straight from the upload (libjpeg shrink-on-load for JPEG), the three
// sizes are produced in parallel, the id is the hash of the uploaded bytes (so a duplicate is detected BEFORE any pixel work),
// and the accent is sampled from the 480 px result instead of a separate decode.
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { HttpError } from './http.js';

export const MAX_BYTES = 4_000_000; // Vercel rejects request bodies over 4.5 MB; the browser shrinks larger photos first
export const MIN_WIDTH = 960;
export const MAX_SIDE = 12000;
export const MAX_PIXELS = 80_000_000;
export const WIDTHS = [480, 960, 1600];
const TYPES = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' };
// brand accents, copied from the website's src/styles/tokens.css (--blue, --teal, --amber, --slate)
const PALETTE = { blue: [4, 118, 217], teal: [47, 160, 168], amber: [201, 122, 10], slate: [60, 84, 104] };

/** File signature, not the file name or the declared type. */
export function sniff(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

export const snapToAccent = ({ r, g, b }) => {
  if (Math.max(r, g, b) - Math.min(r, g, b) < 28) return 'slate';
  let best = 'blue'; let bestD = Infinity;
  for (const [name, [pr, pg, pb]] of Object.entries(PALETTE)) { const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2; if (d < bestD) { bestD = d; best = name; } }
  return best;
};

/** Cheap checks only (signature, type, size, hash). Throws HttpError. Returns the content id used for duplicate detection. */
export function inspectUpload(buf, declaredType) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw new HttpError(400, 'empty_image');
  if (buf.length > MAX_BYTES) throw new HttpError(413, 'image_too_large');
  const kind = sniff(buf);
  if (!kind) throw new HttpError(415, 'unsupported_image_type');
  if (declaredType && TYPES[String(declaredType).toLowerCase()] !== kind) throw new HttpError(415, 'image_type_mismatch');
  return { kind, id: createHash('sha256').update(buf).digest('hex').slice(0, 12) };
}

/** @returns {{id, width, height, accent, variants:[{w,file,buffer}], ms:{inspect,variants,total}}}  Throws HttpError for anything not acceptable. */
export async function processImage(buf, declaredType, pre) {
  const t0 = performance.now();
  const { kind, id } = pre ?? inspectUpload(buf, declaredType);
  const opts = { limitInputPixels: MAX_PIXELS, failOn: 'error' };
  let meta;
  try { meta = await sharp(buf, opts).metadata(); } catch { throw new HttpError(422, 'unreadable_image'); }
  if (meta.format !== kind) throw new HttpError(415, 'image_type_mismatch');
  if ((meta.pages ?? 1) > 1) throw new HttpError(422, 'animated_image');
  const swap = (meta.orientation ?? 1) >= 5; // EXIF orientation 5-8 swaps width and height once rotated
  const width = swap ? meta.height : meta.width; const height = swap ? meta.width : meta.height;
  if (!width || !height) throw new HttpError(422, 'unreadable_image');
  if (width < MIN_WIDTH) throw new HttpError(422, 'image_too_small', { minWidth: MIN_WIDTH });
  if (width > MAX_SIDE || height > MAX_SIDE) throw new HttpError(422, 'image_too_large_dimensions');
  const t1 = performance.now();
  const widths = WIDTHS.filter((w) => w <= width || w === WIDTHS[0]);
  if (width > Math.max(...widths) && width < WIDTHS[WIDTHS.length - 1]) widths.push(width);
  widths.sort((a, b) => a - b);
  let variants;
  try {
    // rotate() applies the EXIF orientation; no withMetadata(), so EXIF, GPS, XMP and ICC are all dropped
    variants = await Promise.all(widths.map(async (w) => ({
      w, file: `${id}-${w}.webp`,
      buffer: await sharp(buf, opts).rotate().resize({ width: Math.min(w, width), withoutEnlargement: true }).webp({ quality: 78 }).toBuffer(),
    })));
  } catch { throw new HttpError(422, 'unreadable_image'); }
  const { dominant } = await sharp(variants[0].buffer).resize(128, 128, { fit: 'inside' }).stats();
  const t2 = performance.now();
  return { id, width, height, accent: snapToAccent(dominant), variants, ms: { inspect: Math.round(t1 - t0), variants: Math.round(t2 - t1), total: Math.round(t2 - t0) } };
}
