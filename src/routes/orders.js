const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { loadOrders, saveOrders, loadTables, saveTables, loadSettings } = require('../utils/data');
const { garsonRequired, yoneticiRequired } = require('../utils/auth');
const { broadcast } = require('../ws/websocket');
const { autoKitchenPrint } = require('../services/kitchen-auto');
const { getBrand } = require('../../brand');

const router = express.Router();

// Faz 2 yazma yolu: yalnizca sqlite ozelligi acik markada (Alkyone) kapanan
// siparisleri 2.0 analitik semasina yazar. Sakura'da tam no-op.
const _alkyoneSqlite = !!(getBrand().features && getBrand().features.sqlite);
function recordAnalytics(order) {
  if (!_alkyoneSqlite) return;
  if (!order || order.status !== 'closed') return; // yalnizca gerceklesen satis
  try { require('../alkyone/writer').recordClosedOrder(order); } catch (_) { /* POS'u etkileme */ }
}

/**
 * Yeni siparis ID olustur
 */
function generateOrderId() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const seq = String(Math.floor(Math.random() * 999)).padStart(3, '0');
  return `ord_${date}_${seq}`;
}

/**
 * Yeni satir ID olustur
 */
function generateLineId() {
  return `ln_${uuidv4().slice(0, 8)}`;
}

// GET /api/orders
router.get('/', garsonRequired, (req, res) => {
  const data = loadOrders();
  res.json(data);
});

// ===== HARICI SIPARISLER (Trendyol / Yemeksepeti / Getir Yemek — manuel giris) =====
// Bu kaynaklarda yazici tetiklenmez — sadece ciro/takip icin kayit tutulur
const EXTERNAL_SOURCES = ['trendyol', 'yemeksepeti', 'getir'];
// Eve teslim — ayri akis (telefonla siparis, adres + adisyon basimi)
const DELIVERY_SOURCES = ['eve'];

// GET /api/orders/external/list — bugunku harici siparisler
router.get('/external/list', garsonRequired, (req, res) => {
  const data = loadOrders();
  const today = new Date().toISOString().slice(0, 10);
  const list = (data.orders || [])
    .filter(o => EXTERNAL_SOURCES.includes(o.source)
      && (o.openedAt || '').slice(0, 10) === today
      && o.status !== 'cancelled')
    .sort((a, b) => new Date(b.openedAt) - new Date(a.openedAt));
  res.json({ orders: list });
});

// POST /api/orders/external — yeni harici siparis (tek seferde tamamlanir)
router.post('/external', garsonRequired, (req, res) => {
  const { source, platformOrderNo, customer, phone, address, note, items } = req.body;

  if (!EXTERNAL_SOURCES.includes(source)) {
    return res.status(400).json({ error: 'Gecersiz kaynak (trendyol, yemeksepeti veya getir olmali)' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'En az bir urun gerekli' });
  }

  const now = new Date().toISOString();
  const lines = items.map(it => {
    const qty = Math.max(1, parseInt(it.qty) || 1);
    const unitPrice = Number(it.unitPrice) || 0;
    return {
      lineId: generateLineId(),
      itemId: it.itemId,
      name: it.name,
      qty,
      unitPrice,
      lineTotal: qty * unitPrice,
      ikram: false,
      note: it.note || '',
      addedAt: now,
      addedBy: req.user.role,
      status: 'active'
    };
  });

  const order = {
    id: generateOrderId(),
    tableId: null,
    source,
    platformOrderNo: platformOrderNo || '',
    customer: customer || '',
    phone: String(phone || '').trim(),
    address: String(address || '').trim(),
    openedAt: now,
    closedAt: now,
    status: 'closed',
    version: 1,
    openedBy: req.user.role,
    items: lines,
    subtotal: 0,
    discount: 0,
    total: 0,
    note: note || '',
    payment: { method: source, paidAt: now }
  };
  recalcOrder(order);

  const data = loadOrders();
  data.orders.push(order);
  saveOrders(data);

  broadcast('order:created', order);
  broadcast('order:closed', order);
  recordAnalytics(order);
  res.json(order);
  // Harici siparislerde otomatik mutfak fisi yok — yalnizca kayit/takip
});

