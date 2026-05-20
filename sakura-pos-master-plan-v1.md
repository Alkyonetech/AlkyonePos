# Sakura POS — Master Plan v1 (Final)

> **Proje:** Sakura Sushi Fulya — Restoran Yönetim ve QR Menü Sistemi
> **Versiyon:** 1.0 (Final, production-ready)
> **Tarih:** Nisan 2025
> **Durum:** Onaylandı, geliştirmeye başlanacak

---

## 0. Tasarım Kararları Özeti

Bu plan, planlama aşamasında alınan kritik kararları yansıtır:

- **Mimari:** Web (Netlify) ve yerel (POS) sistemler birbirinden bağımsız çalışır. Menü her iki tarafta ayrı yönetilir, sync yoktur. Bu sayede çakışma imkansızdır.
- **Müşteri menüsü:** Netlify Free üzerinde, müşteri 4G/5G ile bağlanır. Maliyet sıfır.
- **POS:** Tek `.exe`, Electron tabanlı, internet bağımsız, restoranın yerel ağında çalışır.
- **APK'lar:** WebView wrapper, sakura.local üzerinden POS'a bağlanır. Garson ve Yönetici olarak iki ayrı APK.
- **mDNS:** sakura.local üç katmanlı fallback ile çözülür (mDNS → ARP scan → manuel IP).
- **Yazıcı:** ESC/POS protokolü ile termal yazıcı, fallback A4 print.
- **Eşzamanlılık:** Aynı masaya iki garson yazma çakışması version-based optimistic locking ile çözülür.
- **Veri güvenliği:** Atomic write + saatlik yedek (7 gün rolling).
- **Gün sınırı:** Ayarlanabilir (varsayılan: 04:00 — restoran gece geç saatlere kadar açık olabilir).
- **Güncelleme:** Tamamen offline, USB ile manuel dağıtım. Hiçbir sunucu/cloud kullanılmaz, kaynak kod sadece geliştiricide kalır.
- **Code signing yok:** İlk kurulumda Windows SmartScreen uyarısı bir kez kabul edilir, sonrası sorunsuz.

---

## 1. Sistem Felsefesi

**İki bağımsız sistem, tek restoran.**

- **Web sistemi:** Müşterinin QR'la menüyü görmesi için. Netlify'da, internet üzerinden erişilir. Ayrı admin'i var.
- **Yerel sistem:** Restoran operasyonu için. Bilgisayardaki exe, internetsiz çalışır. Ayrı admin'i var.

İki sistem birbirine veri göndermez. Menü değişikliği ikisinde de yapılır (5 dakikalık ek iş, ama sıfır sync hatası).

---

## 2. Mimari Diyagramı

```
┌──────────────────────────────────┐    ┌──────────────────────────────────┐
│         WEB (Netlify Free)       │    │       YEREL (Restoran)           │
│                                  │    │                                  │
│   sakurasushi.netlify.app        │    │   SakuraPOS.exe                  │
│   ├── /        → Müşteri Menüsü  │    │   (Electron + Node.js)           │
│   └── /admin   → Web Admin       │    │                                  │
│                                  │    │   HTTP :3000  /  WS :3000        │
│   Müşteri 4G/5G ile bağlanır     │    │   mDNS: sakura.local             │
│   Veri: tarayıcı localStorage    │    │                                  │
│                                  │    │   ├── /pos      Kasiyer ekranı   │
│   Maliyet: 0 TL                  │    │   ├── /garson   Garson APK       │
│                                  │    │   ├── /admin    Yerel Admin      │
│                                  │    │   └── /rapor    Raporlar         │
│                                  │    │                                  │
│                                  │    │   Veri: data/*.json (atomic)     │
│                                  │    │   Yedek: data/backups/           │
└──────────────────────────────────┘    └──────────────────────────────────┘
                                                      ▲
                                          ┌───────────┴───────────┐
                                          │      Yerel WiFi       │
                                          │                       │
                                  Garson APK            Yönetici APK
                                  (WebView)             (WebView)
                                  /garson               /pos
```

---

## 3. Bileşenler

### 3.1 Web — Müşteri Menüsü (Mevcut)
- **Platform:** Netlify Free (deploy: GitHub repo → otomatik)
- **URL:** `sakurasushi.netlify.app`
- **Dosyalar:** `index.html` + `admin.html` (mevcut, korunuyor)
- **Veri:** Tarayıcı localStorage
- **Trafik limiti:** 100 GB/ay (Netlify Free) — restoran için fazlasıyla yeterli

### 3.2 Yerel — SakuraPOS.exe

| Katman | Teknoloji | Görev |
|---|---|---|
| Sunucu | Node.js + Express | HTTP API + statik dosya servisi |
| Realtime | `ws` (WebSocket) | Cihazlar arası anlık senkronizasyon |
| mDNS | `bonjour-service` | `sakura.local` adı yayını |
| Yazıcı | `escpos` | Termal yazıcı protokolü (USB/seri) |
| QR | `qrcode` | Masa QR'larını üretir |
| Veri | JSON dosyaları | Atomic write + yedek |
| Kabuk | Electron | Tek pencereli masaüstü uygulaması |
| Paket | `electron-builder` | Tek `.exe` çıktısı |

### 3.3 SakuraPOS-Garson.apk
- **Yapı:** Android Native + WebView Activity (tek aktivite)
- **Min SDK:** Android 7.0 (API 24) — pazarda %96 cihaz destekler
- **Boyut:** ~3 MB
- **Bağlantı:** `http://sakura.local:3000/garson` → fallback IP
- **Özel davranış:**
  - Tam ekran (immersive mode)
  - Geri tuşu devre dışı
  - WebSocket koparsa otomatik yeniden bağlanır
  - Sunucu adresi ilk açılışta sorulur, ayarlardan değiştirilebilir

### 3.4 SakuraPOS-Yonetici.apk
- Aynı projenin farklı flavor'u
- Açılış URL'i: `/pos`
- PIN ile rol kontrolü

---

## 4. Veri Modeli

### 4.1 Yerel Dosya Yapısı

