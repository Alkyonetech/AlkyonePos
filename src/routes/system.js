const express = require('express');
const fs = require('fs');
const path = require('path');
const { loadSettings, loadOrders, saveOrders, saveReport } = require('../utils/data');
const { yoneticiRequired } = require('../utils/auth');
const { broadcast } = require('../ws/websocket');

const router = express.Router();

const UPDATES_DIR = process.env.SAKURA_UPDATES_DIR
  || path.join(__dirname, '../../updates');

// Calisan kodun gercek surumu — tek dogruluk kaynagi. settings.appVersion
// eskiyebildigi icin (kurulumdan sonra guncellenmez) her yerde bunu kullan.
const PKG_VERSION = (() => {
  try { return require('../../package.json').version; } catch (_) { return '0.0.0'; }
})();

function readLatestManifest() {
  try {
    const p = path.join(UPDATES_DIR, 'latest.json');
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) { return null; }
}

// GET /api/health
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// GET /api/time — sunucu otoritesi (master plan §6.2)
// Frontend bu degerle kendi Date.now() ile karsilastirip offset hesaplar
router.get('/time', (req, res) => {
  res.json({ now: Date.now(), iso: new Date().toISOString() });
});

// GET /api/version
// APK surumlerinde oncelik: updates/latest.json (canli), sonra settings.json (statik fallback)
router.get('/version', (req, res) => {
  const settings = loadSettings();
  const manifest = readLatestManifest();
  const apkVersion =
    manifest?.apk?.version
    || settings.apkVersion
    || PKG_VERSION;
  const minApkVersion =
    manifest?.apk?.minApkVersion
    || settings.minApkVersion
    || '0.0.0';
  // POS (EXE/sunucu) surumu: calisan kod = PKG_VERSION. manifest.pos.version
  // GitHub'daki en son yayin — banner "guncelleme var mi" karsilastirmasi icin.
  const latestPosVersion = manifest?.pos?.version || null;
  res.json({
    appVersion: PKG_VERSION,
    apkVersion,
    minApkVersion,
    latestPosVersion,
    posUpdateAvailable: !!(latestPosVersion && cmpVer(latestPosVersion, PKG_VERSION) > 0),
  });
});

// Basit semver karsilastirmasi (a>b -> 1, a<b -> -1, esit -> 0)
function cmpVer(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n) || 0);
  const pb = String(b).split('.').map(n => parseInt(n) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

// POST /api/day/close - Gunu kapat
router.post('/day/close', yoneticiRequired, (req, res) => {
  const settings = loadSettings();
  const data = loadOrders();

  // Acik masa kontrolu
  const openOrders = data.orders.filter(o => o.status === 'open');
  if (openOrders.length > 0 && !req.body.force) {
    return res.status(400).json({
      error: `${openOrders.length} acik adisyon var. Once hesaplari kapatin veya force: true gonderin.`,
      openOrders: openOrders.map(o => ({ id: o.id, tableId: o.tableId, total: o.total }))
    });
  }

  // Bugunun tarihini hesapla (dayCloseHour'a gore)
  const now = new Date();
  const closeHour = settings.operations.dayCloseHour || 4;
  let reportDate;
  if (now.getHours() < closeHour) {
    // Gece yarisi ile closeHour arasi - dunku gun
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    reportDate = yesterday.toISOString().slice(0, 10);
  } else {
    reportDate = now.toISOString().slice(0, 10);
  }

  // Kapatilmis siparisleri rapora cevir
  const closedOrders = data.orders.filter(o => o.status === 'closed');

  if (closedOrders.length === 0 && openOrders.length === 0) {
    return res.status(400).json({ error: 'Kapatilacak adisyon yok' });
  }

  // Rapor olustur
  const report = generateDailyReport(reportDate, closedOrders, now);

  // Raporu kaydet
  saveReport(reportDate, report);

  // Orders.json'u sifirla (acik olanlar kalir)
  const remainingOrders = data.orders.filter(o => o.status === 'open');
  saveOrders({ orders: remainingOrders });

  broadcast('day:closed', { date: reportDate, summary: report.summary });

  res.json({ success: true, date: reportDate, summary: report.summary });
});

/**
 * Gunluk rapor olustur
 */
function generateDailyReport(date, orders, closeTime) {
  const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0);
  const totalItems = orders.reduce((sum, o) => sum + o.items.filter(i => i.status === 'active').length, 0);

  // Urun bazli
  const productMap = {};
  const categoryMap = {};
  const hourMap = {};

  for (const order of orders) {
    // Saatlik
    const hour = new Date(order.openedAt).getHours();
    const hourKey = `${String(hour).padStart(2, '0')}:00`;
    if (!hourMap[hourKey]) {
      hourMap[hourKey] = { hour: hourKey, orders: 0, revenue: 0, items: 0 };
    }
    hourMap[hourKey].orders += 1;
    hourMap[hourKey].revenue += order.total;

    for (const item of order.items.filter(i => i.status === 'active')) {
      // Urun
      if (!productMap[item.itemId]) {
        productMap[item.itemId] = { id: item.itemId, name: item.name, qty: 0, revenue: 0 };
      }
      productMap[item.itemId].qty += item.qty;
      productMap[item.itemId].revenue += item.lineTotal;

      hourMap[hourKey].items += item.qty;
    }
  }

  // Pik saat bul
  const hourEntries = Object.values(hourMap).sort((a, b) => b.revenue - a.revenue);
  const peakHour = hourEntries.length > 0 ? hourEntries[0].hour : null;

  return {
    date,
    openedAt: orders.length > 0 ? orders[0].openedAt : null,
    closedAt: closeTime.toISOString(),
    summary: {
      totalRevenue,
      totalOrders: orders.length,
      totalItems,
      avgOrderValue: orders.length > 0 ? Math.round(totalRevenue / orders.length) : 0,
      avgItemsPerOrder: orders.length > 0 ? parseFloat((totalItems / orders.length).toFixed(1)) : 0,
      peakHour,
      peakHourRevenue: peakHour ? hourMap[peakHour].revenue : 0
    },
    byProduct: Object.values(productMap).sort((a, b) => b.revenue - a.revenue),
    byHour: Object.values(hourMap).sort((a, b) => a.hour.localeCompare(b.hour)),
    orders
  };
}

module.exports = router;
