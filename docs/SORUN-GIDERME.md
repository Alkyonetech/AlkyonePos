# Sakura POS — Sorun Giderme

Sık karşılaşılan sorunlar ve çözümleri. Sıralama: önce hızlı kontroller, sonra detaylı.

---

## ⚡ Acil Durum — POS açılmıyor

1. **Sakura POS** kısayoluna sağ tık → **Yönetici olarak çalıştır**
2. Çözmediyse: **Görev Yöneticisi** (Ctrl+Shift+Esc) → "SakuraPOS" işlemi varsa kapat → tekrar aç
3. Hâlâ açılmıyorsa: `C:\Program Files\Sakura POS\SakuraPOS.exe` üzerinde sağ tık → **Özellikler → Engelliliği kaldır** (Antivirüs)
4. **Acil yedek:** Yan masadaki dizüstü/yedek bilgisayarda da Sakura POS kuruluysa, oraya geçin. Tabletler aynı IP'ye otomatik bulamayabilir → manuel IP gir.

---

## 1. Tablet bağlantı sorunları

### "Sunucu bulunamadı" hatası

**Olası neden 1: Yanlış WiFi**
- Tablette aynı WiFi'a bağlı mı kontrol et (POS bilgisayarıyla aynı ağ)

**Olası neden 2: mDNS desteklenmiyor**
- Bazı yönlendiriciler `sakura.local` çözümlemeyi engeller
- **Çözüm:** APK açılınca "Sunucu Adresi" diyaloğu çıkar → IP'yi elle gir
- IP'yi öğrenmek için POS bilgisayarında `ipconfig` (cmd)

**Olası neden 3: Sunucu durmuş**
- POS bilgisayarındaki tarayıcıdan `http://localhost:3000` aç
- Açılmıyorsa POS uygulamasını yeniden başlat

**Olası neden 4: Güvenlik duvarı**
- Windows Defender Firewall: gelen bağlantı engelliyor olabilir
- **Çözüm:** Denetim Masası → Güvenlik Duvarı → "Sakura POS"a izin ver

### Tablet bağlandı ama sürekli kopuyor

- **WiFi sinyali zayıf** olabilir → tableti yönlendiriciye yaklaştır
- Yönlendirici "Client Isolation" / "AP Isolation" özelliği açıksa kapatın
- 2.4 GHz vs 5 GHz: tabletler ve POS aynı bantta olsun

### IP değişti

POS bilgisayarının IP'si değiştiyse tabletler eski IP'ye bağlanmaya çalışır.
- **Geçici çözüm:** Her tablette APK'yı kapat/aç → mDNS yeniden bulur
- **Kalıcı çözüm:** Yönlendiricide POS bilgisayarına **DHCP rezervasyonu** yap (statik IP)

---

## 2. Yazıcı sorunları

### Yazıcı yazmıyor

1. USB kablosunu çıkar/tak
2. Yazıcının ışığı yanıyor mu? Kağıt var mı?
3. POS'un sağ üstündeki yazıcı simgesi:
   - **Yeşil:** çalışıyor
   - **Kırmızı:** bağlantı yok
   - **Sarı:** kuyruğa alınmış fişler var
4. `/admin → Ayarlar → Yazıcı → Test fişi` → çıkmıyorsa USB sürücüsü problemi olabilir

### Yazıcı sürücüsü hatası

- Windows otomatik bulamayabilir
- Yazıcı modeline göre `escpos` jenerik sürücüsü çoğu termal yazıcıyla uyumlu
- Üreticinin sürücüsünü indir (yazıcı kutusunda CD veya web sitesi)

### Türkçe karakter bozuk basıyor (öŞĞ vb.)

- `/admin → Ayarlar → Yazıcı → Encoding` → **PC857** olarak ayarlandığını kontrol et
- Bazı yazıcılar **CP1254** ister — değiştir, test fişi bas

### Yazıcı çevrimdışı, hesaplar ne olur?

- Hesap normal kapanır, **fişler kuyruğa** alınır
- Yazıcı bağlanınca biriken fişler otomatik basılır
- Acil durumda `/admin → Yazıcı → Kuyruktaki fişleri PDF olarak indir`