```
SakuraPOS/
├── SakuraPOS.exe
└── data/
    ├── menu.json           ← Kategoriler, ürünler, fiyatlar
    ├── tables.json         ← Masa tanımları + canlı durumlar
    ├── orders.json         ← Aktif gün açık adisyonlar
    ├── settings.json       ← PIN'ler, port, yazıcı, gün-saati
    ├── reports/
    │   ├── 2025-04-16.json
    │   ├── 2025-04-17.json
    │   └── ...
    └── backups/            ← Saatte bir otomatik yedek
        ├── 2025-04-17_09.zip
        ├── 2025-04-17_10.zip
        └── ... (son 168 saat = 7 gün rolling)
```

### 4.2 Şemalar

**`menu.json`** (mevcut yapıya uyumlu)
```json
{
  "categories": [
    {
      "id": "corbalar",
      "name": "Çorbalar",
      "nameEn": "Soups",
      "jp": "スープ",
      "coverImg": "corbalar/wonton.jpg",
      "items": [
        {
          "id": 1,
          "name": "Wonton Çorbası",
          "nameEn": "Wonton Soup",
          "price": 360,
          "desc": "Geleneksel wonton mantısı...",
          "img": "corbalar/wonton.jpg",
          "visible": true
        }
      ]
    }
  ]
}
```

**`tables.json`**
```json
{
  "version": 5,
  "tables": [
    {
      "id": 1,
      "name": "Masa 1",
      "capacity": 4,
      "section": "salon",
      "currentOrderId": null,
      "status": "empty"
    },
    {
      "id": 3,
      "name": "Masa 3",
      "capacity": 4,
      "section": "salon",
      "currentOrderId": "ord_20250416_003",
      "status": "open"
    }
  ]
}
```
> `status`: `empty | open | reserved | cleaning`
> `currentOrderId`: açık adisyon referansı (kapatınca `null`)

**`orders.json`** (sadece aktif gün, kapatılanlar `reports/` altına gider)
```json
{
  "orders": [
    {
      "id": "ord_20250416_001",
      "tableId": 3,
      "openedAt": "2025-04-16T12:34:00.123Z",
      "closedAt": null,
      "status": "open",
      "version": 7,
      "openedBy": "yonetici",
      "items": [
        {
          "lineId": "ln_001",
          "itemId": 47,
          "name": "Salmon Avocado Roll",
          "qty": 2,
          "unitPrice": 420,
          "lineTotal": 840,
          "note": "Az wasabi",
          "addedAt": "2025-04-16T12:35:10.000Z",
          "addedBy": "garson_1",
          "status": "active"
        }
      ],
      "subtotal": 840,
      "discount": 0,
      "total": 840,
      "payment": null
    }
  ]
}
```

> **`version`** alanı kritik: aynı masaya iki garson aynı anda yazarsa, sunucu version eşleşmiyorsa "yenile" hatası döner. Optimistic locking.

**`reports/2025-04-16.json`**
```json
{
  "date": "2025-04-16",
  "openedAt": "2025-04-16T09:00:00.000Z",
  "closedAt": "2025-04-17T02:30:00.000Z",
  "summary": {
    "totalRevenue": 28450,
    "totalOrders": 34,
    "totalItems": 187,
    "avgOrderValue": 837,
    "avgItemsPerOrder": 5.5,
    "peakHour": "13:00",
    "peakHourRevenue": 9800,
    "openedTables": 38,
    "uniqueProductsSold": 23
  },
  "byProduct": [
    {
      "id": 47,
      "name": "Salmon Avocado Roll",
      "category": "sushi",
      "qty": 28,
      "revenue": 11760,
      "avgPrice": 420
    }
  ],
  "byCategory": [
    {
      "id": "sushi",
      "name": "Sushi Uramaki",
      "qty": 78,
      "revenue": 32480
    }
  ],
  "byHour": [
    { "hour": "12:00", "orders": 8, "revenue": 6200, "items": 42 }
  ],
  "orders": [ /* o gün kapatılan tüm adisyonlar (snapshot) */ ]
}
```

**`settings.json`**
```json
{
  "restaurant": {
    "name": "Sakura Sushi Fulya",
    "address": "Fulya, İstanbul",
    "phone": "0212 ___ __ __",
    "logo": ""
  },
  "network": {
    "port": 3000,
    "mdnsName": "sakura",
    "lastKnownIp": "192.168.1.101"
  },
  "auth": {
    "garsonPin": "1234",
    "yoneticiPin": "9999",
    "pinChangedAt": "2025-04-16T10:00:00.000Z"
  },
  "operations": {
    "dayCloseHour": 4,
    "vatRate": 10,
    "currency": "TL"
  },
  "printer": {
    "enabled": true,
    "type": "escpos",
    "connection": "usb",
    "device": "auto",
    "paperWidth": 58,
    "encoding": "PC857"
  },
  "appVersion": "1.0.0",
  "minApkVersion": "1.0.0"
}
```

> **`dayCloseHour: 4`** → Saat 04:00'a kadar olan satışlar dünkü güne yazılır. Restoran 02:00'a kadar açıksa rapor doğru çıkar.

---

## 5. Backend API

### 5.1 REST Endpoints

| Method | URL | Auth | Açıklama |
|---|---|---|---|
| `GET` | `/api/menu` | — | Menü oku |
| `PUT` | `/api/menu` | yönetici | Menü kaydet |
| `GET` | `/api/tables` | — | Masa listesi |
| `PUT` | `/api/tables` | yönetici | Masa düzeni güncelle |
| `GET` | `/api/orders` | garson+ | Aktif adisyonlar |
| `GET` | `/api/orders/:tableId` | garson+ | Tek masa adisyonu |
| `POST` | `/api/orders/:tableId/items` | garson+ | Ürün ekle (version kontrolü) |
| `PATCH` | `/api/orders/:tableId/items/:lineId` | garson+ | Miktar/not güncelle |
| `DELETE` | `/api/orders/:tableId/items/:lineId` | garson+ | Ürün çıkar |
| `POST` | `/api/orders/:tableId/close` | yönetici | Hesap kapat |
| `POST` | `/api/orders/:fromId/transfer/:toId` | yönetici | Masa taşı |
| `POST` | `/api/orders/merge` | yönetici | Masa birleştir |
| `POST` | `/api/print/receipt/:orderId` | yönetici | Adisyon yazdır |
| `GET` | `/api/reports` | yönetici | Rapor listesi |
| `GET` | `/api/reports/:date` | yönetici | Gün raporu |
| `GET` | `/api/reports/monthly/:year/:month` | yönetici | Aylık özet |
| `POST` | `/api/day/close` | yönetici | Günü kapat |
| `GET` | `/api/settings` | — | Ayarları oku |
| `PUT` | `/api/settings` | yönetici | Ayar güncelle |
| `POST` | `/api/auth/login` | — | PIN doğrula → token |
| `GET` | `/api/qr/:tableId` | — | Masa QR kodu (PNG) |
| `GET` | `/api/version` | — | Sürüm bilgisi (APK uyumluluk) |
| `GET` | `/api/health` | — | Sunucu canlılık kontrolü |

