// ===== SAKURA RAPORLAR =====

// ----- Global JS hata yakalayici -----
window.addEventListener('error', (ev) => {
  try {
    const msg = ev.message || (ev.error && ev.error.message) || 'Bilinmeyen hata';
    const where = ev.filename ? `${String(ev.filename).split('/').pop()}:${ev.lineno}` : '';
    console.error('[rapor] window error:', msg, where, ev.error);
  } catch (_) {}
});
window.addEventListener('unhandledrejection', (ev) => {
  try { console.error('[rapor] unhandled rejection:', ev.reason); } catch (_) {}
});

// ----- Null-safe DOM yardimcilari -----
function $$id(id) { return document.getElementById(id); }
function $$txt(id, t) { const e = $$id(id); if (e) e.textContent = t; }
function $$add(id, c) { const e = $$id(id); if (e && e.classList) e.classList.add(c); }
function $$rm(id, c)  { const e = $$id(id); if (e && e.classList) e.classList.remove(c); }
function $$tg(id, c, f) { const e = $$id(id); if (e && e.classList) e.classList.toggle(c, f); }

let token = null;
let reports = [];
let currentMonth = new Date().getMonth() + 1;
let currentYear = new Date().getFullYear();
let selectedYear = currentYear;
let chartHourly = null;
let chartMonthly = null;
let chartYearly = null;

const MONTHS = ['', 'Ocak','Subat','Mart','Nisan','Mayis','Haziran','Temmuz','Agustos','Eylul','Ekim','Kasim','Aralik'];

// ===== PIN =====
let pv = '';
function pi(d) { if (pv.length >= 4) return; pv += d; ud(); if (pv.length === 4) setTimeout(ps, 200); }
function pc() { pv = ''; ud(); $$txt('pin-err', ''); }
function ud() {
  document.querySelectorAll('#pin-dots span').forEach((s, i) => {
    if (s && s.classList) s.classList.toggle('f', i < pv.length);
  });
}

async function ps() {
  try {
    const res = await api('POST', '/api/auth/login', { pin: pv });
    if (res.role !== 'yonetici') { $$txt('pin-err', 'Yonetici PIN gerekli'); pc(); return; }
    token = res.token;
    $$add('pin-screen', 'hidden');
    $$rm('main', 'hidden');
    await loadToday();
    loadReportList();
  } catch (e) { $$txt('pin-err', e.message); pc(); }
}

// ===== VIEWS =====
function switchView(v) {
  document.querySelectorAll('.nav').forEach(n => {
    if (n && n.classList) n.classList.toggle('active', n.dataset.v === v);
  });
  ['today','history','monthly','yearly'].forEach(id => {
    $$tg('view-' + id, 'hidden', id !== v);
  });
  if (v === 'today') loadToday();
  if (v === 'history') loadReportList();
  if (v === 'monthly') loadMonthly();
  if (v === 'yearly') loadYearly();
}

// ===== TODAY =====
async function loadToday() {
  // Bugunun verisi: aktif siparislerden canli hesapla
  try {
    const ordersData = await api('GET', '/api/orders');
    const orders = ordersData.orders || [];

    const closed = orders.filter(o => o.status === 'closed');
    const all = orders.filter(o => o.status === 'open' || o.status === 'closed');

    const totalRevenue = all.reduce((s, o) => s + o.total, 0);
    const totalItems = all.reduce((s, o) => s + o.items.filter(i => i.status === 'active').length, 0);

    // Saatlik dagilim
    const hourMap = {};
    for (let h = 8; h <= 23; h++) hourMap[h] = { orders: 0, revenue: 0 };
    for (const o of all) {
      const h = new Date(o.openedAt).getHours();
      if (!hourMap[h]) hourMap[h] = { orders: 0, revenue: 0 };
      hourMap[h].orders++;
      hourMap[h].revenue += o.total;
    }

    // Pik saat
    let peakHour = '-';
    let peakRev = 0;
    for (const [h, d] of Object.entries(hourMap)) {
      if (d.revenue > peakRev) { peakRev = d.revenue; peakHour = h + ':00'; }
    }

    // Urun bazli
    const prodMap = {};
    for (const o of all) {
      for (const item of o.items.filter(i => i.status === 'active')) {
        if (!prodMap[item.itemId]) prodMap[item.itemId] = { name: item.name, qty: 0, revenue: 0 };
        prodMap[item.itemId].qty += item.qty;
        prodMap[item.itemId].revenue += item.lineTotal;
      }
    }

    // Stats
    document.getElementById('s-revenue').textContent = totalRevenue.toLocaleString('tr-TR') + ' TL';
    document.getElementById('s-orders').textContent = all.length;
    document.getElementById('s-items').textContent = totalItems;
    document.getElementById('s-peak').textContent = peakHour;

    // Saatlik grafik
    const hours = Object.keys(hourMap).sort((a, b) => a - b);
    const revenues = hours.map(h => hourMap[h].revenue);
    renderHourlyChart(hours.map(h => h + ':00'), revenues);

    // Kanal dagilimi
    const chMap = {};
    for (const o of all) {
      const ch = o.source || 'masa';
      if (!chMap[ch]) chMap[ch] = { channel: ch, orders: 0, revenue: 0, items: 0 };
      chMap[ch].orders++;
      chMap[ch].revenue += o.total;
      chMap[ch].items += o.items.filter(i => i.status === 'active').length;
    }
    renderChannels('today-channels', Object.values(chMap));

    // Top 10
    const topProducts = Object.values(prodMap).sort((a, b) => b.revenue - a.revenue).slice(0, 10);
    renderProducts('top-products', topProducts);

    // Aktivite
    renderActivity(all);

  } catch (e) {
    console.error(e);
  }
}

