/**
 * ESC/POS komut üretici (saf JS, native modül yok).
 * 58mm (32 char/satır) ve 80mm (48 char/satır) termal yazıcılar için.
 *
 * Çıktı: bir Buffer (ESC/POS protokolü).
 * Bu Buffer printer.js tarafından TCP socket veya raw file ile yazıcıya gönderilir.
 *
 * Kaynak: ESC/POS Programming Manual, Epson TM-T20II / XPrinter POS-80C.
 */

const ESC = 0x1B;
const GS = 0x1D;
const LF = 0x0A;

// Komutlar
const CMD = {
  INIT: Buffer.from([ESC, 0x40]),                          // Yazıcı sıfırla
  ALIGN_LEFT: Buffer.from([ESC, 0x61, 0]),
  ALIGN_CENTER: Buffer.from([ESC, 0x61, 1]),
  ALIGN_RIGHT: Buffer.from([ESC, 0x61, 2]),
  BOLD_ON: Buffer.from([ESC, 0x45, 1]),
  BOLD_OFF: Buffer.from([ESC, 0x45, 0]),
  // GS ! n — bit 0x10 = double width, bit 0x01 = double height
  SIZE_NORMAL: Buffer.from([GS, 0x21, 0x00]),
  SIZE_TALL: Buffer.from([GS, 0x21, 0x01]),                // sadece yükseklik 2x
  SIZE_WIDE: Buffer.from([GS, 0x21, 0x10]),                // sadece genişlik 2x
  SIZE_DOUBLE: Buffer.from([GS, 0x21, 0x11]),              // hem genişlik hem yükseklik 2x
  CUT_FULL: Buffer.from([GS, 0x56, 0x00]),
  CUT_PARTIAL: Buffer.from([GS, 0x56, 0x01]),
  FEED_3: Buffer.from([ESC, 0x64, 3]),
};

/**
 * Desteklenen kod sayfaları (POS-80C / XPrinter ESC/POS).
 * Çoğu Çin yapımı POS-80C yazıcı PC857'yi desteklemez ama WPC1254'ü destekler.
 * WPC1254 = Windows-1254 (Türkçe), kod indeksi 32.
 * PC857 = DOS Latin-5 (Türkçe), kod indeksi 13.
 */
// Windows-1254 (Turkce) byte tablosu — yazici kod sayfasi WPC1254'i destekledigi
// surece hangi 'code' indeksi (ESC t n) ile aktiflestirildigi onemli degildir.
// POS-80C / XPrinter firmware'leri n degerini farkli mapliyor; bu yuzden ayni
// karakter haritasini birkac farkli n ile test etmek lazim.
const WPC1254_MAP = {
  'ı': 0xFD, 'İ': 0xDD,
  'ç': 0xE7, 'Ç': 0xC7,
  'ğ': 0xF0, 'Ğ': 0xD0,
  'ş': 0xFE, 'Ş': 0xDE,
  'ü': 0xFC, 'Ü': 0xDC,
  'ö': 0xF6, 'Ö': 0xD6,
};
// Standart IBM CP857 (DOS Turkce, Latin-5) byte degerleri.
const PC857_MAP = {
  'ı': 0x8D, 'İ': 0x98,
  'ç': 0x87, 'Ç': 0x80,
  'ğ': 0xA7, 'Ğ': 0xA6,
  'ş': 0x9F, 'Ş': 0x9E,
  'ü': 0x81, 'Ü': 0x9A,
  'ö': 0x94, 'Ö': 0x99,
};

// Kod sayfasi adayi listesi — POS-80C / XPrinter firmware'lerinde Turkce
// karakterler icin denenecek (n, map) ciftleri. Kullanici codepage-test
// ciktisindan hangi satirin duzgun basildigini gorur, settings'te o adi secer.
const ENCODINGS = {
  // Windows-1254 (Turkce) — en olasi adaylar
  CP1254_18: { code: 18, map: WPC1254_MAP },  // XPrinter cogu modeli
  CP1254_32: { code: 32, map: WPC1254_MAP },  // Bazi POS-80C surumleri
  CP1254_33: { code: 33, map: WPC1254_MAP },  // Eski POS-80C firmware
  CP1254_44: { code: 44, map: WPC1254_MAP },  // Modern XPrinter
  WPC1254:   { code: 32, map: WPC1254_MAP },  // Geriye donuk uyumluluk
  // PC857 (DOS Turkce, Latin-5)
  PC857:     { code: 13, map: PC857_MAP },
  // Hicbir kod sayfasi calismayan eski yazicilar icin ASCII zorlamasi
  ASCII:     { code: 0,  map: {
    'ı': 0x69, 'İ': 0x49, 'ç': 0x63, 'Ç': 0x43,
    'ğ': 0x67, 'Ğ': 0x47, 'ş': 0x73, 'Ş': 0x53,
    'ü': 0x75, 'Ü': 0x55, 'ö': 0x6F, 'Ö': 0x4F,
  }},
};

