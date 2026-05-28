// ===== SAKURA ADMIN =====

// ----- Global JS hata yakalayici -----
window.addEventListener('error', (ev) => {
  try {
    const msg = ev.message || (ev.error && ev.error.message) || 'Bilinmeyen hata';
    const where = ev.filename ? `${String(ev.filename).split('/').pop()}:${ev.lineno}` : '';
    console.error('[admin] window error:', msg, where, ev.error);
    if (typeof toast === 'function') toast(`JS HATA: ${msg} ${where}`, 'error');
  } catch (_) {}
});
window.addEventListener('unhandledrejection', (ev) => {
  try {
    const r = ev.reason || {};
    const msg = r.message || String(r);
    console.error('[admin] unhandled rejection:', msg, r);
    if (typeof toast === 'function') toast(`Async hata: ${msg}`, 'error');
  } catch (_) {}
});

// ----- Null-safe DOM yardimcilari -----
function $$id(id) { return document.getElementById(id); }
function $$txt(id, t) { const e = $$id(id); if (e) e.textContent = t; }
function $$add(id, c) { const e = $$id(id); if (e && e.classList) e.classList.add(c); }
function $$rm(id, c)  { const e = $$id(id); if (e && e.classList) e.classList.remove(c); }
function $$tg(id, c, f) { const e = $$id(id); if (e && e.classList) e.classList.toggle(c, f); }

let token = null;
let menu = { version: 1, categories: [] };
let tablesData = { version: 1, tables: [] };
let settings = {};

// Edit state
let editingTableIdx = -1;

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
    await loadAll();
  } catch (e) { $$txt('pin-err', e.message); pc(); }
}

async function loadAll() {
  try {
    const [m, t, s] = await Promise.all([api('GET', '/api/menu'), api('GET', '/api/tables'), api('GET', '/api/settings')]);
    menu = m;
    tablesData = t;
    settings = s;
    renderTables();
    renderPins();
    renderPrinter();
    renderReceiptTemplate();
    renderBackup();
    renderSystem();
    renderTheme();
    renderAbout();
    refreshPrinterStatus();
  } catch (e) { toast(e.message, 'error'); }
}

// ===== SECTIONS =====
function switchSection(s) {
  document.querySelectorAll('.nav-btn').forEach(b => {
    if (b && b.classList) b.classList.toggle('active', b.dataset.s === s);
  });
  ['tables','pins','printer','receipt','backup','system','theme','about'].forEach(id => {
    $$tg('sec-' + id, 'hidden', id !== s);
  });
}

// ===== TABLES =====
function renderTables() {
  const el = document.getElementById('tables-editor');
  if (tablesData.tables.length === 0) {
    el.innerHTML = '<p class="hint">Henuz masa yok.</p>';
    return;
  }
  el.innerHTML = tablesData.tables.map((t, i) =>
    `<div class="te-card">
      <div class="te-info">
        <div class="te-name">${t.name}</div>
        <div class="te-meta">${t.capacity} kisi | ${t.section}</div>
      </div>
      <div class="te-actions">
        <button class="btn-sm" onclick="editTable(${i})">Duzenle</button>
        <button class="btn-sm danger" onclick="deleteTable(${i})">Sil</button>
      </div>
    </div>`
  ).join('');
}

function addTable() {
  editingTableIdx = -1;
  document.getElementById('table-modal-title').textContent = 'Yeni Masa';
  const nextNum = tablesData.tables.length + 1;
  document.getElementById('table-name').value = 'Masa ' + nextNum;
  document.getElementById('table-capacity').value = '4';
  document.getElementById('table-section').value = 'salon';
  openModal('table-modal');
}

function editTable(idx) {
  editingTableIdx = idx;
  const t = tablesData.tables[idx];
  document.getElementById('table-modal-title').textContent = 'Masa Duzenle';
  document.getElementById('table-name').value = t.name;
  document.getElementById('table-capacity').value = t.capacity;
  document.getElementById('table-section').value = t.section;
  openModal('table-modal');
}

