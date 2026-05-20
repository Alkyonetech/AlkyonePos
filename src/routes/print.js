const express = require('express');
const { loadOrders, saveOrders, loadSettings } = require('../utils/data');
const { yoneticiRequired } = require('../utils/auth');
const { broadcast } = require('../ws/websocket');
const {
  printReceipt: hwPrintReceipt,
  printKitchenTicket: hwPrintKitchen,
  getProfile,
  clearDiscoveryCache,
} = require('../services/printer');
const { resolveTemplate, formatCodepageTest, listEncodings } = require('../services/escpos');
const { resolveProfile, sendBuffer } = require('../services/printer');
const { listWindowsPrinters } = require('../services/printer-discovery');
const { scanNetwork, getLocalSubnets } = require('../services/network-printer-discovery');

const router = express.Router();

// Iki bagimsiz kuyruk — biri tikanirsa digeri bekleme
const queues = {
  receipt: { jobs: [], busy: false, lastOk: null, lastError: null },
  kitchen: { jobs: [], busy: false, lastOk: null, lastError: null },
};

// GET /api/print/status — her iki yazici icin durum
router.get('/status', (req, res) => {
  const settings = loadSettings();
  const receipt = getProfile(settings, 'receipt');
  const kitchen = getProfile(settings, 'kitchen');
  res.json({
    receipt: profileSummary(receipt, queues.receipt),
    kitchen: profileSummary(kitchen, queues.kitchen),
  });
});

function profileSummary(profile, q) {
  return {
    enabled: !!profile?.enabled,
    model: profile?.model || null,
    connection: profile?.connection || null,
    device: profile?.device || null,
    paperWidth: profile?.paperWidth || 58,
    queueSize: q.jobs.length,
    isPrinting: q.busy,
    lastOk: q.lastOk,
    lastError: q.lastError,
  };
}

// GET /api/print/discover?filter=thermal|all  — yerel paylasilan yazicilar
//   filter=thermal -> sadece termal/POS olarak siniflananlar (varsayilan)
//   filter=all     -> tum yazicilar
router.get('/discover', yoneticiRequired, (req, res) => {
  clearDiscoveryCache();
  const all = listWindowsPrinters();
  const filter = (req.query.filter || 'thermal').toString();
  const thermal = all.filter(p => p.isThermal);
  res.json({
    platform: process.platform,
    filter,
    printers: filter === 'all' ? all : thermal,
    counts: {
      total: all.length,
      thermal: thermal.length,
      shared: all.filter(p => p.isShared).length,
    },
  });
});