// DELETE /api/orders/external/:id — hatali harici siparisi iptal et (yonetici)
router.delete('/external/:id', yoneticiRequired, (req, res) => {
  const data = loadOrders();
  const order = (data.orders || []).find(o => o.id === req.params.id && EXTERNAL_SOURCES.includes(o.source));
  if (!order) {
    return res.status(404).json({ error: 'Harici siparis bulunamadi' });
  }
  order.status = 'cancelled';
  order.closedAt = new Date().toISOString();
  saveOrders(data);
  broadcast('order:closed', order);
  res.json({ cancelled: true, id: order.id });
});

// ===== EVE TESLIM (Telefonla siparis) =====

// GET /api/orders/delivery/list — bugunku eve teslim siparisleri
router.get('/delivery/list', garsonRequired, (req, res) => {
  const data = loadOrders();
  const today = new Date().toISOString().slice(0, 10);
  const list = (data.orders || [])
    .filter(o => DELIVERY_SOURCES.includes(o.source)
      && (o.openedAt || '').slice(0, 10) === today
      && o.status !== 'cancelled')
    .sort((a, b) => new Date(b.openedAt) - new Date(a.openedAt));
  res.json({ orders: list });
});

// POST /api/orders/delivery — yeni eve teslim siparisi
router.post('/delivery', garsonRequired, (req, res) => {
  const { customer, phone, address, note, items, paymentMethod, saveCustomer } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'En az bir urun gerekli' });
  }
  if (!address || !String(address).trim()) {
    return res.status(400).json({ error: 'Teslimat adresi gerekli' });
  }

  const now = new Date().toISOString();
  const lines = items.map(it => {
    const qty = Math.max(1, parseInt(it.qty) || 1);
    const unitPrice = Number(it.unitPrice) || 0;
    return {
      lineId: generateLineId(),
      itemId: it.itemId,
      name: it.name,
      qty,
      unitPrice,
      lineTotal: qty * unitPrice,
      ikram: false,
      note: it.note || '',
      addedAt: now,
      addedBy: req.user.role,
      status: 'active'
    };
  });

  const order = {
    id: generateOrderId(),
    tableId: null,
    source: 'eve',
    customer: customer || '',
    phone: String(phone || '').trim(),
    address: String(address).trim(),
    openedAt: now,
    closedAt: now,
    status: 'closed',
    version: 1,
    openedBy: req.user.role,
    items: lines,
    subtotal: 0,
    discount: 0,
    total: 0,
    note: note || '',
    payment: { method: paymentMethod || 'nakit', paidAt: now }
  };
  recalcOrder(order);

  const data = loadOrders();
  data.orders.push(order);
  saveOrders(data);

  broadcast('order:created', order);
  broadcast('order:closed', order);
  recordAnalytics(order);

  // Adres defterine kaydet (manuel onay kutusu) — POS'u etkilemesin diye try
  if (saveCustomer) {
    try {
      require('./customers').upsertCustomer({
        name: order.customer, phone: order.phone,
        address: order.address, note: order.note, touchOrder: true,
      });
    } catch (e) { console.error('[Musteri] kayit hatasi:', e.message); }
  }

  res.json(order);
  // Mutfak fisi otomatik gonderilmez — kullanici listeden manuel tetikler
});

// DELETE /api/orders/delivery/:id — eve teslim siparisini iptal et (yonetici)
router.delete('/delivery/:id', yoneticiRequired, (req, res) => {
  const data = loadOrders();
  const order = (data.orders || []).find(o => o.id === req.params.id && DELIVERY_SOURCES.includes(o.source));
  if (!order) {
    return res.status(404).json({ error: 'Eve teslim siparisi bulunamadi' });
  }
  order.status = 'cancelled';
  order.closedAt = new Date().toISOString();
  saveOrders(data);
  broadcast('order:closed', order);
  res.json({ cancelled: true, id: order.id });
});

// GET /api/orders/closed/list — BUGUN kapatilan adisyonlar (kazara kapatilani
// bulmak icin). Gun kapatilinca bu veriler rapora arsivlenir. /:tableId'den ONCE.
router.get('/closed/list', yoneticiRequired, (req, res) => {
  const data = loadOrders();
  // Gun kapatma ile ayni gun tanimi (UTC dilim) — tutarlilik icin.
  const today = new Date().toISOString().slice(0, 10);
  const list = (data.orders || [])
    .filter(o => o.status === 'closed' && o.closedAt && o.closedAt.slice(0, 10) === today)
    .sort((a, b) => String(b.closedAt).localeCompare(String(a.closedAt)));
  res.json({ orders: list, count: list.length });
});

