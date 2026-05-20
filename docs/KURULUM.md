# Alkyone POS — Kurulum Kılavuzu

Bu doküman Alkyone POS'u restoran bilgisayarına ve tabletlere ilk kez kurarken
adım adım takip etmeniz gereken kılavuzdur.

---

## 1. Gereksinimler

**Bilgisayar (POS):**
- Windows 10 veya üzeri (64-bit)
- En az 4 GB RAM
- 500 MB boş disk
- Ethernet veya WiFi ile yerel ağa bağlı

**Yazıcı (opsiyonel):**
- ESC/POS uyumlu termal yazıcı (58 mm)
- USB bağlantısı

**Tabletler:**
- Android 7.0 (API 24) veya üzeri
- 7 inç veya daha büyük ekran
- Aynı WiFi ağına bağlı

**Ağ:**
- Restoran içi WiFi (yönlendirici)
- İnternet bağlantısı **gerekli değil** (sistem yerel çalışır)

---

## 2. Bilgisayara POS Kurulumu

### Adım 1 — Dosyaları al
Geliştiriciden USB veya WeTransfer ile aldığınız `AlkyonePOS-x.x.x.zip`
dosyasını C:\\ veya Masaüstüne çıkartın.

### Adım 2 — Kurulum sihirbazını çalıştır
`AlkyonePOS Setup 1.0.0.exe` dosyasına çift tıklayın.

1. "Next" → kurulum klasörünü seçin (varsayılan: `C:\Program Files\Alkyone POS`)
2. "Install" → kurulum birkaç saniye sürer
3. "Finish" → Masaüstü ve Başlat menüsüne kısayol oluşturulur

### Adım 3 — İlk çalıştırma
Masaüstündeki **Alkyone POS** kısayoluna çift tıklayın.

İlk çalıştırmada şunları yapar:
- Yerel sunucuyu başlatır (port 3000)
- mDNS yayını açar (`sakura.local`)
- Tarayıcıda POS arayüzünü açar

İlk açılışta ayar sihirbazı görüntülenir:
- Restoran adı, adres, telefon
- Yönetici PIN değiştir (varsayılan: 9999)
- Garson PIN değiştir (varsayılan: 1234)
- Yazıcı bağlandıysa "test fişi" yazdır

### Adım 4 — IP adresini not al
Tabletlerin bağlanabilmesi için bilgisayarın IP adresini öğrenin:

**Yöntem 1 — Komut satırı:**
```cmd
ipconfig
```
"IPv4 Address" satırındaki adres (örn: `192.168.1.50`).

**Yöntem 2 — Yönlendirici paneli:**
Yönlendiricinin admin paneline girip bağlı cihazlardan POS bilgisayarını bulun.

> **Önemli:** Bu IP'yi yönlendiricide **statik** olarak ayarlayın
> (DHCP rezervasyonu) — yoksa restart sonrası IP değişebilir.

---

## 3. Tabletlere APK Kurulumu

### Adım 1 — APK'yı tablete aktar
İki APK dosyası vardır:
- `garson-1.0.0.apk` → garson tabletleri için
- `yonetici-1.0.0.apk` → yönetici tableti için

Aktarma yöntemleri:
- **USB:** Tableti kabloyla bilgisayara bağla, dosyayı `Download/` klasörüne kopyala
- **WiFi:** Aynı ağdaki başka cihazdan paylaş (Send Anywhere, Snapdrop)

### Adım 2 — "Bilinmeyen kaynaklara izin ver"
Android **Ayarlar → Güvenlik → Bilinmeyen kaynaklar** veya
Android 8+ için: APK açıldığında çıkan diyalogdan **"Ayarlar"** → bu uygulama için izin ver.

### Adım 3 — APK'yı kur
Dosya yöneticisinden APK'ya dokun → **"Yükle"**.
Kurulum bittikten sonra:
- Garson tableti için: `Alkyone Garson` simgesine dokun
- Yönetici tableti için: `Alkyone Yönetici` simgesine dokun

### Adım 4 — Sunucuya bağlan
APK ilk açıldığında otomatik olarak `sakura.local` üzerinden sunucuyu arar.

**Bulamazsa** (mDNS desteklenmeyen ağlarda) IP girme diyaloğu açılır:
1. Adım 2.4'te not aldığınız IP'yi gir (örn: `192.168.1.50`)
2. **"Bağlan"** → POS arayüzü açılır

---

## 4. QR Kodlarını Hazırla

Müşterilerin masadan menüye erişmesi için QR kodlar gerekir.

1. Tarayıcıdan `http://localhost:3000/admin` aç
2. **Masalar** sekmesi → her masa için QR kodunu indir
3. QR kodları yazıcıdan A4 kağıda yazdır
4. Plastikleyip masalara yapıştır

QR kod tarandığında müşteri menüsü `http://<IP>:3000/menu/<masaNo>`
adresinde açılır.

---

## 5. Yazıcı Bağlantısı (opsiyonel)

1. Termal yazıcıyı USB ile bilgisayara bağla
2. Sürücü gerekirse Windows otomatik kurar
3. POS'u yeniden başlat
4. `http://localhost:3000/admin` → **Ayarlar → Yazıcı**
5. **"Yazıcıyı tara"** → otomatik bulunur
6. **"Test fişi"** → çalışıyor mu kontrol et

Yazıcı yoksa: hesap kapanırken A4 PDF üretilir, yazıcıya gönderilebilir.

---

## 6. İlk Gün Açma Adımları

1. **POS bilgisayarı:** sabah açılınca masaüstündeki **Alkyone POS** kısayoluna tıkla
2. **Tabletler:** her tabletten kendi APK'sını aç
3. **Yönetici PIN** ile yönetici tableti girişi: `9999` (veya değiştirdiğin PIN)
4. **Garson PIN** ile garson tabletleri girişi: `1234`
5. **POS ekranında** masa düzeni göründüğünde sistem hazırdır
6. Müşteri geldiğinde:
   - Garson masaya yöneliyorsa: tabletteki masaya tıkla → ürün ekle
   - QR ile sipariş alınıyorsa: müşteri telefondan QR'ı tarar, sipariş ulaşır

---

## 7. Sıkça Karşılaşılan Sorunlar

> Detaylı sorun giderme: `SORUN-GIDERME.md`

- **Tablet bağlanamıyor:** IP'yi manuel gir (yönlendiricinin DHCP rezervasyonunu yap)
- **mDNS çalışmıyor:** Bazı yönlendiriciler mDNS'i bloklar — IP fallback otomatik devreye girer
- **Yazıcı çalışmıyor:** USB kabloyu çıkar/tak, sürücü kur, yeniden test et
- **POS açılmıyor:** Antivirüs `AlkyonePOS.exe`'yi karantinaya almış olabilir, izin ver

---

## 8. Veri Yedekleme

Sistem her saat başı otomatik yedek alır (`data/backups/`).
**Manuel yedek:** Ayda bir kez `data/` klasörünü USB'ye kopyala.

Donanım arızası veya bilgisayar değiştirme durumunda:
1. Yeni bilgisayara setup'ı kur
2. Eski `data/` klasörünü yeni kuruluma kopyala (üzerine yaz)
3. POS'u başlat → tüm veriler geri gelir
