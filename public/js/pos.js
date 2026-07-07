// ===== SAKURA POS - Frontend =====

// ----- Global JS hata yakalayici (toast olarak goster) -----
window.addEventListener('error', (ev) => {
  try {
    const msg = ev.message || (ev.error && ev.error.message) || 'Bilinmeyen hata';
    const where = ev.filename ? `${String(ev.filename).split('/').pop()}:${ev.lineno}` : '';
    console.error('[pos] window error:', msg, where, ev.error);
    if (typeof showToast === 'function') showToast(`JS HATA: ${msg} ${where}`, 'error');
  } catch (_) {}
});
window.addEventListener('unhandledrejection', (ev) => {
  try {
    const r = ev.reason || {};
    const msg = r.message || String(r);
    console.error('[pos] unhandled rejection:', msg, r);
    if (typeof showToast === 'function') showToast(`Async hata: ${msg}`, 'error');
  } catch (_) {}
});

// ----- Null-safe DOM yardimcilari -----
function $$id(id) { return document.getElementById(id); }
function $$add(id, c) { const e = $$id(id); if (e && e.classList) e.classList.add(c); }
function $$rm(id, c)  { const e = $$id(id); if (e && e.classList) e.classList.remove(c); }
function $$tg(id, c, f) { const e = $$id(id); if (e && e.classList) e.classList.toggle(c, f); }

// --- State ---
let token = localStorage.getItem('sakura_token');
let userRole = localStorage.getItem('sakura_role');
let tables = [];
let orders = [];
let menu = { categories: [] };
let selectedTableId = null;
let selectedOrder = null;
let ws = null;
let wsReconnectDelay = 1000;

// Modal state
let addItemData = { itemId: null, name: '', qty: 1, unitPrice: 0, note: '', ikram: false };
let selectedPayment = 'nakit';
let selectedDiscountType = 'fixed';
let selectedCategoryId = null;

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  applyTheme();
  if (token && userRole) {
    showPOS();
  }
  updateClock();
  setInterval(updateClock, 1000);

  // Filtre butonlari
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderTables();
    });
  });
});

// ===== PIN =====
let pinValue = '';

function pinInput(digit) {
  if (pinValue.length >= 4) return;
  pinValue += digit;
  updatePinDots();
  if (pinValue.length === 4) {
    setTimeout(pinSubmit, 200);
  }
}

function pinClear() {
  pinValue = '';
  updatePinDots();
  document.getElementById('pin-error').textContent = '';
}

function updatePinDots() {
  const dots = document.querySelectorAll('.pin-dot');
  dots.forEach((dot, i) => {
    dot.classList.toggle('filled', i < pinValue.length);
  });
}

async function pinSubmit() {
  if (pinValue.length !== 4) return;
  try {
    const res = await api('POST', '/api/auth/login', { pin: pinValue, scope: 'pos' });
    token = res.token;
    userRole = res.role;
    localStorage.setItem('sakura_token', token);
    localStorage.setItem('sakura_role', res.role);
    showPOS();
  } catch (err) {
    document.getElementById('pin-error').textContent = err.message || 'Gecersiz PIN';
    pinClear();
  }
}

function logout() {
  token = null;
  userRole = null;
  localStorage.removeItem('sakura_token');
  localStorage.removeItem('sakura_role');
  if (ws) ws.close();
  $$rm('pin-screen', 'hidden');
  $$add('pos-screen', 'hidden');
  pinClear();
}

// ===== POS SCREEN =====
async function showPOS() {
  $$add('pin-screen', 'hidden');
  $$rm('pos-screen', 'hidden');
  document.getElementById('user-role').textContent = userRole;

  connectWebSocket();
  await loadAllData();
  await applyTheme();
}

async function applyTheme() {
  try {
    const s = await api('GET', '/api/settings');
    const theme = (s.ui && s.ui.theme) || 'sakura';
    document.body.setAttribute('data-theme', theme);
  } catch (_) {}
}

async function loadAllData() {
  try {
    const [tablesData, ordersData, menuData] = await Promise.all([
      api('GET', '/api/tables'),
      api('GET', '/api/orders'),
      api('GET', '/api/menu')
    ]);
    tables = tablesData.tables || [];
    orders = ordersData.orders || [];
    menu = menuData;
    renderTables();
    updateStats();
  } catch (err) {
    if (err.status === 401) {
      logout();
    } else {
      showToast('Veri yuklenemedi: ' + err.message, 'error');
    }
  }
}

