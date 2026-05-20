/**
 * PNG -> ICO sarmalayici (saf JS, native modul yok).
 * Electron-builder Windows ikonu (.ico) icin gerekli.
 *
 * Kullanim: node electron/make-ico.js
 * Cikti:   electron/icon.ico
 *
 * NOT: Gercek tasarim icon yapildiginda bu script silinir, .ico el ile konur.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PNG_PATH = path.join(__dirname, 'icon.png');
const ICO_PATH = path.join(__dirname, 'icon.ico');

// Mevcut icon.png 32x32 placeholder. Electron-builder NSIS 256x256+ ister.
// 256x256 duz Sakura pembesi RGBA PNG synthesize ediyoruz.
function makeSolidPng(size, r, g, b, a = 255) {
  // CRC tablo
  const crcTab = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (const b of buf) c = (crcTab[(c ^ b) & 0xFF] ^ (c >>> 8)) >>> 0;
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.writeUInt8(8, 8);    // bit depth
  ihdr.writeUInt8(6, 9);    // color type: RGBA
  ihdr.writeUInt8(0, 10);   // compression
  ihdr.writeUInt8(0, 11);   // filter
  ihdr.writeUInt8(0, 12);   // interlace

  // IDAT — her satir 1 filter byte (0=None) + size*4 RGBA
  const row = Buffer.alloc(1 + size * 4);
  row[0] = 0; // filter None
  for (let i = 0; i < size; i++) {
    row[1 + i * 4] = r;
    row[2 + i * 4] = g;
    row[3 + i * 4] = b;
    row[4 + i * 4] = a;
  }
  const raw = Buffer.alloc(size * row.length);
  for (let y = 0; y < size; y++) row.copy(raw, y * row.length);
  const idatData = zlib.deflateSync(raw);

  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const SIZE = 256;
// Sakura pembesi: #e8b4b8
const png = makeSolidPng(SIZE, 0xe8, 0xb4, 0xb8);
fs.writeFileSync(PNG_PATH, png);
console.log(`PNG synthesize edildi: ${SIZE}x${SIZE}, ${png.length} bayt`);
const width = SIZE, height = SIZE;

// ICO format (PNG-embedded, Vista+):
//   ICONDIR (6 bayt) + ICONDIRENTRY (16 bayt) + PNG data
const ICONDIR = Buffer.alloc(6);
ICONDIR.writeUInt16LE(0, 0);     // reserved
ICONDIR.writeUInt16LE(1, 2);     // type: 1 = icon
ICONDIR.writeUInt16LE(1, 4);     // count: 1 image

const ICONDIRENTRY = Buffer.alloc(16);
// 0=256 boyutu icin 0 yazilir
ICONDIRENTRY.writeUInt8(width >= 256 ? 0 : width, 0);
ICONDIRENTRY.writeUInt8(height >= 256 ? 0 : height, 1);
ICONDIRENTRY.writeUInt8(0, 2);       // color count (0 = >=256)
ICONDIRENTRY.writeUInt8(0, 3);       // reserved
ICONDIRENTRY.writeUInt16LE(1, 4);    // planes
ICONDIRENTRY.writeUInt16LE(32, 6);   // bpp
ICONDIRENTRY.writeUInt32LE(png.length, 8);   // size
ICONDIRENTRY.writeUInt32LE(22, 12);          // offset (6 + 16)

const ico = Buffer.concat([ICONDIR, ICONDIRENTRY, png]);
fs.writeFileSync(ICO_PATH, ico);
console.log(`ICO yazildi: ${ICO_PATH} (${ico.length} bayt)`);
