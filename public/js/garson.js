// ===== SAKURA GARSON - Mobile Frontend =====

// ----- Global JS hata yakalayici: WebView console'da gormek zor, ekrana toast at -----
window.addEventListener('error', (ev) => {
  try {
    const msg = ev.message || (ev.error && ev.error.message) || 'Bilinmeyen hata';
    const where = ev.filename ? `${ev.filename.split('/').pop()}:${ev.lineno}` : '';
    console.error('[garson] window error:', msg, where, ev.error);
    if (typeof toast === 'function') toast(`JS HATA: ${msg} ${where}`, 'error');
  } catch (_) {}
});
window.addEventListener('unhandledrejection', (ev) => {
  try {
    const r = ev.reason || {};
    const msg = r.message || String(r);
    console.error('[garson] unhandled rejection:', msg, r);
    if (typeof toast === 'function') toast(`Async hata: ${msg}`, 'error');
  } catch (_) {}
});

// ----- time-sync.js yuklenmediyse Date.now() fallback -----
if (typeof window.serverNow !== 'function') {
  window.serverNow = function () { return Date.now(); };
  window.serverDate = function () { return new Date(); };
}

// ----- Null-safe DOM yardimcilari -----
function $$id(id) { return document.getElementById(id); }
function $$txt(id, t) { const e = $$id(id); if (e) e.textContent = t; }
function $$html(id, h) { const e = $$id(id); if (e) e.innerHTML = h; }
function $$add(id, c) { const e = $$id(id); if (e) e.classList.add(c); }
function $$rm(id, c) { const e = $$id(id); if (e) e.classList.remove(c); }
function $$tg(id, c, f) { const e = $$id(id); if (e) e.classList.toggle(c, f); }

let token = localStorage.getItem('sakura_garson_token');
let userRole = localStorage.getItem('sakura_garson_role');
let tables = [];
let orders = [];
let menu = { categories: [] };
let ws = null;
let wsReconnectDelay = 1000;
let wsReconnectTimer = null;

// Siparis ekrani state
let currentTableId = null;
let currentOrder = null;
let selectedCatId = null;

// Modal state
let modalItem = { itemId: null, name: '', qty: 1, unitPrice: 0 };

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  if (token && userRole) {
    showMain();
  }
});

// ===== PIN =====
let pinVal = '';

function pinInput(d) {
  if (pinVal.length >= 4) return;
  pinVal += d;
  updateDots();
  if (pinVal.length === 4) setTimeout(pinSubmit, 200);
}

function pinClear() {
  pinVal = '';
  updateDots();
  $$txt('pin-error', '');
}

function updateDots() {
  document.querySelectorAll('#pin-display .dot').forEach((d, i) => {
    d.classList.toggle('filled', i < pinVal.length);
  });
}

async function pinSubmit() {
  if (pinVal.length !== 4) return;
  try {
    const res = await api('POST', '/api/auth/login', { pin: pinVal });
    token = res.token;
    userRole = res.role;
    localStorage.setItem('sakura_garson_token', token);
    localStorage.setItem('sakura_garson_role', res.role);
    showMain();
  } catch (e) {
    $$txt('pin-error', e.message || 'Gecersiz PIN');
    pinClear();
  }
}

function logout() {
  token = null;
  userRole = null;
  localStorage.removeItem('sakura_garson_token');
  localStorage.removeItem('sakura_garson_role');
  if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
  if (ws) {
    try { ws.onclose = null; ws.close(); } catch (_) {}
    ws = null;
  }
  show('pin-screen');
  hide('main-screen');
  hide('order-screen');
  pinClear();
}

// ===== SCREENS =====
function show(id) { $$rm(id, 'hidden'); }
function hide(id) { $$add(id, 'hidden'); }

async function showMain() {
  hide('pin-screen');
  show('main-screen');
  hide('order-screen');
  currentTableId = null;
  currentOrder = null;
  connectWS();
  await loadData();
}

async function loadData() {
  try {
    const [t, o, m] = await Promise.all([
      api('GET', '/api/tables'),
      api('GET', '/api/orders'),
      api('GET', '/api/menu')
    ]);
    tables = t.tables || [];
    orders = o.orders || [];
    menu = m;
    renderTables();
    renderActive();
  } catch (e) {
    if (e.status === 401) logout();
    else toast(e.message, 'error');
  }
}

