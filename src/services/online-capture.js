// ===== ONLINE SIPARIS YAKALAMA =====
// Yemeksepeti / Trendyol / Getir baskisini yakalar; ham ESC/POS'u metne cevirip
// siparise ayristirir ve ONAY BEKLEYEN kuyruga koyar. Yakalanan is HENUZ satis
// DEGILDIR — masalar ekraninda onaylanirsa harici siparise donusur ve rapora
// islenir, reddedilirse silinir.
//
// Iki tasima (transport), her biri bagimsiz ve OPT-IN (varsayilan KAPALI):
//   1) TCP 9100 (RAW/JetDirect): platform cihazi baskiyi bu makinenin IP:9100
//      adresine yollar (ag yazicisi gibi).
//   2) USB / seri karakter cihazi: baski verisini yayan bir cihaz dugumunden
//      (Linux: /dev/usb/lp0, Windows: COM3 gibi) okur.
// Gelecekteki Windows spooler yakalama da ayni ingestCapturedJob() borusuna baglanir.

const net = require('net');
const fs = require('fs');
const crypto = require('crypto');
const { loadIncoming, saveIncoming, loadSettings } = require('../utils/data');
const { escposToText, parseOrderText } = require('./online-order-parser');
const { broadcast } = require('../ws/websocket');

// Cok kucuk/anlamsiz yakalamalari eleme esigi
const MIN_TEXT_LEN = 8;
// USB akisinda bir baski isinin bittigini varsaymadan once beklenen bosluk (ms)
const USB_IDLE_MS = 800;

// Calisan tasima durumlari
let tcp = { server: null, port: null };
let usb = { stream: null, device: null, buf: [], timer: null, reopen: null };
// Tee (Windows spooler): yakalanan baskiyi fiziksel adisyon yazicisina da gecir
let teeEnabled = false;

// Yakalanan ham baskiyi (pass-through) fiziksel adisyon yazicisina ilet.
// Boylece platform bizim loopback yazicimiza bassa da fis yine kagida basilir.
function maybeTee(raw) {
  if (!teeEnabled || !raw || !raw.length) return;
  try {
    const settings = loadSettings();
    const printer = require('./printer');
    const profile = printer.getProfile(settings, 'receipt');
    if (!profile || profile.enabled === false) {
      console.warn('[Yakalama] tee: adisyon yazicisi kapali/tanimsiz — fiziksel baski atlandi');
      return;
    }
    const resolved = printer.resolveProfile(profile);
    Promise.resolve(printer.sendBuffer(resolved, raw)).then(
      () => console.log('[Yakalama] tee: fis fiziksel yaziciya iletildi'),
      (e) => console.warn('[Yakalama] tee gonderim hatasi:', e.message)
    );
  } catch (e) {
    console.warn('[Yakalama] tee hatasi:', e.message);
  }
}

/**
 * Kaynaktan bagimsiz ingest: ham baski verisini bekleyen siparise cevirir.
 * @param {Buffer} raw ham baski baytlari
 * @param {{transport?:string, remoteAddr?:string}} meta
 * @returns {object|null}
 */
function ingestCapturedJob(raw, meta = {}) {
  // Once fiziksel yaziciya gecir (pass-through) — ayristirmadan bagimsiz, fis her
  // halukarda basilsin. Sadece anlamli isler icin (asagida MIN_TEXT_LEN sonrasi).
  const text = escposToText(raw);
  if (!text || text.replace(/\s/g, '').length < MIN_TEXT_LEN) {
    console.warn('[Yakalama] Bos/anlamsiz baski atlandi (transport:', meta.transport || '?', ')');
    return null;
  }
  maybeTee(raw); // fiziksel yaziciya pass-through (tee aciksa)
  const parsed = parseOrderText(text);

  const rec = {
    id: 'inc_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex'),
    receivedAt: new Date().toISOString(),
    transport: meta.transport || 'tcp9100',
    remoteAddr: meta.remoteAddr || '',
    rawText: text,
    source: parsed.source,
    customer: parsed.customer,
    phone: parsed.phone,
    address: parsed.address,
    parsedTotal: parsed.parsedTotal,
    items: parsed.items,
    status: 'pending',
  };

  const store = loadIncoming();
  store.pending = store.pending || [];
  store.pending.push(rec);
  if (store.pending.length > 200) store.pending = store.pending.slice(-200);
  saveIncoming(store);

  console.log(`[Yakalama] Yeni online siparis (${rec.transport}: ${rec.source || 'kaynak?'}, ${rec.items.length} urun, ${rec.remoteAddr || rec.transport})`);
  try { broadcast('incoming:new', rec); } catch (_) {}
  return rec;
}

