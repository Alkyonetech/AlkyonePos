/**
 * Sakura POS — Performans / Yuk Testi
 * 15 eszamanli istemci (1 PC + 5 garson tablet + 9 musteri telefonu) simulasyonu.
 *
 * Calistirma:
 *   node test/load-test.js
 *   node test/load-test.js 30        # 30 saniye sure
 *   SAKURA_BASE=http://192.168.1.10:3000 node test/load-test.js
 *
 * Olculen metrikler:
 *   - Toplam istek/sn (RPS)
 *   - p50/p95/p99 latency
 *   - Hata orani
 *   - Version conflict orani (cakisma yuku altinda)
 */

const BASE = process.env.SAKURA_BASE || 'http://localhost:3000';
const DURATION_SEC = parseInt(process.argv[2] || '15', 10);

// Roller: 1 yonetici (POS), 5 garson, 9 anonim menu okuyucu
const CLIENT_PROFILE = {
  yonetici: 1,
  garson: 5,
  musteri: 9,
};

const stats = {
  total: 0,
  errors: 0,
  conflicts: 0,
  latencies: [],
  byEndpoint: {},
};

let stopFlag = false;

async function api(method, p, body, token) {
  const t0 = Date.now();
  let status = 0;
  let data = null;
  try {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (token) opts.headers['Authorization'] = `Bearer ${token}`;
    if (body && method !== 'GET') opts.body = JSON.stringify(body);
    const res = await fetch(BASE + p, opts);
    status = res.status;
    try { data = await res.json(); } catch (e) {}
  } catch (e) {
    status = -1;
  }
  const dt = Date.now() - t0;

  stats.total++;
  stats.latencies.push(dt);
  if (status >= 500 || status < 0) stats.errors++;
  if (status === 409) stats.conflicts++;

  const key = `${method} ${p.split('?')[0].replace(/\d+/g, ':id')}`;
  if (!stats.byEndpoint[key]) stats.byEndpoint[key] = { n: 0, err: 0 };
  stats.byEndpoint[key].n++;
  if (status >= 500 || status < 0) stats.byEndpoint[key].err++;

  return { status, data, dt };
}

async function login(pin) {
  const r = await api('POST', '/api/auth/login', { pin });
  return r.data?.token;
}

// Yonetici davranisi: rapor sorgula, masa bak
async function yoneticiLoop(token) {
  while (!stopFlag) {
    await api('GET', '/api/tables', null, token);
    await api('GET', '/api/orders', null, token);
    await api('GET', '/api/reports', null, token);
    await sleep(rand(800, 2000));
  }
}

// Garson davranisi: masa secip urun ekle/cikar/yenile
async function garsonLoop(token, garsonId) {
  while (!stopFlag) {
    const tableId = rand(1, 10);

    // Mevcut adisyonu cek
    const cur = await api('GET', `/api/orders/${tableId}`, null, token);
    const version = cur.data?.version;

    // Urun ekle
    const add = await api('POST', `/api/orders/${tableId}/items`, {
      version, itemId: rand(1, 5), name: `G${garsonId}-Urun`,
      qty: rand(1, 3), unitPrice: rand(100, 500),
    }, token);

    if (add.status === 409) {
      // Conflict — yeniden cek ve dene
      const fresh = await api('GET', `/api/orders/${tableId}`, null, token);
      await api('POST', `/api/orders/${tableId}/items`, {
        version: fresh.data?.version, itemId: 1, name: 'Retry', qty: 1, unitPrice: 100,
      }, token);
    }

    await sleep(rand(500, 1500));
  }
}

// Musteri davranisi: anonim menu okuma
async function musteriLoop() {
  while (!stopFlag) {
    await api('GET', '/api/menu');
    await sleep(rand(2000, 5000));
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function rand(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }

function pct(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p / 100))];
}

async function main() {
  console.log(`SAKURA POS — YUK TESTI`);
  console.log(`Hedef: ${BASE}`);
  console.log(`Sure: ${DURATION_SEC} saniye`);
  console.log(`Profil: 1 yonetici + 5 garson + 9 anonim okuyucu\n`);

  let yoneticiToken, garsonToken;
  try {
    yoneticiToken = await login('9999');
    garsonToken = await login('1234');
    if (!yoneticiToken || !garsonToken) throw new Error('Login basarisiz');
  } catch (e) {
    console.error('Login hatasi:', e.message);
    console.error('settings.json icindeki PIN dogru mu? (varsayilan 1234/9999)');
    process.exit(1);
  }

  const start = Date.now();
  const tasks = [];

  for (let i = 0; i < CLIENT_PROFILE.yonetici; i++) tasks.push(yoneticiLoop(yoneticiToken));
  for (let i = 0; i < CLIENT_PROFILE.garson; i++) tasks.push(garsonLoop(garsonToken, i));
  for (let i = 0; i < CLIENT_PROFILE.musteri; i++) tasks.push(musteriLoop());

  // Ilerleme cubugu
  const tick = setInterval(() => {
    const elapsed = (Date.now() - start) / 1000;
    const rps = stats.total / Math.max(elapsed, 1);
    process.stdout.write(`\r  ${elapsed.toFixed(0)}s | ${stats.total} istek | ${rps.toFixed(1)} rps | ${stats.errors} hata | ${stats.conflicts} conflict`);
  }, 1000);

  await sleep(DURATION_SEC * 1000);
  stopFlag = true;
  clearInterval(tick);

  // Aktif istekleri bekle
  await sleep(2000);

  const elapsed = (Date.now() - start) / 1000;
  const rps = stats.total / elapsed;

  console.log('\n\n=== SONUC ===');
  console.log(`Toplam istek    : ${stats.total}`);
  console.log(`Sure            : ${elapsed.toFixed(1)}s`);
  console.log(`Throughput      : ${rps.toFixed(1)} req/s`);
  console.log(`Hatalar (5xx)   : ${stats.errors} (${(stats.errors/stats.total*100).toFixed(2)}%)`);
  console.log(`Conflict (409)  : ${stats.conflicts} (beklenir, version-locking saglikli)`);
  console.log(`\nLatency (ms):`);
  console.log(`  p50  : ${pct(stats.latencies, 50)}`);
  console.log(`  p95  : ${pct(stats.latencies, 95)}`);
  console.log(`  p99  : ${pct(stats.latencies, 99)}`);
  console.log(`  max  : ${pct(stats.latencies, 100)}`);

  console.log(`\nEndpoint dagilimi:`);
  Object.entries(stats.byEndpoint)
    .sort(([,a], [,b]) => b.n - a.n)
    .forEach(([k, v]) => {
      console.log(`  ${k.padEnd(40)} ${String(v.n).padStart(6)} (${v.err} err)`);
    });

  console.log('\n=== KABUL KRITERLERI ===');
  const criteria = [
    { name: '5xx hata orani < 1%', ok: stats.errors / stats.total < 0.01 },
    { name: 'p95 latency < 500ms', ok: pct(stats.latencies, 95) < 500 },
    { name: 'p99 latency < 1500ms', ok: pct(stats.latencies, 99) < 1500 },
    { name: 'Throughput > 10 req/s', ok: rps > 10 },
  ];
  criteria.forEach(c => console.log(`  ${c.ok ? '+' : 'X'} ${c.name}`));

  const allOk = criteria.every(c => c.ok);
  process.exit(allOk ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(2); });
