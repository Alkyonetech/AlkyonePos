/**
 * Otomatik mutfak fisi gonderimi.
 *
 * Garson urun ekledikce mutfaga fis gider — yeni satirlar (printedAt: null)
 * yazilir, basildiktan sonra siparis kaydina printedAt isaretlenir.
 *
 * Bu modul orders.js'den cagrilir; print.js'in HTTP rotalarini cagirmak
 * yerine dogrudan servisleri kullanir (network roundtrip yok).
 *
 * settings.printers.kitchen.enabled === false ise no-op.
 */

const { loadOrders, saveOrders, loadSettings } = require('../utils/data');
const { printKitchenTicket, getProfile } = require('./printer');
const { broadcast } = require('../ws/websocket');

// Hata spam'ini onle: ayni hata mesaji 30sn icinde tekrar log'lanmasin
let lastErr = null;
let lastErrAt = 0;
const ERR_THROTTLE_MS = 30000;

async function autoKitchenPrint(orderId, lineIds) {
  try {
    const settings = loadSettings();
    const profile = getProfile(settings, 'kitchen');
    if (!profile?.enabled) return;

    const data = loadOrders();
    const order = data.orders.find(o => o.id === orderId);
    if (!order) return;

    await printKitchenTicket(order, settings, { itemIds: lineIds });

    // Basariliysa printedAt isaretle
    const now = new Date().toISOString();
    const set = new Set(lineIds);
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
      broadcast('printer:status', { role: 'kitchen', ok: true });
    }
  } catch (err) {
    const now = Date.now();
    if (err.message !== lastErr || now - lastErrAt > ERR_THROTTLE_MS) {
      console.error('[Mutfak] Otomatik basim hatasi:', err.message);
      lastErr = err.message;
      lastErrAt = now;
    }
    broadcast('printer:status', { role: 'kitchen', ok: false, message: err.message });
  }
}

module.exports = { autoKitchenPrint };