// ===== WEBSOCKET =====
function connectWebSocket() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${location.host}?token=${token}`;

  ws = new WebSocket(url);

  ws.onopen = () => {
    $$add('ws-status', 'connected');
    wsReconnectDelay = 1000;
  };

  ws.onclose = () => {
    $$rm('ws-status', 'connected');
    setTimeout(reconnectWS, wsReconnectDelay);
    wsReconnectDelay = Math.min(wsReconnectDelay * 2, 30000);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleWSEvent(msg);
    } catch (e) {}
  };
}

function reconnectWS() {
  if (!token) return;
  connectWebSocket();
}

function handleWSEvent(msg) {
  switch (msg.type) {
    case 'order:created':
    case 'order:updated':
    case 'order:closed':
      updateOrderInState(msg.data);
      break;
    case 'table:updated':
      updateTableInState(msg.data);
      break;
    case 'tables:refresh':
      tables = msg.data.tables || [];
      if (selectedTableId && !tables.find(t => t.id === selectedTableId)) {
        selectedTableId = null;
        selectedOrder = null;
        renderOrderDetail();
      }
      renderTables();
      updateStats();
      break;
    case 'menu:updated':
      api('GET', '/api/menu').then(m => { menu = m; });
      break;
    case 'day:closed':
      showToast('Gun kapatildi: ' + msg.data.date, 'info');
      loadAllData();
      break;
    case 'settings:theme':
      if (msg.data && msg.data.theme && typeof window.__sakuraApplyTheme === 'function') {
        window.__sakuraApplyTheme(msg.data.theme);
      }
      break;
    case 'printer:status':
      if (msg.data.ok) {
        showToast(msg.data.message, 'success');
      } else {
        showToast('Yazici: ' + msg.data.message, 'warning');
      }
      break;
  }
}

function updateOrderInState(order) {
  if (!order) return;
  const idx = orders.findIndex(o => o.id === order.id);
  if (idx >= 0) {
    if (order.status === 'merged') {
      orders.splice(idx, 1);
    } else {
      orders[idx] = order;
    }
  } else {
    orders.push(order);
  }

  if (selectedTableId === order.tableId) {
    selectedOrder = orders.find(o => o.tableId === selectedTableId && o.status === 'open') || null;
    renderOrderDetail();
  }
  renderTables();
  updateStats();
}

function updateTableInState(table) {
  if (!table) return;
  const idx = tables.findIndex(t => t.id === table.id);
  if (idx >= 0) {
    tables[idx] = table;
  }
  renderTables();
  updateStats();
}

// ===== RENDER TABLES =====
function renderTables() {
  const grid = document.getElementById('tables-grid');
  const filter = document.querySelector('.filter-btn.active')?.dataset.filter || 'all';

  const filtered = filter === 'all' ? tables : tables.filter(t => t.section === filter);

  grid.innerHTML = filtered.map(t => {
    const order = orders.find(o => o.tableId === t.id && o.status === 'open');
    const amount = order ? order.total : 0;
    const isSelected = selectedTableId === t.id;

    return `
      <div class="table-card status-${t.status} ${isSelected ? 'selected' : ''}"
           onclick="selectTable(${t.id})">
        <div class="table-card-top">
          <div>
            <div class="table-name">${t.name}</div>
            <div class="table-info">${t.capacity} kisi | ${t.section}</div>
          </div>
          <div class="table-status-dot"></div>
        </div>
        ${t.status === 'open' ? `<div class="table-amount">${amount.toFixed(0)} TL</div>` : ''}
      </div>
    `;
  }).join('');
}

function selectTable(tableId) {
  selectedTableId = tableId;
  selectedOrder = orders.find(o => o.tableId === tableId && o.status === 'open') || null;

  renderTables();
  renderOrderDetail();
}

// ===== RENDER ORDER DETAIL =====
function renderOrderDetail() {
  const noSel = document.getElementById('no-selection');
  const detail = document.getElementById('order-detail');

  if (!selectedTableId) {
    if (noSel) noSel.classList.remove('hidden');
    if (detail) detail.classList.add('hidden');
    return;
  }

  if (noSel) noSel.classList.add('hidden');
  if (detail) detail.classList.remove('hidden');

  const table = tables.find(t => t.id === selectedTableId);
  document.getElementById('order-table-name').textContent = table ? table.name : `Masa ${selectedTableId}`;

  if (!selectedOrder) {
    document.getElementById('order-time').textContent = 'Bos masa';
    document.getElementById('order-items-count').textContent = '0 kalem';
    document.getElementById('order-items').innerHTML = `
      <div style="padding:40px;text-align:center;color:var(--text-muted);">
        <p>Adisyon yok</p>
        <p style="font-size:0.8rem;margin-top:8px;">Urun ekleyerek adisyon acin</p>
      </div>`;
    document.getElementById('order-subtotal').textContent = '0.00 TL';
    document.getElementById('order-total').textContent = '0.00 TL';
    document.getElementById('discount-row').style.display = 'none';
    return;
  }

  // Zaman
  const opened = new Date(selectedOrder.openedAt);
  const diff = Math.floor((serverNow() - opened.getTime()) / 60000);
  document.getElementById('order-time').textContent =
    `${opened.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })} - ${diff}dk`;

  // Kalemler
  const activeItems = selectedOrder.items.filter(i => i.status === 'active');
  document.getElementById('order-items-count').textContent = `${activeItems.length} kalem`;

  const paidItems = activeItems.filter(i => !i.ikram);
  const ikramItems = activeItems.filter(i => i.ikram);

  const renderRow = (item) => `
    <div class="order-item${item.ikram ? ' order-item-ikram' : ''}">
      <div class="item-info">
        <div class="item-name">${item.name}</div>
        ${item.note ? `<div class="item-note">${item.note}</div>` : ''}
      </div>
      <div class="item-qty-ctrl">
        <button class="qty-btn" onclick="changeItemQty('${item.lineId}', -1)">-</button>
        <span class="qty-value">${item.qty}</span>
        <button class="qty-btn" onclick="changeItemQty('${item.lineId}', 1)">+</button>
      </div>
      <div class="item-price">${item.ikram ? 'Ikram' : item.lineTotal.toFixed(0) + ' TL'}</div>
      <button class="item-remove" onclick="removeItem('${item.lineId}')" title="Sil">&times;</button>
    </div>
  `;

  let html = paidItems.map(renderRow).join('');
  if (ikramItems.length) {
    html += `<div class="ikram-header">Ikramlar</div>` + ikramItems.map(renderRow).join('');
  }
  document.getElementById('order-items').innerHTML = html;

  // Toplamlar
  document.getElementById('order-subtotal').textContent = selectedOrder.subtotal.toFixed(2) + ' TL';
  document.getElementById('order-total').textContent = selectedOrder.total.toFixed(2) + ' TL';

  if (selectedOrder.discount > 0) {
    document.getElementById('discount-row').style.display = 'flex';
    document.getElementById('order-discount').textContent = '-' + selectedOrder.discount.toFixed(2) + ' TL';
  } else {
    document.getElementById('discount-row').style.display = 'none';
  }
}

// ===== ITEM ACTIONS =====
async function changeItemQty(lineId, delta) {
  if (!selectedOrder) return;
  const item = selectedOrder.items.find(i => i.lineId === lineId);
  if (!item) return;

  const newQty = item.qty + delta;
  if (newQty < 1) return;

  try {
    const res = await api('PATCH', `/api/orders/${selectedTableId}/items/${lineId}`, {
      version: selectedOrder.version,
      qty: newQty
    });
    updateOrderInState(res);
  } catch (err) {
    handleConflict(err);
  }
}

async function removeItem(lineId) {
  if (!selectedOrder) return;
  try {
    const res = await api('DELETE', `/api/orders/${selectedTableId}/items/${lineId}?version=${selectedOrder.version}`);
    updateOrderInState(res);
    showToast('Urun silindi', 'info');
  } catch (err) {
    handleConflict(err);
  }
}

// ===== ADD ITEM MODAL =====
function openAddItemModal() {
  if (!selectedTableId) return;
  openModal('add-item-modal');
  renderMenuCategories();
}

function renderMenuCategories() {
  const container = document.getElementById('menu-categories');
  if (!menu.categories || menu.categories.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem;padding:8px;">Menu bos. Admin panelinden ekleyin.</p>';
    document.getElementById('menu-items').innerHTML = '';
    return;
  }

  selectedCategoryId = selectedCategoryId || menu.categories[0].id;

  container.innerHTML = menu.categories.map(cat => `
    <button class="cat-btn ${cat.id === selectedCategoryId ? 'active' : ''}"
            onclick="selectCategory('${cat.id}')">
      ${cat.name}
    </button>
  `).join('');

  renderMenuItems();
}

function selectCategory(catId) {
  selectedCategoryId = catId;
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.cat-btn[onclick*="'${catId}'"]`)?.classList.add('active');
  renderMenuItems();
}

