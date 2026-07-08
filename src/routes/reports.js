const express = require('express');
const { loadOrders, saveOrders, loadReport, listReports, saveReport, loadSettings } = require('../utils/data');
const { yoneticiRequired } = require('../utils/auth');
const { broadcast } = require('../ws/websocket');

const router = express.Router();

// GET /api/reports
router.get('/', yoneticiRequired, (req, res) => {
  const reports = listReports();
  res.json({ reports });
});

// GET /api/reports/monthly/:year/:month
router.get('/monthly/:year/:month', yoneticiRequired, (req, res) => {
  const { year, month } = req.params;
  const prefix = `${year}-${month.padStart(2, '0')}`;

  const allReports = listReports();
  const monthlyReports = allReports.filter(d => d.startsWith(prefix));

  let totalRevenue = 0;
  let totalOrders = 0;
  let totalItems = 0;
  const dailyData = [];
  const productMap = {};

  for (const date of monthlyReports) {
    const report = loadReport(date);
    if (!report) continue;

    totalRevenue += report.summary?.totalRevenue || 0;
    totalOrders += report.summary?.totalOrders || 0;
    totalItems += report.summary?.totalItems || 0;

    dailyData.push({
      date,
      revenue: report.summary?.totalRevenue || 0,
      orders: report.summary?.totalOrders || 0
    });

    // Urun bazli toplama
    if (report.byProduct) {
      for (const p of report.byProduct) {
        if (!productMap[p.id]) {
          productMap[p.id] = { ...p, qty: 0, revenue: 0 };
        }
        productMap[p.id].qty += p.qty;
        productMap[p.id].revenue += p.revenue;
      }
    }
  }

  const topProducts = Object.values(productMap)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 20);

  res.json({
    year: parseInt(year),
    month: parseInt(month),
    totalRevenue,
    totalOrders,
    totalItems,
    avgOrderValue: totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0,
    dailyData,
    topProducts
  });
});

// GET /api/reports/range?from=YYYY-MM-DD&to=YYYY-MM-DD
//   Aralikta kaydedilmis gunluk (Z) raporlari toplar. /:date'ten ONCE tanimli.
router.get('/range', yoneticiRequired, (req, res) => {
  const from = String(req.query.from || '').slice(0, 10);
  const to = String(req.query.to || '').slice(0, 10);
  if (!from || !to) return res.status(400).json({ error: 'from ve to (YYYY-MM-DD) gerekli' });

  const dates = listReports().filter(d => d >= from && d <= to).sort();

  let totalRevenue = 0, totalOrders = 0, totalItems = 0;
  const dailyData = [];
  const productMap = {};
  const channelMap = {};
  const paymentMap = {};

  for (const date of dates) {
    const report = loadReport(date);
    if (!report) continue;
    const s = report.summary || {};
    totalRevenue += s.totalRevenue || 0;
    totalOrders += s.totalOrders || 0;
    totalItems += s.totalItems || 0;
    dailyData.push({ date, revenue: s.totalRevenue || 0, orders: s.totalOrders || 0 });

    for (const p of (report.byProduct || [])) {
      if (!productMap[p.id]) productMap[p.id] = { id: p.id, name: p.name, qty: 0, revenue: 0 };
      productMap[p.id].qty += p.qty || 0;
      productMap[p.id].revenue += p.revenue || 0;
    }
    for (const ch of (report.byChannel || Object.values(s.byChannel || {}))) {
      const key = ch.channel || 'masa';
      if (!channelMap[key]) channelMap[key] = { channel: key, orders: 0, revenue: 0, items: 0 };
      channelMap[key].orders += ch.orders || 0;
      channelMap[key].revenue += ch.revenue || 0;
      channelMap[key].items += ch.items || 0;
    }
    for (const [m, v] of Object.entries(s.byPayment || {})) {
      paymentMap[m] = (paymentMap[m] || 0) + (v || 0);
    }
  }

  const topProducts = Object.values(productMap).sort((a, b) => b.revenue - a.revenue).slice(0, 20);

  res.json({
    from, to,
    days: dates.length,
    totalRevenue, totalOrders, totalItems,
    avgOrderValue: totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0,
    dailyData,
    topProducts,
    byChannel: Object.values(channelMap).sort((a, b) => b.revenue - a.revenue),
    byPayment: paymentMap,
  });
});