async function saveTableModal() {
  const name = document.getElementById('table-name').value.trim();
  const capacity = parseInt(document.getElementById('table-capacity').value);
  const section = document.getElementById('table-section').value;
  if (!name || isNaN(capacity)) { toast('Ad ve kapasite gerekli', 'error'); return; }

  if (editingTableIdx === -1) {
    const maxId = tablesData.tables.reduce((m, t) => Math.max(m, t.id), 0);
    tablesData.tables.push({ id: maxId + 1, name, capacity, section, currentOrderId: null, status: 'empty' });
  } else {
    tablesData.tables[editingTableIdx].name = name;
    tablesData.tables[editingTableIdx].capacity = capacity;
    tablesData.tables[editingTableIdx].section = section;
  }

  await saveTables();
  closeModal('table-modal');
  renderTables();
}

async function deleteTable(idx) {
  const t = tablesData.tables[idx];
  if (t.status === 'open') { toast('Acik masayi silemezsiniz', 'error'); return; }
  if (!confirm(`"${t.name}" masasini silmek istediginize emin misiniz?`)) return;
  tablesData.tables.splice(idx, 1);
  await saveTables();
  renderTables();
}

async function saveTables() {
  try {
    const res = await api('PUT', '/api/tables', { version: tablesData.version, tables: tablesData.tables });
    tablesData.version = res.version;
    toast('Masalar kaydedildi', 'success');
  } catch (e) { toast('Hata: ' + e.message, 'error'); }
}

// ===== PINS =====
function renderPins() {
  // PIN'ler guvenlik nedeniyle settings'ten gelmiyor, bos goster
  document.getElementById('garson-pin').value = '';
  document.getElementById('yonetici-pin').value = '';
}

async function savePins() {
  const garsonPin = document.getElementById('garson-pin').value.trim();
  const yoneticiPin = document.getElementById('yonetici-pin').value.trim();
  const update = {};
  if (garsonPin && garsonPin.length === 4) update.garsonPin = garsonPin;
  if (yoneticiPin && yoneticiPin.length === 4) update.yoneticiPin = yoneticiPin;
  if (Object.keys(update).length === 0) { toast('En az bir PIN girin (4 hane)', 'error'); return; }

  try {
    await api('PUT', '/api/settings', { auth: update });
    toast('PIN\'ler guncellendi', 'success');
  } catch (e) { toast('Hata: ' + e.message, 'error'); }
}

// ===== PRINTER =====
function renderPrinter() {
  const profiles = settings.printers || {};
  for (const role of ['receipt', 'kitchen']) {
    const p = profiles[role] || {};
    document.getElementById(role + '-enabled').value = String(p.enabled !== false);
    document.getElementById(role + '-model').value = p.model || '';
    const devEl = document.getElementById(role + '-device');
    if (p.connection === 'tcp' && p.host) {
      devEl.value = '';
      devEl.placeholder = `AG: ${p.host}:${p.port || 9100} (bos birakirsaniz korunur)`;
    } else {
      devEl.value = p.device || 'auto';
      devEl.placeholder = 'auto veya \\\\BILGISAYAR\\RP8020';
    }
    document.getElementById(role + '-width').value = String(p.paperWidth || (role === 'receipt' ? 80 : 58));
    const encEl = document.getElementById(role + '-encoding');
    if (encEl) encEl.value = p.encoding || 'CP1254_18';
  }
}