function renderMenuItems() {
  const container = document.getElementById('menu-items');
  const searchTerm = document.getElementById('menu-search').value.toLowerCase();

  let items = [];
  if (selectedCategoryId) {
    const cat = menu.categories.find(c => c.id === selectedCategoryId);
    if (cat) items = cat.items || [];
  }

  if (searchTerm) {
    // Tum kategorilerde ara
    items = [];
    for (const cat of menu.categories) {
      for (const item of (cat.items || [])) {
        if (item.name.toLowerCase().includes(searchTerm) || (item.nameEn || '').toLowerCase().includes(searchTerm)) {
          items.push(item);
        }
      }
    }
  }

  const visibleItems = items.filter(i => i.visible !== false);

  container.innerHTML = visibleItems.map(item => `
    <div class="menu-item-card" onclick="selectMenuItem(${item.id}, '${item.name.replace(/'/g, "\\'")}', ${item.price})">
      <div class="menu-item-name">${item.name}</div>
      <div class="menu-item-price">${item.price} TL</div>
    </div>
  `).join('');

  if (visibleItems.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;padding:20px;grid-column:1/-1;text-align:center;">Urun bulunamadi</p>';
  }
}

function filterMenu() {
  renderMenuItems();
}

function selectMenuItem(itemId, name, price) {
  addItemData = { itemId, name, qty: 1, unitPrice: price, note: '', ikram: false };
  closeModal('add-item-modal');
  openModal('item-qty-modal');

  document.getElementById('item-qty-name').textContent = name;
  document.getElementById('item-qty-value').textContent = '1';
  document.getElementById('item-qty-price').textContent = price;
  document.getElementById('item-qty-note').value = '';
  document.getElementById('item-qty-ikram').checked = false;
}

function updateModalPrice() {
  const el = document.getElementById('item-qty-price');
  el.textContent = addItemData.ikram ? '0 (Ikram)' : addItemData.qty * addItemData.unitPrice;
}

function toggleIkram() {
  addItemData.ikram = document.getElementById('item-qty-ikram').checked;
  updateModalPrice();
}

function changeModalQty(delta) {
  addItemData.qty = Math.max(1, addItemData.qty + delta);
  document.getElementById('item-qty-value').textContent = addItemData.qty;
  updateModalPrice();
}

async function confirmAddItem() {
  addItemData.note = document.getElementById('item-qty-note').value;

  try {
    const payload = {
      itemId: addItemData.itemId,
      name: addItemData.name,
      qty: addItemData.qty,
      unitPrice: addItemData.unitPrice,
      note: addItemData.note,
      ikram: addItemData.ikram
    };
    if (selectedOrder) {
      payload.version = selectedOrder.version;
    }

    const res = await api('POST', `/api/orders/${selectedTableId}/items`, payload);
    updateOrderInState(res);
    closeModal('item-qty-modal');
    showToast(`${addItemData.name} x${addItemData.qty}${addItemData.ikram ? ' (ikram)' : ''} eklendi`, 'success');
  } catch (err) {
    handleConflict(err);
  }
}

// ===== ADISYON BAS (musteri fisi) =====
async function printReceiptNow() {
  if (!selectedOrder) {
    showToast('Acik adisyon yok', 'warning');
    return;
  }
  try {
    const res = await api('POST', `/api/print/receipt/${selectedOrder.id}`);
    if (res.method === 'html') {
      // Yazici devre disi — tarayici print fallback
      const w = window.open('', '_blank', 'width=400,height=600');
      w.document.write('<html><head><title>Adisyon</title></head><body>'
        + res.receipt
        + '<script>window.onload=()=>{window.print();setTimeout(()=>window.close(),300);}<\/script>'
        + '</body></html>');
      w.document.close();
      showToast('Yazici devre disi — tarayicidan basildi', 'info');
    } else {
      showToast('Adisyon yaziciya gonderildi', 'success');
    }
  } catch (err) {
    showToast('Yazdirma hatasi: ' + err.message, 'error');
  }
}

// ===== CLOSE ORDER =====
function openCloseModal() {
  if (!selectedOrder) {
    showToast('Acik adisyon yok', 'warning');
    return;
  }
  if (userRole !== 'yonetici') {
    showToast('Sadece yonetici hesap kapatabilir', 'error');
    return;
  }
  openModal('close-modal');
  document.getElementById('close-total').textContent = selectedOrder.total.toFixed(2) + ' TL';
  selectPayment('nakit');
}

function selectPayment(method) {
  selectedPayment = method;
  document.querySelectorAll('#close-modal .payment-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.method === method);
  });
}

async function confirmClose() {
  if (!selectedOrder) return;
  try {
    const res = await api('POST', `/api/orders/${selectedTableId}/close`, {
      paymentMethod: selectedPayment
    });
    updateOrderInState(res);
    closeModal('close-modal');
    // Masa kapandi -> secimi birak, kart eski (bos) rengine donsun
    selectedTableId = null;
    selectedOrder = null;
    renderTables();
    renderOrderDetail();
    showToast('Hesap kapatildi', 'success');
  } catch (err) {
    showToast('Hata: ' + err.message, 'error');
  }
}

// ===== TRANSFER =====
function openTransferModal() {
  if (!selectedOrder) {
    showToast('Acik adisyon yok', 'warning');
    return;
  }
  if (userRole !== 'yonetici') {
    showToast('Sadece yonetici masa tasiyabilir', 'error');
    return;
  }
  openModal('transfer-modal');

  const emptyTables = tables.filter(t => t.status === 'empty');
  document.getElementById('transfer-tables').innerHTML = emptyTables.map(t => `
    <button class="transfer-table-btn" onclick="confirmTransfer(${t.id})">${t.name}</button>
  `).join('') || '<p style="color:var(--text-muted);">Bos masa yok</p>';
}

async function confirmTransfer(toId) {
  try {
    const res = await api('POST', `/api/orders/${selectedTableId}/transfer/${toId}`);
    closeModal('transfer-modal');
    await loadAllData();
    selectTable(toId);
    showToast('Masa taşindi', 'success');
  } catch (err) {
    showToast('Hata: ' + err.message, 'error');
  }
}

// ===== MERGE =====
function openMergeModal() {
  if (!selectedOrder) {
    showToast('Acik adisyon yok', 'warning');
    return;
  }
  if (userRole !== 'yonetici') {
    showToast('Sadece yonetici birlestirme yapabilir', 'error');
    return;
  }
  openModal('merge-modal');

  const openTables = tables.filter(t => t.status === 'open' && t.id !== selectedTableId);
  document.getElementById('merge-tables').innerHTML = openTables.map(t => `
    <button class="transfer-table-btn" onclick="confirmMerge(${t.id})">${t.name}</button>
  `).join('') || '<p style="color:var(--text-muted);">Baska acik masa yok</p>';
}