### 5.2 Auth Sistemi

**Akış:**
1. Cihaz açılır → PIN ekranı
2. PIN gönderilir → `POST /api/auth/login`
3. Sunucu PIN'i doğrular → JWT token döner (24 saat geçerli)
4. Cihaz token'ı saklar (localStorage), her istekte `Authorization: Bearer <token>`
5. Token süresi dolarsa otomatik PIN ekranı

**Roller:**
- `garson`: sadece adisyon işlemleri
- `yonetici`: tüm işlemler

> **Not:** Bu kafe için yüksek güvenlik gerekmiyor (yerel ağ, kötü niyetli erişim olası değil), ama temel ayrım gerekli. JWT yerine basit signed cookie de kullanılabilir.

### 5.3 WebSocket Events

**Sunucu → Cihazlar:**
| Event | Payload | Açıklama |
|---|---|---|
| `order:created` | `{order}` | Yeni masa açıldı |
| `order:updated` | `{order}` | Adisyon değişti (version dahil) |
| `order:closed` | `{order, paymentInfo}` | Hesap kapatıldı |
| `table:updated` | `{table}` | Masa durumu değişti |
| `menu:updated` | `{}` | Menü güncellendi (cache invalidate) |
| `day:closed` | `{date, summary}` | Gün kapatıldı |
| `printer:status` | `{ok, message}` | Yazıcı durumu |

