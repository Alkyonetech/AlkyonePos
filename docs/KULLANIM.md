# Alkyone POS — Kullanım Kılavuzu

Sistem beş ekrandan oluşur:
- `/pos` — Kasiyer / yönetici (bilgisayar)
- `/garson` — Garson (tablet/telefon — APK)
- `/yonetici` — Yönetici mobil (tablet/telefon — APK, hesap kapatma + günlük takip)
- `/admin` — Yönetim paneli (bilgisayar — menü/personel/yazıcı yönetimi)
- `/rapor` — Raporlar (bilgisayar)

---

## 1. POS Ekranı (`/pos`) — Kasiyer

### Açma
1. Bilgisayardaki **Alkyone POS** kısayoluna tıkla
2. Tarayıcı açılır → PIN ekranı (yönetici PIN: 9999)
3. Masa düzeni görünür

### Masa Renkleri
- **Beyaz:** boş masa
- **Yeşil:** açık adisyon (yiyor)
- **Sarı:** hesap istendi
- **Kırmızı:** sorunlu (uzun süre dokunulmadı vb.)

### Sipariş Almak
1. Masaya tıkla → adisyon ekranı açılır
2. Sol panelden ürün ara (kategori veya isim)
3. Ürüne tıkla → adisyon listesine eklenir
4. Adet artırma/azaltma için + / − butonları
5. Not eklemek için ürünün üzerine tıkla → "Not"

### Hesap Kapatma
1. Adisyon ekranında **Hesap Kapat**
2. Ödeme tipi seç: **Nakit / Kart / Karışık**
3. Karışık seçildiyse iki tutarı gir
4. **Onayla** → fiş yazdırılır, masa boşalır

### Masa Taşı / Birleştir
- **Taşı:** masa üzerinde sağ tık → **Taşı** → hedef masa seç
- **Birleştir:** masa üzerinde sağ tık → **Birleştir** → hedef masa seç (kaynak masa boşalır, ürünler hedefe eklenir)

### Gün Kapatma
Gün sonunda (varsayılan saat 04:00 otomatik):
1. POS ekranı sağ üst → **Gün Kapat**
2. Tüm açık adisyonların kapatılmış olduğunu kontrol et
3. **Onayla** → günlük rapor `data/reports/<tarih>.json` olarak kaydedilir

---

## 2. Garson Ekranı (`/garson`) — Tablet

### Giriş
- APK aç → otomatik bağlanır
- PIN ekranı: garson PIN (varsayılan: 1234)

### Masa Düzeni
POS'taki gibi renklerle masaları görürsün. Masaya dokun → adisyon ekranı.

### Hızlı Sipariş
- **Favori ürünler** üst bantta (en çok sipariş edilen 8 ürün)
- **Ses kontrol** simgesi (gelecek özellik): basılı tut, "iki dragon roll" dikte et

### Bağlantı Durumu
Sağ üst köşede:
- **Yeşil nokta:** bağlı
- **Kırmızı nokta:** bağlı değil (otomatik yeniden bağlanır)

### Geri Tuşu
Garson APK'da geri tuşu **devre dışıdır** (kiosk modu).
Çıkmak için yönetici PIN gerekir (Ayarlar simgesi).

---

## 3. Yönetici Mobil APK (`/yonetici`) — Tablet/Telefon

Mobil yönetici uygulaması — sahip/yöneticinin masada dolaşırken hesap kapatabilmesi ve gün boyu ciroyu takip edebilmesi için. `/admin` paneline alternatif değil, tamamlayıcı.

### Giriş
- **Alkyone Yönetici** APK'sını aç → otomatik bağlanır
- Yönetici PIN ile giriş yap (varsayılan: 9999 — değiştirilmiş olmalı!)

### Üst Bant (Header İstatistikleri)
- **Açık ciro:** o anda açık tüm masaların toplam tutarı
- **Açık masa:** "açık/toplam" sayacı (ör. 3/12)

### Sekmeler

**Masalar:** POS'taki gibi renkli masa düzeni — masa başına ürün sayısı + tutar.

**Adisyonlar:** Açık adisyon listesi — masa adı, ürün sayısı, kaç dakikadır açık, tutar.

**Bugün:** Günlük rapor + canlı:
- Toplam ciro (kapanmış + açık adisyonlar)
- Toplam adisyon sayısı, açık olanlar
- Ortalama hesap
- En çok satan ürünler (8 adet)
- **Günü Kapat** butonu (Z raporu — `data/reports/<tarih>.json` oluşturur)

### Hesap Kapatma (Mobil)
1. Masaya dokun → adisyon ekranı açılır
2. Sağ üstteki **Hesap Kapat** butonuna dokun
3. **Ödeme yöntemi:** Nakit / Kart / Karışık seç
4. **İndirim** (opsiyonel):
   - Sabit tutar ("fixed"): TL cinsinden indirim (ör. 50 TL)
   - Yüzde ("percent"): % cinsinden indirim (ör. %10)
5. Ara toplam ve indirimli toplam ekranda görünür
6. **Onayla** → fiş yazdırılır, masa boş duruma döner

### Sipariş Ekleme (Mobil Yönetici)
Yönetici APK'da garson işlemleri de yapılabilir — masaya dokun → kategori seç → ürüne dokun → adet/not gir → **Onayla**.

### Bağlantı Durumu
Üst köşede yeşil/kırmızı nokta. Kırmızı ise altta turuncu "Bağlantı yok" bandı görünür — sistem otomatik yeniden bağlanır.