function getEncoding(name) {
  return ENCODINGS[name] || ENCODINGS.CP1254_18;
}

function listEncodings() {
  return Object.keys(ENCODINGS);
}

class EscPos {
  constructor(width = 32, encodingName = 'CP1254_32') {
    this.width = width;
    this.encoding = getEncoding(encodingName);
    this.chunks = [
      CMD.INIT,
      Buffer.from([ESC, 0x74, this.encoding.code]),
    ];
  }

  raw(buf) { this.chunks.push(buf); return this; }

  text(s) {
    if (!s) return this;
    this.chunks.push(Buffer.from(toBytes(String(s), this.encoding.map), 'binary'));
    return this;
  }

  line(s = '') { return this.text(s).newline(); }
  newline() { this.chunks.push(Buffer.from([LF])); return this; }

  align(pos) {
    return this.raw(pos === 'center' ? CMD.ALIGN_CENTER :
                    pos === 'right'  ? CMD.ALIGN_RIGHT :
                                       CMD.ALIGN_LEFT);
  }
  bold(on)   { return this.raw(on ? CMD.BOLD_ON : CMD.BOLD_OFF); }
  double(on) { return this.raw(on ? CMD.SIZE_DOUBLE : CMD.SIZE_NORMAL); }
  tall(on)   { return this.raw(on ? CMD.SIZE_TALL   : CMD.SIZE_NORMAL); }
  wide(on)   { return this.raw(on ? CMD.SIZE_WIDE   : CMD.SIZE_NORMAL); }

  hr(ch = '-') {
    return this.line(ch.repeat(this.width));
  }

  // Sol-sağ iki sütun (ad ile fiyat)
  twoCol(left, right) {
    const l = String(left || '');
    const r = String(right || '');
    const pad = Math.max(1, this.width - l.length - r.length);
    return this.line(l + ' '.repeat(pad) + r);
  }

  feed(n = 3) { return this.raw(Buffer.from([ESC, 0x64, n])); }
  cut() { return this.raw(CMD.CUT_PARTIAL); }

  toBuffer() { return Buffer.concat(this.chunks); }
}

/**
 * UTF-8 string -> seçilen kod sayfasına göre byte mapping.
 * ASCII (<0x80) aynen geçer; eşleşmeyen karakter '?' olur.
 */
function toBytes(s, map) {
  let out = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c < 0x80) out += ch;
    else if (map[ch] !== undefined) out += String.fromCharCode(map[ch]);
    else out += '?';
  }
  return out;
}

// Geriye dönük uyumluluk
function toLatin5(s) { return toBytes(s, ENCODINGS.PC857.map); }

/**
 * Adisyon -> ESC/POS Buffer
 */
const DEFAULT_TEMPLATE = {
  headerLines: [],
  showRestaurantName: true,
  showAddress: true,
  showPhone: true,
  subHeaderText: '',
  showDateTime: true,
  showTableNo: true,
  showOrderId: true,
  showItemUnitPrice: true,
  showItemNotes: true,
  showSubtotal: true,
  showDiscount: true,
  showVat: false,
  showPaymentMethod: true,
  footerLines: ['Teşekkür ederiz!'],
  footerFeedLines: 3,
};

function resolveTemplate(settings) {
  return { ...DEFAULT_TEMPLATE, ...(settings?.receiptTemplate || {}) };
}

function paymentLabel(method) {
  const m = String(method || '').toLowerCase().trim();
  if (m === 'nakit' || m === 'cash') return 'NAKİT';
  if (m === 'kart' || m === 'kredi' || m === 'kredi karti' || m === 'kredi kartı' || m === 'card') return 'KREDİ KARTI';
  if (m === 'havale' || m === 'eft') return 'HAVALE/EFT';
  if (!m) return '-';
  return method.toUpperCase();
}

