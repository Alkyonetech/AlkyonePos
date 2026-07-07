/**
 * Alkyone 2.0 route'lari — yalnizca brand.features.sqlite aktif markada mount edilir.
 * Faz 3: manuel maliyet + atik girisi. Faz 4: analitik.
 */
const express = require('express');
const { yoneticiRequired } = require('../utils/auth');
const { tlToKurus } = require('../alkyone/money');

const router = express.Router();

// Lazy require — SQLite katmani yalnizca bu route'lar kullanilinca yuklensin.
const repo = () => require('../alkyone/repo');
const analytics = () => require('../alkyone/analytics');
const writer = () => require('../alkyone/writer');

// ---------- Faz 3: maliyet girisi (P0) ----------

// GET /api/alkyone/items — urunler + guncel maliyet (maliyet girisi ekrani icin)
router.get('/items', yoneticiRequired, (req, res) => {
  const r = repo();
  const items = r.listItems().map(it => ({
    id: it.id,
    externalRef: it.external_ref,
    name: it.name,
    category: it.category,
    salePrice: it.sale_price,
    currentCost: r.currentCost(it.id),
  }));
  res.json({ items });
});

// POST /api/alkyone/cost — { itemId, costTl | costKurus, effectiveFrom?, source? }
router.post('/cost', yoneticiRequired, (req, res) => {
  const { itemId, costTl, costKurus, effectiveFrom, source } = req.body;
  if (!itemId) return res.status(400).json({ error: 'itemId gerekli' });
  const cost = costKurus != null ? Math.round(costKurus) : tlToKurus(costTl);
  if (!(cost >= 0)) return res.status(400).json({ error: 'gecerli maliyet gerekli' });
  const id = repo().addItemCost({ itemId, cost, effectiveFrom, source: source || 'manual' });
  res.json({ id, itemId, cost });
});

// POST /api/alkyone/cost/estimate — bilmeyen sahip icin "satis fiyatinin %X'i" fallback
// { pct, itemId? } — itemId yoksa maliyeti olmayan TUM urunlere uygular.
router.post('/cost/estimate', yoneticiRequired, (req, res) => {
  const pct = Number(req.body.pct);
  if (!(pct > 0 && pct < 100)) return res.status(400).json({ error: 'pct 1-99 arasi olmali' });
  const r = repo();
  const targets = req.body.itemId
    ? r.listItems().filter(i => i.id === req.body.itemId)
    : r.listItems().filter(i => r.currentCost(i.id) == null);
  let applied = 0;
  for (const it of targets) {
    r.addItemCost({
      itemId: it.id,
      cost: Math.round(it.sale_price * pct / 100),
      source: 'estimate_pct',
    });
    applied++;
  }
  res.json({ applied, pct });
});

// ---------- Faz 3: atik girisi ----------

// GET /api/alkyone/stock — hammadde listesi
router.get('/stock', yoneticiRequired, (req, res) => {
  res.json({ items: repo().listStockItems() });
});

// POST /api/alkyone/stock — { name, unit, unitCostTl | unitCostKurus }
router.post('/stock', yoneticiRequired, (req, res) => {
  const { name, unit, unitCostTl, unitCostKurus } = req.body;
  if (!name) return res.status(400).json({ error: 'name gerekli' });
  const unitCost = unitCostKurus != null ? Math.round(unitCostKurus) : tlToKurus(unitCostTl);
  const id = repo().createStockItem({ name, unit, unitCost });
  res.json({ id });
});

// POST /api/alkyone/waste — { stockItemId | itemId, qty, reason, occurredAt? }
// cost_value MALIYETTEN otomatik (sahip para GIRMEZ — Kural #2).
router.post('/waste', yoneticiRequired, (req, res) => {
  const { stockItemId, itemId, qty, reason, occurredAt } = req.body;
  if (qty == null || !(Number(qty) > 0)) return res.status(400).json({ error: 'qty > 0 gerekli' });
  try {
    const out = repo().createWaste({
      stockItemId: stockItemId || null,
      itemId: itemId || null,
      qty, reason, occurredAt,
    });
    res.json(out);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- Faz 4: analitik ----------

const days = (req) => Math.max(1, Math.min(730, parseInt(req.query.days) || 30));

router.get('/analytics/overview', yoneticiRequired, (req, res) =>
  res.json(analytics().overview(days(req))));
router.get('/analytics/sales', yoneticiRequired, (req, res) =>
  res.json({ items: analytics().salesByItem(days(req)) }));
router.get('/analytics/menu-engineering', yoneticiRequired, (req, res) =>
  res.json(analytics().menuEngineering(days(req))));
router.get('/analytics/heatmap', yoneticiRequired, (req, res) =>
  res.json({ cells: analytics().hourHeatmap(days(req)) }));
router.get('/analytics/basket', yoneticiRequired, (req, res) =>
  res.json({ pairs: analytics().basket(days(req)) }));
router.get('/analytics/waste', yoneticiRequired, (req, res) =>
  res.json(analytics().wasteSummary(days(req))));

// POST /api/alkyone/sync-menu — menu.json -> items yeniden senkron
router.post('/sync-menu', yoneticiRequired, (req, res) => {
  const n = writer().syncMenu();
  res.json({ synced: n });
});

module.exports = router;
