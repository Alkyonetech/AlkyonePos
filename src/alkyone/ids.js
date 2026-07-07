/**
 * ULID uretimi — bagimsiz (Crockford Base32).
 *
 * Spec Bolum 3: PK = TEXT, ULID; autoincrement INTEGER KULLANMA (cloud sync'te
 * iki restoranin ID'leri cakisir). ULID sozluksel siralanabilir + zaman-sirali.
 */
const crypto = require('crypto');

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford Base32 (I,L,O,U yok)
const TIME_LEN = 10;
const RAND_LEN = 16;

let lastTime = 0;
let lastRand = null;

function encodeTime(now, len) {
  let out = '';
  for (let i = len - 1; i >= 0; i--) {
    const mod = now % 32;
    out = ENCODING[mod] + out;
    now = (now - mod) / 32;
  }
  return out;
}

function randomChars(len) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ENCODING[bytes[i] & 0x1f];
  return out;
}

function ulid(now = Date.now()) {
  // Ayni milisaniyede monotonik artis — sozluksel sira korunur.
  if (now === lastTime && lastRand) {
    lastRand = incrementRand(lastRand);
    return encodeTime(now, TIME_LEN) + lastRand;
  }
  lastTime = now;
  lastRand = randomChars(RAND_LEN);
  return encodeTime(now, TIME_LEN) + lastRand;
}

function incrementRand(str) {
  const arr = str.split('');
  for (let i = arr.length - 1; i >= 0; i--) {
    const idx = ENCODING.indexOf(arr[i]);
    if (idx < 31) { arr[i] = ENCODING[idx + 1]; return arr.join(''); }
    arr[i] = ENCODING[0];
  }
  return randomChars(RAND_LEN); // tasma — yeni rastgele
}

module.exports = { ulid };
