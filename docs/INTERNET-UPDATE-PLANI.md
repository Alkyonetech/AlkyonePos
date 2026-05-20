# Alkyone POS — İnternet Üzerinden Güncelleme Mimarisi

**Tarih:** 2026-05-20
**Repo:** [`Alkyonetech/AlkyonePos`](https://github.com/Alkyonetech/AlkyonePos) (public)
**Durum:** Tasarım onaylandı, implementasyon bekleniyor

---

## Karar Özeti

| Soru | Karar |
|---|---|
| Güncelleme dosyaları nerede? | **GitHub Releases (public repo)** |
| POS (Electron) güncelleme akışı | **Tamamen otomatik, sessiz kurulum** |
| APK güncellemesi nereden? | **Sunucu aracılığıyla** (POS internetten çeker, tabletlere yerel ağda dağıtır) |
| Güncelleme kontrol sıklığı | **Sadece açılışta** |

---

## Mimari

```
                  ┌─────────────────────────┐
                  │   GitHub Releases       │
                  │  Alkyonetech/AlkyonePos │
                  │                         │
                  │  • Setup.exe (POS)      │
                  │  • latest.yml           │
                  │  • garson-x.y.z.apk     │
                  │  • yonetici-x.y.z.apk   │
                  │  • latest.json          │
                  └────────────┬────────────┘
                               │ (internet)
                               ▼
         ┌─────────────────────────────────────────┐
         │  Restoran PC (Electron POS)             │
         │                                         │
         │  • electron-updater (Setup için)        │
         │  • src/services/apk-updater.js          │
         │    -> updates/apk/ ve updates/latest.json│
         └────────────┬────────────────────────────┘
                      │ (yerel ağ: 192.168.1.x)
                      ▼
         ┌─────────────────────────────────────────┐
         │  Tabletler (Poco) — Garson + Yönetici   │
         │                                         │
         │  /api/version  → güncellemeyi öğren     │
         │  /updates/apk/ → APK indir              │
         └─────────────────────────────────────────┘
```

---

## 1) POS Electron Tarafı — `electron-updater`

### Bağımlılık
```bash
npm i electron-updater
```

### `package.json` — `build` bloğuna
```json
"publish": [{
  "provider": "github",
  "owner": "Alkyonetech",
  "repo": "AlkyonePos"
}]
```

### `electron/main.js` — entegrasyon
- `app.whenReady()` sonrasında, sunucu listen olduktan sonra `autoUpdater.checkForUpdates()` çağır
- `autoUpdater.autoDownload = true`
- `autoUpdater.autoInstallOnAppQuit = true`
- `update-downloaded` event'inde `autoUpdater.quitAndInstall(true, true)` (sessiz + restart) — gece-açık makinada günün son sipariş'ten sonra restart
- Tüm event'ler `data/logs/server.log`'a düşsün, kullanıcıya UI gösterilmesin
- `isDev` modunda devre dışı

---

## 2) APK Relay — Yeni Servis

### `src/services/apk-updater.js`
- Sunucu açılışında GitHub Releases API'sini sorgular:
  ```
  GET https://api.github.com/repos/Alkyonetech/AlkyonePos/releases/latest
  ```
- Asset listesinden:
  - `garson-X.Y.Z.apk` ve `yonetici-X.Y.Z.apk` → `UPDATES_DIR/apk/`
  - `latest.json` → `UPDATES_DIR/latest.json`
- İndirme **atomik**: `<file>.tmp` olarak indir, başarılıysa `rename`
- Mevcut dosya varsa **versiyon kontrolü** ile atla
- Hata olursa sessiz log; eski APK'lar yerinde kalır

### Tablet tarafı — DEĞİŞMİYOR
- `/api/version` zaten `updates/latest.json`'u okuyor
- `/updates/apk/*` zaten static serving yapıyor
- APK'daki update flow (`MainActivity.checkVersion()`) zaten çalışıyor
- **Sıfır değişiklik**, sadece dosyalar artık internetten geliyor

---

## 3) Release Otomasyonu

### `scripts/build-release.js` — yeni `--publish` flag

`node scripts/build-release.js --publish` çalıştırıldığında:

1. **Electron build + GitHub publish**
   ```
   electron-builder --win --publish always
   ```
   - Setup.exe + `latest.yml` + `.blockmap` otomatik GitHub release'ine yüklenir
   - Tag formatı: `v<version>` (örn `v1.7.0`)

2. **APK + manifest upload**
   ```
   gh release upload v<version> \
     garson-X.Y.Z.apk \
     yonetici-X.Y.Z.apk \
     latest.json \
     --clobber
   ```

3. Release yoksa otomatik oluştur:
   ```
   gh release create v<version> --title "Alkyone POS X.Y.Z" --notes-file DEGISIKLIKLER.txt
   ```

`--publish` flag'i **yoksa** mevcut offline akış aynen çalışır (USB dağıtımı geri uyumlu).

---

## 4) İlk Kurulum (One-Time Setup)

### Geliştirici makinesinde

```bash
# 1) GitHub repo'ya bağla
git remote add origin https://github.com/Alkyonetech/AlkyonePos.git

# 2) gh CLI auth
gh auth login   # browser flow

# 3) electron-builder için GH_TOKEN
$env:GH_TOKEN = gh auth token   # PowerShell'de

# 4) İlk commit + push
git add .
git commit -m "Alkyone POS baseline v1.6.3"
git push -u origin master

# 5) İlk publish
node scripts/build-release.js --publish
```

### Restoran PC'sinde (son manuel adım)

- Mevcut `release/AlkyonePOS-1.6.3/pos/AlkyonePOS Setup 1.6.3.exe`'yi USB ile kur
- Bu, internet-update özelliği eklenmiş yeni Electron — bu noktadan sonra **manuel kurulum bitti**
- Sonraki sürümler otomatik

---

## 5) Saha Akışı (Sonradan)

1. Geliştirici yeni özellik ekler, `--publish` ile build alır
2. GitHub release oluşur (yeni Setup.exe + latest.yml + APK'lar + latest.json)
3. Restoran PC'si **gece açılışta** (veya manuel restart):
   - `electron-updater` `latest.yml`'a bakar → yeni Setup'ı arka planda indirir
   - Uygulama kapanırken sessizce kurulur, otomatik restart eder
4. Aynı açılışta `apk-updater` GitHub API'yi sorgular → yeni APK'ları indirir
5. Garson tabletleri açılır, `/api/version` ile yeni sürümü görür → `MainActivity.checkVersion()` update diyaloğu açar → `/updates/apk/garson-X.Y.Z.apk` indirir, kurar

**Toplam müdahale: 0.** USB taşıma yok.

---

## 6) Riskler ve Önlemler

| Risk | Önlem |
|---|---|
| Kaynak kodu public görünür | Org adı (`Alkyonetech`) profesyonel, kabul edildi. Hassas sırlar `data/settings.json`'da yerel kalır (commit edilmez, `.gitignore`) |
| Bozuk release sahaya gider | İlk `gh release create --draft` ile test, sonra `gh release edit --draft=false` ile promote |
| Restoran internetsiz | apk-updater sessizce hata yutar, eski APK'lar yerel cache'te kalır, sistem çalışmaya devam eder |
| GH_TOKEN sızıntısı | Sadece geliştirici makinesinde, repo'ya commit edilmez |
| İndirme bozulursa | `.tmp` + rename atomic; SHA256 doğrulaması GitHub'ın digest header'ı varsa kontrol |
| Eski APK ile yeni sunucu | `minApkVersion` zaten var — eski APK update diyaloğunu zorunlu gösterir |

---

## 7) Yapılacaklar Listesi (Implementasyon)

- [ ] `npm i electron-updater`
- [ ] `package.json` → `build.publish` config
- [ ] `electron/main.js` → autoUpdater entegrasyonu + log
- [ ] `src/services/apk-updater.js` → yeni dosya
- [ ] `src/server/index.js` → `startApkUpdater()` çağrısı
- [ ] `scripts/build-release.js` → `--publish` flag
- [ ] `.gitignore` doğrula (`data/`, `dist/`, `release/`, `node_modules/`, `*.tmp`)
- [ ] README'ye internet-update bölümü ekle
- [ ] İlk repo push + ilk publish testi

Tahmini süre: 1-2 saatlik kod, + ilk release test çevrimi.
