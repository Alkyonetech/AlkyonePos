// ===== ONLINE SIPARIS AYRISTIRICI =====
// Yemeksepeti / Trendyol / Getir Yemek gibi platformlarin YAZICIYA gonderdigi
// ham baski akisini (ESC/POS) okunabilir metne cevirir ve sezgisel olarak
// siparise (kaynak, urunler, tutar, musteri) ayristirir.
//
// Ayristirma platform fis formatina gore degiskendir; bu yuzden akis ONAY
// BAZLIDIR: ham metin her zaman saklanir, ayristirma yalnizca on-doldurma icin
// kullanilir. Personel masalar ekraninda gorur, onaylar veya reddeder.

// Turkce karakter byte tablolarinin TERSI (escpos.js ile ayni degerler).
// WPC1254 yuksek bayt araligi (0xC0-0xFF) ile CP857 araligi (0x80-0x9F) buyuk
// olcude cakismaz; ikisini birlestirerek kaynak kod sayfasini bilmeden cozeriz.
const REV = {
  // Windows-1254
  0xFD: 'ı', 0xDD: 'İ', 0xE7: 'ç', 0xC7: 'Ç', 0xF0: 'ğ', 0xD0: 'Ğ',
  0xFE: 'ş', 0xDE: 'Ş', 0xFC: 'ü', 0xDC: 'Ü', 0xF6: 'ö', 0xD6: 'Ö',
  // CP857 (DOS Turkce)
  0x8D: 'ı', 0x98: 'İ', 0x87: 'ç', 0x80: 'Ç', 0xA7: 'ğ', 0xA6: 'Ğ',
  0x9F: 'ş', 0x9E: 'Ş', 0x81: 'ü', 0x9A: 'Ü', 0x94: 'ö', 0x99: 'Ö',
};

// ESC (0x1B) komutlarinin parametre bayt sayisi (komut baytindan sonra atlanacak).
// Listede olmayan ESC komutu icin yalnizca komut bayti atlanir.
const ESC_PARAMS = {
  0x21: 1, // ESC ! n   (yazi tipi)
  0x61: 1, // ESC a n   (hizalama)
  0x74: 1, // ESC t n   (kod sayfasi)
  0x2D: 1, // ESC - n   (alt cizgi)
  0x45: 1, // ESC E n   (bold)
  0x47: 1, // ESC G n   (cift baski)
  0x64: 1, // ESC d n   (n satir besle)
  0x4A: 1, // ESC J n   (dikey besle)
  0x7B: 1, // ESC { n   (ust-alt cevir)
  0x72: 1, // ESC r n   (renk)
  0x4D: 1, // ESC M n   (font)
  0x20: 1, // ESC SP n  (karakter araligi)
  0x40: 0, // ESC @     (reset)
};

// GS (0x1D) komutlarinin parametre bayt sayisi.
const GS_PARAMS = {
  0x21: 1, // GS ! n    (karakter boyutu)
  0x42: 1, // GS B n    (ters video)
  0x56: 1, // GS V m    (kagit kes) — m>=65 ise 2. bayt da olabilir; birini atla
  0x72: 1, // GS r n
  0x68: 1, // GS h n    (barkod yuksekligi)
  0x77: 1, // GS w n    (barkod genisligi)
  0x48: 1, // GS H n
  0x66: 1, // GS f n
};

/**
 * Ham ESC/POS Buffer -> okunabilir duz metin.
 * Kontrol/escape dizileri temizlenir, satir sonlari korunur, Turkce yuksek
 * baytlar cozulur. Baski isi metin olmayan (barkod/logo) parcalar icerse
 * kucuk gurultu kalabilir — onay bazli oldugu icin kabul edilebilir.
 */
