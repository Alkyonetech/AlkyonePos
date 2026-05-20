# Sakura POS — Güncelleme Kılavuzu

Yeni sürüm geldiğinde bilgisayara ve tabletlere nasıl uygulanacağı.

> **Önemli:** Sistem tamamen offline çalışır. Hiçbir cloud sunucu yoktur.
> Geliştirici dosyaları **USB veya WeTransfer ile** size ulaştırır.

---

## 1. Geliştiriciden Gelen Paket

USB veya WeTransfer ile aldığınız ZIP içinde:
```
SakuraPOS-Update-1.x.0/
├── latest.json                    ← sürüm manifesti
├── pos/
│   └── SakuraPOS-1.x.0.exe       ← yeni POS
├── apk/
│   ├── garson-1.x.0.apk          ← yeni garson APK
│   └── yonetici-1.x.0.apk        ← yeni yönetici APK
└── DEGISIKLIKLER.txt              ← bu sürümde ne değişti
```

---

## 2. POS Bilgisayarını Güncelleme

### Adım 1 — Dosyaları kopyala
1. POS bilgisayarında **`SakuraPOS/updates/`** klasörünü aç
   (genellikle `C:\Program Files\Sakura POS\updates\` veya `C:\SakuraPOS\updates\`)
2. ZIP içindeki dosyaları **doğru yerlere** kopyala:
   - `latest.json` → `updates/latest.json` (üstüne yaz)
   - `SakuraPOS-1.x.0.exe` → `updates/pos/`
   - `garson-1.x.0.apk` → `updates/apk/`
   - `yonetici-1.x.0.apk` → `updates/apk/`

### Adım 2 — POS'u kapat
- Görev çubuğundan Sakura POS'a sağ tık → **Çıkış**
- veya tarayıcıdan `/pos` ekranındaki **Çıkış** butonu → tarayıcıyı kapat
- Görev Yöneticisi'nde "SakuraPOS" işlemi olmadığından emin ol

### Adım 3 — Launcher ile güncelle
1. Masaüstünden **Sakura POS** kısayoluna çift tıkla
   (Bu kısayol aslında `SakuraPOS-Launcher.exe`'yi çalıştırır)
2. Launcher otomatik olarak:
   - `latest.json`'u okur
   - Mevcut sürümle karşılaştırır
   - Yeni sürüm varsa: **"Sürüm 1.x.0'a güncelleniyor..."** ekranı (3-5 sn)
   - Eski sürümü `SakuraPOS.exe.bak` olarak yedekler
   - Yeni sürümü kurar
   - POS'u başlatır

### Adım 4 — Doğrulama
- POS açıldı mı?
- Sağ alt köşede sürüm numarası: `1.x.0` görünüyor mu?
- Açık masalar duruyor mu? (önceki günden devreden adisyon varsa)
- Birkaç tabletten bağlanıp test sipariş gir

---

## 3. Tabletleri Güncelleme

Tabletler **otomatik** günceleceleri için elle bir şey yapmanıza gerek yok.

### Otomatik güncelleme akışı
1. Garson/yönetici tableti açtığında APK kendi sürümünü `/api/version` ile karşılaştırır
2. Yeni sürüm varsa **"Yeni Sürüm Var"** diyaloğu çıkar
3. Garson **"İndir & Kur"** butonuna basar
4. APK indirilir (5-10 sn), Android kurulum sihirbazı açılır
5. **"Yükle"** → APK güncellenir, uygulama yeniden açılır

### Zorunlu güncelleme
Bazı sürümlerde eski APK ile çalışılamaz (`minApkVersion` ihlali):
- Diyalog **kapatılamaz**, sadece "İndir & Kur" görünür
- Güncelleme yapılmadan tablet kullanılamaz

### Tablette güncelleme çıkmıyor mu?
1. APK'yı tamamen kapat (son uygulamalar listesinden kaldır)
2. Tekrar aç → `/api/version` polling tekrar tetiklenir
3. Yine çıkmıyorsa: WiFi/POS bağlantısı kontrol et

### Manuel kurulum (acil durum)
Eğer tablet otomatik güncellemeyi alamıyorsa:
1. APK dosyasını USB ile tablete kopyala (`Download/` klasörüne)
2. Dosya yöneticisinden APK'ya dokun → **Yükle**
3. Eski sürüm üzerine yazılır, ayarlar/PIN korunur

---

## 4. Sorun Çıkarsa — Geri Dönüş (Rollback)

### POS yeni sürümde açılmıyor (otomatik rollback)
Launcher zaten otomatik rollback yapar:
- Yeni `.exe` checksum tutmazsa
- Açılışta crash verirse
- → `.bak` yedeği geri yüklenir, eski sürüm açılır
- `update-failed.log` oluşur, geliştiriciye gönderin

### Manuel POS rollback
1. `SakuraPOS/` klasörünü aç
2. `SakuraPOS.exe` dosyasını sil
3. `SakuraPOS.exe.bak` → `SakuraPOS.exe` olarak yeniden adlandır
4. `updates/latest.json` dosyasını **eski sürümle** değiştir (geliştiricinin verdiği bir önceki paketten)
5. POS'u açar gibi tekrar Launcher'a tıkla

### APK rollback (tablet)
1. **Ayarlar → Uygulamalar → Sakura Garson** (veya Yönetici)
2. **Kaldır**
3. Bilgisayardan eski APK'yı USB ile getir
4. Tablete kur
5. Yeniden bağlan, PIN gir

> **Not:** Veri tablette saklanmaz, hep sunucudadır. Tableti silip yeniden kurmak güvenlidir.

---

## 5. Veri Korunuyor mu?

**Evet — güncelleme `data/` klasörüne dokunmaz:**
- `data/menu.json` — menü
- `data/tables.json` — masalar
- `data/orders.json` — açık adisyonlar
- `data/reports/` — eski raporlar
- `data/backups/` — saatlik yedekler
- `data/settings.json` — restoran bilgileri, PIN'ler

**Yine de güvenlik için:**
- Güncelleme öncesi `data/` klasörünü USB'ye **manuel yedekle**
- Önemli güncellemeden hemen sonra tarayıcıdan `/admin → Manuel yedek al`

---

## 6. Sürüm Numaralama

Sürüm formatı: `MAJOR.MINOR.PATCH` (semantic versioning)
- **MAJOR** (örn: 1 → 2): büyük değişiklikler, veri formatı değişebilir
- **MINOR** (örn: 1.0 → 1.1): yeni özellikler, geriye uyumlu
- **PATCH** (örn: 1.1.0 → 1.1.1): hata düzeltme

`DEGISIKLIKLER.txt` dosyasında bu sürümde ne değiştiğini görebilirsiniz.

---

## 7. Güncelleme Sıklığı

- **Patch sürümler** (hata düzeltme): birkaç haftada bir
- **Minor sürümler** (yeni özellik): 2-3 ayda bir
- **Major sürümler**: yılda bir

Acil hata düzeltme gerekirse 1-2 günde aceleyle çıkar.

---

## 8. Güncelleme Sonrası Kontrol Listesi

- [ ] POS açıldı, sürüm doğru
- [ ] Açık masalar yerinde
- [ ] Bir tabletten test bağlantı + sipariş ekle/sil
- [ ] Yazıcı çalışıyor (test fişi)
- [ ] `data/backups/` yeni güncelleme öncesi yedek oluşturuldu
- [ ] Tabletler bildirim aldı (1 saat içinde)
- [ ] Bir tablet güncellendi, çalışıyor

Sorun varsa → `SORUN-GIDERME.md`
