/**
 * Alkyone 2.0 SQLite baglantisi + migration runner.
 *
 * Native bagimlilik YOK — Node yerlesik node:sqlite (DatabaseSync). Boylece
 * node-gyp/derleme gerektirmez; tek dosya DB marka veri dizininde tutulur.
 *
 * Yalnizca brand.features.sqlite aktifken kullanilir; Sakura (json) bu modulu
 * hic yuklemez.
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { getBrand } = require('../../brand');
const { ulid } = require('./ids');
const { nowIso } = require('./time');

let db = null;
let restaurantIdCache = null;

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function runMigrations(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);`);
  const applied = new Set(
    database.prepare('SELECT name FROM _migrations').all().map(r => r.name)
  );
  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    database.exec(sql);
    database.prepare('INSERT INTO _migrations(name, applied_at) VALUES(?, ?)').run(f, nowIso());
    console.log(`[Alkyone DB] migration uygulandi: ${f}`);
  }
}

function getDb() {
  if (db) return db;
  const brand = getBrand();
  fs.mkdirSync(brand.dataDirAbs, { recursive: true });
  db = new DatabaseSync(brand.sqliteFileAbs);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  runMigrations(db);
  ensureRestaurant(db);
  return db;
}

/**
 * Tek restoran satirini garanti et; ULID'i dondur. (Spec: tek restoran, sabit
 * ULID her tabloda restaurant_id olarak kullanilir.)
 */
function ensureRestaurant(database) {
  const row = database.prepare(
    'SELECT id, name FROM restaurants WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1'
  ).get();
  if (row) { restaurantIdCache = row.id; return row.id; }

  let name = 'Restoran';
  try {
    const { loadSettings } = require('../utils/data');
    const s = loadSettings();
    if (s && s.restaurant && s.restaurant.name) name = s.restaurant.name;
  } catch (_) { /* settings yoksa placeholder */ }

  const id = ulid();
  const now = nowIso();
  database.prepare(
    'INSERT INTO restaurants(id, name, created_at, updated_at) VALUES(?,?,?,?)'
  ).run(id, name, now, now);
  restaurantIdCache = id;
  console.log(`[Alkyone DB] restoran olusturuldu: ${name} (${id})`);
  return id;
}

function restaurantId() {
  if (restaurantIdCache) return restaurantIdCache;
  getDb();
  return restaurantIdCache;
}

module.exports = { getDb, restaurantId };
