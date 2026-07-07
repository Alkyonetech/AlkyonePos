/**
 * Faz 4 — Analitik sorgular. Hepsi SQLite 2.0 semasindan okur, para kurus.
 * Spec Bolum 4: satis+kar, menu muhendisligi, zaman deseni & sepet, gercek israf.
 */
const { getDb, restaurantId } = require('./db');

function range(days) {
  const to = new Date();
  const from = new Date(to.getTime() - (days || 30) * 86400000);
  return { fromIso: from.toISOString(), toIso: to.toISOString() };
}

/** Urun bazinda adet + ciro + KAR + marj. */
function salesByItem(days = 30) {
  const { fromIso, toIso } = range(days);
  const rows = getDb().prepare(`
    SELECT
      COALESCE(l.item_id, 'x-'||l.name_snapshot) AS key,
      MAX(COALESCE(i.name, l.name_snapshot))     AS name,
      MAX(i.category)                            AS category,
      SUM(l.qty)                                 AS qty,
      SUM(l.line_total)                          AS revenue,
      SUM(COALESCE(l.unit_cost,0) * l.qty)       AS cost
    FROM order_lines l
    JOIN orders o ON o.id = l.order_id AND o.deleted_at IS NULL
    LEFT JOIN items i ON i.id = l.item_id
    WHERE l.restaurant_id = ? AND l.deleted_at IS NULL
      AND o.status IN ('closed','merged')
      AND o.closed_at BETWEEN ? AND ?
      AND l.is_ikram = 0
    GROUP BY key
    ORDER BY qty DESC
  `).all(restaurantId(), fromIso, toIso);

  return rows.map(r => {
    const profit = (r.revenue || 0) - (r.cost || 0);
    const margin = r.revenue ? profit / r.revenue : 0;
    return {
      key: r.key, name: r.name, category: r.category,
      qty: r.qty || 0, revenue: r.revenue || 0, cost: r.cost || 0,
      profit, margin,
    };
  });
}

/**
 * Menu muhendisligi matrisi: populerlik (adet) x karlilik (marj) ortalamaya gore.
 * yildiz (star) / is ati (plowhorse) / bulmaca (puzzle) / kopek (dog).
 */
function menuEngineering(days = 30) {
  const items = salesByItem(days);
  if (items.length === 0) return { items: [], avgQty: 0, avgMargin: 0 };
  const avgQty = items.reduce((s, i) => s + i.qty, 0) / items.length;
  const totalRev = items.reduce((s, i) => s + i.revenue, 0);
  const totalProfit = items.reduce((s, i) => s + i.profit, 0);
  const avgMargin = totalRev ? totalProfit / totalRev : 0;
  const classify = (i) => {
    const pop = i.qty >= avgQty;
    const prof = i.margin >= avgMargin;
    if (pop && prof) return 'star';       // yildiz
    if (pop && !prof) return 'plowhorse'; // is ati
    if (!pop && prof) return 'puzzle';    // bulmaca
    return 'dog';                          // kopek
  };
  return {
    avgQty, avgMargin,
    items: items.map(i => ({ ...i, quadrant: classify(i) })),
  };
}

/** gun (0=Pazar) x saat siparis sayisi + ciro isi haritasi. */
function hourHeatmap(days = 60) {
  const { fromIso, toIso } = range(days);
  const rows = getDb().prepare(`
    SELECT o.closed_at AS ts, o.total AS total
    FROM orders o
    WHERE o.restaurant_id = ? AND o.deleted_at IS NULL
      AND o.status IN ('closed','merged')
      AND o.closed_at BETWEEN ? AND ?
  `).all(restaurantId(), fromIso, toIso);
  const grid = {};
  for (const r of rows) {
    const d = new Date(r.ts);
    if (Number.isNaN(d.getTime())) continue;
    const dow = d.getDay();
    const hr = d.getHours();
    const k = `${dow}_${hr}`;
    if (!grid[k]) grid[k] = { dow, hour: hr, count: 0, revenue: 0 };
    grid[k].count += 1;
    grid[k].revenue += r.total || 0;
  }
  return Object.values(grid);
}

/** Genel bakis: siparis, ciro, kar, ortalama, israf. */
function overview(days = 30) {
  const { fromIso, toIso } = range(days);
  const o = getDb().prepare(`
    SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue
    FROM orders WHERE restaurant_id=? AND deleted_at IS NULL
      AND status IN ('closed','merged') AND closed_at BETWEEN ? AND ?
  `).get(restaurantId(), fromIso, toIso);
  const items = salesByItem(days);
  const profit = items.reduce((s, i) => s + i.profit, 0);
  const cost = items.reduce((s, i) => s + i.cost, 0);
  const waste = getDb().prepare(`
    SELECT COALESCE(SUM(cost_value),0) AS waste
    FROM waste_log WHERE restaurant_id=? AND deleted_at IS NULL
      AND occurred_at BETWEEN ? AND ?
  `).get(restaurantId(), fromIso, toIso);
  const avgTicket = o.orders ? Math.round(o.revenue / o.orders) : 0;
  return {
    days, orders: o.orders, revenue: o.revenue, cost, profit,
    wasteCost: waste.waste, avgTicket,
    costCoverage: items.filter(i => i.cost > 0).length + '/' + items.length,
  };
}

/** Sepet analizi: ayni sipariste birlikte gecen urun ciftleri (top). */
function basket(days = 90, limit = 20) {
  const { fromIso, toIso } = range(days);
  const rows = getDb().prepare(`
    SELECT a.name_snapshot AS a, b.name_snapshot AS b, COUNT(*) AS n
    FROM order_lines a
    JOIN order_lines b ON a.order_id = b.order_id AND a.name_snapshot < b.name_snapshot
    JOIN orders o ON o.id = a.order_id AND o.deleted_at IS NULL
    WHERE a.restaurant_id=? AND a.deleted_at IS NULL AND b.deleted_at IS NULL
      AND o.status IN ('closed','merged') AND o.closed_at BETWEEN ? AND ?
    GROUP BY a.name_snapshot, b.name_snapshot
    HAVING n > 1
    ORDER BY n DESC
    LIMIT ?
  `).all(restaurantId(), fromIso, toIso, limit);
  return rows;
}

/** Israf: sebebe ve hammaddeye gore maliyet kaybi. */
function wasteSummary(days = 30) {
  const { fromIso, toIso } = range(days);
  const byReason = getDb().prepare(`
    SELECT reason, COUNT(*) AS n, COALESCE(SUM(cost_value),0) AS cost
    FROM waste_log WHERE restaurant_id=? AND deleted_at IS NULL
      AND occurred_at BETWEEN ? AND ?
    GROUP BY reason ORDER BY cost DESC
  `).all(restaurantId(), fromIso, toIso);
  const byStock = getDb().prepare(`
    SELECT COALESCE(s.name, i.name, '?') AS label,
           COALESCE(SUM(w.cost_value),0) AS cost, SUM(w.qty) AS qty
    FROM waste_log w
    LEFT JOIN stock_items s ON s.id = w.stock_item_id
    LEFT JOIN items i ON i.id = w.item_id
    WHERE w.restaurant_id=? AND w.deleted_at IS NULL
      AND w.occurred_at BETWEEN ? AND ?
    GROUP BY label ORDER BY cost DESC
  `).all(restaurantId(), fromIso, toIso);
  const total = byReason.reduce((s, r) => s + r.cost, 0);
  return { total, byReason, byStock };
}

module.exports = {
  salesByItem, menuEngineering, hourHeatmap, overview, basket, wasteSummary,
};