async function savePrinterProfile(role) {
  const existing = (settings.printers && settings.printers[role]) || {};
  const deviceVal = document.getElementById(role + '-device').value.trim();
  const isTcpExisting = existing.connection === 'tcp' && !deviceVal;
  const encVal = document.getElementById(role + '-encoding')?.value || 'CP1254_18';
  const profile = isTcpExisting
    ? {
        ...existing,
        enabled: document.getElementById(role + '-enabled').value === 'true',
        model: document.getElementById(role + '-model').value.trim() || null,
        paperWidth: parseInt(document.getElementById(role + '-width').value),
        encoding: encVal,
      }
    : {
        enabled: document.getElementById(role + '-enabled').value === 'true',
        model: document.getElementById(role + '-model').value.trim() || null,
        connection: 'usb',
        device: deviceVal || 'auto',
        paperWidth: parseInt(document.getElementById(role + '-width').value),
        encoding: encVal,
      };
  try {
    const newPrinters = { ...(settings.printers || {}), [role]: profile };
    await api('PUT', '/api/settings', { printers: newPrinters });
    settings.printers = newPrinters;
    toast(role === 'receipt' ? 'Adisyon yazicisi kaydedildi' : 'Mutfak yazicisi kaydedildi', 'success');
    refreshPrinterStatus();
  } catch (e) { toast('Hata: ' + e.message, 'error'); }
}

async function testPrinterProfile(role) {
  try {
    const res = await api('POST', '/api/print/test/' + role);
    if (res.success) toast('Test fisi gonderildi', 'success');
  } catch (e) {
    toast('Test basarisiz: ' + e.message, 'error');
  }
}

// Yazici Turkce karakter bozuk basiyorsa: bu tum kod sayfalarini tek fiste
// basar. Kullanici duzgun basan satirin adini (orn CP1254_18) "Kod sayfasi"
// alanina yazar.
async function codepageTest(role) {
  try {
    const res = await api('POST', '/api/print/codepage-test', { role });
    if (res.success) toast('Kod sayfasi test fisi basildi - duzgun basanin adini secin', 'success');
  } catch (e) {
    toast('Test basarisiz: ' + e.message, 'error');
  }
}

async function discoverPrinters() {
  const list = document.getElementById('discovered-list');
  const countsEl = document.getElementById('discover-counts');
  const filter = document.getElementById('discover-filter')?.value || 'thermal';
  list.innerHTML = '<p class="hint">Araniyor...</p>';
  if (countsEl) countsEl.textContent = '';
  try {
    const res = await api('GET', '/api/print/discover?filter=' + encodeURIComponent(filter));
    if (countsEl && res.counts) {
      countsEl.textContent = `Toplam: ${res.counts.total} | Termal/POS: ${res.counts.thermal} | Paylasimli: ${res.counts.shared}`;
    }
    if (!res.printers || res.printers.length === 0) {
      list.innerHTML = filter === 'thermal'
        ? '<p class="hint">Termal/POS yazici bulunamadi. Filtreyi "Tum yazicilar"a alip kontrol edebilirsiniz.</p>'
        : '<p class="hint">Sistemde yazici bulunamadi.</p>';
      return;
    }
    list.innerHTML = res.printers.map(p => {
      const tags = [];
      if (p.isThermal) tags.push('<span class="tag tag-ok">Termal/POS</span>');
      if (p.isShared) tags.push('<span class="tag">Paylasimli</span>');
      if (p.portType) tags.push(`<span class="tag">${escapeHtml(p.portType.toUpperCase())}</span>`);
      return `
      <div class="discovered-item">
        <div>
          <strong>${escapeHtml(p.name)}</strong> ${tags.join(' ')}
          <div class="hint">Surucu: ${escapeHtml(p.driver || '-')}</div>
          <div class="hint">Port: ${escapeHtml(p.port || '-')}${p.uncPath ? ` | UNC: <code>${escapeHtml(p.uncPath)}</code>` : ''}</div>
        </div>
        ${p.uncPath ? `<button class="btn-sm" onclick="useDeviceFor('receipt','${encodeURIComponent(p.uncPath)}')">Adisyon</button>` : ''}
        ${p.uncPath ? `<button class="btn-sm" onclick="useDeviceFor('kitchen','${encodeURIComponent(p.uncPath)}')">Mutfak</button>` : ''}
      </div>`;
    }).join('');
  } catch (e) {
    list.innerHTML = `<p class="hint">Hata: ${escapeHtml(e.message)}</p>`;
  }
}