function renderHourlyChart(labels, data) {
  const ctx = document.getElementById('chart-hourly');
  if (chartHourly) chartHourly.destroy();
  chartHourly = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Ciro (TL)',
        data,
        backgroundColor: 'rgba(232, 180, 184, 0.6)',
        borderColor: '#e8b4b8',
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#8888a0', font: { size: 10 } }, grid: { color: '#2a2a45' } },
        y: { ticks: { color: '#8888a0', font: { size: 10 } }, grid: { color: '#2a2a45' } }
      }
    }
  });
}

function renderProducts(containerId, products) {
  const el = document.getElementById(containerId);
  if (products.length === 0) { el.innerHTML = '<p class="muted">Veri yok</p>'; return; }
  const maxRev = products[0].revenue;
  el.innerHTML = products.map((p, i) => `
    <div class="product-row">
      <div class="product-rank ${i < 3 ? 'top3' : ''}">${i + 1}</div>
      <div class="product-name">${p.name}</div>
      <div class="product-bar-wrap"><div class="product-bar" style="width:${(p.revenue / maxRev * 100).toFixed(0)}%"></div></div>
      <div class="product-qty">${p.qty}x</div>
      <div class="product-rev">${p.revenue.toLocaleString('tr-TR')} TL</div>
    </div>
  `).join('');
}

const CHANNEL_LABELS = { masa: 'Salon', trendyol: 'Trendyol', yemeksepeti: 'Yemeksepeti', getir: 'Getir Yemek' };

function renderChannels(containerId, channels) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!channels || channels.length === 0) { el.innerHTML = '<p class="muted">Veri yok</p>'; return; }
  const sorted = [...channels].sort((a, b) => b.revenue - a.revenue);
  const maxRev = sorted[0].revenue || 1;
  el.innerHTML = sorted.map((c, i) => `
    <div class="product-row">
      <div class="product-rank ${i < 3 ? 'top3' : ''}">${i + 1}</div>
      <div class="product-name">${CHANNEL_LABELS[c.channel] || c.channel}</div>
      <div class="product-bar-wrap"><div class="product-bar" style="width:${(c.revenue / maxRev * 100).toFixed(0)}%"></div></div>
      <div class="product-qty">${c.orders} sip.</div>
      <div class="product-rev">${(c.revenue || 0).toLocaleString('tr-TR')} TL</div>
    </div>
  `).join('');
}

