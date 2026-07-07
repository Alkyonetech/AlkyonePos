-- Alkyone POS 2.0 — Baslangic semasi (spec Bolum 4: 7 tablo)
-- Ortak sutunlar her tabloda: id (ULID PK), restaurant_id, created_at,
-- updated_at, deleted_at (soft delete). Hard delete YOK.
-- Para = INTEGER kurus. Zaman = TEXT ISO-8601 UTC.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS restaurants (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);

-- mamul / menu urunu (California Roll). stock_items ile KARISTIRMA (Kural #3).
CREATE TABLE IF NOT EXISTS items (
  id             TEXT PRIMARY KEY,
  restaurant_id  TEXT NOT NULL,
  name           TEXT NOT NULL,
  category       TEXT,
  sale_price     INTEGER NOT NULL DEFAULT 0,   -- kurus
  is_active      INTEGER NOT NULL DEFAULT 1,
  external_ref   TEXT,                          -- kaynak POS menu id eslemesi
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_items_rest ON items(restaurant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_items_extref ON items(restaurant_id, external_ref);

-- append-only, tarihsel maliyet (Kural #5: mevcut maliyetin uzerine YAZMA).
-- guncel maliyet = effective_from <= now olan en son kayit.
CREATE TABLE IF NOT EXISTS item_cost_history (
  id             TEXT PRIMARY KEY,
  restaurant_id  TEXT NOT NULL,
  item_id        TEXT NOT NULL REFERENCES items(id),
  cost           INTEGER NOT NULL,              -- kurus
  effective_from TEXT NOT NULL,
  source         TEXT,                          -- manual | estimate_pct | import
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_cost_item ON item_cost_history(item_id, effective_from);

-- siparis / masa oturumu
CREATE TABLE IF NOT EXISTS orders (
  id             TEXT PRIMARY KEY,
  restaurant_id  TEXT NOT NULL,
  table_id       TEXT,
  external_ref   TEXT,                          -- kaynak POS order id (idempotent yazim)
  opened_at      TEXT,
  closed_at      TEXT,
  covers         INTEGER,
  payment_type   TEXT,
  order_type     TEXT,                          -- dine_in | takeaway | delivery
  subtotal       INTEGER NOT NULL DEFAULT 0,    -- kurus
  discount       INTEGER NOT NULL DEFAULT 0,    -- kurus
  total          INTEGER NOT NULL DEFAULT 0,    -- kurus
  status         TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_rest ON orders(restaurant_id, closed_at) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_extref ON orders(restaurant_id, external_ref) WHERE external_ref IS NOT NULL;

-- satir kalemi. unit_price = SATIS ANI snapshot'i (Kural #4: canli fiyata FK verme).
CREATE TABLE IF NOT EXISTS order_lines (
  id             TEXT PRIMARY KEY,
  restaurant_id  TEXT NOT NULL,
  order_id       TEXT NOT NULL REFERENCES orders(id),
  item_id        TEXT REFERENCES items(id),
  name_snapshot  TEXT,                          -- urun adi (silinse bile rapor okunur)
  qty            INTEGER NOT NULL DEFAULT 1,
  unit_price     INTEGER NOT NULL DEFAULT 0,    -- kurus, SNAPSHOT
  unit_cost      INTEGER,                       -- kurus, satis anindaki maliyet snapshot'i
  line_total     INTEGER NOT NULL DEFAULT 0,    -- kurus
  is_ikram       INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_lines_order ON order_lines(order_id);
CREATE INDEX IF NOT EXISTS idx_lines_item ON order_lines(restaurant_id, item_id);

-- hammadde (somon, pirinc, nori — cope giden bu). items ile ayri katman (Kural #3).
CREATE TABLE IF NOT EXISTS stock_items (
  id             TEXT PRIMARY KEY,
  restaurant_id  TEXT NOT NULL,
  name           TEXT NOT NULL,
  unit           TEXT,                          -- kg | adet | lt
  unit_cost      INTEGER NOT NULL DEFAULT 0,    -- kurus (birim basi)
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_stock_rest ON stock_items(restaurant_id) WHERE deleted_at IS NULL;

-- fire / atik. cost_value MALIYETTEN turetilir (Kural #2: satis fiyatindan ASLA).
CREATE TABLE IF NOT EXISTS waste_log (
  id             TEXT PRIMARY KEY,
  restaurant_id  TEXT NOT NULL,
  stock_item_id  TEXT REFERENCES stock_items(id),  -- ana durum: hammadde firesi
  item_id        TEXT REFERENCES items(id),        -- nadir: bitmis tabak kaybi
  qty            REAL NOT NULL DEFAULT 0,
  cost_value     INTEGER NOT NULL DEFAULT 0,        -- kurus, MALIYETTEN
  reason         TEXT,                              -- spoilage | wrong_order | overprep | other
  occurred_at    TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT,
  -- tam olarak biri dolu olmali
  CHECK ((stock_item_id IS NOT NULL) <> (item_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_waste_rest ON waste_log(restaurant_id, occurred_at) WHERE deleted_at IS NULL;