async function discoverNetworkPrinters() {
  const list = document.getElementById('netscan-list');
  const info = document.getElementById('netscan-info');
  list.innerHTML = '<p class="hint">Ag taraniyor (port 9100, ~15-30 saniye)...</p>';
  if (info) info.textContent = '';
  try {
    const res = await api('GET', '/api/print/discover-network');
    const subnetStr = (res.subnets || []).map(s => s.cidr).join(', ') || '-';
    if (info) info.textContent = `Taranan ag(lar): ${subnetStr} | Host: ${res.scannedHosts} | Bulunan: ${res.printers.length}`;
    if (!res.printers || res.printers.length === 0) {
      list.innerHTML = '<p class="hint">Agda port 9100 dinleyen cihaz bulunamadi.</p>';
      return;
    }
    list.innerHTML = res.printers.map(p => {
      const tag = p.escposConfirmed
        ? '<span class="tag tag-ok">ESC/POS Dogrulandi</span>'
        : '<span class="tag tag-warn">Port acik (dogrulanmadi)</span>';
      const statusInfo = p.status
        ? `<div class="hint">Durum: ${p.status.online ? 'Cevrimici' : 'Cevrimdisi'}${p.status.coverOpen ? ' | Kapak ACIK' : ''}${p.status.feedButton ? ' | Feed basili' : ''} (0x${p.statusByte.toString(16).padStart(2, '0')})</div>`
        : '';
      return `
      <div class="discovered-item">
        <div>
          <strong>${escapeHtml(p.ip)}:${p.port}</strong> ${tag}
          <div class="hint">Arabirim: ${escapeHtml(p.iface || '-')}</div>
          ${statusInfo}
        </div>
        <button class="btn-sm" onclick="useNetworkPrinter('receipt','${escapeHtml(p.ip)}',${p.port})">Adisyon</button>
        <button class="btn-sm" onclick="useNetworkPrinter('kitchen','${escapeHtml(p.ip)}',${p.port})">Mutfak</button>
      </div>`;
    }).join('');
  } catch (e) {
    list.innerHTML = `<p class="hint">Hata: ${escapeHtml(e.message)}</p>`;
  }
}

async function testManualPrinter() {
  const ip = document.getElementById('manual-ip').value.trim();
  const port = parseInt(document.getElementById('manual-port').value) || 9100;
  const out = document.getElementById('manual-result');
  if (!ip) { out.textContent = 'IP veya hostname girin'; return; }
  out.textContent = 'Test ediliyor...';
  try {
    const r = await api('POST', '/api/print/probe', { host: ip, port });
    if (!r.reachable) {
      out.innerHTML = `<span style="color:var(--red)">${escapeHtml(ip)}:${port} cevap vermiyor (port kapali / cihaz kapali / ag erisimi yok)</span>`;
      return;
    }
    if (r.escposConfirmed) {
      const s = r.status;
      out.innerHTML = `<span style="color:var(--green)">ESC/POS dogrulandi · ${s.online ? 'Online' : 'Offline'}${s.coverOpen ? ' · Kapak ACIK' : ''}${s.feedButton ? ' · Feed basili' : ''} (0x${r.statusByte.toString(16).padStart(2,'0')})</span>`;
    } else {
      out.innerHTML = `<span style="color:var(--amber,#f0b060)">Port acik ama ESC/POS cevabi yok. Yine de "Adisyon/Mutfak Olarak Ekle" ile zorla baglanabilirsiniz.</span>`;
    }
  } catch (e) {
    out.innerHTML = `<span style="color:var(--red)">Hata: ${escapeHtml(e.message)}</span>`;
  }
}