// POST /api/reports/close-day  (Z raporu — DIKKAT: /:date'ten ONCE tanimli olmali
// yoksa Express :date='close-day' olarak yakalar)
// Bugune ait kapanmis adisyonlardan ozet rapor olustur ve data/reports/<bugun>.json
// olarak kaydet. Acik adisyonlar dahil edilmez (kullanici onceden kapatmali).
// Aynı gun icin tekrar cagrilirsa raporu uzeri yazilir.
router.post('/close-day', yoneticiRequired, (req, res) => {
  try {
    const ordersData = loadOrders();
    const allOrders = Array.isArray(ordersData) ? ordersData : (ordersData.orders || []);
    const now = new Date();
    const today = now.toISOString().slice(0, 10); // YYYY-MM-DD

    // Bugun kapanmis adisyonlari sec (closedAt bugune denk geliyor mu)
    const closedToday = allOrders.filter(o => {
      if (o.status !== 'closed' || !o.closedAt) return false;
      return o.closedAt.slice(0, 10) === today;
    });

    if (closedToday.length === 0) {
      // Hicbir kapanmis adisyon yoksa bos rapor olusturma — kullanicıyı bilgilendir
      return res.status(400).json({
        error: 'Bugun kapanmis adisyon yok. Once tum acik adisyonlari kapatin.'
      });
    }

    // Toplam ciro, urun ve byProduct
    let totalRevenue = 0;
    let totalItems = 0;
    const productMap = {};
    const hourMap = {};
    const paymentMap = {};
    const channelMap = {};

    for (const o of closedToday) {
      totalRevenue += o.total || 0;

      const channel = o.source || 'masa';
      if (!channelMap[channel]) channelMap[channel] = { channel, orders: 0, revenue: 0, items: 0 };
      channelMap[channel].orders += 1;
      channelMap[channel].revenue += o.total || 0;
      const closedDate = new Date(o.closedAt);
      const hourKey = String(closedDate.getHours()).padStart(2, '0') + ':00';

      if (!hourMap[hourKey]) hourMap[hourKey] = { hour: hourKey, orders: 0, revenue: 0, items: 0 };
      hourMap[hourKey].orders += 1;
      hourMap[hourKey].revenue += o.total || 0;

      if (o.paymentMethod) {
        paymentMap[o.paymentMethod] = (paymentMap[o.paymentMethod] || 0) + (o.total || 0);
      }

      for (const item of (o.items || [])) {
        if (item.status === 'cancelled') continue;
        const qty = item.qty || 0;
        const revenue = item.lineTotal || 0;
        totalItems += qty;
        hourMap[hourKey].items += qty;
        channelMap[channel].items += qty;
        if (!productMap[item.itemId]) {
          productMap[item.itemId] = {
            id: item.itemId,
            name: item.name,
            qty: 0,
            revenue: 0
          };
        }
        productMap[item.itemId].qty += qty;
        productMap[item.itemId].revenue += revenue;
      }
    }

    // En cok satan ürünleri sirala
    const byProduct = Object.values(productMap)
      .sort((a, b) => b.revenue - a.revenue);

    const byHour = Object.values(hourMap)
      .sort((a, b) => a.hour.localeCompare(b.hour));

    // Yogun saat
    let peakHour = '';
    let peakHourRevenue = 0;
    for (const h of byHour) {
      if (h.revenue > peakHourRevenue) {
        peakHourRevenue = h.revenue;
        peakHour = h.hour;
      }
    }

    const totalOrders = closedToday.length;
    const report = {
      date: today,
      openedAt: closedToday[0].openedAt,
      closedAt: now.toISOString(),
      summary: {
        totalRevenue,
        totalOrders,
        totalItems,
        avgOrderValue: totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0,
        avgItemsPerOrder: totalOrders > 0 ? Math.round((totalItems / totalOrders) * 10) / 10 : 0,
        peakHour,
        peakHourRevenue,
        byPayment: paymentMap,
        byChannel: channelMap,
      },
      byProduct,
      byHour,
      byChannel: Object.values(channelMap),
      orders: closedToday,
    };

    saveReport(today, report);

    // WS broadcast — tabletler "gun kapatildi" mesajini alsin
    try { broadcast({ type: 'day:closed', data: { date: today } }); } catch (_) {}

    res.json({ success: true, date: today, summary: report.summary });
  } catch (err) {
    console.error('[reports/close-day]', err);
    res.status(500).json({ error: err.message || 'Z raporu olusturulamadi' });
  }
});

// GET /api/reports/:date  (close-day'den SONRA tanimli — onceden eslesmesin)
router.get('/:date', yoneticiRequired, (req, res) => {
  const report = loadReport(req.params.date);
  if (!report) {
    return res.status(404).json({ error: 'Rapor bulunamadi' });
  }
  res.json(report);
});

module.exports = router;
