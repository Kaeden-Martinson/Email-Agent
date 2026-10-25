// Draws the Lodestar app icon (a white four-point star over a horizon line, on a blue rounded square)
// as a 256x256 PNG, with no image tools needed. Written to build/icon.png (electron-builder turns it
// into the installer's .ico) and src/assets/icon.png (window and tray icon, copied to dist/assets).
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const N = 256;
const RADIUS = 56; // corner radius of the rounded square
const BLUE = [0x2b, 0x59, 0xd9]; // light accent
const WHITE = [255, 255, 255];

// The mark lives on a 24-unit grid (same path as ICON_PATHS.lodestar) and spans 60% of the square.
const SCALE = (N * 0.6) / 24;
const OFFSET = (N - 24 * SCALE) / 2;
const P = (x, y) => [OFFSET + x * SCALE, OFFSET + y * SCALE];

// M12 2.5 c.6 4.3 2.2 5.9 6.5 6.5 -4.3.6 -5.9 2.2 -6.5 6.5 -.6-4.3 -2.2-5.9 -6.5-6.5 4.3-.6 5.9-2.2 6.5-6.5z
const STAR = [
  [[12, 2.5], [12.6, 6.8], [14.2, 8.4], [18.5, 9]],
  [[18.5, 9], [14.2, 9.6], [12.6, 11.2], [12, 15.5]],
  [[12, 15.5], [11.4, 11.2], [9.8, 9.6], [5.5, 9]],
  [[5.5, 9], [9.8, 8.4], [11.4, 6.8], [12, 2.5]],
];

/** Each cubic Bézier sampled into short straight segments. */
function sampleCubic([p0, p1, p2, p3], steps = 24) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    pts.push(P(a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]));
  }
  const segs = [];
  for (let i = 0; i < steps; i++) segs.push([...pts[i], ...pts[i + 1]]);
  return segs;
}
const starSegs = STAR.flatMap((c) => sampleCubic(c));
const horizonSegs = [[...P(4, 20), ...P(20, 20)]];

/** Distance from a point to a segment (round caps and joins come for free). */
function distToSeg(x, y, [x0, y0, x1, y1]) {
  const dx = x1 - x0, dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2)) : 0;
  return Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy));
}
/** Anti-aliased coverage of a stroke of the given width (in grid units) along these segments. */
function strokeCoverage(x, y, segs, widthUnits) {
  let d = Infinity;
  for (const s of segs) d = Math.min(d, distToSeg(x, y, s));
  return Math.min(1, Math.max(0, (widthUnits * SCALE) / 2 - d + 0.5));
}
/** Anti-aliased coverage of the full-size rounded square. */
function squareCoverage(x, y) {
  const h = N / 2;
  const qx = Math.abs(x - h) - (h - RADIUS);
  const qy = Math.abs(y - h) - (h - RADIUS);
  const sd = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - RADIUS;
  return Math.min(1, Math.max(0, 0.5 - sd));
}

const px = Buffer.alloc(N * N * 4);
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const cx = x + 0.5, cy = y + 0.5;
    const bg = squareCoverage(cx, cy);
    if (bg === 0) continue;
    const mark = Math.max(strokeCoverage(cx, cy, starSegs, 1.8), strokeCoverage(cx, cy, horizonSegs, 1.9));
    const i = (y * N + x) * 4;
    for (let k = 0; k < 3; k++) px[i + k] = Math.round(WHITE[k] * mark + BLUE[k] * (1 - mark));
    px[i + 3] = Math.round(bg * 255);
  }
}

// PNG encoding.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let k = n;
  for (let i = 0; i < 8; i++) k = k & 1 ? 0xedb88320 ^ (k >>> 1) : k >>> 1;
  return k >>> 0;
});
const crc = (buf) => {
  let x = 0xffffffff;
  for (const b of buf) x = crcTable[(x ^ b) & 0xff] ^ (x >>> 8);
  return (x ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const cr = Buffer.alloc(4);
  cr.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, cr]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0);
ihdr.writeUInt32BE(N, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const raw = Buffer.alloc((N * 4 + 1) * N);
for (let y = 0; y < N; y++) px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4);
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);
for (const dir of ['build', 'src/assets']) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/icon.png`, png);
  console.log(`${dir}/icon.png written`);
}