### Cihaz Uyumluluk Notu
İlk açılışta **MIUI/HyperOS, ColorOS, Funtouch, OneUI** vb. cihazlarda uygulamanın arka planda kapatılmaması için:
1. **Pil optimizasyonu istisnası** ekranı otomatik açılır → "İzin ver" deyin
2. **Otomatik başlat (autostart)** ayar sayfası açılır → Alkyone Yönetici'yi listeye ekleyin
3. Bu uyarı sadece bir kez gösterilir.

---

## 4. Yönetim Paneli (`/admin`)

### Menü Düzenleme
- **Kategoriler** ve **ürünler** ekle/sil/güncelle
- Fiyat değişikliği anında tabletlere yansır
- Görünmez yapma: ürünü silmeden gizle (`visible: false`)

### Masa Yönetimi
- Masa ekle/sil
- Bölüm (salon/bahçe/teras) ata
- Kapasite belirle
- QR kodu indir

### Personel
- Yönetici PIN değiştir
- Garson PIN değiştir
- Tüm tabletlerin oturumlarını kapat (PIN değişince zorunlu)

### Yazıcı Ayarları
- Yazıcı tara, test et
- Fiş başlığı/altı düzenle
- Logo yükle (opsiyonel)

### Yedek
- Manuel yedek al (anlık)
- Yedekten geri yükle (son 7 gün, saatlik)

---

## 5. Raporlar (`/rapor`)

### Günlük Rapor
- Tarih seç → o günün özeti:
  - Toplam ciro
  - Adisyon sayısı
  - Ortalama hesap
  - Ödeme dağılımı (nakit/kart)
  - En çok satan ürünler

### Aylık Rapor
- Yıl/ay seç → grafiklerle:
  - Günlük ciro grafiği
  - Saat dilimi yoğunluğu
  - Kategori bazlı satış

### Dışa Aktarma
- **PDF:** rapor olarak indir (yazdırılabilir)
- **CSV:** Excel için (muhasebeye gönderilir)

---

## 6. Müşteri Menüsü (QR)

Müşteri masadaki QR kodu telefonuyla okutur:
1. Tarayıcı açılır → masa numarası otomatik bilinir
2. Menüden ürün seçer (sepete ekler)
3. **Sipariş Ver** → garson tabletine bildirim düşer
4. Garson onaylar → adisyona eklenir

> Müşteri **hesap kapatamaz** — bu yetki sadece personeldedir.

---

## 7. Kısayollar (klavye)

POS ekranında:
- **Ctrl+M** — Menüye dön
- **Ctrl+L** — Çıkış (oturum kapat)
- **F11** — Tam ekran
- **Ctrl+R** — Yenile (sorun varsa)

---

## 8. Otomatik Başlatma + Kiosk Modu

### Otomatik Başlatma (Windows)
- **Admin Panel → Sistem Ayarları → "Windows açılışında otomatik başlat"** kutusunu işaretle → Kaydet
- Bilgisayar yeniden başlatıldığında Alkyone POS sessizce açılır (`--auto-start` argümanıyla, tray'e gizli).
- Kiosk modu da açıksa doğrudan tam ekran POS gelir.
- **Önkoşul:** Windows kullanıcısı için **otomatik giriş** veya **şifresiz hesap** olmalı (yoksa Windows giriş ekranında kullanıcının manuel giriş yapması gerekir). `netplwiz` komutuyla otomatik giriş ayarlanabilir.

### Kiosk Modu (Tam Ekran, Çıkış Engelli)
Kiosk modunda Alkyone POS:
- **Tam ekran** açılır, taskbar gizlenir
- Pencere çubuğu yok, ALT+F4 / Esc / F11 çalışmaz
- Tray ikonu yok
- Kazara çıkış engelli — kullanıcılar yanlışlıkla pencereyi kapatamaz

**Açmak için:**
1. Admin Panel → Sistem Ayarları → "Kiosk modu aktif" kutusunu işaretle
2. **Kiosk açılış sayfası** seç (varsayılan: POS Ekranı)
3. **Kaydet** — uygulama otomatik yeniden başlar, kiosk modunda açılır

**Çıkmak için:** **`Ctrl + Shift + Q`** klavye kombinasyonu — sadece bu kombinasyon kiosk modundan çıkarır.

**Kiosk modunu kapatmak için:**
1. `Ctrl + Shift + Q` ile uygulamadan çık
2. Tekrar Alkyone POS'u başlat (normal modda açılır)
3. Admin Panel → Sistem Ayarları → "Kiosk modu aktif" işaretini kaldır → Kaydet
4. Yeniden başlatma → normal modda açılır

> Not: Kiosk modunda **otomatik başlatma + Windows otomatik giriş** birleşimi, restoran PC'sini açıp kapatınca direkt sipariş alma ekranına düşürür.

---

## 9. Günlük Operasyon İpuçları

- **Sabah 1. iş:** Tarayıcıyı yenile (`Ctrl+R`) — temiz bir oturumla başla
- **Yoğun saat:** Garsonlar mümkünse aynı masaya yazmasın (version conflict olur, kayıp yok ama küçük gecikme)
- **Akşam:** Yazıcıyı kapatma — sabah USB resetlemek gerekebilir
- **Pazartesi:** Aylık rapor al, muhasebeye gönder
- **Ay sonu:** Manuel yedek al, USB'ye kopyala