// ===== TABS =====
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => {
    if (t && t.classList) t.classList.toggle('active', t.dataset.tab === tab);
  });
  $$tg('tab-tables', 'hidden', tab !== 'tables');
  $$tg('tab-active', 'hidden', tab !== 'active');
}

// ===== TABLES =====
function renderTables() {
  const grid = document.getElementById('tables-grid');
  if (!grid) return;
  grid.innerHTML = (tables || []).map(t => {
    const order = orders.find(o => o.tableId === t.id && o.status === 'open');
    let cls = t.status === 'open' ? 'open' : t.status === 'reserved' ? 'reserved' : '';
    if (t.id === currentTableId) cls += ' selected';
    return `
      <div class="t-card ${cls}" onclick="openTable(${t.id})">
        <div class="t-dot"></div>
        <div class="t-name">${t.name}</div>
        <div class="t-info">${t.capacity} kisi</div>
        ${order ? `<div class="t-amount">${order.total} TL</div>` : ''}
      </div>`;
  }).join('');
}

function renderActive() {
  const list = document.getElementById('active-list');
  if (!list) return;
  const openOrders = (orders || []).filter(o => o.status === 'open');

  if (openOrders.length === 0) {
    list.innerHTML = '<div class="empty-state"><p>Acik adisyon yok</p></div>';
    return;
  }

  list.innerHTML = openOrders.map(o => {
    const table = tables.find(t => t.id === o.tableId);
    const name = table ? table.name : `Masa ${o.tableId}`;
    const items = o.items.filter(i => i.status === 'active').length;
    const opened = new Date(o.openedAt);
    const mins = Math.floor((serverNow() - opened.getTime()) / 60000);
    return `
      <div class="active-card" onclick="openTable(${o.tableId})">
        <div class="active-left">
          <span class="active-table">${name}</span>
          <span class="active-meta">${items} urun - ${mins}dk</span>
        </div>
        <span class="active-amount">${o.total} TL</span>
      </div>`;
  }).join('');
}

// ===== ORDER SCREEN =====
function openTable(tableId) {
  currentTableId = tableId;
  currentOrder = orders.find(o => o.tableId === tableId && o.status === 'open') || null;

  hide('main-screen');
  show('order-screen');

  const table = tables.find(t => t.id === tableId);
  $$txt('order-table-name', table ? table.name : `Masa ${tableId}`);

  renderOrder();
  renderCategories();
}

function goBack() {
  hide('order-screen');
  show('main-screen');
  currentTableId = null;
  currentOrder = null;
  renderTables();
  renderActive();
}

function renderOrder() {
  const container = document.getElementById('order-items');
  const emptyEl = document.getElementById('empty-order');
  const totalEl = document.getElementById('order-total');
  if (!container) return;

  // Zaman
  if (currentOrder) {
    const opened = new Date(currentOrder.openedAt);
    const mins = Math.floor((serverNow() - opened.getTime()) / 60000);
    $$txt('order-time',
      `${opened.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })} - ${mins}dk`);
  } else {
    $$txt('order-time', 'Yeni adisyon');
  }

  if (!currentOrder || currentOrder.items.filter(i => i.status === 'active').length === 0) {
    container.innerHTML = '';
    if (emptyEl) {
      container.appendChild(emptyEl);
      emptyEl.classList.remove('hidden');
    }
    if (totalEl) totalEl.textContent = '0 TL';
    return;
  }

  if (emptyEl) emptyEl.classList.add('hidden');
  const activeItems = currentOrder.items.filter(i => i.status === 'active');
  const paidItems = activeItems.filter(i => !i.ikram);
  const ikramItems = activeItems.filter(i => i.ikram);

  const renderRow = (item) => `
    <div class="o-item${item.ikram ? ' o-item-ikram' : ''}">
      <div class="o-info">
        <div class="o-name">${item.name}</div>
        ${item.note ? `<div class="o-note">${item.note}</div>` : ''}
      </div>
      <div class="o-qty">
        <button onclick="changeQty('${item.lineId}',-1)">-</button>
        <span>${item.qty}</span>
        <button onclick="changeQty('${item.lineId}',1)">+</button>
      </div>
      <div class="o-price">${item.ikram ? 'Ikram' : item.lineTotal + ' TL'}</div>
      <button class="o-del" onclick="removeItem('${item.lineId}')">&times;</button>
    </div>
  `;

  let html = paidItems.map(renderRow).join('');
  if (ikramItems.length) {
    html += `<div class="o-ikram-header">Ikramlar</div>` + ikramItems.map(renderRow).join('');
  }
  container.innerHTML = html;

  if (totalEl) totalEl.textContent = currentOrder.total + ' TL';
}