// ---------- TCP 9100 ----------
function startTcp(port) {
  stopTcp();
  const server = net.createServer((socket) => {
    const chunks = [];
    const remoteAddr = socket.remoteAddress || '';
    socket.on('data', (d) => chunks.push(d));
    socket.on('error', () => {});
    socket.on('close', () => {
      if (!chunks.length) return;
      try { ingestCapturedJob(Buffer.concat(chunks), { transport: 'tcp9100', remoteAddr }); }
      catch (e) { console.warn('[Yakalama] TCP ingest hatasi:', e.message); }
    });
    socket.setTimeout(30000, () => socket.destroy());
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[Yakalama] TCP ${port} kullanimda — TCP yakalama devre disi (POS calismaya devam eder)`);
    } else {
      console.warn('[Yakalama] TCP sunucu hatasi:', err.message);
    }
    tcp = { server: null, port: null };
  });
  server.listen(port, '0.0.0.0', () => {
    console.log(`[Yakalama] TCP ${port} (RAW/JetDirect) aktif`);
  });
  tcp = { server, port };
}

function stopTcp() {
  if (tcp.server) { try { tcp.server.close(); } catch (_) {} }
  tcp = { server: null, port: null };
}

// ---------- USB / seri karakter cihazi ----------
function flushUsb() {
  if (usb.timer) { clearTimeout(usb.timer); usb.timer = null; }
  if (!usb.buf.length) return;
  const raw = Buffer.concat(usb.buf);
  usb.buf = [];
  try { ingestCapturedJob(raw, { transport: 'usb', remoteAddr: usb.device || '' }); }
  catch (e) { console.warn('[Yakalama] USB ingest hatasi:', e.message); }
}

function startUsb(device) {
  stopUsb();
  if (!device) return;
  usb.device = device;

  const open = () => {
    if (!fs.existsSync(device)) {
      console.warn(`[Yakalama] USB cihazi yok: ${device} — 5sn sonra tekrar denenecek`);
      usb.reopen = setTimeout(open, 5000);
      return;
    }
    let stream;
    try {
      stream = fs.createReadStream(device);
    } catch (e) {
      console.warn(`[Yakalama] USB acilamadi (${device}): ${e.message}`);
      usb.reopen = setTimeout(open, 5000);
      return;
    }
    usb.stream = stream;
    stream.on('data', (d) => {
      usb.buf.push(d);
      if (usb.timer) clearTimeout(usb.timer);
      usb.timer = setTimeout(flushUsb, USB_IDLE_MS);
    });
    stream.on('error', (e) => {
      console.warn(`[Yakalama] USB akis hatasi (${device}): ${e.message}`);
    });
    stream.on('close', () => {
      flushUsb();
      // Cihaz koptu — hala istenen cihazsa yeniden ac
      if (usb.device === device) usb.reopen = setTimeout(open, 3000);
    });
    console.log(`[Yakalama] USB/seri yakalama aktif: ${device}`);
  };
  open();
}

function stopUsb() {
  if (usb.reopen) { clearTimeout(usb.reopen); }
  if (usb.timer) { clearTimeout(usb.timer); }
  if (usb.stream) { try { usb.stream.destroy(); } catch (_) {} }
  usb = { stream: null, device: null, buf: [], timer: null, reopen: null };
}

/**
 * Ayarlara gore TCP/USB tasimalarini baslat/durdur (idempotent).
 * Master anahtar KAPALIYSA hicbir sey dinlemez.
 * @param {object} settings tam settings nesnesi
 */
function reconcileCapture(settings) {
  const oc = (settings && settings.onlineCapture) || {};
  const master = oc.enabled === true;                 // varsayilan KAPALI
  const wantTcp = master && oc.tcpEnabled !== false;  // yakalama acikken TCP varsayilan acik
  const wantUsb = master && oc.usbEnabled === true && !!oc.usbDevice;
  const port = Number(oc.port) || 9100;
  const device = oc.usbDevice || '';
  teeEnabled = master && oc.teeEnabled === true; // yakalanan baskiyi fiziksel yaziciya gecir

  // TCP
  if (wantTcp) {
    if (!tcp.server || tcp.port !== port) startTcp(port);
  } else {
    if (tcp.server) { stopTcp(); console.log('[Yakalama] TCP yakalama durduruldu'); }
  }

  // USB
  if (wantUsb) {
    if (!usb.device || usb.device !== device) startUsb(device);
  } else {
    if (usb.device) { stopUsb(); console.log('[Yakalama] USB yakalama durduruldu'); }
  }

  if (!master) console.log('[Yakalama] Online yakalama KAPALI (ayarlardan)');
}

function stopAll() { stopTcp(); stopUsb(); }

module.exports = { reconcileCapture, ingestCapturedJob, stopAll };