---

## 3. Veri / Adisyon sorunları

### "Bu masada zaten açık adisyon var" hatası

İki garson aynı anda aynı masaya başlamış olabilir. Sayfayı yenile, en güncel hali alacak.

### Sipariş eklendi ama görünmüyor (tabletler arası)

- WebSocket kopmuş olabilir → tablette **çek-aşağı yenile** veya APK'yı kapat/aç
- POS ekranında sağ üst → **Yenile** (Ctrl+R)

### "Version conflict" uyarısı

İki kişi aynı anda aynı adisyona yazmış. Sistem otomatik en güncel halini çekip yeniden yazıyor. Veri kaybı yoktur. Yine de yoğun saatte birden çok garson aynı masaya yazmasın.

### Yanlış ürün eklendi, hesap kapanmadan iptal etmek istiyorum

- Adisyon ekranında ürünün yanında **çöp kutusu** simgesi → sil
- Hesap kapandıysa: yönetici PIN gerekli, **/admin → Adisyonlar → İptal**

### Hesap yanlış kapatıldı (yanlış ödeme tipi vs.)

- `/admin → Adisyonlar → Geçmiş` → o adisyonu bul → **"Düzelt"**
- Yönetici PIN gerekli, log'a kaydedilir

---

## 4. Performans / Yavaşlık

### Sistem yavaş

- Bilgisayarda başka uygulamalar (Chrome 50 sekme vb.) varsa kapat
- POS bilgisayarını **haftada bir** restart et (RAM temizliği)
- `data/orders.json` çok büyüdüyse (>10 MB) gün kapatma yapılmamış demektir → gün kapat

### `data/` klasörü çok büyük

Yedekler birikiyor olabilir:
- `data/backups/` → 7 günden eskiler otomatik silinir
- `data/reports/` → ay sonunda eski raporları başka klasöre taşıyın

---

## 5. Güncelleme sorunları

### Launcher splash takılı kaldı

- 30 saniye bekle, takılıysa: **Görev Yöneticisi** ile `SakuraPOS-Launcher.exe`'yi sonlandır
- Sonra: `SakuraPOS/SakuraPOS.exe.bak` dosyası varsa onu **`SakuraPOS.exe`** olarak yeniden adlandır
- POS açılır (eski sürüm ile)
- Geliştiriciye `update-failed.log` dosyasını gönder

### "Güncelleme zorunlu" diyor ama tablet güncellemiyor

- Tablette internet/yerel ağ olduğundan emin ol
- "İndir & Kur" → bildirim çubuğunda iniyor mu? Tıkla
- Android **"Bilinmeyen kaynak"** izni kapanmış olabilir → tekrar ver
- En son çare: APK'yı bilgisayardan al, USB ile tablete kopyala, manuel kur

### POS güncellendi ama tabletler eski sürümde "uyumsuz" diyor

- Tabletlerin APK'sı çok eski → manuel güncellenmeli
- `/api/version` endpoint'ine bakıp `minApkVersion`'u öğren
- O sürümün APK'sını tablete elden kur

---

## 6. PIN / Giriş sorunları

### PIN unutuldu

**Yönetici PIN unutulduysa:**
- POS bilgisayarında: `data/settings.json` dosyasını editör ile aç
- `auth.yoneticiPin` alanını "9999" yap, kaydet
- POS yeniden başlat
- İlk girişte yeni PIN belirle

**Garson PIN unutulduysa:**
- Yönetici girişi yap, `/admin → Personel → Garson PIN` üzerinden değiştir

### "Yetersiz yetki" hatası

- Garson PIN ile yapılamaz işlem (örn: hesap kapatma → yönetici gerekli)
- Yönetici PIN ile gir

---

## 7. Acil İletişim

Çözemediğiniz sorunda:
1. `data/` klasörünün son saatlik yedeğini USB'ye al
2. Sorunun ekran görüntüsünü çek
3. Geliştiriciye gönder: telefon/WhatsApp/e-posta

**Sistemin tamamen donduğu durumda fallback:**
- Adisyonları kâğıda yaz
- Sistem geri geldiğinde elden gir (`/admin → Adisyon ekle`)