async function confirmMerge(targetId) {
  try {
    await api('POST', '/api/orders/merge', {
      sourceTableId: selectedTableId,
      targetTableId: targetId
    });
    closeModal('merge-modal');
    await loadAllData();
    selectTable(targetId);
    showToast('Masalar birlestirildi', 'success');
  } catch (err) {
    showToast('Hata: ' + err.message, 'error');
  }
}

// ===== DISCOUNT =====
function openDiscountModal() {
  if (!selectedOrder) return;
  if (userRole !== 'yonetici') {
    showToast('Sadece yonetici indirim uygulayabilir', 'error');
    return;
  }
  openModal('discount-modal');
  document.getElementById('discount-value').value = '';
  selectDiscountType('fixed');
}

function selectDiscountType(type) {
  selectedDiscountType = type;
  document.querySelectorAll('#discount-modal .payment-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.dtype === type);
  });
  document.getElementById('discount-value').placeholder = type === 'fixed' ? 'Tutar (TL)' : 'Yuzde (%)';
}

async function applyDiscount() {
  if (!selectedOrder) return;
  const val = parseFloat(document.getElementById('discount-value').value);
  if (isNaN(val) || val <= 0) {
    showToast('Gecerli bir deger girin', 'warning');
    return;
  }

  let discount;
  if (selectedDiscountType === 'percent') {
    discount = Math.round(selectedOrder.subtotal * val / 100);
  } else {
    discount = val;
  }

  try {
    // Indirimi backend'e kaydet -> adisyon fisinde ve hesap kapamada gorunur
    const res = await api('POST', `/api/orders/${selectedTableId}/discount`, {
      discount,
      version: selectedOrder.version
    });
    updateOrderInState(res);
    renderOrderDetail();
    closeModal('discount-modal');
    showToast(`${res.discount.toFixed(0)} TL indirim uygulandi`, 'success');
  } catch (err) {
    handleConflict(err);
  }
}

// ===== DAY CLOSE =====
function closeDay() {
  if (userRole !== 'yonetici') {
    showToast('Sadece yonetici gunu kapatabilir', 'error');
    return;
  }

  const openOrders = orders.filter(o => o.status === 'open');
  const closedOrders = orders.filter(o => o.status === 'closed');
  const totalRevenue = closedOrders.reduce((s, o) => s + o.total, 0);

  let warning = '';
  if (openOrders.length > 0) {
    warning = `<p style="color:var(--amber);margin-bottom:12px;">Dikkat: ${openOrders.length} acik adisyon var!</p>`;
  }

  document.getElementById('dayclose-warning').innerHTML = warning + 'Gunu kapatmak istediginize emin misiniz?';
  document.getElementById('dayclose-summary').innerHTML = `
    <p><span>Kapatilan adisyon</span><strong>${closedOrders.length}</strong></p>
    <p><span>Toplam ciro</span><strong>${totalRevenue.toFixed(0)} TL</strong></p>
  `;

  openModal('dayclose-modal');
}

async function confirmCloseDay() {
  try {
    const openOrders = orders.filter(o => o.status === 'open');
    const res = await api('POST', '/api/day/close', { force: openOrders.length > 0 });
    closeModal('dayclose-modal');
    showToast(`Gun kapatildi. Ciro: ${res.summary.totalRevenue} TL`, 'success');
    await loadAllData();
    selectedTableId = null;
    selectedOrder = null;
    renderOrderDetail();
  } catch (err) {
    showToast('Hata: ' + err.message, 'error');
  }
}

// ===== REPORTS =====
function openReports() {
  window.open('/rapor.html', '_blank');
}

// ===== MENU YONETIMI (POS icinden) =====
let mmEditingItemId = null; // null = yeni, numara = duzenle

function openMenuManager() {
  if (userRole !== 'yonetici') {
    showToast('Sadece yonetici menu yonetebilir', 'error');
    return;
  }
  openModal('menu-manager-modal');
  renderMenuManager();
}

