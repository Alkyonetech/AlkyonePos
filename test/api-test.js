/**
 * Sakura POS — Kapsamli API Entegrasyon Testi
 * Calistirmak icin: node test/api-test.js
 * Onkosul: sunucu localhost:3000'de calisiyor olmali
 */

const BASE = 'http://localhost:3000';
let passed = 0;
let failed = 0;
let garsonToken = '';
let yoneticiToken = '';

async function api(method, path, body, token) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  const res = await fetch(BASE + path, opts);
  const data = await res.json();
  return { status: res.status, data };
}

function assert(condition, name) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}`);
    failed++;
  }
}

async function run() {
  console.log('\n=== SAKURA POS API TESTI ===\n');

  // 1. HEALTH & VERSION
  console.log('1. Health & Version');
  {
    const h = await api('GET', '/api/health');
    assert(h.status === 200 && h.data.status === 'ok', 'GET /api/health → 200');

    const v = await api('GET', '/api/version');
    assert(v.status === 200 && v.data.appVersion === '1.0.0', 'GET /api/version → 1.0.0');
  }

  // 2. AUTH
  console.log('\n2. Auth');
  {
    const bad = await api('POST', '/api/auth/login', { pin: '0000' });
    assert(bad.status === 401, 'Yanlis PIN → 401');

    const garson = await api('POST', '/api/auth/login', { pin: '1234' });
    assert(garson.status === 200 && garson.data.role === 'garson', 'Garson login → garson role');
    garsonToken = garson.data.token;

    const yon = await api('POST', '/api/auth/login', { pin: '9999' });
    assert(yon.status === 200 && yon.data.role === 'yonetici', 'Yonetici login → yonetici role');
    yoneticiToken = yon.data.token;

    const noAuth = await api('GET', '/api/orders');
    assert(noAuth.status === 401, 'Orders auth-siz → 401');
  }

  // 3. SETTINGS
  console.log('\n3. Settings');
  {
    const s = await api('GET', '/api/settings');
    assert(s.status === 200 && s.data.restaurant, 'GET /api/settings → restoran bilgisi');
    assert(!s.data.auth?.garsonPin, 'Settings PIN gizli');

    const upd = await api('PUT', '/api/settings', { restaurant: { name: 'Test Restoran' } }, yoneticiToken);
    assert(upd.status === 200, 'PUT /api/settings → basarili');

    // Geri al
    await api('PUT', '/api/settings', { restaurant: { name: 'Sakura Sushi Fulya' } }, yoneticiToken);
  }

  // 4. MENU
  console.log('\n4. Menu');
  {
    const m = await api('GET', '/api/menu');
    assert(m.status === 200 && m.data.categories.length > 0, 'GET /api/menu → kategoriler var');

    // Garson menu guncellemeye calissin
    const fail = await api('PUT', '/api/menu', { version: m.data.version, categories: m.data.categories }, garsonToken);
    assert(fail.status === 403, 'Garson menu guncelleyemez → 403');

    // Version conflict
    const conflict = await api('PUT', '/api/menu', { version: 999, categories: m.data.categories }, yoneticiToken);
    assert(conflict.status === 409, 'Menu version conflict → 409');
  }

  // 5. TABLES
  console.log('\n5. Tables');
  {
    const t = await api('GET', '/api/tables');
    assert(t.status === 200 && t.data.tables.length > 0, 'GET /api/tables → masalar var');

    const tableCount = t.data.tables.length;
    // Yeni masa ekle
    const newTables = [...t.data.tables, { id: 99, name: 'Test Masa', capacity: 2, section: 'salon', currentOrderId: null, status: 'empty' }];
    const upd = await api('PUT', '/api/tables', { version: t.data.version, tables: newTables }, yoneticiToken);
    assert(upd.status === 200 && upd.data.tables.length === tableCount + 1, 'Masa eklendi');

    // Geri al
    const revert = upd.data.tables.filter(x => x.id !== 99);
    await api('PUT', '/api/tables', { version: upd.data.version, tables: revert }, yoneticiToken);
  }

  // 6. ORDERS — Tam akis testi
  console.log('\n6. Orders (tam akis)');
  {
    // Masa 1'e urun ekle (adisyon otomatik acilir)
    const add1 = await api('POST', '/api/orders/1/items', {
      itemId: 1, name: 'Salmon Roll', qty: 2, unitPrice: 420
    }, garsonToken);
    assert(add1.status === 200 && add1.data.items.length === 1, 'Urun eklendi, adisyon acildi');
    assert(add1.data.total === 840, 'Toplam: 840 TL');

    const orderId = add1.data.id;
    const lineId1 = add1.data.items[0].lineId;

    // 2. urun ekle (version kontrolu ile)
    const add2 = await api('POST', '/api/orders/1/items', {
      version: add1.data.version, itemId: 10, name: 'Ramen', qty: 1, unitPrice: 450, note: 'Az aci'
    }, garsonToken);
    assert(add2.status === 200 && add2.data.items.length === 2, '2. urun eklendi');
    assert(add2.data.total === 1290, 'Toplam: 1290 TL');

    // Version conflict testi
    const conflict = await api('POST', '/api/orders/1/items', {
      version: 0, itemId: 20, name: 'Edamame', qty: 1, unitPrice: 195
    }, garsonToken);
    assert(conflict.status === 409, 'Version conflict → 409');

    // Miktar guncelle
    const patch = await api('PATCH', '/api/orders/1/items/' + lineId1, {
      version: add2.data.version, qty: 3
    }, garsonToken);
    assert(patch.status === 200 && patch.data.items[0].qty === 3, 'Miktar guncellendi: 3');
    assert(patch.data.total === 1710, 'Toplam: 1710 TL');

    // Urun sil
    const del = await api('DELETE', '/api/orders/1/items/' + add2.data.items[1].lineId + '?version=' + patch.data.version, null, garsonToken);
    assert(del.status === 200 && del.data.items[1].status === 'cancelled', 'Urun silindi (cancelled)');
    assert(del.data.total === 1260, 'Toplam: 1260 TL');

    // Tek masa adisyon sorgula
    const single = await api('GET', '/api/orders/1', null, garsonToken);
    assert(single.status === 200 && single.data.id === orderId, 'GET /api/orders/1 → dogru adisyon');

    // Hesap kapat (yonetici yetkisi)
    const closeFail = await api('POST', '/api/orders/1/close', { paymentMethod: 'nakit' }, garsonToken);
    assert(closeFail.status === 403, 'Garson hesap kapatamaz → 403');

    const close = await api('POST', '/api/orders/1/close', { paymentMethod: 'kart' }, yoneticiToken);
    assert(close.status === 200 && close.data.status === 'closed', 'Hesap kapatildi');
    assert(close.data.payment.method === 'kart', 'Odeme: kart');

    // Masa durumu bosaldi mi?
    const tables = await api('GET', '/api/tables');
    const masa1 = tables.data.tables.find(t => t.id === 1);
    assert(masa1.status === 'empty', 'Masa 1 bosaldi');
  }

  // 7. MASA TASI
  console.log('\n7. Masa Tasi');
  {
    // Masa 2'ye adisyon ac
    await api('POST', '/api/orders/2/items', { itemId: 1, name: 'Roll', qty: 1, unitPrice: 300 }, garsonToken);

    const transfer = await api('POST', '/api/orders/2/transfer/3', null, yoneticiToken);
    assert(transfer.status === 200 && transfer.data.tableId === 3, 'Masa 2 → Masa 3 tasildi');

    // Temizle
    await api('POST', '/api/orders/3/close', { paymentMethod: 'nakit' }, yoneticiToken);
  }

  // 8. MASA BIRLESTIR
  console.log('\n8. Masa Birlestir');
  {
    // 2 masaya siparis ac
    await api('POST', '/api/orders/1/items', { itemId: 1, name: 'Roll A', qty: 1, unitPrice: 200 }, garsonToken);
    await api('POST', '/api/orders/2/items', { itemId: 2, name: 'Roll B', qty: 1, unitPrice: 300 }, garsonToken);

    const merge = await api('POST', '/api/orders/merge', {
      sourceTableId: 1, targetTableId: 2
    }, yoneticiToken);
    assert(merge.status === 200 && merge.data.merged === true, 'Masalar birlestirildi');
    assert(merge.data.targetOrder.total === 500, 'Birlestirilen toplam: 500 TL');

    // Temizle
    await api('POST', '/api/orders/2/close', { paymentMethod: 'nakit' }, yoneticiToken);
  }

  // 9. GUN KAPAT
  console.log('\n9. Gun Kapat');
  {
    // Once bir adisyon ac ve kapat (rapor verisi icin)
    await api('POST', '/api/orders/1/items', { itemId: 1, name: 'Test Urun', qty: 1, unitPrice: 100 }, garsonToken);
    await api('POST', '/api/orders/1/close', { paymentMethod: 'nakit' }, yoneticiToken);

    const dayClose = await api('POST', '/api/day/close', { force: true }, yoneticiToken);
    assert(dayClose.status === 200 && dayClose.data.success === true, 'Gun kapatildi');
    assert(dayClose.data.summary.totalOrders >= 1, 'Raporda en az 1 adisyon');
  }

  // 10. RAPORLAR
  console.log('\n10. Raporlar');
  {
    const list = await api('GET', '/api/reports', null, yoneticiToken);
    assert(list.status === 200, 'GET /api/reports → basarili');

    if (list.data.reports && list.data.reports.length > 0) {
      const date = list.data.reports[0];
      const detail = await api('GET', `/api/reports/${date}`, null, yoneticiToken);
      assert(detail.status === 200 && detail.data.summary, `Rapor ${date} yuklenebiliyor`);
    }

    // Aylik
    const now = new Date();
    const monthly = await api('GET', `/api/reports/monthly/${now.getFullYear()}/${now.getMonth() + 1}`, null, yoneticiToken);
    assert(monthly.status === 200, 'Aylik rapor → basarili');
  }

  // 11. Adisyon sablon onizleme
  console.log('\n11. Adisyon Sablonu');
  {
    const res = await api('POST', '/api/print/preview', { template: { showRestaurantName: true } }, yoneticiToken);
    assert(res.status === 200 && typeof res.data.html === 'string', 'Adisyon onizleme HTML donuyor');
  }

  // SONUC
  console.log(`\n${'='.repeat(40)}`);
  console.log(`TOPLAM: ${passed + failed} test`);
  console.log(`  Basarili: ${passed}`);
  console.log(`  Basarisiz: ${failed}`);
  console.log(`${'='.repeat(40)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error('Test hatasi:', e); process.exit(1); });