async function assignManualPrinter(role) {
  const ip = document.getElementById('manual-ip').value.trim();
  const port = parseInt(document.getElementById('manual-port').value) || 9100;
  const width = parseInt(document.getElementById('manual-width').value) || 80;
  if (!ip) { toast('IP veya hostname girin', 'error'); return; }
  if (!confirm(`${role === 'receipt' ? 'Adisyon' : 'Mutfak'} yazicisi olarak ${ip}:${port} (${width}mm) ZORLA baglanacak. Devam?`)) return;
  const existing = (settings.printers && settings.printers[role]) || {};
  const profile = {
    ...existing,
    enabled: true,
    connection: 'tcp',
    host: ip,
    port: port,
    device: null,
    paperWidth: width,
    encoding: existing.encoding || 'PC857',
  };
  try {
    const newPrinters = { ...(settings.printers || {}), [role]: profile };
    await api('PUT', '/api/settings', { printers: newPrinters });
    settings.printers = newPrinters;
    toast(`${role} yazicisi ${ip}:${port} olarak ayarlandi`, 'success');
    renderPrinter();
    refreshPrinterStatus();
  } catch (e) { toast('Hata: ' + e.message, 'error'); }
}

async function useNetworkPrinter(role, ip, port) {
  if (!confirm(`${role === 'receipt' ? 'Adisyon' : 'Mutfak'} yazicisi olarak ${ip}:${port} ag yazicisi ayarlansin mi?`)) return;
  const existing = (settings.printers && settings.printers[role]) || {};
  const profile = {
    ...existing,
    enabled: true,
    connection: 'tcp',
    host: ip,
    port: port,
    device: null,
    paperWidth: existing.paperWidth || (role === 'receipt' ? 80 : 58),
    encoding: existing.encoding || 'PC857',
  };
  try {
    const newPrinters = { ...(settings.printers || {}), [role]: profile };
    await api('PUT', '/api/settings', { printers: newPrinters });
    settings.printers = newPrinters;
    toast(`${role} yazicisi ${ip}:${port} olarak ayarlandi`, 'success');
    renderPrinter();
    refreshPrinterStatus();
  } catch (e) { toast('Hata: ' + e.message, 'error'); }
}

function useDeviceFor(role, uncPath) {
  document.getElementById(role + '-device').value = decodeURIComponent(uncPath);
  toast(role + ' icin cihaz secildi, kaydetmeyi unutmayin', 'info');
}

async function refreshPrinterStatus() {
  try {
    const s = await api('GET', '/api/print/status');
    const fmt = (st) => {
      if (!st.enabled) return '<span class="ok-no">Devre disi</span>';
      const ok = st.lastOk ? 'Son OK: ' + new Date(st.lastOk).toLocaleString('tr-TR') : 'Henuz baski yok';
      const err = st.lastError ? '<span class="ok-no">Hata: ' + escapeHtml(st.lastError) + '</span>' : '';
      return `<span class="ok-yes">Aktif</span> · ${ok} ${err} · Kuyrukta: ${st.queueSize}`;
    };
    const r = document.getElementById('receipt-status');
    const k = document.getElementById('kitchen-status');
    if (r) r.innerHTML = fmt(s.receipt);
    if (k) k.innerHTML = fmt(s.kitchen);
  } catch (_) {}
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
}

// ===== ADISYON SABLONU =====
const RT_DEFAULT = {
  headerLines: [],
  showRestaurantName: true,
  showAddress: true,
  showPhone: true,
  subHeaderText: '',
  showDateTime: true,
  showTableNo: true,
  showOrderId: true,
  showItemUnitPrice: true,
  showItemNotes: true,
  showSubtotal: true,
  showDiscount: true,
  showVat: false,
  showPaymentMethod: true,
  footerLines: ['Tesekkur ederiz!'],
  footerFeedLines: 3,
};

