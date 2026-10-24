// Draws the app icon (a blue disc with a white envelope) as a 256x256 PNG, with no image tools needed.
// electron-builder converts it to .ico for the Windows installer.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const N = 256;
const px = Buffer.alloc(N * N * 4);
const c = (N - 1) / 2;
const r = N / 2 - 6;

function set(x, y, [R, G, B], a) {
  const i = (y * N + x) * 4;
  const base = px[i + 3] / 255;
  const out = a + base * (1 - a);
  if (out === 0) return;
  px[i] = Math.round((R * a + px[i] * base * (1 - a)) / out);
  px[i + 1] = Math.round((G * a + px[i + 1] * base * (1 - a)) / out);
  px[i + 2] = Math.round((B * a + px[i + 2] * base * (1 - a)) / out);
  px[i + 3] = Math.round(out * 255);
}

// Disc.
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) set(x, y, [37, 99, 235], Math.min(1, Math.max(0, r - Math.hypot(x - c, y - c) + 0.5)));

// Envelope: a white rounded rectangle with a darker "V" flap.
const ex0 = 64, ex1 = 192, ey0 = 84, ey1 = 172;
for (let y = ey0; y <= ey1; y++) for (let x = ex0; x <= ex1; x++) set(x, y, [255, 255, 255], 1);
const line = (x0, y0, x1, y1, w) => {
  for (let y = ey0; y <= ey1; y++) {
    for (let x = ex0; x <= ex1; x++) {
      const t = Math.max(0, Math.min(1, ((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / ((x1 - x0) ** 2 + (y1 - y0) ** 2)));
      const d = Math.hypot(x - (x0 + t * (x1 - x0)), y - (y0 + t * (y1 - y0)));
      set(x, y, [37, 99, 235], Math.min(1, Math.max(0, w - d + 0.5)));
    }
  }
};
line(ex0 + 4, ey0 + 4, c, 136, 5);
line(ex1 - 4, ey0 + 4, c, 136, 5);

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
mkdirSync('build', { recursive: true });
writeFileSync('build/icon.png', png);
console.log('build/icon.png written');
