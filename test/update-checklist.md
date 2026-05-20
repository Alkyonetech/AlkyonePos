# Sakura POS — Guncelleme & Kabul Test Rehberi

Bu doküman manuel testleri ve release öncesi kabul kontrollerini listeler.
Otomatik testler `npm test` (api-test) ve `node test/scenarios.js` ile çalıştırılır.

---

## A. Otomatik Test Komutları

```bash
# 1. API entegrasyon testi
npm test

# 2. Kabul senaryoları (10 senaryonun otomatize bölümü)
node test/scenarios.js

# 3. Performans testi (15 eşzamanlı istemci, varsayılan 15 sn)
node test/load-test.js
node test/load-test.js 60                                  # 1 dakika
SAKURA_BASE=http://192.168.1.10:3000 node test/load-test.js  # uzak sunucu
```

Her üç test de **çıkış kodu 0**'da geçmiş, **1+** kalmış sayılır — CI'da kullanılabilir.

---

## B. Manuel Kabul Kontrolleri

### Kontrol 1 — Senaryo 4: Elektrik kesintisi simülasyonu
- [ ] 5 masada açık adisyon oluştur (`scenarios.js` ile veya elle)
- [ ] Sunucuyu **Ctrl+C** ile sertçe durdur
- [ ] `npm start` ile yeniden başlat
- [ ] `data/orders.json` içeriği kayıp yok mu? Açık adisyonlar duruyor mu?
- [ ] **Beklenen:** atomic write sayesinde son işlem dahil tamamı diskte

### Kontrol 2 — Senaryo 5: WiFi kesintisi (tablet)
- [ ] Garson tableti `/garson` ekranında, açık adisyonlu
- [ ] Tablette WiFi kapatılır
- [ ] **Beklenen:** UI "Bağlantı yok" rozeti gösterir, butonlar disable
- [ ] WiFi açılır
- [ ] **Beklenen:** WebSocket reconnect (15 sn içinde), masa durumu yenilenir

### Kontrol 3 — Senaryo 6: Yazıcı çevrimdışı (donanım)
- [ ] Termal yazıcı USB'si takılı, hesap kapatma → fiş basılır
- [ ] USB çek, hesap kapat
- [ ] **Beklenen:** Adisyon kapanır, fiş kuyruğa alınır (`data/print-queue.json` veya benzeri)
- [ ] USB tak
- [ ] **Beklenen:** Kuyruktaki fişler otomatik basılır
- [ ] Yazıcı yoksa A4 fallback PDF üretiliyor mu?

### Kontrol 4 — Senaryo 8: sakura.local çalışmıyor (Android)
- [ ] APK'yı tablete kur
- [ ] **mDNS desteklemeyen** ağda APK aç
- [ ] **Beklenen:** 5 sn sonra "Sunucu adresi" diyaloğu, manuel IP
- [ ] IP gir → bağlanır, `/garson` veya `/pos` yüklenir
- [ ] APK yeniden açıldığında IP hatırlanır mı? (SharedPreferences)

### Kontrol 5 — Setup .exe (temiz Windows)
- [ ] Sanal makine veya temiz Windows: `dist/SakuraPOS Setup 1.0.0.exe` çalıştır
- [ ] **Beklenen:** NSIS sihirbazı, kurulum klasörü seçilebilir, Masaüstü kısayolu
- [ ] Kurulum sonrası ilk açılış:
  - [ ] mDNS çalışıyor (`sakura.local` ping)
  - [ ] Tarayıcıdan `http://localhost:3000` açılıyor
  - [ ] `data/` klasörü `%PROGRAMDATA%/SakuraPOS/data` veya kurulum altında
- [ ] Kaldır (uninstall): kullanıcı verisi silinmemeli (yalnızca uygulama silinir)

### Kontrol 6 — APK kurulum (3 farklı Android sürümü)
- [ ] Android 7 (API 24, minSdk) → APK kuruldu, çalıştı
- [ ] Android 10 (API 29) → çalıştı
- [ ] Android 13+ (API 33+) → çalıştı
- [ ] "Bilinmeyen kaynak" iznini ilk kurulumda isteyip sonrasında istemediğini doğrula
- [ ] Garson APK ve Yönetici APK aynı tablete birlikte kurulabiliyor mu? (farklı applicationId)

---

## C. Güncelleme (Update) Testleri

### Update 1 — Launcher: 1.0.0 → 1.1.0 başarılı geçiş
- [ ] Mevcut `SakuraPOS/SakuraPOS.exe` v1.0.0 çalışıyor
- [ ] `updates/latest.json` v1.1.0'a güncellendi
- [ ] `updates/pos/SakuraPOS-1.1.0.exe` mevcut
- [ ] POS kapatılır, `SakuraPOS-Launcher.exe` çalıştırılır
- [ ] **Beklenen:** Splash "Sürüm 1.1.0'a güncelleniyor..." (3 sn)
- [ ] `SakuraPOS.exe` yeni sürümle değişti mi?
- [ ] `SakuraPOS.exe.bak` (eski sürüm yedeği) oluştu mu?
- [ ] `settings.json.appVersion` → "1.1.0"
- [ ] Yeni POS açıldı, çalışıyor