// ===== ITEM ACTIONS =====
async function changeQty(lineId, delta) {
  if (!currentOrder) return;
  const item = currentOrder.items.find(i => i.lineId === lineId);
  if (!item) return;
  const newQty = item.qty + delta;
  if (newQty < 1) return;

  try {
    const res = await api('PATCH', `/api/orders/${currentTableId}/items/${lineId}`, {
      version: currentOrder.version, qty: newQty
    });
    syncOrder(res);
  } catch (e) { handleErr(e); }
}

async function removeItem(lineId) {
  if (!currentOrder) return;
  try {
    const res = await api('DELETE', `/api/orders/${currentTableId}/items/${lineId}?version=${currentOrder.version}`);
    syncOrder(res);
    toast('Silindi', 'info');
  } catch (e) { handleErr(e); }
}

// ===== MENU =====
function renderCategories() {
  const chips = document.getElementById('category-chips');
  if (!chips) return;
  if (!menu || !menu.categories || menu.categories.length === 0) {
    chips.innerHTML = '<span style="color:var(--text-muted);font-size:0.75rem;padding:4px;">Menu bos</span>';
    $$html('menu-items-scroll', '');
    return;
  }

  if (!selectedCatId || !menu.categories.find(c => c.id === selectedCatId)) {
    selectedCatId = menu.categories[0].id;
  }

  chips.innerHTML = menu.categories.map(c =>
    `<button class="chip ${c.id === selectedCatId ? 'active' : ''}" onclick="selectCat('${c.id}')">${c.name}</button>`
  ).join('');

  renderMenuItems();
}

function selectCat(id) {
  if (!menu || !menu.categories) return;
  if (!menu.categories.find(c => c.id === id)) return;
  selectedCatId = id;
  // renderCategories chip aktiflemeyi zaten yapiyor; ekstra DOM dolasimina gerek yok
  renderCategories();
}

function renderMenuItems() {
  const container = document.getElementById('menu-items-scroll');
  if (!container) return;
  if (!menu || !menu.categories) { container.innerHTML = ''; return; }
  const cat = menu.categories.find(c => c.id === selectedCatId);
  if (!cat) { container.innerHTML = ''; return; }

  const items = (cat.items || []).filter(i => i.visible !== false);
  container.innerHTML = items.map(i =>
    `<div class="m-card" onclick="openQtyModal(${i.id},'${String(i.name).replace(/'/g, "\\'")}',${i.price})">
      <div class="m-name">${i.name}</div>
      <div class="m-price">${i.price} TL</div>
    </div>`
  ).join('');
}

// ===== QTY MODAL =====
function openQtyModal(id, name, price) {
  modalItem = { itemId: id, name, qty: 1, unitPrice: price, ikram: false };
  $$txt('qty-item-name', name);
  $$txt('qty-val', '1');
  $$txt('qty-price', price + ' TL');
  const note = $$id('qty-note'); if (note) note.value = '';
  const ik = $$id('qty-ikram'); if (ik) ik.checked = false;
  show('qty-modal');
}

function closeQtyModal() { hide('qty-modal'); }

function modalPriceText() {
  return modalItem.ikram ? '0 TL (Ikram)' : (modalItem.qty * modalItem.unitPrice) + ' TL';
}

function modalIkram() {
  modalItem.ikram = $$id('qty-ikram').checked;
  $$txt('qty-price', modalPriceText());
}

function modalQty(d) {
  modalItem.qty = Math.max(1, modalItem.qty + d);
  $$txt('qty-val', modalItem.qty);
  $$txt('qty-price', modalPriceText());
}

async function confirmAdd() {
  const noteEl = $$id('qty-note');
  const note = noteEl ? noteEl.value : '';
  const payload = {
    itemId: modalItem.itemId,
    name: modalItem.name,
    qty: modalItem.qty,
    unitPrice: modalItem.unitPrice,
    note,
    ikram: modalItem.ikram
  };
  if (currentOrder) payload.version = currentOrder.version;

  try {
    const res = await api('POST', `/api/orders/${currentTableId}/items`, payload);
    syncOrder(res);
    closeQtyModal();
    toast(`${modalItem.name} x${modalItem.qty}${modalItem.ikram ? ' (ikram)' : ''} eklendi`, 'success');
  } catch (e) { handleErr(e); }
}

