/* Yonetici gelismis rapor sayfasi (2.1) — offline-guvenli, harici lib yok.
   Bugun/Aralik: JSON rapor + /api/orders (TL). Menu: /api/alkyone/analytics (kurus). */

// ---- yardimcilar ----
async function jget(p) {
  const r = await fetch(p, { headers: { 'Accept': 'application/json' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
const tl = n => Number(n || 0).toLocaleString('tr-TR') + ' TL';
const fmtK = k => (Number(k || 0) / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' TL';
const pct = x => (Number(x || 0) * 100).toFixed(1) + '%';
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function localYmd(d) { const x = new Date(d); if (isNaN(x)) return ''; const m = String(x.getMonth() + 1).padStart(2, '0'), dd = String(x.getDate()).padStart(2, '0'); return `${x.getFullYear()}-${m}-${dd}`; }
const CHANNEL_LABELS = { masa: 'Salon', eve: 'Eve Teslim', trendyol: 'Trendyol', yemeksepeti: 'Yemeksepeti', getir: 'Getir Yemek' };
const PAY_LABELS = { nakit: 'Nakit', kart: 'Kart', havale: 'Havale/EFT', eve: 'Eve Teslim', trendyol: 'Trendyol', yemeksepeti: 'Yemeksepeti', getir: 'Getir' };
const QNAME = { star: 'Yildiz ⭐', plowhorse: 'Is Ati 🐴', puzzle: 'Bulmaca 🧩', dog: 'Kopek 🐕' };

function kpis(id, arr) {
  document.getElementById(id).innerHTML = arr.map(([l, v]) => `<div class="kpi"><div class="v">${v}</div><div class="l">${esc(l)}</div></div>`).join('');
}

// CSS-bar satir listesi (urun/kanal/odeme)
function renderRows(id, items, { name, qty, rev }) {
  const el = document.getElementById(id);
  if (!items || !items.length) { el.innerHTML = '<p class="empty">Veri yok</p>'; return; }
  const max = Math.max(1, ...items.map(rev));
  el.innerHTML = items.map((it, i) => {
    const w = (rev(it) / max * 100).toFixed(0);
    return `<div class="row">
      <div class="rank ${i < 3 ? 'top3' : ''}">${i + 1}</div>
      <div class="rname">${esc(name(it))}</div>
      <div class="rqty">${esc(qty(it))}</div>
      <div class="rrev">${tl(rev(it))}</div>
      <div class="rbar"><i style="width:${w}%"></i></div>
    </div>`;
  }).join('');
}

// Basit canvas bar grafik (devicePixelRatio bilincli)
function drawBars(canvasId, labels, values) {
  const cv = document.getElementById(canvasId);
  if (!cv) return;
  const dpr = window.devicePixelRatio || 1;
  const cssW = cv.clientWidth || cv.parentElement.clientWidth || 300;
  const cssH = cv.clientHeight || 170;
  cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
  const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);
  const padL = 6, padR = 6, padT = 10, padB = 22;
  const w = cssW - padL - padR, h = cssH - padT - padB;
  const max = Math.max(1, ...values);
  const n = values.length || 1;
  const bw = w / n * 0.68, gap = w / n;
  // eksen zemin cizgisi
  ctx.strokeStyle = '#2a2a45'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(padL, padT + h); ctx.lineTo(padL + w, padT + h); ctx.stroke();
  const grad = ctx.createLinearGradient(0, padT, 0, padT + h);
  grad.addColorStop(0, '#7C5CFF'); grad.addColorStop(1, '#5CE0D8');
  ctx.fillStyle = '#8a8aa5'; ctx.font = '9px system-ui'; ctx.textAlign = 'center';
  values.forEach((v, i) => {
    const bh = (v / max) * h;
    const x = padL + i * gap + (gap - bw) / 2;
    const y = padT + h - bh;
    ctx.fillStyle = grad; roundRect(ctx, x, y, bw, bh, 3); ctx.fill();
    if (n <= 16 || i % 2 === 0) { ctx.fillStyle = '#8a8aa5'; ctx.fillText(String(labels[i]), x + bw / 2, cssH - 6); }
  });
}
function roundRect(ctx, x, y, w, h, r) {
  if (h < 1) h = 1; r = Math.min(r, w / 2, h);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ---- gorunum gecisi ----
let menuLoaded = false, rangeLoaded = false;
function switchView(v) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.v === v));
  document.querySelectorAll('.view').forEach(el => el.classList.toggle('active', el.id === 'view-' + v));
  if (v === 'menu' && !menuLoaded) loadMenu();
  if (v === 'range' && !rangeLoaded) loadRange();
}

// ---- BUGUN (canli) ----
async function loadToday() {
  let data;
  try { data = await jget('/api/orders'); } catch (e) { return; }
  const orders = (data.orders || data || []);
  const today = localYmd(new Date());
  const todays = orders.filter(o => localYmd(o.closedAt || o.openedAt) === today);
  const closed = todays.filter(o => o.status === 'closed');

  let revenue = 0, items = 0;
  const hourRev = {}; const prod = {}; const chan = {};
  for (const o of closed) {
    revenue += o.total || 0;
    const hr = new Date(o.closedAt || o.openedAt).getHours();
    hourRev[hr] = (hourRev[hr] || 0) + (o.total || 0);
    const ch = o.source || 'masa';
    if (!chan[ch]) chan[ch] = { channel: ch, orders: 0, revenue: 0 };
    chan[ch].orders++; chan[ch].revenue += o.total || 0;
    for (const it of (o.items || [])) {
      if (it.status !== 'active') continue;
      items += it.qty || 0;
      const k = it.itemId || it.name;
      if (!prod[k]) prod[k] = { name: it.name, qty: 0, revenue: 0 };
      prod[k].qty += it.qty || 0; prod[k].revenue += it.lineTotal || 0;
    }
  }
  kpis('today-kpis', [
    ['Ciro', tl(revenue)], ['Siparis', closed.length], ['Urun', items],
    ['Ort. Adisyon', tl(closed.length ? Math.round(revenue / closed.length) : 0)],
  ]);
  const labels = [], vals = [];
  for (let h = 8; h <= 23; h++) { labels.push(h); vals.push(hourRev[h] || 0); }
  drawBars('today-hourly', labels, vals);
  renderRows('today-channels', Object.values(chan).sort((a, b) => b.revenue - a.revenue),
    { name: c => CHANNEL_LABELS[c.channel] || c.channel, qty: c => c.orders + ' sip.', rev: c => c.revenue });
  renderRows('today-products', Object.values(prod).sort((a, b) => b.revenue - a.revenue).slice(0, 20),
    { name: p => p.name, qty: p => p.qty + 'x', rev: p => p.revenue });
}

// ---- ARALIK ----
async function loadRange() {
  rangeLoaded = true;
  const from = document.getElementById('r-from').value;
  const to = document.getElementById('r-to').value;
  if (!from || !to) return;
  let d;
  try { d = await jget(`/api/reports/range?from=${from}&to=${to}`); } catch (e) { return; }
  kpis('range-kpis', [
    ['Ciro', tl(d.totalRevenue)], ['Siparis', d.totalOrders], ['Urun', d.totalItems],
    ['Ort. Adisyon', tl(d.avgOrderValue)], ['Gun', d.days],
  ]);
  const daily = d.dailyData || [];
  if (daily.length) {
    drawBars('range-daily', daily.map(x => x.date.slice(5)), daily.map(x => x.revenue));
  } else {
    drawBars('range-daily', ['—'], [0]);
  }
  renderRows('range-channels', d.byChannel || [],
    { name: c => CHANNEL_LABELS[c.channel] || c.channel, qty: c => c.orders + ' sip.', rev: c => c.revenue });
  const pays = Object.entries(d.byPayment || {}).map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v);
  renderRows('range-payments', pays,
    { name: p => PAY_LABELS[p.k] || p.k, qty: () => '', rev: p => p.v });
  renderRows('range-products', d.topProducts || [],
    { name: p => p.name, qty: p => p.qty + 'x', rev: p => p.revenue });
}

// ---- MENU (analitik, kurus) ----
async function loadMenu() {
  menuLoaded = true;
  const days = document.getElementById('m-days').value;
  let ov, me;
  try {
    [ov, me] = await Promise.all([
      jget('/api/alkyone/analytics/overview?days=' + days),
      jget('/api/alkyone/analytics/menu-engineering?days=' + days),
    ]);
  } catch (e) {
    document.getElementById('menu-note').innerHTML = 'Menu analitigi bu kurulumda kapali.';
    document.getElementById('menu-kpis').innerHTML = '';
    document.getElementById('menu-matrix').innerHTML = '';
    document.querySelector('#menu-sales tbody').innerHTML = '<tr><td colspan="6" class="empty">—</td></tr>';
    return;
  }
  kpis('menu-kpis', [
    ['Siparis', ov.orders], ['Ciro', fmtK(ov.revenue)], ['Kar', fmtK(ov.profit)],
    ['Ort. Adisyon', fmtK(ov.avgTicket)], ['Maliyetli urun', ov.costCoverage],
  ]);
  const t = document.querySelector('#menu-sales tbody');
  if (!me.items || !me.items.length) {
    document.getElementById('menu-note').textContent = 'Henuz veri yok — siparisler kapandikca dolar.';
    document.getElementById('menu-matrix').innerHTML = '';
    t.innerHTML = '<tr><td colspan="6" class="empty">Veri yok</td></tr>';
    return;
  }
  document.getElementById('menu-note').textContent =
    `Ort. adet ${me.avgQty.toFixed(1)} · ort. marj ${pct(me.avgMargin)} (esik). Maliyet girilmemis urun karsiz gorunur.`;
  t.innerHTML = me.items.map(i => `<tr>
    <td>${esc(i.name)}</td><td class="num">${i.qty}</td><td class="num">${fmtK(i.revenue)}</td>
    <td class="num">${fmtK(i.profit)}</td><td class="num">${pct(i.margin)}</td>
    <td><span class="q ${i.quadrant}">${QNAME[i.quadrant].split(' ')[0]}</span></td></tr>`).join('');
  const groups = { star: [], plowhorse: [], puzzle: [], dog: [] };
  me.items.forEach(i => groups[i.quadrant].push(i.name));
  document.getElementById('menu-matrix').innerHTML = ['star', 'puzzle', 'plowhorse', 'dog'].map(q => `
    <div class="quad"><h3><span class="q ${q}">${QNAME[q]}</span></h3>
    <ul>${groups[q].slice(0, 8).map(n => `<li>${esc(n)}</li>`).join('') || '<li class="muted">—</li>'}</ul></div>`).join('');
}

// ---- init ----
(function init() {
  const now = new Date();
  const from = new Date(now.getTime() - 6 * 86400000);
  document.getElementById('r-to').value = localYmd(now);
  document.getElementById('r-from').value = localYmd(from);
  loadToday();
})();