### Update 2 — Launcher: bozuk .exe → otomatik rollback
- [ ] `updates/pos/SakuraPOS-1.2.0.exe` dosyasını **bilerek boz** (ilk 1KB sıfırla)
- [ ] `updates/latest.json` 1.2.0
- [ ] Launcher çalıştırılır
- [ ] **Beklenen:**
  - Checksum/imza eşleşmiyor → güncelleme iptal
  - `update-failed.log` oluşur
  - `SakuraPOS.exe.bak` → `SakuraPOS.exe` geri yüklenir
  - Eski sürüm açılır, kullanıcı bilgilendirilir

### Update 3 — Launcher: data/ klasörü dokunulmadı
- [ ] Güncelleme öncesi `data/orders.json` MD5 hash al
- [ ] Güncelleme yap
- [ ] Güncelleme sonrası aynı hash mı?
- [ ] `data/backups/`, `data/reports/`, `data/menu.json` aynen duruyor mu?
- [ ] Kapanmamış adisyonlar duruyor mu?

### Update 4 — APK: yeni sürüm bildirim + indirme + kurulum
- [ ] Sunucuda `settings.json.minApkVersion = "1.0.0"`, `apkVersion = "1.1.0"`
- [ ] Tablette mevcut APK 1.0.0
- [ ] APK aç → `checkVersion()` polled
- [ ] **Beklenen:** "Yeni Sürüm Var: 1.1.0" diyaloğu, "İndir & Kur" / "Sonra"
- [ ] "İndir & Kur" → DownloadManager bildirimi
- [ ] İndirme bitince Android installer açılır
- [ ] "Yükle" → kurulur, eski sürüm üzerine yazılır

### Update 5 — APK: zorunlu güncelleme akışı
- [ ] `settings.json.minApkVersion = "1.2.0"` (mevcut tabletten yeni)
- [ ] Tablette APK 1.0.0, aç
- [ ] **Beklenen:** "Güncelleme Zorunlu" diyaloğu, **sadece "İndir & Kur"** butonu
- [ ] Diyalog kapatılamaz (`setCancelable(false)`)
- [ ] Geri tuşu çalışmaz

### Update 6 — APK: indirme başarısızsa
- [ ] Sunucu kapalıyken "İndir & Kur"
- [ ] **Beklenen:** "İndirme başarısız" toast mesajı, eski sürüm çalışır

---

## D. Performans Kabul Kriterleri

`node test/load-test.js 60` çıkışında:
- [ ] 5xx hata oranı **< %1**
- [ ] p95 latency **< 500ms**
- [ ] p99 latency **< 1500ms**
- [ ] Throughput **> 10 req/s**
- [ ] Conflict (409) sayısı: > 0 olabilir, **bu beklenir** (version locking sağlıklı)

---

## E. Yazıcı Donanım Testi (gerçek ESC/POS termal)

- [ ] Yazıcı USB ile bağlı, `data/settings.json.printer.enabled = true`
- [ ] `POST /api/print/test` → test fişi basıldı mı?
- [ ] Adisyon kapatma → fiş otomatik basıyor
- [ ] 58mm format, restoran adı/adresi tepede, ürünler ortada, toplam altta
- [ ] Türkçe karakterler doğru (`encoding: PC857`)
- [ ] Kağıt kesme (cut) komutu çalışıyor
- [ ] Yazıcı kapalı → fallback PDF veya kuyruk

---

## F. Final Paket Kontrolü

Release paketinde (`release/SakuraPOS-1.x.0/`) bulunması gerekenler:
- [ ] `SakuraPOS-Launcher.exe`
- [ ] `SakuraPOS Setup 1.x.0.exe`
- [ ] `garson-1.x.0.apk`
- [ ] `yonetici-1.x.0.apk`
- [ ] `latest.json` (sürüm manifest)
- [ ] `docs/KURULUM.md`
- [ ] `docs/KULLANIM.md`
- [ ] `docs/SORUN-GIDERME.md`
- [ ] `docs/GUNCELLEME.md`
- [ ] `data/menu.json` örneği (boş restoran için başlangıç verisi)
- [ ] `data/settings.json` örneği

---

## G. Sürüm Yayınlama Sonrası

- [ ] Release paketi USB veya WeTransfer ile gönder
- [ ] Restoran sahibi: `updates/` klasörüne kopyala
- [ ] POS yeniden başlat → otomatik güncellenir
- [ ] Birkaç saat içinde tabletler bildirim alır
- [ ] Garson/yönetici "Güncelle" tıklar → 5-10 sn içinde tamam

---

**Tüm checklistler geçtiğinde sürüm yayına çıkmaya hazırdır.**
