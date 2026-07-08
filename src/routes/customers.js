/**
 * Musteri / adres defteri — eve-teslim siparislerde adres kaydetme & secme.
 * Depo: data/<marka>/customers.json  ({ customers: [...] })
 * Auth: yoneticiRequired (yerel agda gevsek gecer — audit rolu icin).
 */
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { loadCustomers, saveCustomers, normPhone } = require('../utils/data');
const { yoneticiRequired } = require('../utils/auth');

const router = express.Router();

function now() { return new Date().toISOString(); }
function addrKey(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }

/**
 * Musteriyi telefona gore bul/olustur; adres verilmisse (metin dedupe) ekle.
 * Hem POST ucu hem sipariskaydi (orders.js) buradan cagirir.
 * Doner: { customer, created:bool }
 */
function upsertCustomer({ name, phone, address, note, touchOrder } = {}) {
  const phoneNorm = normPhone(phone);
  if (!phoneNorm && !addrKey(address)) return { customer: null, created: false };

  const db = loadCustomers();
  db.customers = Array.isArray(db.customers) ? db.customers : [];

  let c = phoneNorm ? db.customers.find(x => x.phoneNorm === phoneNorm) : null;
  let created = false;

  if (!c) {
    c = {
      id: `cus_${uuidv4().slice(0, 8)}`,
      name: String(name || '').trim(),
      phone: String(phone || '').trim(),
      phoneNorm,
      addresses: [],
      orderCount: 0,
      lastOrderAt: null,
      createdAt: now(),
      updatedAt: now(),
    };
    db.customers.push(c);
    created = true;
  } else {
    if (name && String(name).trim()) c.name = String(name).trim();
    if (phone && String(phone).trim()) { c.phone = String(phone).trim(); c.phoneNorm = phoneNorm; }
  }

  const text = String(address || '').trim();
  if (text) {
    let a = (c.addresses || []).find(x => addrKey(x.text) === addrKey(text));
    if (!a) {
      a = { id: `adr_${uuidv4().slice(0, 8)}`, text, note: String(note || '').trim(), lastUsedAt: now() };
      c.addresses.push(a);
    } else {
      a.lastUsedAt = now();
      if (note && String(note).trim()) a.note = String(note).trim();
    }
  }

  if (touchOrder) {
    c.orderCount = (c.orderCount || 0) + 1;
    c.lastOrderAt = now();
  }
  c.updatedAt = now();

  saveCustomers(db);
  return { customer: c, created };
}

/** Ozet (liste icin) — adres metni kirpilmis, sayimlar dahil. */
function summarize(c) {
  return {
    id: c.id, name: c.name, phone: c.phone,
    addressCount: (c.addresses || []).length,
    orderCount: c.orderCount || 0,
    lastOrderAt: c.lastOrderAt || null,
  };
}

// GET /api/customers?q=  — arama (telefon-prefix veya ad); q yoksa son kullanilanlar
router.get('/', yoneticiRequired, (req, res) => {
  const db = loadCustomers();
  const list = Array.isArray(db.customers) ? db.customers : [];
  const q = String(req.query.q || '').trim();
  let out = list;
  if (q) {
    const qn = normPhone(q);
    const ql = q.toLowerCase();
    out = list.filter(c =>
      (qn && c.phoneNorm && c.phoneNorm.includes(qn)) ||
      (c.name && c.name.toLowerCase().includes(ql))
    );
  }
  out = out
    .slice()
    .sort((a, b) => String(b.lastOrderAt || b.updatedAt || '').localeCompare(String(a.lastOrderAt || a.updatedAt || '')))
    .slice(0, 100)
    .map(summarize);
  res.json({ customers: out });
});

// GET /api/customers/lookup?phone=  — tam telefon eslesmesi (siparis ani otomatik doldurma)
router.get('/lookup', yoneticiRequired, (req, res) => {
  const phoneNorm = normPhone(req.query.phone);
  if (!phoneNorm || phoneNorm.length < 3) return res.json({ found: false });
  const db = loadCustomers();
  const c = (db.customers || []).find(x => x.phoneNorm === phoneNorm);
  if (!c) return res.json({ found: false });
  // adresleri son kullanima gore sirala
  const addresses = (c.addresses || []).slice()
    .sort((a, b) => String(b.lastUsedAt || '').localeCompare(String(a.lastUsedAt || '')));
  res.json({ found: true, customer: { ...c, addresses } });
});

// GET /api/customers/:id  — tam kayit (adresler dahil). /lookup'tan SONRA tanimli.
router.get('/:id', yoneticiRequired, (req, res) => {
  const db = loadCustomers();
  const c = (db.customers || []).find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Musteri bulunamadi' });
  const addresses = (c.addresses || []).slice()
    .sort((a, b) => String(b.lastUsedAt || '').localeCompare(String(a.lastUsedAt || '')));
  res.json({ customer: { ...c, addresses } });
});

// POST /api/customers  — manuel upsert { name, phone, address?, note? }
router.post('/', yoneticiRequired, (req, res) => {
  const { name, phone, address, note } = req.body || {};
  if (!normPhone(phone) && !String(name || '').trim()) {
    return res.status(400).json({ error: 'Ad veya telefon gerekli' });
  }
  const { customer, created } = upsertCustomer({ name, phone, address, note });
  res.json({ success: true, created, customer });
});

// PUT /api/customers/:id  — ad/telefon duzenle
router.put('/:id', yoneticiRequired, (req, res) => {
  const db = loadCustomers();
  const c = (db.customers || []).find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Musteri bulunamadi' });
  const { name, phone } = req.body || {};
  if (name !== undefined) c.name = String(name).trim();
  if (phone !== undefined) { c.phone = String(phone).trim(); c.phoneNorm = normPhone(phone); }
  c.updatedAt = now();
  saveCustomers(db);
  res.json({ success: true, customer: c });
});

// DELETE /api/customers/:id  — musteri sil
router.delete('/:id', yoneticiRequired, (req, res) => {
  const db = loadCustomers();
  const before = (db.customers || []).length;
  db.customers = (db.customers || []).filter(x => x.id !== req.params.id);
  if (db.customers.length === before) return res.status(404).json({ error: 'Musteri bulunamadi' });
  saveCustomers(db);
  res.json({ success: true });
});

// DELETE /api/customers/:id/addresses/:addrId  — adres sil
router.delete('/:id/addresses/:addrId', yoneticiRequired, (req, res) => {
  const db = loadCustomers();
  const c = (db.customers || []).find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Musteri bulunamadi' });
  const before = (c.addresses || []).length;
  c.addresses = (c.addresses || []).filter(a => a.id !== req.params.addrId);
  if (c.addresses.length === before) return res.status(404).json({ error: 'Adres bulunamadi' });
  c.updatedAt = now();
  saveCustomers(db);
  res.json({ success: true, customer: c });
});

module.exports = router;
module.exports.upsertCustomer = upsertCustomer;
