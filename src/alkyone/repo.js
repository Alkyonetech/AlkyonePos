/**
 * Alkyone 2.0 repository katmani. Tum sorgular soft-delete filtreler
 * (WHERE deleted_at IS NULL). Ortak sutunlar (id/created_at/updated_at) burada
 * doldurulur.
 */
const { getDb, restaurantId } = require('./db');
const { ulid } = require('./ids');
const { nowIso } = require('./time');

// ---------- items (mamul / menu urunu) ----------

/**
 * Kaynak POS menu urununu items'a eslе (idempotent). external_ref = menu item id.
 * Fiyat degisirse guncellenir; ULID sabit kalir.
 */
function upsertItemByExternalRef({ externalRef, name, category, salePrice, isActive = 1 }) {
  const db = getDb();
  const rid = restaurantId();
  const now = nowIso();
  const existing = db.prepare(
    'SELECT id FROM items WHERE restaurant_id=? AND external_ref=? AND deleted_at IS NULL'
  ).get(rid, String(externalRef));
  if (existing) {
    db.prepare(
      'UPDATE items SET name=?, category=?, sale_price=?, is_active=?, updated_at=? WHERE id=?'
    ).run(name, category || null, salePrice, isActive ? 1 : 0, now, existing.id);
    return existing.id;
  }
  const id = ulid();
  db.prepare(
    `INSERT INTO items(id, restaurant_id, name, category, sale_price, is_active,
       external_ref, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)`
  ).run(id, rid, name, category || null, salePrice, isActive ? 1 : 0, String(externalRef), now, now);
  return id;
}

function getItemByExternalRef(externalRef) {
  return getDb().prepare(
    'SELECT * FROM items WHERE restaurant_id=? AND external_ref=? AND deleted_at IS NULL'
  ).get(restaurantId(), String(externalRef));
}

function listItems() {
  return getDb().prepare(
    'SELECT * FROM items WHERE restaurant_id=? AND deleted_at IS NULL ORDER BY category, name'
  ).all(restaurantId());
}

// ---------- item_cost_history (append-only) ----------

function addItemCost({ itemId, cost, effectiveFrom, source = 'manual' }) {
  const db = getDb();
  const id = ulid();
  const now = nowIso();
  db.prepare(
    `INSERT INTO item_cost_history(id, restaurant_id, item_id, cost, effective_from,
       source, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)`
  ).run(id, restaurantId(), itemId, cost, effectiveFrom || now, source, now, now);
  return id;
}

/** Guncel maliyet = effective_from <= at olan en son kayit (Kural #5). */
function currentCost(itemId, at = nowIso()) {
  const row = getDb().prepare(
    `SELECT cost FROM item_cost_history
       WHERE item_id=? AND deleted_at IS NULL AND effective_from <= ?
       ORDER BY effective_from DESC LIMIT 1`
  ).get(itemId, at);
  return row ? row.cost : null;
}

// ---------- orders + order_lines ----------

/**
 * Kapanan bir siparisi orders + order_lines olarak yaz (Faz 2 yazma yolu).
 * external_ref ile idempotent — ayni kaynak siparis iki kez yazilmaz.
 * unit_price ve unit_cost SATIS ANI snapshot'idir.
 * lines: [{ itemId?, externalItemRef?, nameSnapshot, qty, unitPrice, isIkram }]
 */
function insertOrderWithLines(order) {
  const db = getDb();
  const rid = restaurantId();
  const now = nowIso();

  if (order.externalRef) {
    const dup = db.prepare(
      'SELECT id FROM orders WHERE restaurant_id=? AND external_ref=?'
    ).get(rid, String(order.externalRef));
    if (dup) return { id: dup.id, duplicate: true };
  }

  const orderId = ulid();
  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO orders(id, restaurant_id, table_id, external_ref, opened_at,
         closed_at, covers, payment_type, order_type, subtotal, discount, total,
         status, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      orderId, rid, order.tableId != null ? String(order.tableId) : null,
      order.externalRef ? String(order.externalRef) : null,
      order.openedAt || null, order.closedAt || now,
      order.covers != null ? order.covers : null,
      order.paymentType || null, order.orderType || null,
      order.subtotal || 0, order.discount || 0, order.total || 0,
      order.status || 'closed', now, now
    );

    const insLine = db.prepare(
      `INSERT INTO order_lines(id, restaurant_id, order_id, item_id, name_snapshot,
         qty, unit_price, unit_cost, line_total, is_ikram, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`
    );
    for (const ln of (order.lines || [])) {
      const itemId = ln.itemId
        || (ln.externalItemRef != null
            ? (getItemByExternalRef(ln.externalItemRef)?.id || null)
            : null);
      const unitCost = ln.unitCost != null
        ? ln.unitCost
        : (itemId ? currentCost(itemId, order.closedAt || now) : null);
      const qty = ln.qty || 0;
      const lineTotal = ln.isIkram ? 0 : (ln.unitPrice || 0) * qty;
      insLine.run(
        ulid(), rid, orderId, itemId, ln.nameSnapshot || null,
        qty, ln.unitPrice || 0, unitCost, lineTotal, ln.isIkram ? 1 : 0, now, now
      );
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { id: orderId, duplicate: false };
}

// ---------- stock_items (hammadde) ----------

function createStockItem({ name, unit, unitCost }) {
  const db = getDb();
  const id = ulid();
  const now = nowIso();
  db.prepare(
    `INSERT INTO stock_items(id, restaurant_id, name, unit, unit_cost, created_at, updated_at)
     VALUES(?,?,?,?,?,?,?)`
  ).run(id, restaurantId(), name, unit || null, unitCost || 0, now, now);
  return id;
}

function listStockItems() {
  return getDb().prepare(
    'SELECT * FROM stock_items WHERE restaurant_id=? AND deleted_at IS NULL ORDER BY name'
  ).all(restaurantId());
}

function getStockItem(id) {
  return getDb().prepare(
    'SELECT * FROM stock_items WHERE id=? AND deleted_at IS NULL'
  ).get(id);
}

// ---------- waste_log (fire) ----------

/**
 * Fire kaydi. cost_value MALIYETTEN turetilir (Kural #2) — cagiran para GIRMEZ.
 * stock_item_id VEYA item_id'den tam olarak biri verilir.
 */
function createWaste({ stockItemId = null, itemId = null, qty, reason, occurredAt }) {
  if ((stockItemId == null) === (itemId == null)) {
    throw new Error('waste: stock_item_id ve item_id\'den tam olarak biri gerekli');
  }
  const db = getDb();
  const now = nowIso();
  let unitCost = 0;
  if (stockItemId) {
    const s = getStockItem(stockItemId);
    if (!s) throw new Error('hammadde bulunamadi');
    unitCost = s.unit_cost || 0;
  } else {
    unitCost = currentCost(itemId, occurredAt || now) || 0;
  }
  const costValue = Math.round(unitCost * Number(qty || 0));
  const id = ulid();
  db.prepare(
    `INSERT INTO waste_log(id, restaurant_id, stock_item_id, item_id, qty, cost_value,
       reason, occurred_at, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`
  ).run(id, restaurantId(), stockItemId, itemId, Number(qty || 0), costValue,
        reason || 'other', occurredAt || now, now, now);
  return { id, costValue };
}

module.exports = {
  upsertItemByExternalRef, getItemByExternalRef, listItems,
  addItemCost, currentCost,
  insertOrderWithLines,
  createStockItem, listStockItems, getStockItem,
  createWaste,
};