function formatReceipt(order, settings) {
  const r = settings.restaurant || {};
  const t = resolveTemplate(settings);
  const W = settings.printer?.paperWidth === 80 ? 48 : 32;
  const enc = settings.printer?.encoding || 'CP1254_32';
  const p = new EscPos(W, enc);

  // Üst ekstra satırlar
  if (Array.isArray(t.headerLines) && t.headerLines.length) {
    p.align('center');
    for (const ln of t.headerLines) if (ln) p.tall(true).line(ln).tall(false);
  }

  // Restoran başlığı (en büyük)
  p.align('center');
  if (t.showRestaurantName) {
    p.bold(true).double(true).line(r.name || 'RESTORAN').double(false).bold(false);
  }
  if (t.showAddress && r.address) p.tall(true).line(r.address).tall(false);
  if (t.showPhone && r.phone) p.tall(true).line('Tel: ' + r.phone).tall(false);
  if (t.subHeaderText) p.tall(true).line(t.subHeaderText).tall(false);

  p.hr('=').align('left');

  // Bilgi bloğu — büyük (çift yükseklik)
  p.tall(true);
  if (t.showDateTime) {
    const dt = new Date(order.closedAt || order.openedAt || Date.now());
    p.line('Tarih   : ' + dt.toLocaleString('tr-TR'));
  }
  if (order.source === 'eve') {
    p.line('** EVE TESLIM **');
    if (order.customer) p.line('Müşteri : ' + order.customer);
    if (order.phone)    p.line('Telefon : ' + order.phone);
    if (order.address)  p.line('Adres   : ' + order.address);
  } else if (t.showTableNo) {
    p.line('Masa    : ' + (order.tableId ?? '-'));
  }
  if (t.showOrderId) p.line('Adisyon : ' + (order.id || '-'));
  p.tall(false);
  if (t.showDateTime || t.showTableNo || t.showOrderId || order.source === 'eve') p.hr('-');

  // Kalemler (ikramlar hariç)
  const activeItems = (order.items || []).filter(i => i.status === 'active');
  const paidItems = activeItems.filter(i => !i.ikram);
  const ikramItems = activeItems.filter(i => i.ikram);

  // Çift yükseklik modunda da W karakter sığar (yalnızca yükseklik 2x)
  for (const item of paidItems) {
    p.tall(true);
    const name = item.name.length > W - 12 ? item.name.slice(0, W - 13) + '.' : item.name;
    p.twoCol(name, item.lineTotal.toFixed(2));
    if (t.showItemUnitPrice) {
      p.line('  ' + item.qty + ' x ' + (item.unitPrice ?? (item.lineTotal / item.qty)).toFixed(2));
    }
    if (t.showItemNotes && item.note) p.line('  (' + item.note + ')');
    p.tall(false);
  }

  // İkramlar (sadece varsa ayrı bölüm, tutar 0)
  if (ikramItems.length) {
    p.hr('-').bold(true).tall(true).line('İKRAMLAR').tall(false).bold(false);
    for (const item of ikramItems) {
      p.tall(true);
      const name = item.name.length > W - 12 ? item.name.slice(0, W - 13) + '.' : item.name;
      p.twoCol(name, 'İKRAM');
      p.line('  ' + item.qty + ' x 0.00');
      if (t.showItemNotes && item.note) p.line('  (' + item.note + ')');
      p.tall(false);
    }
  }

  p.hr('-').tall(true);
  if (t.showSubtotal) p.twoCol('ARA TOPLAM', (order.subtotal || 0).toFixed(2));
  if (t.showDiscount && order.discount > 0) p.twoCol('İNDİRİM', '-' + order.discount.toFixed(2));
  if (t.showVat) {
    const rate = settings.operations?.vatRate || 0;
    const total = order.total || 0;
    const vat = total - total / (1 + rate / 100);
    p.twoCol(`KDV (%${rate})`, vat.toFixed(2));
  }
  p.tall(false).hr('-').bold(true).double(true);
  p.twoCol('TOPLAM', (order.total || 0).toFixed(2) + ' TL');
  p.double(false).bold(false);

  if (t.showPaymentMethod && order.payment) {
    p.hr('-').tall(true);
    p.line('Ödeme   : ' + paymentLabel(order.payment.method));
    p.tall(false);
  }

  p.hr('=').align('center');
  if (Array.isArray(t.footerLines)) {
    for (const ln of t.footerLines) if (ln) p.tall(true).line(ln).tall(false);
  }
  p.feed(Math.max(1, Math.min(10, t.footerFeedLines || 3))).cut();

  return p.toBuffer();
}

/**
 * Mutfak fişi -> ESC/POS Buffer
 * Fiyat yok, ürün + adet + not + masa, büyük yazı.
 * opts.onlyNewItems = true → sadece printedAt'i olmayan kalemleri yazdır.
 */