// ===== SEND FEEDBACK =====
function showSentFeedback() {
  const btn = document.getElementById('send-btn');
  if (!btn) return;
  btn.textContent = 'Gonderildi!';
  btn.classList.add('sent');
  setTimeout(() => {
    if (!btn || !btn.classList) return;
    btn.textContent = 'Siparisi Gonder';
    btn.classList.remove('sent');
  }, 1500);
}

// ===== WEBSOCKET =====
function connectWS() {
  if (!token) return;
  if (ws && ws.readyState <= 1) return;
  try {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}?token=${token}`);
  } catch (e) {
    setOnline(false);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    setOnline(true);
    wsReconnectDelay = 1000;
  };

  ws.onerror = () => {
    setOnline(false);
  };

  ws.onclose = () => {
    setOnline(false);
    scheduleReconnect();
  };

  ws.onmessage = (e) => {
    try { handleWS(JSON.parse(e.data)); }
    catch (err) { console.error('[ws] parse error:', err, e.data); }
  };
}

function scheduleReconnect() {
  if (!token) return;
  if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
  wsReconnectTimer = setTimeout(reconnect, wsReconnectDelay);
  wsReconnectDelay = Math.min(wsReconnectDelay * 2, 30000);
}

function reconnect() {
  wsReconnectTimer = null;
  if (!token) return;
  connectWS();
}

function setOnline(on) {
  $$tg('ws-dot', 'on', on);
  $$tg('ws-dot-order', 'on', on);
  $$tg('offline-banner', 'hidden', on);
}

function handleWS(msg) {
  switch (msg.type) {
    case 'order:created':
    case 'order:updated':
      syncOrderGlobal(msg.data);
      break;
    case 'order:closed':
      removeOrder(msg.data);
      break;
    case 'table:updated':
      syncTable(msg.data);
      break;
    case 'tables:refresh':
      tables = msg.data.tables || [];
      if (currentTableId && !tables.find(t => t.id === currentTableId)) {
        goBack();
      }
      renderTables();
      renderActive();
      break;
    case 'menu:updated':
      api('GET', '/api/menu').then(m => { menu = m; if (currentTableId) renderCategories(); });
      break;
    case 'day:closed':
      toast('Gun kapatildi', 'info');
      loadData();
      if (currentTableId) goBack();
      break;
  }
}

function syncOrder(order) {
  currentOrder = order;
  syncOrderGlobal(order);
  renderOrder();
}

function syncOrderGlobal(order) {
  if (!order) return;
  const idx = orders.findIndex(o => o.id === order.id);
  if (order.status === 'closed' || order.status === 'merged') {
    if (idx >= 0) orders.splice(idx, 1);
  } else if (idx >= 0) {
    orders[idx] = order;
  } else {
    orders.push(order);
  }

  // Eger su an bu masadaysak guncelle
  if (currentTableId && order.tableId === currentTableId && order.status === 'open') {
    currentOrder = order;
    renderOrder();
  }

  renderTables();
  renderActive();
}

function removeOrder(order) {
  if (!order) return;
  const idx = orders.findIndex(o => o.id === order.id);
  if (idx >= 0) orders.splice(idx, 1);

  if (currentTableId && order.tableId === currentTableId) {
    currentOrder = null;
    renderOrder();
  }
  renderTables();
  renderActive();
}

function syncTable(table) {
  if (!table) return;
  const idx = tables.findIndex(t => t.id === table.id);
  if (idx >= 0) tables[idx] = table;
  renderTables();
}

// ===== UTILS =====
function handleErr(e) {
  if (e.status === 409) {
    toast('Adisyon guncellendi, yenileniyor...', 'warning');
    loadData().then(() => { if (currentTableId) openTable(currentTableId); });
  } else if (e.status === 401) {
    logout();
  } else {
    toast(e.message, 'error');
  }
}

function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  if (!el) { try { console.log('[toast]', type, msg); } catch (_) {} return; }
  el.textContent = msg;
  el.className = `toast ${type}`;
  el.classList.remove('hidden');
  setTimeout(() => { if (el && el.classList) el.classList.add('hidden'); }, 2500);
}

async function api(method, url, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
  if (body && method !== 'GET') opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || 'Hata');
    err.status = res.status;
    throw err;
  }
  return data;
}
