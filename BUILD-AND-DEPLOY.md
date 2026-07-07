# Alkyone / Sakura POS — Derleme ve Dağıtım Rehberi

Tek kod tabanı, **marka anahtarlı** iki ayrı ürün:

| | Alkyone POS | Sakura POS |
|---|---|---|
| Amaç | Yeni 2.0 analitik ürünü (amiral, varsayılan) | Mevcut canlı restoran müşterisi |
| Marka | `brand/alkyone.json` | `brand/sakura.json` |
| Electron appId | `com.alkyone.pos` | `com.sakura.pos` |
| Android paket | `com.alkyone.pos.{garson,yonetici}` | `com.sakura.pos.{garson,yonetici}` |
| Veri dizini | `data-alkyone/` + SQLite (`analytics.db`) | `data/` (JSON) — **DOKUNULMAZ** |
| Port (varsayılan) | 3100 | 3000 |
| Analitik / maliyet / fire | ✅ (`/analitik`, `/maliyet`, `/fire`) | — (kapalı) |

> **Sakura verisi güvenliği:** İki ürün ayrı veri dizinleri kullanır. Alkyone hiçbir kod yolunda `data/` dizinine yazmaz. Sunucu boş bir marka dizinini tohumlarken **var olan dosyalara asla dokunmaz** (`src/utils/seed.js`). Electron'da `userData` yolu appId'den türediği için iki ürün aynı makinede otomatik ayrı klasör kullanır.

---

## 1. Mimari — jenerik marka motoru

Kod hiçbir yerde marka ismini sabitlemez. İsim, logo, renk, appId, veri-dizini, port, keşif kimliği — hepsi **aktif marka config'inden** türer.

- Sunucu/Electron marka çözümü: `POS_BRAND` env → `brand/.active` dosyası → varsayılan `alkyone` (`brand/index.js`).
- İstemci (tarayıcı) marka teması: her sayfa `/js/brand.js` yükler → `/api/brand`'tan isim/logo/renk çeker, `document.title` ve `[data-brand]`/`[data-brand-logo]` öğelerini günceller.
- Android marka: `-PposBrand=<key>` → `android/brands/<key>.properties` → `applicationId`, `app_name`, renkler, `BuildConfig.{BRAND_NAME,DISCOVERY_APP,MDNS_HOST,PREFS_NAME}`.

### Yeni marka eklemek (sıfır kod değişikliği)
1. `brand/<key>.json` (mevcut birini kopyala, değerleri değiştir).
2. `brand/assets/<key>/logo.svg`.
3. `android/brands/<key>.properties`.
4. (Electron paketi için) `build/electron-builder-<key>.json` + isteğe bağlı `electron/installer-<key>.nsh`.
5. `package.json`'a `start:<key>` / `build:<key>` script'leri (opsiyonel).

---

## 2. Çalıştırma (geliştirme — sunucu)

```bash
npm install

npm run start:alkyone   # Alkyone POS -> http://localhost:3100
npm run start:sakura    # Sakura POS  -> http://localhost:3000
```

Test:
```bash
npm test                # Alkyone 2.0 analitik birim testleri (izole geçici DB)
```

---

## 3. Electron masaüstü kurulumu (Windows)

> Gerekli: Windows + Node.js. `electron-builder` Windows NSIS kurulumunu üretir.

```bash
npm run build:alkyone   # dist/alkyone/ altında AlkyonePOS Setup .exe
npm run build:sakura    # dist/sakura/  altında SakuraPOS  Setup .exe
npm run build:all       # ikisi de
```

Her script önce `brand/.active`'i yazar (paketlenen uygulama markasını buradan okur), sonra ilgili `build/electron-builder-<key>.json` ile paketler.

---

## 4. Android APK (universal, sideload)

Tek universal APK her Android 7+ (minSdk 24) cihaza kurulur — **cihaz/üretici kilidi yok**. Her marka için iki rol APK'si üretilir: **garson** ve **yönetici**.

### Windows (araç zincirini otomatik indirir)
```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-apks.ps1 -Brand alkyone
powershell -ExecutionPolicy Bypass -File scripts\build-apks.ps1 -Brand sakura
```
İlk çalıştırmada JDK 17 + Android SDK (~1GB) indirir. Çıktı: `dist/apk/<brand>/`.