function formatKitchenTicket(order, settings, opts = {}) {
  const W = settings.printer?.paperWidth === 80 ? 48 : 32;
  const enc = settings.printer?.encoding || 'CP1254_32';
  const p = new EscPos(W, enc);

  p.align('center').bold(true).double(true)
   .line('MUTFAK')
   .double(false).bold(false);
  p.hr('=');

  p.align('left').bold(true).tall(true);
  if (order.source && order.source !== 'masa') {
    const label = order.source === 'trendyol' ? 'TRENDYOL'
      : order.source === 'yemeksepeti' ? 'YEMEKSEPETİ'
      : order.source === 'getir' ? 'GETİR YEMEK'
      : order.source === 'eve' ? 'EVE TESLIM'
      : String(order.source).toUpperCase();
    p.tall(false).double(true).line('** ' + label + ' **').double(false).tall(true);
    if (order.platformOrderNo) p.line('Sip. No : ' + order.platformOrderNo);
    if (order.customer) p.line('Müşteri : ' + order.customer);
    if (order.source === 'eve' && order.phone) p.line('Telefon : ' + order.phone);
    if (order.source === 'eve' && order.address) p.line('Adres   : ' + order.address);
  } else {
    p.line('Masa    : ' + (order.tableId ?? '-'));
  }
  p.line('Adisyon : ' + (order.id || '-'));
  p.bold(false);
  const dt = new Date();
  p.line('Saat    : ' + dt.toLocaleTimeString('tr-TR'));
  p.tall(false).hr('-');

  let items = (order.items || []).filter(i => i.status === 'active');
  if (opts.onlyNewItems) {
    items = items.filter(i => !i.printedAt);
  }
  if (opts.itemIds && Array.isArray(opts.itemIds)) {
    const ids = new Set(opts.itemIds);
    items = items.filter(i => ids.has(i.lineId));
  }

  if (items.length === 0) {
    p.align('center').tall(true).line('(Yeni kalem yok)').tall(false).align('left');
  } else {
    for (const item of items) {
      p.bold(true).double(true);
      p.line(item.qty + ' x ' + item.name);
      p.double(false).bold(false);
      if (item.ikram) p.bold(true).tall(true).line('  ** İKRAM **').tall(false).bold(false);
      if (item.note) p.tall(true).line('  NOT: ' + item.note).tall(false);
      p.newline();
    }
  }

  p.hr('=').feed(3).cut();
  return p.toBuffer();
}

/**
 * Kod sayfasi teshis ciktisi — desteklenen TUM kod sayfalarinda ayni Turkce
 * test satirini ardiska basar. Kullanici fis uzerinde hangi satirin duzgun
 * basildigini gorur, o adi (CP1254_18, CP1254_32, vb.) settings'te secer.
 */
function formatCodepageTest(settings) {
  const W = settings.printer?.paperWidth === 80 ? 48 : 32;
  const sample = 'ÇŞĞÜÖİ - çşğüöı - Teşekkür İNDİRİM';
  const chunks = [
    Buffer.from([0x1B, 0x40]), // INIT
  ];
  // Baslik (varsayilan kod sayfasi olmadan ASCII)
  const header = Buffer.from(
    '\n' +
    'KOD SAYFASI TESTI'.padStart((W + 17) / 2) + '\n' +
    '='.repeat(W) + '\n' +
    'Her satirda kod sayfasi adi ve ayni\n' +
    'Turkce metin basilir. Duzgun basanin\n' +
    'adini settings.printers.receipt.encoding\n' +
    'alanina yazin.\n' +
    '-'.repeat(W) + '\n',
    'ascii'
  );
  chunks.push(header);

  for (const [name, enc] of Object.entries(ENCODINGS)) {
    // ESC t n -> kod sayfasini sec
    chunks.push(Buffer.from([0x1B, 0x74, enc.code]));
    const label = `[${name.padEnd(10)} n=${String(enc.code).padStart(3)}] `;
    chunks.push(Buffer.from(label, 'ascii'));
    chunks.push(Buffer.from(toBytes(sample, enc.map), 'binary'));
    chunks.push(Buffer.from([0x0A])); // LF
  }

  chunks.push(Buffer.from('\n' + '='.repeat(W) + '\n', 'ascii'));
  chunks.push(Buffer.from([0x1B, 0x64, 0x05])); // feed 5
  chunks.push(Buffer.from([0x1D, 0x56, 0x01])); // partial cut
  return Buffer.concat(chunks);
}

module.exports = {
  EscPos,
  formatReceipt,
  formatKitchenTicket,
  formatCodepageTest,
  toLatin5,
  toBytes,
  ENCODINGS,
  listEncodings,
  DEFAULT_TEMPLATE,
  resolveTemplate,
  paymentLabel,
};