// GET /api/print/discover-network — ag yazici taramasi (TCP 9100 + ESC/POS dogrulama)
router.get('/discover-network', yoneticiRequired, async (req, res) => {
  try {
    const port = parseInt(req.query.port) || 9100;
    const result = await scanNetwork({ port });
    res.json({
      success: true,
      subnets: result.subnets,
      port: result.port,
      scannedHosts: result.scannedHosts,
      printers: result.printers,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/print/subnets — yardimci: hangi aglarda taranacagi onizleme
router.get('/subnets', yoneticiRequired, (req, res) => {
  res.json({ subnets: getLocalSubnets() });
});

// POST /api/print/probe — manuel ping + ESC/POS dogrulama, cihaz kaydetmeden
//   body: { host: string, port?: number }
router.post('/probe', yoneticiRequired, async (req, res) => {
  const host = (req.body?.host || '').trim();
  const port = parseInt(req.body?.port) || 9100;
  if (!host) return res.status(400).json({ error: 'host gerekli' });
  try {
    const { probePort, probeEscPos } = require('../services/network-printer-discovery');
    const open = await probePort(host, port, 1500);
    if (!open) return res.json({ host, port, reachable: false, escposConfirmed: false });
    const st = await probeEscPos(host, port, 1500);
    res.json({
      host, port,
      reachable: true,
      escposConfirmed: st.escpos,
      statusByte: st.statusByte,
      status: st.statusByte != null ? {
        online: (st.statusByte & 0x08) === 0,
        coverOpen: (st.statusByte & 0x20) !== 0,
        feedButton: (st.statusByte & 0x40) !== 0,
        raw: st.statusByte,
      } : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/print/encodings — kullanilabilir kod sayfasi adlari
router.get('/encodings', yoneticiRequired, (req, res) => {
  res.json({ encodings: listEncodings() });
});

// POST /api/print/codepage-test — TUM kod sayfalarini tek fiste basar.
// Kullanici fiste hangi satirin Turkce karakterleri duzgun basildigini
// gorur, o adi settings.printers.<role>.encoding alanina yazar.
router.post('/codepage-test', yoneticiRequired, async (req, res) => {
  const role = (req.body?.role === 'kitchen') ? 'kitchen' : 'receipt';
  const settings = loadSettings();
  const profile = getProfile(settings, role);
  if (!profile?.enabled) {
    return res.status(400).json({ error: `${role} yazicisi devre disi` });
  }
  try {
    const resolved = resolveProfile(profile);
    const buf = formatCodepageTest({
      ...settings,
      printer: { paperWidth: resolved.paperWidth || profile.paperWidth || 58 },
    });
    await sendBuffer(resolved, buf);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message, code: err.code || null });
  }
});

// POST /api/print/test/:role — test fisi (role: receipt | kitchen)
router.post('/test/:role', yoneticiRequired, async (req, res) => {
  const role = req.params.role === 'kitchen' ? 'kitchen' : 'receipt';
  const settings = loadSettings();
  const order = {
    id: 'TEST',
    tableId: 0,
    openedAt: new Date().toISOString(),
    closedAt: new Date().toISOString(),
    items: [{ id: 't1', name: 'Test Urun', qty: 1, lineTotal: 0, unitPrice: 0, status: 'active' }],
    subtotal: 0, discount: 0, total: 0,
  };
  try {
    if (role === 'kitchen') await hwPrintKitchen(order, settings);
    else await hwPrintReceipt(order, settings);
    queues[role].lastOk = new Date().toISOString();
    queues[role].lastError = null;
    res.json({ success: true });
  } catch (err) {
    queues[role].lastError = err.message;
    res.status(500).json({ error: err.message, code: err.code || null });
  }
});

// POST /api/print/receipt/:orderId — musteri adisyonu (Adisyon Bas butonu)
router.post('/receipt/:orderId', async (req, res) => {
  const data = loadOrders();
  const order = data.orders.find(o => o.id === req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Adisyon bulunamadi' });

  const settings = loadSettings();
  const profile = getProfile(settings, 'receipt');

  if (!profile?.enabled) {
    // HTML fallback (window.print)
    return res.json({
      success: true,
      method: 'html',
      receipt: formatReceiptHTML(order, settings),
    });
  }

  enqueue('receipt', { order, settings, kind: 'receipt' });
  res.json({ success: true, method: 'escpos', queued: true });
});

// POST /api/print/kitchen/:orderId — mutfak fisi
//   body: { onlyNewItems?: bool, itemIds?: string[] }
router.post('/kitchen/:orderId', async (req, res) => {
  const data = loadOrders();
  const order = data.orders.find(o => o.id === req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Adisyon bulunamadi' });

  const settings = loadSettings();
  const profile = getProfile(settings, 'kitchen');
  if (!profile?.enabled) {
    return res.status(400).json({ error: 'Mutfak yazicisi devre disi' });
  }

  const onlyNewItems = req.body?.onlyNewItems !== false; // varsayilan true
  const itemIds = Array.isArray(req.body?.itemIds) ? req.body.itemIds : null; // lineId'lerin listesi

  enqueue('kitchen', {
    order, settings, kind: 'kitchen',
    opts: { onlyNewItems, itemIds },
    markPrintedIds: collectMarkedIds(order, { onlyNewItems, itemIds }),
  });

  res.json({ success: true, method: 'escpos', queued: true });
});

function collectMarkedIds(order, opts) {
  let items = (order.items || []).filter(i => i.status === 'active');
  if (opts.onlyNewItems) items = items.filter(i => !i.printedAt);
  if (opts.itemIds) {
    const s = new Set(opts.itemIds);
    items = items.filter(i => s.has(i.id));
  }
  return items.map(i => i.lineId);
}

// ===== KUYRUK =====

function enqueue(role, job) {
  queues[role].jobs.push(job);
  processQueue(role);
}

async function processQueue(role) {
  const q = queues[role];
  if (q.busy || q.jobs.length === 0) return;
  q.busy = true;

  while (q.jobs.length > 0) {
    const job = q.jobs.shift();
    try {
      if (job.kind === 'kitchen') {
        await hwPrintKitchen(job.order, job.settings, job.opts || {});
        if (job.markPrintedIds && job.markPrintedIds.length) {
          markItemsPrinted(job.order.id, job.markPrintedIds);
        }
      } else {
        await hwPrintReceipt(job.order, job.settings);
      }
      q.lastOk = new Date().toISOString();
      q.lastError = null;
      broadcast('printer:status', { role, ok: true });
    } catch (err) {
      q.lastError = err.message;
      console.error(`[Yazici:${role}] Hata:`, err.message);
      broadcast('printer:status', { role, ok: false, message: err.message });
      // 5 sn bekleyip tekrar dene; ayni is iki kez ust uste basarisizsa birak
      job.retries = (job.retries || 0) + 1;
      if (job.retries < 2) {
        q.jobs.unshift(job);
        await new Promise(r => setTimeout(r, 5000));
      } else {
        broadcast('printer:status', { role, ok: false, message: `Job dropped: ${err.message}` });
      }
    }
  }

  q.busy = false;
}

function markItemsPrinted(orderId, ids) {
  try {
    const data = loadOrders();
    const order = data.orders.find(o => o.id === orderId);
    if (!order) return;
    const now = new Date().toISOString();
    const set = new Set(ids);
    let touched = false;
    for (const it of order.items || []) {
      if (set.has(it.lineId) && !it.printedAt) {
        it.printedAt = now;
        touched = true;
      }
    }
    if (touched) {
      order.version = (order.version || 0) + 1;
      saveOrders(data);
      broadcast('order:updated', order);
    }
  } catch (e) {
    console.error('[Yazici] markItemsPrinted hata:', e.message);
  }
}

// ===== HTML FALLBACK =====

function formatReceiptHTML(order, settings) {
  const r = settings.restaurant || {};
  const t = resolveTemplate(settings);
  const parts = [];
  parts.push('<div style="font-family:monospace;max-width:300px;margin:auto;">');

  if (Array.isArray(t.headerLines)) {
    for (const ln of t.headerLines) if (ln) parts.push(`<p style="text-align:center;margin:2px 0">${escapeHtml(ln)}</p>`);
  }
  if (t.showRestaurantName) parts.push(`<h3 style="text-align:center;margin:4px 0">${escapeHtml(r.name || '')}</h3>`);
  const sub = [];
  if (t.showAddress && r.address) sub.push(escapeHtml(r.address));
  if (t.showPhone && r.phone) sub.push('Tel: ' + escapeHtml(r.phone));
  if (sub.length) parts.push(`<p style="text-align:center;margin:2px 0">${sub.join('<br>')}</p>`);
  if (t.subHeaderText) parts.push(`<p style="text-align:center;margin:2px 0">${escapeHtml(t.subHeaderText)}</p>`);
  parts.push('<hr>');

  const info = [];
  if (t.showDateTime) info.push('Tarih: ' + new Date(order.closedAt || order.openedAt || Date.now()).toLocaleString('tr-TR'));
  if (order.source === 'eve') {
    info.push('** EVE TESLIM **');
    if (order.customer) info.push('Müşteri: ' + escapeHtml(order.customer));
    if (order.phone)    info.push('Telefon: ' + escapeHtml(order.phone));
    if (order.address)  info.push('Adres: ' + escapeHtml(order.address));
  } else if (t.showTableNo) {
    info.push('Masa: ' + (order.tableId ?? '-'));
  }
  if (t.showOrderId) info.push('Adisyon: ' + escapeHtml(order.id || '-'));
  if (info.length) parts.push(`<p>${info.join('<br>')}</p><hr>`);

  const items = (order.items || [])
    .filter(i => i.status === 'active')
    .map(i => {
      const noteHtml = (t.showItemNotes && i.note) ? `<br><small>(${escapeHtml(i.note)})</small>` : '';
      const unitHtml = t.showItemUnitPrice ? `<br><small>${i.qty} x ${(i.unitPrice ?? (i.lineTotal / i.qty)).toFixed(2)}</small>` : '';
      return `<tr><td>${escapeHtml(i.name)}${noteHtml}${unitHtml}</td><td style="text-align:right">${(i.lineTotal || 0).toFixed(2)}</td></tr>`;
    })
    .join('');
  parts.push(`<table style="width:100%">${items}</table><hr>`);

  if (t.showSubtotal) parts.push(`<p>Ara Toplam: ${(order.subtotal || 0).toFixed(2)} TL</p>`);
  if (t.showDiscount && order.discount > 0) parts.push(`<p>Indirim: -${order.discount.toFixed(2)} TL</p>`);
  if (t.showVat) {
    const rate = settings.operations?.vatRate || 0;
    const total = order.total || 0;
    const vat = total - total / (1 + rate / 100);
    parts.push(`<p>KDV (%${rate}): ${vat.toFixed(2)} TL</p>`);
  }
  parts.push(`<p style="font-size:1.2em"><strong>TOPLAM: ${(order.total || 0).toFixed(2)} TL</strong></p>`);
  if (t.showPaymentMethod && order.payment) parts.push(`<p>Odeme: ${escapeHtml(order.payment.method || '')}</p>`);
  parts.push('<hr>');
  if (Array.isArray(t.footerLines)) {
    for (const ln of t.footerLines) if (ln) parts.push(`<p style="text-align:center;margin:2px 0">${escapeHtml(ln)}</p>`);
  }
  parts.push('</div>');
  return parts.join('');
}

// POST /api/print/preview — sablonu kaydetmeden onizle
//   body: { template?: object }  -> verilirse mevcutla birlestirilir
router.post('/preview', yoneticiRequired, (req, res) => {
  const settings = loadSettings();
  if (req.body && req.body.template && typeof req.body.template === 'object') {
    settings.receiptTemplate = { ...(settings.receiptTemplate || {}), ...req.body.template };
  }
  const sampleOrder = {
    id: 'ORN-001',
    tableId: 5,
    openedAt: new Date().toISOString(),
    closedAt: new Date().toISOString(),
    items: [
      { id: 'a', name: 'California Roll', qty: 2, unitPrice: 120, lineTotal: 240, status: 'active', note: 'Az wasabi' },
      { id: 'b', name: 'Yakisoba', qty: 1, unitPrice: 180, lineTotal: 180, status: 'active' },
      { id: 'c', name: 'Yesil Cay', qty: 3, unitPrice: 40, lineTotal: 120, status: 'active' },
    ],
    subtotal: 540, discount: 40, total: 500,
    payment: { method: 'Kart' },
  };
  res.json({ html: formatReceiptHTML(sampleOrder, settings) });
});

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

module.exports = router;