function escposToText(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf || []);
  let out = '';
  let i = 0;
  const n = buf.length;
  while (i < n) {
    const b = buf[i];
    if (b === 0x1B) { // ESC
      const cmd = buf[i + 1];
      const skip = ESC_PARAMS[cmd];
      i += 2 + (skip == null ? 0 : skip);
      continue;
    }
    if (b === 0x1D) { // GS
      const cmd = buf[i + 1];
      const skip = GS_PARAMS[cmd];
      i += 2 + (skip == null ? 0 : skip);
      continue;
    }
    if (b === 0x0A || b === 0x0D) { out += '\n'; i++; continue; }
    if (b === 0x09) { out += ' '; i++; continue; }
    if (b < 0x20) { i++; continue; }        // diger kontrol baytlari at
    if (b < 0x80) { out += String.fromCharCode(b); i++; continue; }
    out += REV[b] || Buffer.from([b]).toString('latin1'); // yuksek bayt
    i++;
  }
  // Coklu bos satirlari sadelestir
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Turkce para bicimi -> Number. "1.234,56" -> 1234.56 ; "45,00" -> 45 ; "45.00" -> 45
function parseTLNumber(s) {
  if (s == null) return 0;
  let t = String(s).replace(/[^\d.,]/g, '');
  if (t.includes(',')) {
    // virgul ondalik: binlik noktalarini kaldir, virgulu noktaya cevir
    t = t.replace(/\./g, '').replace(',', '.');
  } else if ((t.match(/\./g) || []).length > 1) {
    // birden fazla nokta -> binlik ayirici
    t = t.replace(/\./g, '');
  }
  const v = parseFloat(t);
  return isNaN(v) ? 0 : v;
}

const SOURCE_PATTERNS = [
  { key: 'yemeksepeti', re: /yemek\s*sepeti|yemeksepeti/i },
  { key: 'trendyol', re: /trendyol|ty\s*yemek/i },
  { key: 'getir', re: /getir/i },
];

function detectSource(text) {
  for (const s of SOURCE_PATTERNS) if (s.re.test(text)) return s.key;
  return '';
}

// Bir satirdan urun cikar: "2 x Adana Kebap ... 240,00" / "2  Lahmacun  90,00 TL"
const ITEM_RES = [
  /^\s*(\d{1,3})\s*[xX*]\s*(.+?)\s+([\d.,]+)\s*(?:TL|₺|TRY)?\s*$/,
  /^\s*(\d{1,3})\s+(.+?)\s{2,}([\d.,]+)\s*(?:TL|₺|TRY)?\s*$/,
  /^\s*(\d{1,3})\s+(.+?)\s+([\d.,]+)\s*(?:TL|₺|TRY)\s*$/,
];

// Urun satiri olarak degerlendirilmemesi gereken toplam/ozet satirlari
const SKIP_LINE = /(topla[mn]|tutar|ara\s*toplam|genel|kdv|vergi|indirim|ödenecek|odenecek|servis|paket|teslimat|iskonto)/i;

function parseItems(lines) {
  const items = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || SKIP_LINE.test(line)) continue;
    for (const re of ITEM_RES) {
      const m = line.match(re);
      if (m) {
        const qty = Math.max(1, parseInt(m[1], 10) || 1);
        const name = m[2].replace(/\.{2,}/g, ' ').replace(/\s{2,}/g, ' ').trim();
        const lineTotal = parseTLNumber(m[3]);
        if (name.length >= 2) {
          items.push({ qty, name, unitPrice: qty ? +(lineTotal / qty).toFixed(2) : lineTotal });
        }
        break;
      }
    }
  }
  return items;
}

function firstMatch(text, re) {
  const m = text.match(re);
  return m ? m[1].trim() : '';
}

/**
 * Ham metin -> yapisal siparis tahmini (on-doldurma icin).
 * @returns {{source, items, parsedTotal, customer, phone, address}}
 */
function parseOrderText(text) {
  const lines = String(text || '').split(/\n/);
  const source = detectSource(text);
  const items = parseItems(lines);

  const totalStr = firstMatch(text,
    /(?:genel\s*toplam|ödenecek\s*tutar|odenecek\s*tutar|toplam\s*tutar|toplam)\s*:?\s*([\d.,]+)\s*(?:TL|₺|TRY)?/i);
  const parsedTotal = parseTLNumber(totalStr);

  let phone = firstMatch(text, /(?:tel(?:efon)?|gsm)\s*:?\s*([\d ()+\-]{7,})/i);
  if (!phone) phone = firstMatch(text, /\b(0?5\d{2}[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2})\b/);
  phone = phone.replace(/[^\d+]/g, '');

  const address = firstMatch(text, /adres\s*:?\s*(.+)/i);
  const customer = firstMatch(text, /(?:m[üu][şs]teri|ad[ıi]\s*soyad[ıi]|isim|al[ıi]c[ıi]|name)\s*:?\s*(.+)/i);

  return { source, items, parsedTotal, customer, phone, address };
}

module.exports = { escposToText, parseOrderText, parseTLNumber, detectSource };
