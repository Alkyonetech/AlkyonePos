/**
 * Alkyone 2.0 analitik hatti — uctan uca birim testi (HTTP yok).
 * Kendi gecici veri dizinini kurar; Sakura verisine DOKUNMAZ.
 *   npm test
 */
const os = require('os');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

// Izole marka + gecici veri dizini (her calismada temiz DB)
process.env.POS_BRAND = 'alkyone';
process.env.POS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'alkyone-test-'));

const { tlToKurus, formatKurus } = require('../src/alkyone/money');
const { ulid } = require('../src/alkyone/ids');
const repo = require('../src/alkyone/repo');
const writer = require('../src/alkyone/writer');
const analytics = require('../src/alkyone/analytics');
const { getDb } = require('../src/alkyone/db');

let pass = 0;
const ok = (m) => { console.log('OK  ' + m); pass++; };

// ULID
const a = ulid(1000), b = ulid(1000), c = ulid(2000);
assert(a.length === 26 && b > a && c > b);
ok('ULID 26 char, monotonik + siralı');

// Para (kurus tam sayi)
assert.strictEqual(tlToKurus(360), 36000);
assert.strictEqual(formatKurus(1050), '10,50');
ok('para kurus: 360 TL = 36000, format 10,50');

// items + tarihsel maliyet
const salmon = repo.upsertItemByExternalRef({ externalRef: 101, name: 'Salmon Roll', category: 'Sushi', salePrice: tlToKurus(320) });
assert.strictEqual(salmon, repo.upsertItemByExternalRef({ externalRef: 101, name: 'Salmon Roll', salePrice: tlToKurus(999) }));
ok('items external_ref idempotent');
repo.addItemCost({ itemId: salmon, cost: tlToKurus(90), effectiveFrom: '2026-01-01T00:00:00Z' });
repo.addItemCost({ itemId: salmon, cost: tlToKurus(120), effectiveFrom: '2026-06-01T00:00:00Z' });
assert.strictEqual(repo.currentCost(salmon, '2026-03-01T00:00:00Z'), tlToKurus(90));
assert.strictEqual(repo.currentCost(salmon, '2026-07-01T00:00:00Z'), tlToKurus(120));
ok('maliyet tarihsel (append-only, sipariс ani snapshot)');

// Faz 2 idempotent yazim + snapshot
const t = '2026-07-06T19:30:00Z';
const mkOrder = (id, lines) => ({
  id, tableId: 5, source: 'masa', status: 'closed', openedAt: t, closedAt: t,
  subtotal: lines.reduce((s, l) => s + l.qty * l.unitPrice, 0), discount: 0,
  total: lines.reduce((s, l) => s + l.qty * l.unitPrice, 0), payment: { method: 'nakit' },
  items: lines.map(l => ({ ...l, status: 'active' })),
});
writer.recordClosedOrder(mkOrder('ord_1', [{ itemId: 101, name: 'Salmon Roll', qty: 2, unitPrice: 320 }]));
writer.recordClosedOrder(mkOrder('ord_1', [{ itemId: 101, name: 'Salmon Roll', qty: 9, unitPrice: 320 }]));
writer.recordClosedOrder(mkOrder('ord_2', [{ itemId: 101, name: 'Salmon Roll', qty: 1, unitPrice: 320 }]));
assert.strictEqual(getDb().prepare('SELECT COUNT(*) n FROM orders').get().n, 2);
ok('Faz2 idempotent: 3 cagri -> 2 order');
assert.strictEqual(getDb().prepare("SELECT unit_cost c FROM order_lines LIMIT 1").get().c, tlToKurus(120));
ok('satis ani maliyet snapshot dogru');

// Faz 3 atik (maliyetten) + CHECK
const nori = repo.createStockItem({ name: 'Nori', unit: 'adet', unitCost: tlToKurus(5) });
assert.strictEqual(repo.createWaste({ stockItemId: nori, qty: 10, reason: 'spoilage', occurredAt: t }).costValue, tlToKurus(50));
ok('Faz3 atik maliyetten: 10 x 5 = 50 TL');
let threw = false;
try { repo.createWaste({ stockItemId: nori, itemId: salmon, qty: 1 }); } catch (_) { threw = true; }
assert(threw);
ok('waste CHECK: iki taraf birlikte reddedildi');

// Faz 4 analitik
const s = analytics.salesByItem(3650).find(x => x.name === 'Salmon Roll');
assert.strictEqual(s.qty, 3);
assert.strictEqual(s.revenue, tlToKurus(960));
assert.strictEqual(s.profit, tlToKurus(600));
ok('Faz4 satis+kar: 3 adet, ciro 960, kar 600 TL');
assert.strictEqual(analytics.wasteSummary(3650).total, tlToKurus(50));
ok('Faz4 israf ozeti toplam 50 TL');
assert(analytics.overview(3650).orders === 2);
ok('Faz4 overview siparis=2');

// temizlik
try { fs.rmSync(process.env.POS_DATA_DIR, { recursive: true, force: true }); } catch (_) {}
console.log(`\n=== ${pass} test GECTI ===`);