// POST /api/orders/:orderId/reopen — kazara kapatilan adisyonu yeniden ac.
// Masa adisyonuysa masa bostaysa tekrar o masaya baglar; masa doluysa reddeder.
router.post('/:orderId/reopen', yoneticiRequired, (req, res) => {
  const data = loadOrders();
  const order = (data.orders || []).find(o => o.id === req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Adisyon bulunamadi' });
  if (order.status !== 'closed') {
    return res.status(400).json({ error: 'Yalnizca kapatilmis adisyon yeniden acilabilir' });
  }

  // Masa adisyonu ise masayi kontrol et
  if (order.tableId != null) {
    const tables = loadTables();
    const table = tables.tables.find(t => t.id === order.tableId);
    if (table && table.currentOrderId && table.currentOrderId !== order.id) {
      return res.status(409).json({ error: `Masa ${order.tableId} dolu — once oradaki adisyonu kapatin` });
    }
    if (table) {
      table.currentOrderId = order.id;
      table.status = 'open';
      tables.version = (tables.version || 0) + 1;
      saveTables(tables);
      broadcast('table:updated', table);
    }
  }

  order.status = 'open';
  order.closedAt = null;
  order.payment = null;
  order.version = (order.version || 0) + 1;
  recalcOrder(order);
  saveOrders(data);

  broadcast('order:updated', order);
  res.json(order);
});

// GET /api/orders/:tableId
router.get('/:tableId', garsonRequired, (req, res) => {
  const tableId = parseInt(req.params.tableId);
  const data = loadOrders();
  const order = data.orders.find(o => o.tableId === tableId && o.status === 'open');

  if (!order) {
    return res.status(404).json({ error: 'Bu masada acik adisyon yok' });
  }

  res.json(order);
});

// POST /api/orders/:tableId/items - Urun ekle
router.post('/:tableId/items', garsonRequired, (req, res) => {
  const tableId = parseInt(req.params.tableId);
  const { version, itemId, name, qty, unitPrice, note, ikram } = req.body;

  if (!itemId || !name || !qty || !unitPrice) {
    return res.status(400).json({ error: 'itemId, name, qty ve unitPrice gerekli' });
  }

  const data = loadOrders();
  let order = data.orders.find(o => o.tableId === tableId && o.status === 'open');

  // Masada acik adisyon yoksa yeni olustur
  if (!order) {
    order = {
      id: generateOrderId(),
      tableId,
      openedAt: new Date().toISOString(),
      closedAt: null,
      status: 'open',
      version: 0,
      source: 'masa',
      openedBy: req.user.role,
      items: [],
      subtotal: 0,
      discount: 0,
      total: 0,
      payment: null
    };
    data.orders.push(order);

    // Masa durumunu guncelle
    const tables = loadTables();
    const table = tables.tables.find(t => t.id === tableId);
    if (table) {
      table.currentOrderId = order.id;
      table.status = 'open';
      tables.version = (tables.version || 0) + 1;
      saveTables(tables);
      broadcast('table:updated', table);
    }

    broadcast('order:created', order);
  }

  // Version kontrolu (optimistic locking)
  if (version !== undefined && version !== order.version) {
    return res.status(409).json({
      error: 'Adisyon baska cihazda guncellendi, yenileyin',
      currentVersion: order.version,
      order
    });
  }

  // Yeni satir ekle (ikram ise tutar 0, orijinal fiyat kayit icin saklanir)
  const isIkram = ikram === true;
  const lineTotal = isIkram ? 0 : qty * unitPrice;
  const newLine = {
    lineId: generateLineId(),
    itemId,
    name,
    qty,
    unitPrice,
    lineTotal,
    ikram: isIkram,
    note: note || '',
    addedAt: new Date().toISOString(),
    addedBy: req.user.role,
    status: 'active'
  };

  order.items.push(newLine);
  recalcOrder(order);
  order.version += 1;

  saveOrders(data);
  broadcast('order:updated', order);
  res.json(order);

  // Mutfak fisini arka planda gonder (yanit blocklamaz)
  autoKitchenPrint(order.id, [newLine.lineId]);
});

// PATCH /api/orders/:tableId/items/:lineId - Miktar/not guncelle
router.patch('/:tableId/items/:lineId', garsonRequired, (req, res) => {
  const tableId = parseInt(req.params.tableId);
  const { lineId } = req.params;
  const { version, qty, note } = req.body;

  const data = loadOrders();
  const order = data.orders.find(o => o.tableId === tableId && o.status === 'open');

  if (!order) {
    return res.status(404).json({ error: 'Bu masada acik adisyon yok' });
  }

  if (version !== undefined && version !== order.version) {
    return res.status(409).json({
      error: 'Adisyon baska cihazda guncellendi',
      currentVersion: order.version,
      order
    });
  }

  const line = order.items.find(i => i.lineId === lineId && i.status === 'active');
  if (!line) {
    return res.status(404).json({ error: 'Urun bulunamadi' });
  }

  if (qty !== undefined) {
    line.qty = qty;
    line.lineTotal = line.ikram ? 0 : qty * line.unitPrice;
  }
  if (note !== undefined) {
    line.note = note;
  }

  recalcOrder(order);
  order.version += 1;

  saveOrders(data);
  broadcast('order:updated', order);
  res.json(order);
});

// DELETE /api/orders/:tableId/items/:lineId - Urun cikar
router.delete('/:tableId/items/:lineId', garsonRequired, (req, res) => {
  const tableId = parseInt(req.params.tableId);
  const { lineId } = req.params;
  const version = req.query.version !== undefined ? parseInt(req.query.version) : undefined;

  const data = loadOrders();
  const order = data.orders.find(o => o.tableId === tableId && o.status === 'open');

  if (!order) {
    return res.status(404).json({ error: 'Bu masada acik adisyon yok' });
  }

  if (version !== undefined && version !== order.version) {
    return res.status(409).json({
      error: 'Adisyon baska cihazda guncellendi',
      currentVersion: order.version,
      order
    });
  }

  const line = order.items.find(i => i.lineId === lineId);
  if (!line) {
    return res.status(404).json({ error: 'Urun bulunamadi' });
  }

  line.status = 'cancelled';
  recalcOrder(order);
  order.version += 1;

  // Aktif urun kalmadiysa adisyonu otomatik kapat ve masayi bosalt
  const activeItems = order.items.filter(i => i.status === 'active');
  if (activeItems.length === 0) {
    order.status = 'cancelled';
    order.closedAt = new Date().toISOString();

    const tables = loadTables();
    const table = tables.tables.find(t => t.id === tableId);
    if (table) {
      table.currentOrderId = null;
      table.status = 'empty';
      tables.version = (tables.version || 0) + 1;
      saveTables(tables);
      broadcast('table:updated', table);
    }

    saveOrders(data);
    broadcast('order:closed', order);
    return res.json(order);
  }

  saveOrders(data);
  broadcast('order:updated', order);
  res.json(order);
});

// POST /api/orders/:tableId/discount - Acik adisyona indirim uygula (yonetici)
//   body: { discount: number (TL, kuru veya tam) }  -> adisyon uzerinde saklanir,
//   boylece adisyon fisinde ve hesap kapamada gorunur.
router.post('/:tableId/discount', yoneticiRequired, (req, res) => {
  const tableId = parseInt(req.params.tableId);
  const { discount, version } = req.body;

  const data = loadOrders();
  const order = data.orders.find(o => o.tableId === tableId && o.status === 'open');
  if (!order) {
    return res.status(404).json({ error: 'Bu masada acik adisyon yok' });
  }
  if (version !== undefined && version !== order.version) {
    return res.status(409).json({
      error: 'Adisyon baska cihazda guncellendi, yenileyin',
      currentVersion: order.version,
      order
    });
  }

  const d = Math.max(0, Number(discount) || 0);
  // Indirim ara toplamini asamaz
  order.discount = Math.min(d, order.subtotal || 0);
  recalcOrder(order);
  order.version += 1;

  saveOrders(data);
  broadcast('order:updated', order);
  res.json(order);
});

// POST /api/orders/:tableId/close - Hesap kapat
router.post('/:tableId/close', yoneticiRequired, (req, res) => {
  const tableId = parseInt(req.params.tableId);
  const { paymentMethod, discount } = req.body;

  const data = loadOrders();
  const order = data.orders.find(o => o.tableId === tableId && o.status === 'open');

  if (!order) {
    return res.status(404).json({ error: 'Bu masada acik adisyon yok' });
  }

  if (discount !== undefined) {
    order.discount = discount;
  }

  recalcOrder(order);
  order.status = 'closed';
  order.closedAt = new Date().toISOString();
  order.payment = {
    method: paymentMethod || 'nakit',
    paidAt: new Date().toISOString()
  };

  // Masa durumunu guncelle
  const tables = loadTables();
  const table = tables.tables.find(t => t.id === tableId);
  if (table) {
    table.currentOrderId = null;
    table.status = 'empty';
    tables.version = (tables.version || 0) + 1;
    saveTables(tables);
    broadcast('table:updated', table);
  }

  saveOrders(data);
  broadcast('order:closed', order);
  recordAnalytics(order);
  res.json(order);
});

// POST /api/orders/:fromId/transfer/:toId - Masa tasi
router.post('/:fromId/transfer/:toId', yoneticiRequired, (req, res) => {
  const fromId = parseInt(req.params.fromId);
  const toId = parseInt(req.params.toId);

  const data = loadOrders();
  const order = data.orders.find(o => o.tableId === fromId && o.status === 'open');

  if (!order) {
    return res.status(404).json({ error: 'Kaynak masada acik adisyon yok' });
  }

  // Hedef masada acik adisyon var mi?
  const existingOrder = data.orders.find(o => o.tableId === toId && o.status === 'open');
  if (existingOrder) {
    return res.status(400).json({ error: 'Hedef masada zaten acik adisyon var' });
  }

  order.tableId = toId;
  order.version += 1;

  // Masa durumlarini guncelle
  const tables = loadTables();
  const fromTable = tables.tables.find(t => t.id === fromId);
  const toTable = tables.tables.find(t => t.id === toId);

  if (fromTable) {
    fromTable.currentOrderId = null;
    fromTable.status = 'empty';
  }
  if (toTable) {
    toTable.currentOrderId = order.id;
    toTable.status = 'open';
  }
  tables.version = (tables.version || 0) + 1;

  saveTables(tables);
  saveOrders(data);

  broadcast('order:updated', order);
  broadcast('table:updated', fromTable);
  broadcast('table:updated', toTable);

  res.json(order);
});

// POST /api/orders/merge - Masa birlestir
router.post('/merge', yoneticiRequired, (req, res) => {
  const { sourceTableId, targetTableId } = req.body;

  if (!sourceTableId || !targetTableId) {
    return res.status(400).json({ error: 'sourceTableId ve targetTableId gerekli' });
  }

  const data = loadOrders();
  const sourceOrder = data.orders.find(o => o.tableId === sourceTableId && o.status === 'open');
  const targetOrder = data.orders.find(o => o.tableId === targetTableId && o.status === 'open');

  if (!sourceOrder) {
    return res.status(404).json({ error: 'Kaynak masada acik adisyon yok' });
  }
  if (!targetOrder) {
    return res.status(404).json({ error: 'Hedef masada acik adisyon yok' });
  }

  // Kaynak siparisleri hedefe tasi
  for (const item of sourceOrder.items) {
    if (item.status === 'active') {
      targetOrder.items.push({ ...item });
    }
  }

  // Kaynagi kapat
  sourceOrder.status = 'merged';
  sourceOrder.closedAt = new Date().toISOString();

  recalcOrder(targetOrder);
  targetOrder.version += 1;

  // Kaynak masayi bosalt
  const tables = loadTables();
  const sourceTable = tables.tables.find(t => t.id === sourceTableId);
  if (sourceTable) {
    sourceTable.currentOrderId = null;
    sourceTable.status = 'empty';
  }
  tables.version = (tables.version || 0) + 1;

  saveTables(tables);
  saveOrders(data);

  broadcast('order:updated', targetOrder);
  broadcast('table:updated', sourceTable);

  res.json({ merged: true, targetOrder });
});

/**
 * Adisyon toplamlarini yeniden hesapla
 */
function recalcOrder(order) {
  const activeItems = order.items.filter(i => i.status === 'active');
  order.subtotal = activeItems.reduce((sum, i) => sum + i.lineTotal, 0);
  order.total = order.subtotal - (order.discount || 0);
}

module.exports = router;