**Cihaz → Sunucu:**
| Event | Açıklama |
|---|---|
| `ping` | Bağlantı kontrolü (15sn'de bir) |
| `subscribe` | İlgili event'lere abone olur |

**Bağlantı kopmaları:**
- Cihaz tarafı: 5 saniye sonra otomatik yeniden bağlan, exponential backoff
- Sunucu tarafı: 60 saniye boyunca ping almazsa cihazı offline işaretle

---

## 6. Kritik Senaryolar ve Çözümler

### 6.1 Aynı anda aynı masaya iki garson yazıyor

**Senaryo:** Garson A Masa 3'e Ramen ekliyor, Garson B aynı anda Masa 3'e Sushi ekliyor.

**Çözüm:** Optimistic locking (version field).
1. Her cihaz adisyonun mevcut `version`'ını biliyor
2. POST request'te version gönderiyor
3. Sunucu version eşleşmiyorsa **409 Conflict** döner
4. Cihaz "Adisyon başka cihazda güncellendi" toast gösterir, otomatik yeniler, kullanıcı tekrar dener
5. Bu sırada her iki cihaz da WebSocket ile yeni adisyonu otomatik almıştır

### 6.2 Saat senkronizasyon farkı

**Senaryo:** Tablet saati yanlış, raporlar tutarsız.

**Çözüm:** Tüm `timestamp`'ler **sunucuda** üretilir. Cihaz tarihi/saati hiç kullanılmaz. Cihaz "yeni ürün ekle" der, sunucu o an `Date.now()` ile timestamp atar.

### 6.3 Elektrik kesintisi

**Senaryo:** Açık adisyonlarla birlikte bilgisayar aniden kapandı.

**Çözüm:**
- Her yazma işlemi **atomic write** ile yapılır (önce `.tmp` dosyaya yaz, sonra `rename`)
- Saatte bir `data/backups/` altına otomatik yedek (zip)
- Açılırken `orders.json` bütünlük kontrolü, bozuksa son sağlam yedekten geri yükle
- Garson APK'lar tekrar bağlanınca otomatik yenilenir

### 6.4 Yazıcı çevrimdışı / kağıt bitti

**Senaryo:** Hesap kapat → adisyon basılamadı.

**Çözüm:**
- Yazıcı durumu sürekli kontrol edilir (kağıt sensoru, bağlantı)
- Hesap kapatma her durumda devam eder (yazıcı blok değildir)
- Yazdırma kuyruğa alınır, yazıcı düzelince otomatik basılır
- Yedek olarak: tarayıcı print → A4 yazıcıya da basabilir

### 6.5 sakura.local Android'de çalışmıyor

**Senaryo:** Bazı Android cihazlar mDNS desteklemiyor.

**Çözüm — 3 katmanlı:**
1. **Birincil:** `sakura.local` dene
2. **İkincil:** mDNS başarısız → ARP scan ile yerel ağda Sakura sunucusunu bul (`/api/health` cevap veren IP)
3. **Tersiyer:** Manuel IP girişi ekranı (settings) → user IP'yi yazar

### 6.6 APK eski sürüm, sunucu yeni özellik

**Senaryo:** Sunucu güncellendi, eski APK uyumsuz endpoint çağırıyor.

**Çözüm:**
- Sunucu: `settings.json` içinde `minApkVersion` tutar
- APK her açılışta `GET /api/version` ile kontrol eder
- Versiyonu küçükse uyarı: "Garson uygulaması güncel değil. /apk adresinden yeni sürümü indirin." (PC'den APK serve edilir)

### 6.7 Disk doldu

**Senaryo:** Eski raporlar disk doldurmuş.

**Çözüm:**
- Yedekler 7 gün rolling (otomatik silinir)
- Raporlar 1 yıl saklanır, sonrasında `archive/` klasörüne taşınır
- Disk %95 dolarsa POS uyarı verir

### 6.8 İki kişi aynı anda menü düzenliyor (yerel)

**Senaryo:** Yönetici PC'de admin'i açtı, başka biri tabletten admin'i açtı, ikisi de değişiklik yapıyor.

**Çözüm:** Menü için de version field. Son kaydeden kazanır, diğer cihaz uyarı alır: "Menü başka cihazda değişti, yeniden yüklendi."

---

## 7. POS Arayüzü — Detaylı Spec

### 7.1 `/pos` — Kasiyer Ekranı (Electron)

**Üst bar:** Logo + tarih/saat + bugün ciro + dolu masa sayısı + canlı bağlantı durumu

**Sol panel (geniş):** Masa grid
- 4-5 sütun, kapasiteye göre boyut
- Renk kodları: boş (gri), açık (sakura), rezerve (amber), seçili (vurgulu sakura)
- Üst sağda durum noktası (animasyonlu)
- Alt sağda anlık tutar (TL)
- Tıklayınca o masanın adisyonu sağ panelde açılır

**Sağ panel (sabit ~340px):** Adisyon detayı
- Masa adı + açılış saati + süre + kalem sayısı
- Ürün listesi (qty kontrolü, not, fiyat, sil butonu)
- Alt: Ara toplam, KDV, **Toplam (büyük sakura)**
- Aksiyonlar: Ürün ekle, masa taşı, masa birleştir, indirim uygula
- **Hesap Kapat** (büyük sakura gradient buton)

**Alt bar:** Rapor butonu, ayarlar, admin, günü kapat

### 7.2 `/garson` — Garson Ekranı (Mobil-first)

**Üst bar:** Logo + canlı bağlantı durumu + çıkış (PIN'e dön)

**İki sekme:**
- **Masalar:** 3x3 grid masa görünümü
- **Aktif:** Açık adisyon listesi (hızlı erişim)

**Adisyon ekranı:**
- Başlık: ‹ geri + Masa adı + süre
- Ürün listesi (qty kontrolü)
- Sticky alt: kategori chip scroll + ürün listesi (filtrelenmiş)
- Footer: Toplam + **Siparişi Gönder** (sakura gradient)

> Garson "siparişi gönder" demese de her ürün ekleme anında kaydedilir. "Gönder" sadece UI metaforu, UX rahatlığı için.

### 7.3 `/admin` — Yerel Admin

Mevcut `admin.html`'in yerel sürümü:
- Menü/kategori yönetimi (web admin'in aynısı)
- **Ek modüller:**
  - Masa yönetimi (sayı, isim, kapasite, salon/teras)
  - PIN ayarları
  - Yazıcı testi
  - Yedek/restore (manuel)
  - Sürüm bilgisi
  - QR yazdırma sayfası (her masa için)

### 7.4 `/rapor` — Rapor Ekranı

**Görünümler:**

**1. Bugün Dashboard**
- 4 stat kartı: Ciro, adisyon, ürün, pik saat
- Saatlik bar grafik (yoğunluk)
- En çok satan 10 ürün (bar dolulukla)
- Canlı aktivite akışı (sağ kolon)

**2. Geçmiş Gün**
- Sol: Takvim
- Sağ: Seçilen günün dashboard'u

**3. Aylık Özet**
- Günlük ciro çizgi grafiği (Chart.js)
- Toplam ciro / sipariş / ortalama
- Ay genelinde en çok satan 20 ürün
- Karşılaştırma: Bu ay vs geçen ay vs geçen yıl aynı ay

**4. Yıllık**
- Aylık karşılaştırma bar grafik
- Trend analizi
- Sezon analizi (kategori bazlı)

**Gün Kapat butonu:**
- Confirm dialog
- Açık masa varsa uyar
- Tüm orders.json → reports/YYYY-MM-DD.json
- orders.json sıfırla
- WebSocket `day:closed` event yayınla

---

## 8. APK — Detaylı Spec

### 8.1 İlk Açılış Akışı

```
1. APK açılır
2. Saved IP / sakura.local kontrol et
3. /api/health → cevap geldi mi?
   ├── Geldi → PIN ekranı
   └── Gelmedi → Bağlantı ayarı ekranı
                  ├── "sakura.local'i tekrar dene"
                  ├── "IP elle gir: 192.168.___.___"
                  └── "QR ile bağlan" (PC'deki QR'ı oku)
4. PIN gir → token al → ana ekran
```

### 8.2 İmmersive Mode
- Status bar gizli
- Geri tuşu devre dışı (kiosk)
- Power'a basılınca uyumaz (`KEEP_SCREEN_ON` flag)
- Pull-to-refresh ile sayfa yenileme

### 8.3 Bağlantı Yönetimi
- WebSocket koparsa: 1s, 3s, 5s, 10s, 30s exponential backoff
- 60 saniye bağlanamazsa "Bağlantı yok" toast (kapatılamaz)
- Bağlanınca toast otomatik kalkar
- Network change listener: WiFi değiştiyse otomatik sakura.local'i yeniden ara

### 8.4 İki Flavor

```
SakuraPOS-Garson.apk
├── package: com.sakura.pos.garson
├── icon: 🍱 (turuncu-sakura)
├── label: "Sakura Garson"
└── start_url: /garson + role: "garson"

SakuraPOS-Yonetici.apk
├── package: com.sakura.pos.yonetici
├── icon: 👑 (altın-sakura)
├── label: "Sakura Yönetici"
└── start_url: /pos + role: "yonetici"
```

İki APK aynı cihaza yan yana kurulabilir.

---

## 9. Yazıcı Entegrasyonu

### 9.1 Donanım
- Önerilen: 58mm termal yazıcı, USB
- Test edilen modeller: Epson TM-T20III, Xprinter XP-58IIH

### 9.2 Protokol
- ESC/POS (`escpos` npm paketi)
- USB üzerinden direkt iletişim
- Driver gerekmez (raw USB)

### 9.3 Adisyon Formatı (58mm)

```
================================
       SAKURA SUSHİ FULYA
          Fulya, İstanbul
       Tel: 0212 ___ __ __
================================
Tarih : 16 Nis 2025  13:42
Masa  : 3
Garson: Yönetici
Adisyon No: ord_20250416_003
--------------------------------
ÜRÜN              ADET   FİYAT
--------------------------------
Salmon Avocado Roll
                  2     840.00
Tonkotsu Ramen
  (Az acı)        1     450.00
Edamame           1     195.00
--------------------------------
ARA TOPLAM             1.485.00
KDV (%10)                148.50
--------------------------------
TOPLAM         ₺ 1.633.50
================================
   Teşekkür ederiz!
   ありがとうございました
================================
   sakurasushi.netlify.app
```

### 9.4 Fallback
- Yazıcı yoksa: Tarayıcı `window.print()` → A4 sayfa
- CSS @media print ile özel format

---

## 10. Deploy & Kurulum

### 10.1 Web Tarafı

**İlk kurulum:**
1. GitHub'da `sakura-menu` repo oluştur
2. `index.html` ve `admin.html`'i push et
3. Netlify'a giriş yap, repo'yu bağla
4. Build settings: yok (statik)
5. Domain: `sakurasushi.netlify.app` (otomatik)
6. Deploy → 30 saniye → canlı

**Güncelleme:**
- Admin'den menü değişince otomatik kaydedilir (localStorage)
- Yazılım güncellemesi gerekirse: GitHub'a push → Netlify otomatik deploy

### 10.2 Yerel Tarafı (`SakuraPOS.exe`)

**Geliştirici tarafında:**
```bash
npm run build:win
# Çıktı: dist/SakuraPOS Setup 1.0.0.exe (~80 MB)
```

**Restoranda kurulum:**
1. `SakuraPOS Setup 1.0.0.exe` çift tıkla → kur
2. Masaüstüne kısayol oluşur
3. İlk açılışta sihirbaz:
   - Restoran adı/adresi
   - Masa sayısı (örn: 20)
   - Garson PIN, Yönetici PIN
   - Yazıcı tara/seç (opsiyonel)
4. POS açılır, hazır

**Otomatik başlatma:**
- Setup sırasında "Bilgisayar açılınca otomatik başlat" seçeneği
- Windows Startup klasörüne kısayol

**Güvenlik duvarı:**
- Setup script'i Windows Firewall'a kural ekler (port 3000 izin ver)
- Aksi halde garson APK'lar bağlanamaz

### 10.3 APK Kurulum

**Geliştirici:**
```bash
./gradlew assembleRelease
# Çıktı: app-garson-release.apk + app-yonetici-release.apk
```

**Restoran tarafında:**
1. APK'yı PC'den `/apk/garson.apk` adresine koy
2. Tabletin tarayıcısından `http://sakura.local:3000/apk` aç
3. APK indir → "Bilinmeyen kaynaklara izin ver" → kur
4. Aç → IP otomatik bulunur veya elle gir → PIN gir

---

## 11. Test Stratejisi

### 11.1 Geliştirme Aşaması Testleri

**Birim:**
- Atomic write fonksiyonları
- Version conflict kontrolü
- Timestamp üretimi (sunucu saati)
- PIN hash kontrolü

**Entegrasyon:**
- API endpoint'leri (Postman collection)
- WebSocket event'leri
- Yazıcı bağlantısı

### 11.2 Kabul Testleri (release öncesi)

**Senaryo 1 — Normal gün:**
- 5 masa açılır, sipariş alınır, hesaplar kapatılır, gün kapatılır, rapor doğru çıkar.

**Senaryo 2 — Aynı anda 3 garson:**
- 3 tablet, 3 farklı masaya aynı anda sipariş giriyor. Hiçbiri kaybolmuyor.

**Senaryo 3 — Aynı masaya 2 garson çakışma:**
- İki tablet aynı masaya yazıyor. Birinin işlemi version conflict alıyor, otomatik yenileyip tekrar yazıyor. Veri kaybı yok.

**Senaryo 4 — Elektrik kesintisi:**
- 5 masa açıkken sunucu fişi çekilir. Yeniden başlatılır. Tüm masalar açıktı, veri kaybı yok.

**Senaryo 5 — WiFi kesintisi:**
- Garson tablet WiFi'ı kapatılır. UI bağlantı yok uyarısı. WiFi açılınca otomatik bağlanır, son durum yenilenir.

**Senaryo 6 — Yazıcı çevrimdışı:**
- Yazıcı kablosu çekilir. Hesap kapatılır → kuyruğa alınır. Yazıcı bağlanır → otomatik basar.

**Senaryo 7 — Saat değişikliği:**
- Tablette saat 1 saat ileri/geri alınır. Sunucu saati değişmediği için raporlar doğru.

**Senaryo 8 — sakura.local çalışmıyor:**
- Android'de mDNS kapalı. Manuel IP girişi ile bağlanılır.

**Senaryo 9 — Yedekten geri yükleme:**
- `data/orders.json` manuel bozulur. Sunucu açılır, son yedekten geri yükler, çalışmaya devam eder.

**Senaryo 10 — Aynı anda 15 cihaz:**
- 1 PC + 5 tablet + 9 müşteri aynı anda. Sunucu performansı düşmüyor.

---

## 12. Sürüm Yönetimi & Güncelleme Sistemi

### 12.1 Felsefe: Tam Offline, USB ile Dağıtım

Hiçbir cloud sunucu, GitHub, Netlify CDN veya online servis kullanılmaz. Kaynak kod ve derlenmiş dosyalar **sadece geliştiricinin kendi bilgisayarında** durur. Yeni sürüm çıktığında geliştirici dosyaları USB veya WeTransfer ile restorana ulaştırır, restoran sahibi tek bir klasöre atar, gerisi otomatik.

### 12.2 Klasör Yapısı

```
SakuraPOS/                          ← restoran bilgisayarındaki ana klasör
├── SakuraPOS-Launcher.exe          ← kullanıcı bunu çalıştırır
├── SakuraPOS.exe                   ← asıl POS (launcher tarafından yönetilir)
├── data/                           ← veriler (güncellemede dokunulmaz)
│   ├── menu.json
│   ├── tables.json
│   ├── orders.json
│   ├── settings.json
│   └── reports/
└── updates/                        ← güncelleme dropbox klasörü
    ├── latest.json                 ← sürüm manifesti
    ├── pos/
    │   └── SakuraPOS-1.1.0.exe    ← yeni POS
    └── apk/
        ├── garson-1.1.0.apk
        └── yonetici-1.1.0.apk
```

### 12.3 `latest.json` Manifesti

```json
{
  "pos": {
    "version": "1.1.0",
    "file": "pos/SakuraPOS-1.1.0.exe",
    "releasedAt": "2025-05-20",
    "notes": "Hesap kapatma akışı iyileştirildi. Rapor sayfasına yıllık karşılaştırma eklendi.",
    "minApkVersion": "1.0.0"
  },
  "garson": {
    "version": "1.1.0",
    "file": "apk/garson-1.1.0.apk",
    "releasedAt": "2025-05-20",
    "notes": "Bağlantı kopması iyileştirildi."
  },
  "yonetici": {
    "version": "1.1.0",
    "file": "apk/yonetici-1.1.0.apk",
    "releasedAt": "2025-05-20",
    "notes": "Aynı sürüm."
  }
}
```

### 12.4 POS Güncelleme Akışı (Launcher Tabanlı)

**Neden launcher gerekli?**
Windows'ta çalışan bir `.exe` kendi dosyasını silemez veya değiştiremez. Bu yüzden mevcut POS yerine **küçük bir launcher** (`SakuraPOS-Launcher.exe`, ~5 MB) kullanıcının çalıştırdığı asıl uygulama olur. Launcher arka planda güncellemeyi yapar, sonra asıl POS'u başlatır.

**Akış:**
```
1. Kullanıcı SakuraPOS-Launcher.exe'yi çalıştırır
   ↓
2. Launcher updates/latest.json'u okur
   ↓
3. Mevcut SakuraPOS.exe sürümü vs latest.json sürümü karşılaştırır
   ↓
4. Yeni sürüm var mı?
   ├── HAYIR → SakuraPOS.exe'yi başlat (normal akış)
   └── EVET → 
        ├── Mevcut data/ klasörünü değiştirmez
        ├── Eski SakuraPOS.exe'yi yedekler (SakuraPOS.exe.bak)
        ├── updates/pos/SakuraPOS-1.1.0.exe → SakuraPOS.exe olarak kopyalar
        ├── settings.json'daki appVersion'u günceller
        ├── Splash screen: "Sürüm 1.1.0'a güncelleniyor..." (3 sn)
        ├── Yeni SakuraPOS.exe'yi başlatır
        └── Update başarılı log'u yaz
```

**Hata durumları:**
- Yeni `.exe` bozuksa: launcher checksum kontrolü yapar, bozuksa eski sürüme geri döner
- Disk dolu/yazma izni yok: kullanıcıya bildirim, eski sürüm devam eder
- Güncelleme başarısız: `update-failed.log` dosyası oluşur, eski `.bak` dosyası geri yüklenir

### 12.5 APK Güncelleme Akışı

**APK her açılışta:**
```
1. Tablet uygulaması açılır
2. /api/version endpoint'ini sorgular
3. Sunucu updates/latest.json'u okuyup APK sürümünü cevaplar
4. Tablet kendi versionCode'u ile karşılaştırır
5. Yeni sürüm var mı?
   ├── HAYIR → normal kullanım
   └── EVET →
        ├── Bildirim göster: "Yeni sürüm hazır"
        ├── Kullanıcı tıkladığında APK'yı /updates/apk/ adresinden indir
        ├── İndirme bitince Android installer'ı aç
        ├── Kullanıcı "Güncelle" butonuna basar
        └── 5-10 saniye, kurulum tamamlanır
```

**Sürüm uyumluluk kontrolü:**
- `latest.json.pos.minApkVersion` → APK bu sürümden eski ise zorunlu güncelleme
- Zorunlu güncelleme durumunda APK uygulaması kullanılamaz, sadece "Güncelle" butonu görünür

**Android sınırlaması:**
Android güvenlik politikası nedeniyle hiçbir uygulama başka bir uygulamayı tamamen sessizce kuramaz. Kullanıcı tek tıkla onaylamalıdır. Bu Google'ın kuralı, aşılamaz. Ama akış 10 saniyeyi geçmez.

**Bilinmeyen kaynak izni:**
APK ilk kurulumda Android tablette "Bilinmeyen kaynaklara izin ver" ayarı yapılır (bir kerelik). Sonraki güncellemeler aynı kaynaktan geldiği için ek izin istemez.

### 12.6 Geliştirici Sürüm Yayınlama Akışı

**Sen tarafın:**
```
1. Kodu güncelle (kendi bilgisayarın)
2. version'u artır:
   ├── package.json: 1.0.0 → 1.1.0
   └── android/app/build.gradle: versionCode 1 → 2
3. Build script'i çalıştır (tek komut):
   ├── npm run build:all
   │   ├── electron-builder → dist/SakuraPOS-1.1.0.exe
   │   ├── gradle assembleRelease → garson-1.1.0.apk
   │   └── gradle assembleRelease → yonetici-1.1.0.apk
4. Üç dosyayı + güncellenmiş latest.json'u USB'ye/WeTransfer'a koy
5. Müşteri/restoranla paylaş
```

**Restoran sahibinin yapacağı (talimat dokümanında detaylı):**
```
1. WeTransfer/USB'den dosyaları al
2. Bilgisayardaki SakuraPOS/updates/ klasörüne yapıştır
   - latest.json → updates/latest.json
   - SakuraPOS-1.1.0.exe → updates/pos/
   - garson-1.1.0.apk → updates/apk/
   - yonetici-1.1.0.apk → updates/apk/
3. POS'u kapat
4. SakuraPOS-Launcher.exe'yi tekrar çalıştır → otomatik güncellenir
5. Tabletler birkaç saat içinde bildirim alır → "Güncelle" butonuna bas
```

**Eski dosyalar:**
- Launcher güncelleme başarılı olduğunda eski `.exe` ve `.apk` dosyalarını siler
- Sadece son sürüm + bir önceki sürüm yedek olarak tutulur (rollback için)

### 12.7 Geri Dönüş (Rollback)

Yeni sürümde sorun varsa:
1. POS açılışta crash veriyorsa launcher otomatik `SakuraPOS.exe.bak` → `SakuraPOS.exe` olarak geri yükler
2. Manuel rollback: Restoran sahibi `updates/latest.json`'u eski sürümle değiştirir, tekrar açar
3. APK rollback: Tablete eski APK manuel kurulur

### 12.8 Versiyonlama Kuralları

**Semver (`MAJOR.MINOR.PATCH`):**
- `1.0.0 → 1.0.1`: Bug fix, küçük iyileştirme (otomatik güncelleme uygun)
- `1.0.0 → 1.1.0`: Yeni özellik (otomatik güncelleme uygun)
- `1.0.0 → 2.0.0`: Büyük değişiklik, veri migration gerekebilir (manuel kontrol)

**APK versionCode:**
- Her sürümde 1 artırılır (1, 2, 3, 4...)
- Android Play Store olmasa da bu zorunlu kural

**Web (Netlify):**
- Bu sistemde kapsam dışı (web sürümü ayrı yaşam döngüsünde)
- Kullanılırsa: GitHub repo + Netlify auto-deploy

### 12.9 Web Tarafı (Müşteri Menüsü)

Web tarafı bu güncelleme sisteminin parçası DEĞİLDİR. Çünkü:
- Web menüsü sadece müşterinin gördüğü statik bir sayfa
- POS ile veri paylaşmıyor
- Geliştirici Netlify dashboard'una manuel `index.html` ve `admin.html`'i drag-drop ile yüklerse iş biter
- Bir kerelik kurulum, sonra restoran sahibi web admin'inden menüyü yönetir, kod değişikliği nadir

Eğer web kodu değişirse:
1. Geliştirici dosyaları Netlify dashboard'a drag-drop ile yükler (1 dakika)
2. Veya GitHub'a push eder (otomatik deploy)
3. Müşteri tarayıcı yenilediğinde yeni sürümü görür

---

## 13. Geliştirme Yol Haritası

### Faz 1 — Backend & Veri (3-4 gün)
- [ ] Express sunucu kurulumu
- [ ] WebSocket entegrasyonu
- [ ] JSON veri katmanı (atomic write + backup)
- [ ] Tüm REST endpoint'leri
- [ ] PIN auth + JWT token
- [ ] mDNS yayını
- [ ] Saat senkronizasyonu (sunucu otoritesi)
- [ ] Version-based optimistic locking

### Faz 2 — POS Arayüzü (4-5 gün)
- [ ] Masa planı + canlı durumlar
- [ ] Adisyon paneli
- [ ] Ürün ekleme akışı
- [ ] Hesap kapatma + ödeme
- [ ] Masa transfer/birleştir
- [ ] İndirim uygulama
- [ ] Adisyon yazdırma (ESC/POS)

### Faz 3 — Garson Arayüzü (2-3 gün)
- [ ] Mobil optimize layout
- [ ] PIN ekranı + auth
- [ ] Masa listesi + aktif adisyon görünümü
- [ ] Sipariş gönderme akışı
- [ ] Bağlantı yönetimi (reconnect)

### Faz 4 — Rapor (3-4 gün)
- [ ] Günlük dashboard
- [ ] Saatlik grafik (Chart.js)
- [ ] Ürün/kategori bazlı satış
- [ ] Geçmiş gün gezici (takvim)
- [ ] Aylık özet
- [ ] Yıllık karşılaştırma
- [ ] Gün kapatma akışı

### Faz 5 — Yerel Admin (2 gün)
- [ ] Web admin'i yerel API'ye port et
- [ ] Masa yönetimi modülü
- [ ] PIN yönetimi
- [ ] Yazıcı testi
- [ ] QR yazdırma sayfası
- [ ] Yedek/restore UI

### Faz 6 — Electron Paketi & Launcher (3-4 gün)
- [ ] `main.js` Electron entry
- [ ] Tray ikonu
- [ ] İlk kurulum sihirbazı
- [ ] Otomatik başlatma seçeneği
- [ ] Windows Firewall kuralı
- [ ] `electron-builder` config
- [ ] Setup `.exe` üretimi
- [ ] **`SakuraPOS-Launcher.exe` (~5MB)**
  - [ ] `updates/latest.json` okuma + sürüm karşılaştırma
  - [ ] Eski `.exe` yedekleme (`.bak`)
  - [ ] Yeni `.exe` kopyalama + checksum kontrolü
  - [ ] Splash screen (3sn)
  - [ ] Hata durumunda otomatik rollback
  - [ ] `update-log.txt` yazımı
- [ ] Code signing (opsiyonel, alınmadı — SmartScreen uyarısı bir kerelik)

### Faz 7 — Android APK (3-4 gün)
- [ ] Android Studio projesi
- [ ] WebView Activity (immersive)
- [ ] mDNS resolver (Java NSD API)
- [ ] IP fallback ekranı
- [ ] PIN ekranı
- [ ] WebSocket reconnect logic
- [ ] Network change listener
- [ ] İki flavor (garson/yönetici)
- [ ] **APK güncelleme akışı:**
  - [ ] `/api/version` polling (her açılışta)
  - [ ] Yeni sürüm bildirimi
  - [ ] APK indirme (FileProvider)
  - [ ] Android installer çağırma (intent)
  - [ ] Zorunlu güncelleme modu (minVersion ihlali)
- [ ] Release imzası + APK üretimi

### Faz 8 — Test & Paket (3-4 gün)
- [ ] 10 senaryo testi
- [ ] Performans testi (15 eşzamanlı cihaz)
- [ ] Yazıcı testi (gerçek termal)
- [ ] Setup `.exe` testi (temiz Windows)
- [ ] APK testi (3 farklı Android sürümü)
- [ ] **Güncelleme testleri:**
  - [ ] Launcher: 1.0.0 → 1.1.0 başarılı geçiş
  - [ ] Launcher: bozuk `.exe` → otomatik rollback
  - [ ] Launcher: data/ klasörü dokunulmadığını doğrula
  - [ ] APK: yeni sürüm bildirim + indirme + kurulum
  - [ ] APK: zorunlu güncelleme akışı
- [ ] Kullanıcı dokümantasyonu
- [ ] Final paket

**Toplam tahmini süre:** 23-30 gün (1 kişi)

---

## 14. Teslim Paketi

### İlk Kurulum Paketi (restorana verilir)

```
SakuraPOS-v1.0.0/
├── SakuraPOS-Launcher.exe          ← Kullanıcı bunu çalıştırır (5 MB)
├── SakuraPOS.exe                   ← Asıl POS (80 MB, launcher tarafından yönetilir)
├── data/                           ← Boş şablon
│   ├── menu-template.json
│   ├── settings-template.json
│   └── reports/  (boş)
├── updates/                        ← Boş, gelecek güncellemeler buraya atılacak
│   └── README.txt                  ← "Güncelleme geldiğinde bu klasöre at"
├── apk/
│   ├── SakuraPOS-Garson-1.0.0.apk        (3 MB)
│   └── SakuraPOS-Yonetici-1.0.0.apk      (3 MB)
└── docs/
    ├── KURULUM.pdf                 ← Görsellerle kurulum
    ├── KULLANIM.pdf                ← Günlük kullanım
    ├── GUNCELLEME.pdf              ← Sürüm güncelleme talimatı
    └── SORUN-GIDERME.pdf           ← FAQ
```

### Sonraki Sürüm Paketleri (her güncellemede)

```
SakuraPOS-v1.1.0-update/
├── latest.json
├── pos/
│   └── SakuraPOS-1.1.0.exe
└── apk/
    ├── garson-1.1.0.apk
    └── yonetici-1.1.0.apk
```

Bu paket WeTransfer/USB ile restorana ulaştırılır. Restoran sahibi içeriği `SakuraPOS/updates/` klasörüne yapıştırır, POS'u tekrar açar.

### Dokümantasyon İçerikleri

**KURULUM.pdf:**
- Bilgisayara dosyaları kopyalama (drag-drop görsel)
- `SakuraPOS-Launcher.exe`'yi çalıştırma
- İlk açılış sihirbazı (ekran görüntüleri)
- WiFi'a bağlanma + IP not alma (router admin paneli görsel)
- Tabletlere APK kurma:
  - APK'yı tablete aktarma (USB veya WiFi share)
  - "Bilinmeyen kaynaklara izin ver" ayarı
  - Kurulum tek tıkla
- Tabletten POS'a bağlanma (sakura.local veya manuel IP)
- QR kod yazdırma + masalara yapıştırma
- Yazıcı bağlama (USB plug & play)
- İlk gün açma adımları

**GUNCELLEME.pdf:**
- Geliştiriciden gelen dosyaları aldığınızda
- `SakuraPOS/updates/` klasörünü açma
- Dosyaları doğru yerlere atma (görsel)
- POS'u kapatıp `SakuraPOS-Launcher.exe`'yi tekrar açma
- Splash screen kontrolü
- Tabletlerde "Güncelle" bildirimine tıklama
- Sorun çıkarsa rollback talimatı

---

## 15. Maliyet & Bakım

### İlk Kurulum
| Kalem | Maliyet | Açıklama |
|---|---|---|
| Geliştirme | (proje süresi) | Bir kerelik |
| Web hosting (Netlify Free) | 0 TL | Müşteri menüsü için |
| Domain (opsiyonel) | 200 TL/yıl | `sakurasushi.com.tr` isteniyorsa |
| Code signing | 0 TL | Alınmadı, SmartScreen uyarısı bir kerelik |
| Sunucu/cloud | 0 TL | Hiç kullanılmıyor |
| **TOPLAM (minimum)** | **0 TL** | |

### Aylık/Yıllık Bakım
| Kalem | Maliyet |
|---|---|
| Hosting | 0 TL |
| Sunucu | 0 TL (yerel) |
| Cloud | 0 TL (kullanılmıyor) |
| Sürüm dağıtım | 0 TL (USB/WeTransfer manuel) |
| Geliştirici bakımı | (anlaşmaya göre) |

### Sürüm Güncelleme Maliyeti

| Kalem | Maliyet |
|---|---|
| Geliştirici sürüm üretimi | 30 dk |
| WeTransfer/USB transferi | 5 dk |
| Restoranda dosya yapıştırma | 2 dk |
| Toplam aksaklık süresi | <10 dk (POS yeniden başlatma) |

**Restoranın görevleri:**
1. Bilgisayarı 7/24 açık tutmak
2. WiFi router'ı sağlam tutmak
3. Yedek alma (otomatik, sadece harici diske kopyalama önerilir)
4. Sürüm güncellemesi geldiğinde dosyaları doğru klasöre koymak

---

## 16. Sınırlamalar ve Bilinen Riskler

| Risk | Etki | Hafifletme |
|---|---|---|
| Bilgisayar kapalıyken müşteri menüye bakamaz | YOK — menü Netlify'da | — |
| Bilgisayar kapalıyken garson çalışamaz | Yüksek | Kullanıcı eğitimi: PC her zaman açık |
| Code signing yok → SmartScreen uyarısı | Düşük | "Yine de çalıştır" der, bir kerelik |
| 50+ aynı anda cihaz | Yüksek (genelde olmaz) | Performans testi yapılacak |
| Trendyol/Yemeksepeti entegrasyonu yok | Orta | İlk sürümde manuel giriş, v2'de otomasyon |
| iOS uygulaması yok | Düşük | Müşteri menüsü zaten web, garsonlar Android tablet kullanır |
| Sunucu çökerse rapor erişilmez | Düşük | Otomatik yedekler var |
| WiFi kesintisi → garson çalışamaz | Orta | Kullanıcı eğitimi: WiFi sağlamlığı önemli |
| **Sürüm güncelleme manuel** | Orta | Geliştirici WeTransfer ile gönderir, restoran 5 dk'da uygular |
| **Restoran sahibi dosya yapıştıramayabilir** | Orta | GUNCELLEME.pdf görsel + telefon desteği |
| **Yeni sürüm bozuk çıkarsa** | Yüksek | Launcher otomatik rollback yapar |
| **Tablet APK güncellemesi atlamak isteyebilir** | Düşük | Zorunlu güncelleme modu (`minApkVersion`) |

---

## 17. v1'den Sonra Yol Haritası

**v1.1 (1-2 ay sonra):**
- Trendyol/Yemeksepeti e-posta parse (gün sonu raporlarına dahil)
- Personel/garson bazlı satış raporu
- İndirim/promosyon kuralları (yüzde, sabit, ürün özel)

**v1.2 (3 ay sonra):**
- Stok takibi (basit, ürün başına)
- Müşteri sadakat (telefon ile, indirim biriktirme)
- Yıllık karşılaştırma raporları
- Yedek dosya import/export sihirbazı

**v2.0 (6 ay sonra, talep gelirse):**
- Cloud sync (POS + Web menü tek noktadan, opsiyonel)
- Birden fazla şube desteği (zincir restoran)
- Online sipariş kabul (yerel, garson onayı ile)
- iOS uygulaması (TestFlight)

---

## 18. Onay & Başlangıç

Bu plan onaylandıktan sonra **Faz 1** başlar:
1. Backend mimarisi (Express + WebSocket + atomic JSON)
2. Auth sistemi (PIN + JWT)
3. mDNS yayını
4. Temel API endpoint'leri
5. Versiyonlama altyapısı (`appVersion`, `latest.json` semantiği)

İlk teslim: 3-4 gün içinde çalışan backend + Postman koleksiyonu (manuel test için).

---

*Master Plan v1.0 (Final) — Sakura Sushi Fulya Restoran Yönetim Sistemi*
*Onaylandı: Nisan 2025*
