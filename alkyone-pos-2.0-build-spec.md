# Alkyone / Sakura POS 2.0 — Build Spec

> Bu doküman Claude Code'u yönlendirmek için yazıldı. Kararlar kesindir; yorum/genişletme isteme, spec'i uygula. Belirsizlik varsa **INPUT GEREKLİ** işaretli yerlerde dur ve sor, gerisini uygula.

---

## 0. Bağlam ve amaç

Mevcut ürün: Android WebView wrapper + local Electron sunucu üzerinde çalışan bir restoran POS'u. Şu an **canlı ve ödeme yapan tek bir restoran müşterisinde** çalışıyor.

2.0'ın hedefi: POS'u, **abonelik bazlı satılabilir bir analitik ürüne** dönüştürmenin ilk adımı. Bunun için veri modeli baştan yeniden kuruluyor. Eski veri taşınmayacak (kullanılamaz kabul edildi); ileriye dönük yeni veri doğru şemayla toplanacak.

Bu sürümde ürünleştirme (multi-tenant, cloud, faturalandırma) **yapılmayacak** ama şema bunlara sonradan geçişi **rewrite değil, switch** yapacak şekilde kurulacak.

---

## 1. Kapsam kararları (kesin)

| Karar | Değer | Sonuç |
|---|---|---|
| Veri konumu | **Local-only** (SQLite) | Cloud sync yok; şema sync-ready |
| Kiracılık | **Tek restoran** | Multi-tenant infra yok; `restaurant_id` her tabloda |
| İsraf ölçümü | **Hafif model** (stok + atık log) | BOM/reçete yok |
| Maliyet girişi | Sahip girecek ve güncel tutacak (teyit edildi) | Kâr + menü mühendisliği açık |
| Müşteri kimliği | Veri yok | Müşteri-bazlı takip **kapsam dışı**, kurma |

---

## 2. İhlal edilemez doğruluk kuralları

Claude Code bu altı kuralı hiçbir koşulda çiğnemez. Bunlar önceki tasarımda yapılan hataların düzeltmeleridir.

1. **Para = tam sayı, kuruş (minor unit).** Asla float/ondalık ile para tutma. `10.50 TL` → `1050`.
2. **İsraf, MALİYET değerinden loglanır — satış fiyatından ASLA.** Atılanı satış fiyatıyla değerlersen zararı 2-4x şişirir, sahibin araca güvenini bitirirsin. `waste_log.cost_value` daima maliyetten türetilir.
3. **`stock_items` = hammadde** (somon, pirinç, nori — çöpe giden bu), **`items` = mamul/menü ürünü** (California Roll). İkisi ayrı katman, karıştırma. Gerçek israf hammadde firesidir.
4. **`order_lines.unit_price` = satış anındaki snapshot.** Canlı fiyata FK verme; fiyat değişince geçmiş siparişler gerçekte tahsil edilen tutarı yansıtmalı.
5. **Maliyet tarihseldir.** `item_cost_history` append-only; mevcut maliyeti üstüne yazma. Geçmiş kâr, sipariş anındaki maliyetle hesaplanır.
6. **Sync/tenant-hazırlık her tabloda zorunlu:** `id` = ULID, `restaurant_id`, `created_at`, `updated_at`, `deleted_at` (soft delete). **Hard delete yok.**

---

## 3. Konvansiyonlar

- **PK:** `TEXT`, ULID (uygulama tarafında üretilir). Autoincrement INTEGER **kullanma** — cloud sync'te iki restoranın ID'leri çakışır.
- **Para:** `INTEGER`, kuruş.
- **Zaman:** `TEXT`, ISO-8601 UTC (`2026-07-06T14:03:00Z`).
- **Soft delete:** silme = `deleted_at` set et. Tüm sorgular `WHERE deleted_at IS NULL` filtreler.
- **`restaurant_id`:** `TEXT NOT NULL`, şimdilik tek restoranın sabit ULID'i. Her domain tablosunda bulunur.
- Foreign key'ler tanımlı; silme soft olduğu için `ON DELETE` yerine `deleted_at` mantığı geçerli.

---

## 4. Şema — 7 tablo

Ortak sütunlar (her tabloda): `id TEXT PK`, `restaurant_id TEXT NOT NULL`, `created_at TEXT`, `updated_at TEXT`, `deleted_at TEXT NULL`.

```
restaurants
  id, name, created_at, updated_at, deleted_at

items                         -- mamul / menü ürünü
  id, restaurant_id, name, category, sale_price INTEGER, is_active INTEGER, [ortak]

item_cost_history             -- append-only, tarihsel maliyet
  id, restaurant_id, item_id FK->items, cost INTEGER, effective_from TEXT, [ortak]
  -- güncel maliyet = effective_from <= now olan en son kayıt

orders                        -- sipariş / masa oturumu
  id, restaurant_id, table_id TEXT, opened_at TEXT, closed_at TEXT,
  covers INTEGER, payment_type TEXT, order_type TEXT,      -- dine_in | takeaway | delivery
  subtotal INTEGER, discount INTEGER, total INTEGER, status TEXT, [ortak]

order_lines                   -- satır kalemi
  id, restaurant_id, order_id FK->orders, item_id FK->items,
  qty INTEGER, unit_price INTEGER,  -- SNAPSHOT, satış anı fiyatı
  line_total INTEGER, [ortak]

stock_items                   -- hammadde
  id, restaurant_id, name, unit TEXT,   -- kg | adet | lt
  unit_cost INTEGER, [ortak]

waste_log                     -- fire / atık
  id, restaurant_id,
  stock_item_id FK->stock_items NULL,   -- ana durum: hammadde firesi
  item_id FK->items NULL,               -- nadir: bitmiş tabak kaybı
  qty REAL, cost_value INTEGER,         -- MALİYETTEN türetilir
  reason TEXT,                          -- spoilage | wrong_order | overprep | other
  occurred_at TEXT, [ortak]
  -- CHECK: stock_item_id ve item_id'den tam olarak biri dolu
```