function renderMenuManager() {
  const container = document.getElementById('mm-categories');
  if (!menu.categories || menu.categories.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);padding:20px;text-align:center;">Henuz kategori yok. Kategori ekleyin.</p>';
    return;
  }

  // Toplu fiyat degisikligi paneli
  let html = `<div style="background:var(--bg-input);border-radius:10px;padding:14px;margin-bottom:16px;border:1px solid var(--border);">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <strong style="color:var(--text);font-size:0.9rem;white-space:nowrap;">Toplu Fiyat Guncelle:</strong>
      <select id="mm-price-cat" style="background:var(--bg-dark);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:0.85rem;">
        <option value="all">Tum Menu</option>
        ${menu.categories.map((c, i) => `<option value="${i}">${c.name}</option>`).join('')}
      </select>
      <div style="display:flex;align-items:center;gap:4px;">
        <span style="color:var(--text-dim);font-size:0.85rem;">%</span>
        <input type="number" id="mm-price-pct" placeholder="10" style="width:70px;background:var(--bg-dark);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px 8px;font-size:0.85rem;text-align:center;">
      </div>
      <button onclick="applyBulkPriceChange()" style="background:var(--sakura);color:var(--bg-dark);border:none;border-radius:6px;padding:6px 16px;cursor:pointer;font-size:0.85rem;font-weight:600;white-space:nowrap;">Uygula</button>
    </div>
    <p style="color:var(--text-muted);font-size:0.7rem;margin-top:6px;">Negatif deger girerseniz indirim uygulanir (ornek: -10 = %10 indirim)</p>
  </div>`;

  html += menu.categories.map((cat, ci) => {
    const items = (cat.items || []).map(item =>
      `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--bg-dark);border-radius:8px;margin-bottom:4px;${item.visible === false ? 'opacity:0.4;' : ''}">
        <div style="flex:1;">
          <span style="color:var(--text);font-size:0.9rem;">${item.name}</span>
          ${item.desc ? `<span style="color:var(--text-muted);font-size:0.75rem;margin-left:8px;">${item.desc}</span>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <strong style="color:var(--sakura);font-size:0.9rem;">${item.price} TL</strong>
          <button onclick="editProductFromManager(${ci},${item.id})" style="background:var(--bg-card);border:1px solid var(--border);color:var(--text-dim);border-radius:6px;padding:4px 10px;cursor:pointer;font-size:0.75rem;">Duzenle</button>
          <button onclick="deleteProductFromManager(${ci},${item.id})" style="background:transparent;border:1px solid #ef4444;color:#ef4444;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:0.75rem;">Sil</button>
        </div>
      </div>`
    ).join('');

    return `<div style="background:var(--bg-card);border-radius:12px;padding:16px;margin-bottom:12px;border:1px solid var(--border);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div>
          <strong style="color:var(--text);font-size:1rem;">${cat.name}</strong>
          <span style="color:var(--text-muted);font-size:0.75rem;margin-left:8px;">(${(cat.items || []).length} urun)</span>
        </div>
        <div style="display:flex;gap:6px;">
          <button onclick="addProductToCategory(${ci})" style="background:var(--sakura);color:var(--bg-dark);border:none;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:0.8rem;font-weight:600;">+ Urun</button>
          <button onclick="deleteCategoryFromManager(${ci})" style="background:transparent;border:1px solid #ef4444;color:#ef4444;border-radius:6px;padding:6px 10px;cursor:pointer;font-size:0.8rem;">Sil</button>
        </div>
      </div>
      ${items || '<p style="color:var(--text-muted);font-size:0.8rem;padding:8px;">Bu kategoride urun yok</p>'}
    </div>`;
  }).join('');

  container.innerHTML = html;
}

// --- Toplu % Fiyat Degisikligi ---
async function applyBulkPriceChange() {
  const catVal = document.getElementById('mm-price-cat').value;
  const pct = parseFloat(document.getElementById('mm-price-pct').value);

  if (isNaN(pct) || pct === 0) {
    showToast('Gecerli bir yuzde girin', 'warning');
    return;
  }

  const multiplier = 1 + (pct / 100);
  let affected = 0;

  if (catVal === 'all') {
    // Tum kategoriler
    const label = pct > 0 ? `%${pct} zam` : `%${Math.abs(pct)} indirim`;
    if (!confirm(`Tum menuye ${label} uygulanacak. Onayliyor musunuz?`)) return;
    for (const cat of menu.categories) {
      for (const item of (cat.items || [])) {
        item.price = Math.round(item.price * multiplier);
        affected++;
      }
    }
  } else {
    const catIdx = parseInt(catVal);
    const cat = menu.categories[catIdx];
    if (!cat) return;
    const label = pct > 0 ? `%${pct} zam` : `%${Math.abs(pct)} indirim`;
    if (!confirm(`"${cat.name}" kategorisine ${label} uygulanacak. Onayliyor musunuz?`)) return;
    for (const item of (cat.items || [])) {
      item.price = Math.round(item.price * multiplier);
      affected++;
    }
  }

  await saveMenuFromPOS();
  renderMenuManager();
  const dir = pct > 0 ? 'zam' : 'indirim';
  showToast(`${affected} urune %${Math.abs(pct)} ${dir} uygulandi`, 'success');
}

// --- Kategori ---
function openNewCategoryModal() {
  document.getElementById('quick-cat-title').textContent = 'Yeni Kategori';
  document.getElementById('qc-id').value = '';
  document.getElementById('qc-name').value = '';
  document.getElementById('qc-id').disabled = false;
  openModal('quick-cat-modal');
}

async function saveQuickCategory() {
  const id = document.getElementById('qc-id').value.trim().toLowerCase().replace(/\s+/g, '_');
  const name = document.getElementById('qc-name').value.trim();
  if (!id || !name) { showToast('ID ve ad gerekli', 'warning'); return; }
  if (menu.categories.find(c => c.id === id)) { showToast('Bu ID zaten var', 'error'); return; }

  menu.categories.push({ id, name, nameEn: '', items: [] });
  await saveMenuFromPOS();
  closeModal('quick-cat-modal');
  renderMenuManager();
}

async function deleteCategoryFromManager(catIdx) {
  const cat = menu.categories[catIdx];
  if (!confirm(`"${cat.name}" kategorisini ve tum urunlerini silmek istediginize emin misiniz?`)) return;
  menu.categories.splice(catIdx, 1);
  await saveMenuFromPOS();
  renderMenuManager();
}

// --- Urun ---
function openNewProductModal() {
  mmEditingItemId = null;
  document.getElementById('quick-product-title').textContent = 'Yeni Urun';
  fillCategorySelect();
  document.getElementById('qp-name').value = '';
  document.getElementById('qp-price').value = '';
  document.getElementById('qp-desc').value = '';
  document.getElementById('qp-visible').checked = true;
  openModal('quick-product-modal');
}

function addProductToCategory(catIdx) {
  mmEditingItemId = null;
  document.getElementById('quick-product-title').textContent = 'Yeni Urun';
  fillCategorySelect(catIdx);
  document.getElementById('qp-name').value = '';
  document.getElementById('qp-price').value = '';
  document.getElementById('qp-desc').value = '';
  document.getElementById('qp-visible').checked = true;
  openModal('quick-product-modal');
}

function editProductFromManager(catIdx, itemId) {
  const cat = menu.categories[catIdx];
  const item = cat.items.find(i => i.id === itemId);
  if (!item) return;

  mmEditingItemId = itemId;
  document.getElementById('quick-product-title').textContent = 'Urun Duzenle';
  fillCategorySelect(catIdx);
  document.getElementById('qp-name').value = item.name;
  document.getElementById('qp-price').value = item.price;
  document.getElementById('qp-desc').value = item.desc || '';
  document.getElementById('qp-visible').checked = item.visible !== false;
  openModal('quick-product-modal');
}

async function deleteProductFromManager(catIdx, itemId) {
  const cat = menu.categories[catIdx];
  const item = cat.items.find(i => i.id === itemId);
  if (!item) return;
  if (!confirm(`"${item.name}" urununu silmek istediginize emin misiniz?`)) return;
  cat.items = cat.items.filter(i => i.id !== itemId);
  await saveMenuFromPOS();
  renderMenuManager();
}

function fillCategorySelect(defaultIdx) {
  const sel = document.getElementById('qp-category');
  sel.innerHTML = menu.categories.map((c, i) =>
    `<option value="${i}" ${i === defaultIdx ? 'selected' : ''}>${c.name}</option>`
  ).join('');
}

async function saveQuickProduct() {
  const catIdx = parseInt(document.getElementById('qp-category').value);
  const name = document.getElementById('qp-name').value.trim();
  const price = parseFloat(document.getElementById('qp-price').value);
  const desc = document.getElementById('qp-desc').value.trim();
  const visible = document.getElementById('qp-visible').checked;

  if (!name || isNaN(price) || price <= 0) { showToast('Ad ve gecerli fiyat gerekli', 'warning'); return; }
  if (catIdx < 0 || catIdx >= menu.categories.length) { showToast('Kategori secin', 'warning'); return; }

  const cat = menu.categories[catIdx];
  cat.items = cat.items || [];

  if (mmEditingItemId !== null) {
    // Duzenle — urun farkli kategoride olabilir, once bul
    let found = false;
    for (const c of menu.categories) {
      const idx = (c.items || []).findIndex(i => i.id === mmEditingItemId);
      if (idx >= 0) {
        const item = c.items[idx];
        // Kategori degisti mi?
        if (c.id !== cat.id) {
          c.items.splice(idx, 1);
          cat.items.push({ ...item, name, price, desc, visible });
        } else {
          item.name = name;
          item.price = price;
          item.desc = desc;
          item.visible = visible;
        }
        found = true;
        break;
      }
    }
    if (!found) { showToast('Urun bulunamadi', 'error'); return; }
  } else {
    // Yeni — max ID bul
    let maxId = 0;
    for (const c of menu.categories) for (const i of (c.items || [])) if (i.id > maxId) maxId = i.id;
    cat.items.push({ id: maxId + 1, name, nameEn: '', price, desc, visible });
  }

  await saveMenuFromPOS();
  closeModal('quick-product-modal');
  renderMenuManager();
  showToast(mmEditingItemId !== null ? 'Urun guncellendi' : 'Urun eklendi', 'success');
}

async function saveMenuFromPOS() {
  try {
    const res = await api('PUT', '/api/menu', { version: menu.version, categories: menu.categories });
    menu.version = res.version;
    menu.categories = res.categories;
  } catch (err) {
    if (err.status === 409) {
      showToast('Menu baskasi tarafindan guncellendi, yenileniyor...', 'warning');
      const fresh = await api('GET', '/api/menu');
      menu = fresh;
    } else {
      showToast('Menu kaydetme hatasi: ' + err.message, 'error');
    }
  }
}

// ===== HARICI SIPARISLER (Trendyol / Yemeksepeti) =====
let extOrder = { source: 'trendyol', items: [] };
let extSelectedCat = null;

function openExternalOrders() {
  extOrder = { source: 'trendyol', items: [] };
  openModal('external-modal');
  document.getElementById('ext-order-no').value = '';
  document.getElementById('ext-customer').value = '';
  document.getElementById('ext-phone').value = '';
  document.getElementById('ext-address').value = '';
  document.getElementById('ext-note').value = '';
  extSelectSource('trendyol');
  renderExtCart();
  loadExternalList();
}

function extSelectSource(src) {
  extOrder.source = src;
  document.querySelectorAll('#external-modal .payment-btn[data-src]').forEach(b => {
    b.classList.toggle('active', b.dataset.src === src);
  });
}

function openExtItemPicker() {
  openModal('external-item-modal');
  extSelectedCat = extSelectedCat || (menu.categories[0] && menu.categories[0].id);
  renderExtMenuCategories();
}

function renderExtMenuCategories() {
  const c = document.getElementById('ext-menu-categories');
  if (!menu.categories || menu.categories.length === 0) {
    c.innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem;padding:8px;">Menu bos</p>';
    document.getElementById('ext-menu-items').innerHTML = '';
    return;
  }
  c.innerHTML = menu.categories.map(cat => `
    <button class="cat-btn ${cat.id === extSelectedCat ? 'active' : ''}"
            onclick="selectExtCategory('${cat.id}')">${cat.name}</button>
  `).join('');
  renderExtMenuItems();
}

function selectExtCategory(catId) {
  extSelectedCat = catId;
  document.querySelectorAll('#ext-menu-categories .cat-btn').forEach(b => b.classList.remove('active'));
  renderExtMenuCategories();
}

function renderExtMenuItems() {
  const container = document.getElementById('ext-menu-items');
  const term = (document.getElementById('ext-menu-search').value || '').toLowerCase();
  let items = [];
  if (term) {
    for (const cat of menu.categories) {
      for (const item of (cat.items || [])) {
        if (item.name.toLowerCase().includes(term)) items.push(item);
      }
    }
  } else {
    const cat = menu.categories.find(c => c.id === extSelectedCat);
    items = cat ? (cat.items || []) : [];
  }
  const visible = items.filter(i => i.visible !== false);
  container.innerHTML = visible.map(item =>
    `<div class="menu-item-card" onclick="extAddItem(${item.id})">
       <div class="menu-item-name">${item.name}</div>
       <div class="menu-item-price">${item.price} TL</div>
     </div>`
  ).join('') || '<p style="color:var(--text-muted);font-size:0.85rem;padding:20px;grid-column:1/-1;text-align:center;">Urun bulunamadi</p>';
}

function findMenuItem(itemId) {
  for (const cat of menu.categories) {
    const it = (cat.items || []).find(i => i.id === itemId);
    if (it) return it;
  }
  return null;
}

function extAddItem(itemId) {
  const mi = findMenuItem(itemId);
  if (!mi) return;
  const existing = extOrder.items.find(i => i.itemId === itemId);
  if (existing) {
    existing.qty += 1;
  } else {
    extOrder.items.push({ itemId, name: mi.name, unitPrice: mi.price, qty: 1, note: '' });
  }
  showToast(`${mi.name} eklendi`, 'success');
  renderExtCart();
}

function extChangeQty(idx, delta) {
  const it = extOrder.items[idx];
  if (!it) return;
  it.qty = Math.max(1, it.qty + delta);
  renderExtCart();
}

function extRemove(idx) {
  extOrder.items.splice(idx, 1);
  renderExtCart();
}

function renderExtCart() {
  const el = document.getElementById('ext-cart');
  if (extOrder.items.length === 0) {
    el.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;padding:8px;">Henuz urun eklenmedi</p>';
    document.getElementById('ext-total').textContent = '0.00 TL';
    return;
  }
  el.innerHTML = extOrder.items.map((it, idx) => `
    <div class="order-item">
      <div class="item-info"><div class="item-name">${it.name}</div></div>
      <div class="item-qty-ctrl">
        <button class="qty-btn" onclick="extChangeQty(${idx},-1)">-</button>
        <span class="qty-value">${it.qty}</span>
        <button class="qty-btn" onclick="extChangeQty(${idx},1)">+</button>
      </div>
      <div class="item-price">${(it.qty * it.unitPrice).toFixed(0)} TL</div>
      <button class="item-remove" onclick="extRemove(${idx})" title="Sil">&times;</button>
    </div>
  `).join('');
  const total = extOrder.items.reduce((s, i) => s + i.qty * i.unitPrice, 0);
  document.getElementById('ext-total').textContent = total.toFixed(2) + ' TL';
}

async function submitExternalOrder() {
  if (extOrder.items.length === 0) {
    showToast('En az bir urun ekleyin', 'warning');
    return;
  }
  try {
    const payload = {
      source: extOrder.source,
      platformOrderNo: document.getElementById('ext-order-no').value.trim(),
      customer: document.getElementById('ext-customer').value.trim(),
      phone: document.getElementById('ext-phone').value.trim(),
      address: document.getElementById('ext-address').value.trim(),
      note: document.getElementById('ext-note').value.trim(),
      items: extOrder.items
    };
    await api('POST', '/api/orders/external', payload);
    showToast('Harici siparis kaydedildi', 'success');
    extOrder = { source: extOrder.source, items: [] };
    document.getElementById('ext-order-no').value = '';
    document.getElementById('ext-customer').value = '';
    document.getElementById('ext-phone').value = '';
    document.getElementById('ext-address').value = '';
    document.getElementById('ext-note').value = '';
    renderExtCart();
    loadExternalList();
  } catch (err) {
    showToast('Hata: ' + err.message, 'error');
  }
}

async function loadExternalList() {
  const el = document.getElementById('ext-list');
  try {
    const res = await api('GET', '/api/orders/external/list');
    const list = res.orders || [];
    if (list.length === 0) {
      el.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;padding:8px;">Bugun harici siparis yok</p>';
      return;
    }
    el.innerHTML = list.map(o => {
      const t = new Date(o.openedAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
      const srcLabel = o.source === 'trendyol' ? 'Trendyol'
        : o.source === 'getir' ? 'Getir Yemek'
        : 'Yemeksepeti';
      const cnt = (o.items || []).filter(i => i.status === 'active').length;
      const canDel = userRole === 'yonetici';
      const esc = s => String(s || '').replace(/</g, '&lt;');
      const addrLine = o.address ? `<div class="item-note">📍 ${esc(o.address)}${o.phone ? ' · ' + esc(o.phone) : ''}</div>`
        : (o.phone ? `<div class="item-note">☎ ${esc(o.phone)}</div>` : '');
      return `<div class="order-item">
        <div class="item-info">
          <div class="item-name">${srcLabel}${o.platformOrderNo ? ' #' + o.platformOrderNo : ''}</div>
          <div class="item-note">${t} - ${cnt} kalem${o.customer ? ' - ' + esc(o.customer) : ''}</div>
          ${addrLine}
        </div>
        <div class="item-price">${(o.total || 0).toFixed(0)} TL</div>
        ${canDel ? `<button class="item-remove" onclick="deleteExternalOrder('${o.id}')" title="Iptal">&times;</button>` : ''}
      </div>`;
    }).join('');
  } catch (err) {
    el.innerHTML = `<p style="color:var(--text-muted);font-size:0.85rem;padding:8px;">Liste yuklenemedi: ${err.message}</p>`;
  }
}

async function deleteExternalOrder(id) {
  if (!confirm('Bu harici siparisi iptal etmek istediginize emin misiniz?')) return;
  try {
    await api('DELETE', `/api/orders/external/${id}`);
    showToast('Harici siparis iptal edildi', 'info');
    loadExternalList();
  } catch (err) {
    showToast('Hata: ' + err.message, 'error');
  }
}

// ===== EVE TESLIM (Telefonla siparis) =====
let dlvOrder = { items: [], paymentMethod: 'nakit' };
let dlvSelectedCat = null;

function openDeliveryOrders() {
  dlvOrder = { items: [], paymentMethod: 'nakit' };
  openModal('delivery-modal');
  document.getElementById('dlv-customer').value = '';
  document.getElementById('dlv-phone').value = '';
  document.getElementById('dlv-address').value = '';
  document.getElementById('dlv-note').value = '';
  dlvSelectPayment('nakit');
  renderDlvCart();
  loadDeliveryList();
}

function dlvSelectPayment(method) {
  dlvOrder.paymentMethod = method;
  document.querySelectorAll('#delivery-modal .payment-btn[data-dlv-pay]').forEach(b => {
    b.classList.toggle('active', b.dataset.dlvPay === method);
  });
}

function openDlvItemPicker() {
  openModal('delivery-item-modal');
  dlvSelectedCat = dlvSelectedCat || (menu.categories[0] && menu.categories[0].id);
  renderDlvMenuCategories();
}

function renderDlvMenuCategories() {
  const c = document.getElementById('dlv-menu-categories');
  if (!menu.categories || menu.categories.length === 0) {
    c.innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem;padding:8px;">Menu bos</p>';
    document.getElementById('dlv-menu-items').innerHTML = '';
    return;
  }
  c.innerHTML = menu.categories.map(cat => `
    <button class="cat-btn ${cat.id === dlvSelectedCat ? 'active' : ''}"
            onclick="selectDlvCategory('${cat.id}')">${cat.name}</button>
  `).join('');
  renderDlvMenuItems();
}

function selectDlvCategory(catId) {
  dlvSelectedCat = catId;
  document.querySelectorAll('#dlv-menu-categories .cat-btn').forEach(b => b.classList.remove('active'));
  renderDlvMenuCategories();
}

function renderDlvMenuItems() {
  const container = document.getElementById('dlv-menu-items');
  const term = (document.getElementById('dlv-menu-search').value || '').toLowerCase();
  let items = [];
  if (term) {
    for (const cat of menu.categories) {
      for (const item of (cat.items || [])) {
        if (item.name.toLowerCase().includes(term)) items.push(item);
      }
    }
  } else {
    const cat = menu.categories.find(c => c.id === dlvSelectedCat);
    items = cat ? (cat.items || []) : [];
  }
  const visible = items.filter(i => i.visible !== false);
  container.innerHTML = visible.map(item =>
    `<div class="menu-item-card" onclick="dlvAddItem(${item.id})">
       <div class="menu-item-name">${item.name}</div>
       <div class="menu-item-price">${item.price} TL</div>
     </div>`
  ).join('') || '<p style="color:var(--text-muted);font-size:0.85rem;padding:20px;grid-column:1/-1;text-align:center;">Urun bulunamadi</p>';
}

function dlvAddItem(itemId) {
  const mi = findMenuItem(itemId);
  if (!mi) return;
  const existing = dlvOrder.items.find(i => i.itemId === itemId);
  if (existing) {
    existing.qty += 1;
  } else {
    dlvOrder.items.push({ itemId, name: mi.name, unitPrice: mi.price, qty: 1, note: '' });
  }
  showToast(`${mi.name} eklendi`, 'success');
  renderDlvCart();
}

function dlvChangeQty(idx, delta) {
  const it = dlvOrder.items[idx];
  if (!it) return;
  it.qty = Math.max(1, it.qty + delta);
  renderDlvCart();
}

function dlvRemove(idx) {
  dlvOrder.items.splice(idx, 1);
  renderDlvCart();
}

function renderDlvCart() {
  const el = document.getElementById('dlv-cart');
  if (dlvOrder.items.length === 0) {
    el.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;padding:8px;">Henuz urun eklenmedi</p>';
    document.getElementById('dlv-total').textContent = '0.00 TL';
    return;
  }
  el.innerHTML = dlvOrder.items.map((it, idx) => `
    <div class="order-item">
      <div class="item-info"><div class="item-name">${it.name}</div></div>
      <div class="item-qty-ctrl">
        <button class="qty-btn" onclick="dlvChangeQty(${idx},-1)">-</button>
        <span class="qty-value">${it.qty}</span>
        <button class="qty-btn" onclick="dlvChangeQty(${idx},1)">+</button>
      </div>
      <div class="item-price">${(it.qty * it.unitPrice).toFixed(0)} TL</div>
      <button class="item-remove" onclick="dlvRemove(${idx})" title="Sil">&times;</button>
    </div>
  `).join('');
  const total = dlvOrder.items.reduce((s, i) => s + i.qty * i.unitPrice, 0);
  document.getElementById('dlv-total').textContent = total.toFixed(2) + ' TL';
}

async function submitDeliveryOrder() {
  if (dlvOrder.items.length === 0) {
    showToast('En az bir urun ekleyin', 'warning');
    return;
  }
  const address = document.getElementById('dlv-address').value.trim();
  if (!address) {
    showToast('Teslimat adresi zorunludur', 'warning');
    return;
  }
  try {
    const payload = {
      customer: document.getElementById('dlv-customer').value.trim(),
      phone: document.getElementById('dlv-phone').value.trim(),
      address,
      note: document.getElementById('dlv-note').value.trim(),
      paymentMethod: dlvOrder.paymentMethod,
      items: dlvOrder.items
    };
    const order = await api('POST', '/api/orders/delivery', payload);
    showToast('Eve teslim siparisi kaydedildi', 'success');

    // Adisyonu otomatik bas
    try {
      const r = await api('POST', `/api/print/receipt/${order.id}`, {});
      if (r && r.method === 'html' && r.receipt) {
        printHtmlFallback(r.receipt);
      }
    } catch (e) {
      showToast('Adisyon basilamadi: ' + e.message, 'warning');
    }

    dlvOrder = { items: [], paymentMethod: dlvOrder.paymentMethod };
    document.getElementById('dlv-customer').value = '';
    document.getElementById('dlv-phone').value = '';
    document.getElementById('dlv-address').value = '';
    document.getElementById('dlv-note').value = '';
    renderDlvCart();
    loadDeliveryList();
  } catch (err) {
    showToast('Hata: ' + err.message, 'error');
  }
}

async function loadDeliveryList() {
  const el = document.getElementById('dlv-list');
  try {
    const res = await api('GET', '/api/orders/delivery/list');
    const list = res.orders || [];
    if (list.length === 0) {
      el.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;padding:8px;">Bugun eve teslim siparisi yok</p>';
      return;
    }
    el.innerHTML = list.map(o => {
      const t = new Date(o.openedAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
      const cnt = (o.items || []).filter(i => i.status === 'active').length;
      const canDel = userRole === 'yonetici';
      const who = o.customer || 'Musteri';
      const phone = o.phone ? ' - ' + o.phone : '';
      const addr = (o.address || '').replace(/</g, '&lt;');
      const kitchenSent = (o.items || []).some(i => i.printedAt);
      const kitchenLabel = kitchenSent ? 'Mutfak ✓' : 'Mutfaga Gonder';
      return `<div class="order-item" style="align-items:flex-start;flex-wrap:wrap;gap:6px;">
        <div class="item-info" style="flex:1;min-width:0;">
          <div class="item-name">${who}${phone}</div>
          <div class="item-note">${t} - ${cnt} kalem</div>
          <div class="item-note" style="white-space:normal;">${addr}</div>
        </div>
        <div class="item-price">${(o.total || 0).toFixed(0)} TL</div>
        <button class="action-btn secondary" onclick="sendDeliveryToKitchen('${o.id}')" title="Mutfaga Gonder" style="padding:6px 10px;font-size:0.8rem;">${kitchenLabel}</button>
        <button class="action-btn secondary" onclick="reprintDeliveryReceipt('${o.id}')" title="Adisyon Bas" style="padding:6px 10px;font-size:0.8rem;">Adisyon</button>
        ${canDel ? `<button class="item-remove" onclick="deleteDeliveryOrder('${o.id}')" title="Iptal">&times;</button>` : ''}
      </div>`;
    }).join('');
  } catch (err) {
    el.innerHTML = `<p style="color:var(--text-muted);font-size:0.85rem;padding:8px;">Liste yuklenemedi: ${err.message}</p>`;
  }
}

async function sendDeliveryToKitchen(id) {
  try {
    await api('POST', `/api/print/kitchen/${id}`, { onlyNewItems: true });
    showToast('Mutfaga gonderildi', 'success');
    loadDeliveryList();
  } catch (e) {
    showToast('Mutfak fisi basilamadi: ' + e.message, 'error');
  }
}

async function reprintDeliveryReceipt(id) {
  try {
    const r = await api('POST', `/api/print/receipt/${id}`, {});
    if (r && r.method === 'html' && r.receipt) {
      printHtmlFallback(r.receipt);
    }
    showToast('Adisyon yazdirildi', 'success');
  } catch (e) {
    showToast('Adisyon basilamadi: ' + e.message, 'error');
  }
}

async function deleteDeliveryOrder(id) {
  if (!confirm('Bu eve teslim siparisini iptal etmek istediginize emin misiniz?')) return;
  try {
    await api('DELETE', `/api/orders/delivery/${id}`);
    showToast('Eve teslim siparisi iptal edildi', 'info');
    loadDeliveryList();
  } catch (err) {
    showToast('Hata: ' + err.message, 'error');
  }
}

function printHtmlFallback(html) {
  const w = window.open('', '_blank', 'width=380,height=600');
  if (!w) return;
  w.document.write('<html><head><title>Adisyon</title></head><body onload="window.print();setTimeout(()=>window.close(),300);">' + html + '</body></html>');
  w.document.close();
}

// ===== UTILITIES =====
function updateClock() {
  const now = serverDate();
  const el = document.getElementById('stat-date');
  if (el) {
    el.textContent = now.toLocaleDateString('tr-TR', {
      weekday: 'short', day: 'numeric', month: 'short'
    }) + ' ' + now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  }
}

function updateStats() {
  const openTables = tables.filter(t => t.status === 'open').length;
  // Kapatilan adisonlarin cirosu + acik adisonlarin anlık toplami
  const closedRevenue = orders.filter(o => o.status === 'closed').reduce((s, o) => s + o.total, 0);
  const openRevenue = orders.filter(o => o.status === 'open').reduce((s, o) => s + o.total, 0);

  document.getElementById('stat-tables').textContent = openTables + '/' + tables.length;
  document.getElementById('stat-revenue').textContent = (closedRevenue + openRevenue).toFixed(0);
}

function handleConflict(err) {
  if (err.status === 409) {
    showToast('Adisyon baska cihazda guncellendi, yenileniyor...', 'warning');
    loadAllData();
  } else {
    showToast('Hata: ' + err.message, 'error');
  }
}

// --- Modal helpers ---
function openModal(id) { $$rm(id, 'hidden'); }
function closeModal(id) { $$add(id, 'hidden'); }

// --- Toast ---
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// --- API ---
async function api(method, url, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (token) {
    opts.headers['Authorization'] = `Bearer ${token}`;
  }
  if (body && method !== 'GET') {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url, opts);
  const data = await res.json();

  if (!res.ok) {
    const err = new Error(data.error || 'Sunucu hatasi');
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}