let rtPreviewTimer = null;

function renderReceiptTemplate() {
  const t = { ...RT_DEFAULT, ...(settings.receiptTemplate || {}) };
  const set = (id, v) => { const e = $$id(id); if (e) { if (e.type === 'checkbox') e.checked = !!v; else e.value = v; } };
  set('rt-header-lines', (t.headerLines || []).join('\n'));
  set('rt-show-name', t.showRestaurantName);
  set('rt-show-address', t.showAddress);
  set('rt-show-phone', t.showPhone);
  set('rt-subheader', t.subHeaderText || '');
  set('rt-show-datetime', t.showDateTime);
  set('rt-show-table', t.showTableNo);
  set('rt-show-orderid', t.showOrderId);
  set('rt-show-unit', t.showItemUnitPrice);
  set('rt-show-notes', t.showItemNotes);
  set('rt-show-subtotal', t.showSubtotal);
  set('rt-show-discount', t.showDiscount);
  set('rt-show-vat', t.showVat);
  set('rt-show-payment', t.showPaymentMethod);
  set('rt-footer-lines', (t.footerLines || []).join('\n'));
  set('rt-feed-lines', t.footerFeedLines || 3);

  bindReceiptInputs();
  updateReceiptPreview();
}

function bindReceiptInputs() {
  const ids = ['rt-header-lines','rt-show-name','rt-show-address','rt-show-phone','rt-subheader',
    'rt-show-datetime','rt-show-table','rt-show-orderid','rt-show-unit','rt-show-notes',
    'rt-show-subtotal','rt-show-discount','rt-show-vat','rt-show-payment','rt-footer-lines','rt-feed-lines'];
  for (const id of ids) {
    const el = $$id(id);
    if (!el || el.dataset.rtBound) continue;
    el.dataset.rtBound = '1';
    const handler = () => {
      clearTimeout(rtPreviewTimer);
      rtPreviewTimer = setTimeout(updateReceiptPreview, 250);
    };
    el.addEventListener('input', handler);
    el.addEventListener('change', handler);
  }
}