Bu şema dört analitiği de açar: satış+kâr (`items`+`order_lines`+`item_cost_history`), menü mühendisliği (aynısı), zaman deseni & sepet analizi (`orders`+`order_lines`), gerçek israf (`stock_items`+`waste_log`).

---

## 5. Build sırası (fazlar)

Fazları sırayla uygula. Bir faz bitmeden sonrakine geçme.

### Faz 0 — INPUT GEREKLİ (insan yapar, Claude Code beklemez ama varsayamaz)
Mevcut export/DB'nin sütunlarını doğrula. Zaten yazılan (timestamp, order_id gruplaması vb.) ne varsa yeniden icat etme. **Bu teyit gelmeden Faz 2'ye başlama.**

### Faz 1 — Şema + migration
- Bölüm 4'teki 7 tabloyu migration dosyaları olarak yaz.
- Konvansiyonları (ULID, soft delete, kuruş, ISO-8601) tek bir yardımcı modülde topla.
- **Kabul kriteri:** migration çalışır; boş DB oluşur; ULID üretimi ve soft-delete helper'ları test edilir.

### Faz 2 — POS yazma yolu entegrasyonu
- POS, her siparişi `orders` + `order_lines` olarak **zaman damgası ve `order_id` gruplamasıyla** yazsın. Eski sistemin eksiği tam buydu (sepet analizi ve zaman deseni bunlara bağlı).
- `order_lines.unit_price` satış anındaki fiyatı snapshot'lasın.
- **Kabul kriteri:** gerçek bir sipariş açılıp kapandığında `orders` + `order_lines` doğru, ilişkili, snapshot fiyatla yazılıyor.

### Faz 3 — Manuel giriş akışları (iki tane, hızlı tut)
- **Maliyet girişi (P0):** `item_cost_history`'ye kayıt. Onboarding'in birincil adımı gibi tasarla, form alanı gibi değil. Bilmeyen sahip için "satış fiyatının %X'i" hızlı-tahmin fallback'i + periyodik güncelleme hatırlatması.
- **Atık girişi:** `waste_log`'a kayıt; `cost_value` seçilen hammadde/ürünün maliyetinden otomatik hesaplansın (sahip elle para girmesin).
- **Kabul kriteri:** her iki akış da 3 tıktan az; atık kaydı maliyetten doğru değerleniyor.
- **Bilinen risk (kod değil, ürün):** bu iki akış sahibe iki ayrı sürekli manuel giriş yükü bindiriyor; ürünün en kırılgan yeri burası. UX sürtünmesini minimuma indir.

### Faz 4 — Analitik (EN SON)
Birkaç hafta gerçek veri birikmeden boş tabloya UI yapma. Olgunluk merdivenine göre sırayla:
- Ay 0-1: betimsel — ürün bazında adet + ciro + **kâr**; kişi başı ortalama; gün×saat ısı haritası.
- Ay 2-3: gün×saat talep profili → prep/vardiya rehberi (betimsel; "tahmin" deme).
- Ay 3-6: sepet analizi (`order_id` ortak kalemler) → combo/bundle.
- Ay 6-12+: gerçek mevsimsel forecasting — ancak mevsim-aşırı geçmiş birikince.
- **Menü mühendisliği** (sahibin #1 isteği): popülerlik (adet) × kârlılık (marj) → yıldız / iş atı / bulmaca / köpek. Maliyet girildiği an açılır.

---

## 6. Non-goals (bu sürümde KESİNLİKLE yapma)

- Cloud / sync mantığı **yok** — ama şema sync-ready (ULID, soft-delete, updated_at) kalacak.
- Multi-tenant auth / routing / faturalandırma **yok** — ama `restaurant_id` her tabloda.
- BOM / reçete sistemi **yok**.
- Müşteri kimliği / müşteri-bazlı takip **yok** (veri desteklemiyor).
- Gerçek veri birikmeden analitik UI **yok**.
- Mevsim-aşırı geçmiş olmadan mevsimsel forecasting iddiası **yok**.

---

## 7. Analitik ↔ sahibin derdi eşlemesi

Sahibin talep ettiği iki şey ve karşılığı:
- **Menü / fiyat kararları** → menü mühendisliği matrisi (maliyet + satış + adetten). Çapa özellik.
- **İsraf** → `waste_log` üzerinden: sebebe göre, hammaddeye göre, zamana göre maliyet kaybı. Not: satış verisi tek başına israfı ölçmez; ölçüm `stock_items` + `waste_log`'a bağlı.