### Linux/mac (JDK 17 + Android SDK kurulu olmalı)
```bash
export ANDROID_SDK_ROOT=~/Android/Sdk        # SDK yolunuz
./scripts/build-apks.sh alkyone
./scripts/build-apks.sh sakura
```

### İmzalama (güncellemeler için ŞART)
Her marka **kendi sabit release keystore'unu** kullanmalı; yoksa güncelleme eski sürümün üzerine kurulmaz.
- `android/brands/alkyone-keystore.properties` (veya `sakura-keystore.properties`)
- yoksa eski `android/keystore.properties`'e düşer
- hiçbiri yoksa debug imzasıyla çıkar (yalnızca test).

Keystore oluşturma:
```bash
keytool -genkeypair -v -keystore alkyone-release.jks -alias alkyone \
  -keyalg RSA -keysize 2048 -validity 10000
```
`android/brands/alkyone-keystore.properties`:
```
storeFile=alkyone-release.jks
storePassword=...
keyAlias=alkyone
keyPassword=...
```

---

## 5. Dağıtım (deploy)

- **Sunucu:** restoran bilgisayarına ilgili marka Electron kurulumunu kur. İlk açılışta setup ekranı restoran adını ister; tamamlanınca POS/analitik açılır.
- **Tabletler (sideload):** APK'yı kendi host'unuzda yayınlayın (ör. alkyonetech.com.tr), cihazda "bilinmeyen kaynak" iznini açın, indirip kurun. Play Store gerekmez.
- **APK oto-güncelleme (LAN):** sunucu `/updates/apk/<rol>-<sürüm>.apk` dosyalarını sunar. APK'ları marka updates dizinine (`updates/` veya `updates-alkyone/`) `apk/` altına koyun. `settings.json`'daki `apkVersion` / `minApkVersion` güncellemeyi tetikler.
- Tablet APK, sunucuyu UDP broadcast (port 5354, `app` = markanın `discoveryApp`) + mDNS (`<marka>.local`) + subnet tarama + manuel IP ile bulur.

---

## 6. Alkyone 2.0 analitik (yalnızca Alkyone markası)

Şema (`src/alkyone/migrations/001_init.sql`) — 7 tablo, ULID PK, kuruş tam sayı, ISO-8601 UTC, soft-delete:
`restaurants, items, item_cost_history, orders, order_lines, stock_items, waste_log`.

Akış:
- **Faz 2 — yazma yolu:** her kapanan sipariş `orders` + `order_lines` olarak, satış anı `unit_price` ve `unit_cost` snapshot'ıyla yazılır (`src/alkyone/writer.js`). Idempotent (kaynak sipariş id'si `external_ref`).
- **Faz 3 — manuel giriş:** `/maliyet` (maliyet + "%X tahmin" fallback), `/fire` (hammadde firesi, maliyet otomatik türetilir).
- **Faz 4 — analitik:** `/analitik` — genel bakış (ciro/kâr/israf), menü mühendisliği (yıldız/iş atı/bulmaca/köpek), ürün satış+kâr, gün×saat ısı haritası, sepet analizi, israf özeti.

API: `/api/alkyone/{items,cost,cost/estimate,stock,waste,sync-menu,analytics/*}`.

### İhlal edilemez kurallar (uygulandı)
Para=kuruş tam sayı · israf **maliyetten** (satış fiyatından asla) · hammadde (`stock_items`) ≠ mamul (`items`) · `order_lines.unit_price` satış anı snapshot · maliyet tarihsel (append-only) · her tabloda ULID+restaurant_id+soft-delete, hard delete yok.

---

## 7. Ortam notu

Bu değişiklikler bir Linux geliştirme sandbox'ında yazıldı; orada **Java/Android SDK/Gradle/Wine yok**, bu yüzden APK/`.exe` binary'leri burada derlenemedi. Node katmanı (sunucu, marka motoru, 2.0 analitik hattı) **çalıştırılarak doğrulandı** (`npm test` + iki markanın HTTP boot testi). Binary derleme yukarıdaki script'lerle sizin araç zincirinizde yapılır.