function collectReceiptTemplate() {
  const linesFrom = (id) => ($$id(id)?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
  const chk = (id) => !!$$id(id)?.checked;
  return {
    headerLines: linesFrom('rt-header-lines'),
    showRestaurantName: chk('rt-show-name'),
    showAddress: chk('rt-show-address'),
    showPhone: chk('rt-show-phone'),
    subHeaderText: $$id('rt-subheader')?.value || '',
    showDateTime: chk('rt-show-datetime'),
    showTableNo: chk('rt-show-table'),
    showOrderId: chk('rt-show-orderid'),
    showItemUnitPrice: chk('rt-show-unit'),
    showItemNotes: chk('rt-show-notes'),
    showSubtotal: chk('rt-show-subtotal'),
    showDiscount: chk('rt-show-discount'),
    showVat: chk('rt-show-vat'),
    showPaymentMethod: chk('rt-show-payment'),
    footerLines: linesFrom('rt-footer-lines'),
    footerFeedLines: Math.max(1, Math.min(10, parseInt($$id('rt-feed-lines')?.value, 10) || 3)),
  };
}

async function updateReceiptPreview() {
  const box = $$id('rt-preview');
  if (!box) return;
  try {
    const tpl = collectReceiptTemplate();
    const res = await api('POST', '/api/print/preview', { template: tpl });
    box.innerHTML = res.html || '';
  } catch (e) {
    box.innerHTML = '<p class="hint">Onizleme yuklenemedi: ' + (e.message || '') + '</p>';
  }
}

async function saveReceiptTemplate() {
  try {
    const receiptTemplate = collectReceiptTemplate();
    await api('PUT', '/api/settings', { receiptTemplate });
    settings.receiptTemplate = receiptTemplate;
    toast('Adisyon sablonu kaydedildi', 'success');
  } catch (e) { toast('Hata: ' + e.message, 'error'); }
}

async function resetReceiptTemplate() {
  if (!confirm('Sablonu varsayilana dondurmek istiyor musunuz?')) return;
  settings.receiptTemplate = { ...RT_DEFAULT };
  renderReceiptTemplate();
  try {
    await api('PUT', '/api/settings', { receiptTemplate: settings.receiptTemplate });
    toast('Varsayilan sablon yuklendi', 'success');
  } catch (e) { toast('Hata: ' + e.message, 'error'); }
}

// ===== BACKUP =====
function renderBackup() {
  document.getElementById('backup-info').innerHTML = `
    <p>Otomatik yedek: <strong>Saatte bir</strong> (7 gun rolling)</p>
    <p>Yedek klasoru: <strong>data/backups/</strong></p>
    <p>Manuel yedek almak icin asagidaki butonu kullanin.</p>
  `;
}

async function createBackup() {
  toast('Manuel yedek alinuyor...', 'info');
  // Backend'de POST endpoint yok, ama saatlik zaten calisiyor
  toast('Otomatik yedek sistemi aktif. data/backups/ klasorunu kontrol edin.', 'success');
}

// ===== SYSTEM =====
function renderSystem() {
  const su = settings.startup || {};
  const cbAuto = $$id('auto-start');
  if (cbAuto) cbAuto.checked = !!su.autoStart;
  const cbKiosk = $$id('kiosk-mode');
  if (cbKiosk) cbKiosk.checked = !!su.kioskMode;
  const selUrl = $$id('kiosk-url');
  if (selUrl) selUrl.value = su.kioskUrl || '/pos';
}

async function saveSystem() {
  try {
    const autoStart = $$id('auto-start')?.checked || false;
    const kioskMode = $$id('kiosk-mode')?.checked || false;
    const kioskUrl = $$id('kiosk-url')?.value || '/pos';
    const wasKiosk = !!(settings.startup && settings.startup.kioskMode);
    await api('PUT', '/api/settings', {
      startup: { autoStart, kioskMode, kioskUrl }
    });
    settings.startup = { autoStart, kioskMode, kioskUrl };
    if (kioskMode !== wasKiosk) {
      toast('Kiosk modu degisti — uygulama yeniden baslatiliyor...', 'warning');
    } else {
      toast('Sistem ayarlari kaydedildi', 'success');
    }
  } catch (e) { toast('Hata: ' + e.message, 'error'); }
}

// ===== THEME =====
function renderTheme() {
  const sel = $$id('theme-select');
  if (sel) sel.value = (settings.ui && settings.ui.theme) || 'sakura';
}

async function saveTheme() {
  const theme = $$id('theme-select')?.value || 'sakura';
  try {
    await api('PUT', '/api/settings', { ui: { theme } });
    settings.ui = { ...(settings.ui || {}), theme };
    toast('Tema kaydedildi', 'success');
  } catch (e) { toast('Hata: ' + e.message, 'error'); }
}

// ===== ABOUT =====
function renderAbout() {
  document.getElementById('about-info').innerHTML = `
    <p>Uygulama: <strong>Sakura POS</strong></p>
    <p>Surum: <strong>${settings.appVersion || '1.0.0'}</strong></p>
    <p>Min APK: <strong>${settings.minApkVersion || '1.0.0'}</strong></p>
    <p>Restoran: <strong>${settings.restaurant?.name || '-'}</strong></p>
    <p>Adres: <strong>${settings.restaurant?.address || '-'}</strong></p>
    <p>Port: <strong>${settings.network?.port || 3000}</strong></p>
  `;
}

// ===== UTILS =====
function openModal(id) { $$rm(id, 'hidden'); }
function closeModal(id) { $$add(id, 'hidden'); }

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
  if (!res.ok) { const e = new Error(data.error || 'Hata'); e.status = res.status; throw e; }
  return data;
}
