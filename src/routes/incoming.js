// ===== GELEN ONLINE SIPARISLER (yazicidan yakalanan, onay bekleyen) =====
// GET    /api/incoming            -> bekleyen yakalamalar
// POST   /api/incoming/:id/approve-> harici siparise cevir (kaydet + rapora isle)
// POST   /api/incoming/:id/reject -> kuyruktan sil
//
// Onaylandiginda kayit, orders.js'teki harici siparis ('external') ile AYNI
// sema ile kapatilmis siparis olarak yazilir; boylece ciro/rapor/analitige dahil olur.

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { loadIncoming, saveIncoming, loadOrders, saveOrders, loadSettings } = require('../utils/data');
const { garsonRequired, yoneticiRequired } = require('../utils/auth');
const { broadcast } = require('../ws/websocket');
const { getBrand } = require('../../brand');

const router = express.Router();

const EXTERNAL_SOURCES = ['trendyol', 'yemeksepeti', 'getir'];

const _alkyoneSqlite = !!(getBrand().features && getBrand().features.sqlite);
function recordAnalytics(order) {
  if (!_alkyoneSqlite) return;
  if (!order || order.status !== 'closed') return;
  try { require('../alkyone/writer').recordClosedOrder(order); } catch (_) { /* POS'u etkileme */ }
}

function generateOrderId() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const seq = String(Math.floor(Math.random() * 999)).padStart(3, '0');
  return `ord_${date}_${seq}`;
}
function generateLineId() { return `ln_${uuidv4().slice(0, 8)}`; }

// GET /api/incoming — bekleyen yakalamalar (en yeni ustte)
router.get('/', garsonRequired, (req, res) => {
  const store = loadIncoming();
  const list = (store.pending || [])
    .filter(r => r.status === 'pending')
    .sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));
  res.json({ pending: list });
});

// POST /api/incoming/:id/approve — onayla: harici siparise cevir + rapora isle
// Govde (opsiyonel) yakalanan degerleri duzeltebilir: { source, customer, phone,
// address, note, items:[{name,qty,unitPrice}] }
router.post('/:id/approve', garsonRequired, (req, res) => {
  const store = loadIncoming();
  const rec = (store.pending || []).find(r => r.id === req.params.id && r.status === 'pending');
  if (!rec) return res.status(404).json({ error: 'Bekleyen siparis bulunamadi' });

  const b = req.body || {};
  const source = b.source || rec.source;
  if (!EXTERNAL_SOURCES.includes(source)) {
    return res.status(400).json({ error: 'Kaynak secilmeli (trendyol, yemeksepeti veya getir)' });
  }

  const srcItems = Array.isArray(b.items) && b.items.length ? b.items : (rec.items || []);
  if (!srcItems.length) {
    return res.status(400).json({ error: 'En az bir urun gerekli' });
  }

  const now = new Date().toISOString();
  const lines = srcItems.map(it => {
    const qty = Math.max(1, parseInt(it.qty, 10) || 1);
    const unitPrice = Number(it.unitPrice) || 0;
    return {
      lineId: generateLineId(),
      itemId: it.itemId || null,
      name: String(it.name || 'Urun').trim(),
      qty,
      unitPrice,
      lineTotal: qty * unitPrice,
      ikram: false,
      note: it.note || '',
      addedAt: now,
      addedBy: req.user.role,
      status: 'active',
    };
  });
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);

  const order = {
    id: generateOrderId(),
    tableId: null,
    source,
    platformOrderNo: b.platformOrderNo || '',
    customer: (b.customer != null ? b.customer : rec.customer) || '',
    phone: String((b.phone != null ? b.phone : rec.phone) || '').trim(),
    address: String((b.address != null ? b.address : rec.address) || '').trim(),
    openedAt: now,
    closedAt: now,
    status: 'closed',
    version: 1,
    openedBy: req.user.role,
    origin: 'online-capture',       // izlenebilirlik: yazicidan yakalanip onaylandi
    items: lines,
    subtotal,
    discount: 0,
    total: subtotal,
    note: (b.note != null ? b.note : '') || '',
    payment: { method: source, paidAt: now },
  };

  const data = loadOrders();
  data.orders = data.orders || [];
  data.orders.push(order);
  saveOrders(data);

  // Kuyruktan cikar
  rec.status = 'approved';
  store.pending = (store.pending || []).filter(r => r.id !== rec.id);
  saveIncoming(store);

  broadcast('order:created', order);
  broadcast('order:closed', order);
  broadcast('incoming:removed', { id: rec.id });
  recordAnalytics(order);

  res.json({ approved: true, order });
});

// POST /api/incoming/:id/reject — reddet: kuyruktan sil (kayit tutulmaz)
router.post('/:id/reject', garsonRequired, (req, res) => {
  const store = loadIncoming();
  const before = (store.pending || []).length;
  store.pending = (store.pending || []).filter(r => r.id !== req.params.id);
  if (store.pending.length === before) {
    return res.status(404).json({ error: 'Bekleyen siparis bulunamadi' });
  }
  saveIncoming(store);
  broadcast('incoming:removed', { id: req.params.id });
  res.json({ rejected: true, id: req.params.id });
});

// POST /api/incoming/setup-windows-printer — Windows'ta yakalama yazicisi+port olustur
// (spooler tee: platform bu yaziciya basar -> 127.0.0.1:port -> yakalama + fiziksel tee)
router.post('/setup-windows-printer', yoneticiRequired, async (req, res) => {
  try {
    const settings = loadSettings();
    const port = (settings.onlineCapture && settings.onlineCapture.port) || 9100;
    await require('../services/win-capture-printer').setupWindowsCapturePrinter(port);
    res.json({
      ok: true,
      message: `"Alkyone Online Yakalama" yazicisi kuruldu (RAW 127.0.0.1:${port}). Platform panelinde otomatik baski yazicisini bu yaziciya secin; fis ayrica fiziksel yaziciya (tee) basilir.`,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/incoming/remove-windows-printer — yakalama yazicisini kaldir
router.post('/remove-windows-printer', yoneticiRequired, async (req, res) => {
  try {
    await require('../services/win-capture-printer').removeWindowsCapturePrinter();
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
