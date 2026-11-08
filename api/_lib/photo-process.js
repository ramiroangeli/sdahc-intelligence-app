// Validation and processing of ONE uploaded image for a draft gallery. Mirrors the website's
// scripts/prepare-listing-photos.mjs (same widths, WebP quality, content-hash id, <id>-<width>.webp names, brand-accent
// snapping, no metadata) so a staged photo can later be promoted to the public store unchanged.
// Original file names are never read: the browser sends bytes only.
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

/** @returns {{id, width, height, accent, variants:[{w,file,buffer}]}}  Throws HttpError for anything not acceptable. */
export async function processImage(buf, declaredType) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw new HttpError(400, 'empty_image');
  if (buf.length > MAX_BYTES) throw new HttpError(413, 'image_too_large');
  const kind = sniff(buf);
  if (!kind) throw new HttpError(415, 'unsupported_image_type');
  if (declaredType && TYPES[String(declaredType).toLowerCase()] !== kind) throw new HttpError(415, 'image_type_mismatch');
  const opts = { limitInputPixels: MAX_PIXELS, failOn: 'error' };
  let meta;
  try { meta = await sharp(buf, opts).metadata(); } catch { throw new HttpError(422, 'unreadable_image'); }
  if (meta.format !== kind) throw new HttpError(415, 'image_type_mismatch');
  if ((meta.pages ?? 1) > 1) throw new HttpError(422, 'animated_image');
  let data; let info;
  try {
    // rotate() applies the EXIF orientation; no withMetadata(), so EXIF, GPS, XMP and ICC are all dropped
    ({ data, info } = await sharp(buf, opts).rotate().toBuffer({ resolveWithObject: true }));
  } catch { throw new HttpError(422, 'unreadable_image'); }
  if (info.width < MIN_WIDTH) throw new HttpError(422, 'image_too_small', { minWidth: MIN_WIDTH });
  if (info.width > MAX_SIDE || info.height > MAX_SIDE) throw new HttpError(422, 'image_too_large_dimensions');
  const id = createHash('sha256').update(data).digest('hex').slice(0, 12);
  const { dominant } = await sharp(data).resize(128, 128, { fit: 'inside' }).stats();
  const widths = WIDTHS.filter((w) => w <= info.width || w === WIDTHS[0]);
  if (info.width > Math.max(...widths) && info.width < WIDTHS[WIDTHS.length - 1]) widths.push(info.width);
  widths.sort((a, b) => a - b);
  const variants = [];
  for (const w of widths) {
    const buffer = await sharp(data).resize({ width: Math.min(w, info.width), withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
    variants.push({ w, file: `${id}-${w}.webp`, buffer });
  }
  return { id, width: info.width, height: info.height, accent: snapToAccent(dominant), variants };
}
