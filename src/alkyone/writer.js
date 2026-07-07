/**
 * Faz 2 — POS yazma yolu entegrasyonu.
 *
 * Mevcut JSON tabanli POS akisi (orders.js) bozulmadan calismaya devam eder;
 * bir siparis KAPANDIGINDA burasi onu 2.0 SQLite semasina (orders + order_lines)
 * zaman damgasi ve order gruplama ile yazar. unit_price ve unit_cost satis ani
 * snapshot'idir (Kural #4, #5). Para TL tam sayidan kurusa cevrilir.
 *
 * Yalnizca brand.features.sqlite aktifken cagrilir.
 */
const { tlToKurus } = require('./money');

// source -> order_type eslemesi
function orderType(source) {
  if (source === 'eve') return 'delivery';
  if (source === 'masa' || source == null) return 'dine_in';
  return 'takeaway'; // trendyol | yemeksepeti | getir
}

/** menu.json -> items senkronu (idempotent, external_ref = menu item id). */
function syncMenu() {
  const repo = require('./repo');
  let menu;
  try {
    const { loadMenu } = require('../utils/data');
    menu = loadMenu();
  } catch (_) { return 0; }
  if (!menu || !Array.isArray(menu.categories)) return 0;
  let n = 0;
  for (const cat of menu.categories) {
    for (const it of (cat.items || [])) {
      repo.upsertItemByExternalRef({
        externalRef: it.id,
        name: it.name,
        category: cat.name || cat.id,
        salePrice: tlToKurus(it.price),
        isActive: it.visible === false ? 0 : 1,
      });
      n++;
    }
  }
  return n;
}

/**
 * Kapanan JSON siparisini SQLite'a yaz. Hata olursa POS akisini ETKILEMEZ —
 * yut ve logla (analitik yazimi operasyonu bloklamamali).
 */
function recordClosedOrder(jsonOrder) {
  try {
    const repo = require('./repo');
    const activeLines = (jsonOrder.items || []).filter(i => i.status === 'active');
    if (activeLines.length === 0 && jsonOrder.status !== 'closed') return;

    // Satirlarda gecen urunler items'ta yoksa satir bilgisinden seed et.
    for (const ln of activeLines) {
      if (ln.itemId != null && !repo.getItemByExternalRef(ln.itemId)) {
        repo.upsertItemByExternalRef({
          externalRef: ln.itemId,
          name: ln.name,
          category: null,
          salePrice: tlToKurus(ln.unitPrice),
          isActive: 1,
        });
      }
    }

    const lines = activeLines.map(ln => ({
      externalItemRef: ln.itemId,
      nameSnapshot: ln.name,
      qty: ln.qty || 0,
      unitPrice: tlToKurus(ln.unitPrice),
      isIkram: ln.ikram === true,
    }));

    const res = repo.insertOrderWithLines({
      externalRef: jsonOrder.id,
      tableId: jsonOrder.tableId,
      openedAt: jsonOrder.openedAt || null,
      closedAt: jsonOrder.closedAt || null,
      covers: jsonOrder.covers != null ? jsonOrder.covers : null,
      paymentType: jsonOrder.payment ? jsonOrder.payment.method : null,
      orderType: orderType(jsonOrder.source),
      subtotal: tlToKurus(jsonOrder.subtotal),
      discount: tlToKurus(jsonOrder.discount),
      total: tlToKurus(jsonOrder.total),
      status: jsonOrder.status || 'closed',
      lines,
    });
    if (!res.duplicate) {
      console.log(`[Alkyone] siparis analitige yazildi: ${jsonOrder.id} -> ${res.id}`);
    }
  } catch (e) {
    console.warn('[Alkyone] analitik yazim hatasi (POS etkilenmedi):', e.message);
  }
}

module.exports = { recordClosedOrder, syncMenu, orderType };
