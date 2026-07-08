/* Yonetici musteri/adres yonetimi (2.1). Uçlar: /api/customers */

async function req(method, url, body) {
  const opt = { method, headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' } };
  if (body !== undefined) opt.body = JSON.stringify(body);
  const r = await fetch(url, opt);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
  return data;
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtDate(s) { if (!s) return '-'; const d = new Date(s); return isNaN(d) ? '-' : d.toLocaleDateString('tr-TR'); }

let searchTimer = null;
function onSearch() { clearTimeout(searchTimer); searchTimer = setTimeout(loadList, 250); }

async function loadList() {
  const q = document.getElementById('q').value.trim();
  const list = document.getElementById('list');
  let res;
  try { res = await req('GET', '/api/customers?q=' + encodeURIComponent(q)); }
  catch (e) { list.innerHTML = `<div class="empty">Hata: ${esc(e.message)}</div>`; return; }
  const cs = res.customers || [];
  if (!cs.length) { list.innerHTML = `<div class="empty">${q ? 'Sonuc yok' : 'Henuz kayitli musteri yok'}</div>`; return; }
  list.innerHTML = cs.map(c => `
    <div class="cust" id="c-${esc(c.id)}">
      <div class="cust-head" onclick="toggle('${esc(c.id)}')">
        <div>
          <div class="nm">${esc(c.name || '(isimsiz)')}</div>
          <div class="ph">${esc(c.phone || '-')}</div>
        </div>
        <div class="meta">${c.addressCount} adres · ${c.orderCount} sip.<br>Son: ${fmtDate(c.lastOrderAt)}</div>
      </div>
      <div class="cust-body" id="b-${esc(c.id)}"></div>
    </div>`).join('');
}

const openSet = new Set();
async function toggle(id) {
  const card = document.getElementById('c-' + id);
  const body = document.getElementById('b-' + id);
  if (card.classList.contains('open')) { card.classList.remove('open'); openSet.delete(id); return; }
  card.classList.add('open'); openSet.add(id);
  body.innerHTML = '<div class="muted">Yukleniyor...</div>';
  try {
    const { customer } = await req('GET', '/api/customers/' + id);
    renderBody(id, customer);
  } catch (e) { body.innerHTML = `<div class="muted">Hata: ${esc(e.message)}</div>`; }
}

function renderBody(id, c) {
  const body = document.getElementById('b-' + id);
  const addrs = (c.addresses || []).map(a => `
    <div class="addr">
      <div class="txt">📍 ${esc(a.text)}${a.note ? `<div class="note">${esc(a.note)}</div>` : ''}</div>
      <button class="danger" onclick="delAddr('${esc(id)}','${esc(a.id)}')">Sil</button>
    </div>`).join('') || '<div class="muted">Kayitli adres yok</div>';
  body.innerHTML = `
    <div class="edit-grid">
      <input id="e-name-${esc(id)}" value="${esc(c.name || '')}" placeholder="Ad">
      <input id="e-phone-${esc(id)}" value="${esc(c.phone || '')}" placeholder="Telefon">
    </div>
    <div class="rowbtns">
      <button class="primary" onclick="saveEdit('${esc(id)}')">Kaydet</button>
      <button class="danger" onclick="delCustomer('${esc(id)}')">Musteriyi Sil</button>
    </div>
    <div style="margin-top:12px">${addrs}</div>`;
}

async function saveEdit(id) {
  const name = document.getElementById('e-name-' + id).value.trim();
  const phone = document.getElementById('e-phone-' + id).value.trim();
  try { await req('PUT', '/api/customers/' + id, { name, phone }); await loadList(); reopen(id); }
  catch (e) { alert('Hata: ' + e.message); }
}
async function delAddr(id, addrId) {
  if (!confirm('Adres silinsin mi?')) return;
  try { const { customer } = await req('DELETE', `/api/customers/${id}/addresses/${addrId}`); renderBody(id, customer); }
  catch (e) { alert('Hata: ' + e.message); }
}
async function delCustomer(id) {
  if (!confirm('Musteri ve tum adresleri silinsin mi?')) return;
  try { await req('DELETE', '/api/customers/' + id); openSet.delete(id); await loadList(); }
  catch (e) { alert('Hata: ' + e.message); }
}
async function reopen(id) { const card = document.getElementById('c-' + id); if (card && openSet.has(id)) toggle(id); }

function openNew() {
  ['n-name', 'n-phone', 'n-address', 'n-note'].forEach(i => document.getElementById(i).value = '');
  document.getElementById('new-dlg').showModal();
}
async function saveNew() {
  const name = document.getElementById('n-name').value.trim();
  const phone = document.getElementById('n-phone').value.trim();
  const address = document.getElementById('n-address').value.trim();
  const note = document.getElementById('n-note').value.trim();
  if (!name && !phone) { alert('Ad veya telefon gerekli'); return; }
  try { await req('POST', '/api/customers', { name, phone, address, note }); document.getElementById('new-dlg').close(); await loadList(); }
  catch (e) { alert('Hata: ' + e.message); }
}

loadList();