function renderActivity(orders) {
  const el = document.getElementById('activity-feed');
  const sorted = [...orders].sort((a, b) => new Date(b.openedAt) - new Date(a.openedAt)).slice(0, 15);
  if (sorted.length === 0) { el.innerHTML = '<p class="muted">Bugun henuz veri yok</p>'; return; }
  el.innerHTML = sorted.map(o => {
    const t = new Date(o.openedAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    const items = o.items.filter(i => i.status === 'active').length;
    const st = o.status === 'closed' ? 'Kapatildi' : 'Acik';
    return `<div class="activity-item">
      <span class="activity-time">${t}</span> Masa ${o.tableId} - ${items} urun - ${o.total} TL (${st})
    </div>`;
  }).join('');
}

// ===== HISTORY =====
async function loadReportList() {
  try {
    const res = await api('GET', '/api/reports');
    reports = res.reports || [];
    const list = document.getElementById('report-list');
    if (reports.length === 0) {
      list.innerHTML = '<p class="muted">Henuz rapor yok</p>';
      return;
    }
    list.innerHTML = reports.map(d =>
      `<button class="report-date-btn" onclick="loadHistoryDay('${d}')">${formatDate(d)}</button>`
    ).join('');
  } catch (e) { console.error(e); }
}

async function loadHistoryDay(date) {
  document.querySelectorAll('.report-date-btn').forEach(b => {
    if (b && b.classList) b.classList.toggle('active', b.textContent === formatDate(date));
  });
  try {
    const report = await api('GET', `/api/reports/${date}`);
    const el = document.getElementById('history-detail');
    const s = report.summary || {};

    el.innerHTML = `
      <div class="stats-row">
        <div class="stat-card"><div class="stat-label">Ciro</div><div class="stat-value">${(s.totalRevenue || 0).toLocaleString('tr-TR')} TL</div></div>
        <div class="stat-card"><div class="stat-label">Adisyon</div><div class="stat-value">${s.totalOrders || 0}</div></div>
        <div class="stat-card"><div class="stat-label">Urun</div><div class="stat-value">${s.totalItems || 0}</div></div>
        <div class="stat-card"><div class="stat-label">Ort. Adisyon</div><div class="stat-value">${s.avgOrderValue || 0} TL</div></div>
      </div>
      <div class="charts-row">
        <div class="chart-box wide"><h3>Saatlik Dagilim</h3><canvas id="chart-history-hourly"></canvas></div>
      </div>
      <div class="charts-row">
        <div class="chart-box wide"><h3>Kanal Dagilimi</h3><div class="top-products" id="history-channels"></div></div>
      </div>
      <div class="charts-row">
        <div class="chart-box wide"><h3>En Cok Satanlar</h3><div class="top-products" id="history-products"></div></div>
      </div>
    `;

    renderChannels('history-channels', report.byChannel || []);

    // Saatlik grafik
    if (report.byHour && report.byHour.length > 0) {
      const labels = report.byHour.map(h => h.hour);
      const data = report.byHour.map(h => h.revenue);
      const ctx = document.getElementById('chart-history-hourly');
      new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: [{ label: 'Ciro', data, backgroundColor: 'rgba(232,180,184,0.6)', borderColor: '#e8b4b8', borderWidth: 1, borderRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#8888a0' }, grid: { color: '#2a2a45' } }, y: { ticks: { color: '#8888a0' }, grid: { color: '#2a2a45' } } } }
      });
    }

    // Urunler
    renderProducts('history-products', (report.byProduct || []).slice(0, 20));

  } catch (e) { document.getElementById('history-detail').innerHTML = `<p class="muted">Rapor yuklenemedi: ${e.message}</p>`; }
}

// ===== MONTHLY =====
async function loadMonthly() {
  document.getElementById('month-label').textContent = MONTHS[currentMonth] + ' ' + currentYear;
  try {
    const res = await api('GET', `/api/reports/monthly/${currentYear}/${currentMonth}`);
    const el = document.getElementById('monthly-stats');
    el.innerHTML = `
      <div class="stat-card"><div class="stat-label">Toplam Ciro</div><div class="stat-value">${(res.totalRevenue || 0).toLocaleString('tr-TR')} TL</div></div>
      <div class="stat-card"><div class="stat-label">Adisyon</div><div class="stat-value">${res.totalOrders || 0}</div></div>
      <div class="stat-card"><div class="stat-label">Urun</div><div class="stat-value">${res.totalItems || 0}</div></div>
      <div class="stat-card"><div class="stat-label">Ort. Adisyon</div><div class="stat-value">${res.avgOrderValue || 0} TL</div></div>
    `;

    // Gunluk ciro grafigi
    if (res.dailyData && res.dailyData.length > 0) {
      const labels = res.dailyData.map(d => d.date.slice(8)); // gun
      const data = res.dailyData.map(d => d.revenue);
      const ctx = document.getElementById('chart-monthly');
      if (chartMonthly) chartMonthly.destroy();
      chartMonthly = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'Ciro (TL)',
            data,
            borderColor: '#e8b4b8',
            backgroundColor: 'rgba(232,180,184,0.15)',
            fill: true,
            tension: 0.3,
            pointBackgroundColor: '#e8b4b8',
            pointRadius: 4
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: '#8888a0' }, grid: { color: '#2a2a45' } },
            y: { ticks: { color: '#8888a0' }, grid: { color: '#2a2a45' } }
          }
        }
      });
    }

    // Top 20
    renderProducts('monthly-products', (res.topProducts || []).slice(0, 20));

  } catch (e) { console.error(e); }
}

function changeMonth(delta) {
  currentMonth += delta;
  if (currentMonth > 12) { currentMonth = 1; currentYear++; }
  if (currentMonth < 1) { currentMonth = 12; currentYear--; }
  loadMonthly();
}

// ===== YEARLY =====
async function loadYearly() {
  document.getElementById('year-label').textContent = selectedYear;
  const monthlyData = [];

  for (let m = 1; m <= 12; m++) {
    try {
      const res = await api('GET', `/api/reports/monthly/${selectedYear}/${m}`);
      monthlyData.push({ month: m, revenue: res.totalRevenue || 0 });
    } catch (e) {
      monthlyData.push({ month: m, revenue: 0 });
    }
  }

  const labels = monthlyData.map(d => MONTHS[d.month].slice(0, 3));
  const data = monthlyData.map(d => d.revenue);

  const ctx = document.getElementById('chart-yearly');
  if (chartYearly) chartYearly.destroy();
  chartYearly = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Ciro (TL)',
        data,
        backgroundColor: 'rgba(232,180,184,0.6)',
        borderColor: '#e8b4b8',
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#8888a0' }, grid: { color: '#2a2a45' } },
        y: { ticks: { color: '#8888a0' }, grid: { color: '#2a2a45' } }
      }
    }
  });
}

function changeYear(delta) {
  selectedYear += delta;
  loadYearly();
}

// ===== UTILS =====
function formatDate(d) {
  const [y, m, day] = d.split('-');
  return `${parseInt(day)} ${MONTHS[parseInt(m)]} ${y}`;
}

async function api(method, url, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) { const e = new Error(data.error || 'Hata'); e.status = res.status; throw e; }
  return data;
}
