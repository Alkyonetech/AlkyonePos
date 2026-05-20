# İlk Kurulum — İnternet Üzerinden Güncelleme

Bu rehber `INTERNET-UPDATE-PLANI.md`'nin uygulama adımlarıdır. Tek seferlik kurulumdur; bittiğinde `node scripts/build-release.js --publish` ile her yeni sürüm sahaya otomatik gider.

## Önkoşullar (geliştirici makinesi)

- `git` — kuruldu
- `gh` — GitHub CLI ([cli.github.com](https://cli.github.com)). Yoksa:
  ```powershell
  winget install --id GitHub.cli
  ```
- Node.js + npm — kuruldu

## 1) GitHub Repo'yu Hazırla

Web'den `Alkyonetech/AlkyonePos` repo'sunu **public** olarak aç (henüz açmadıysan). Açıklama: "Alkyone POS — restoran yönetim sistemi". `.gitignore`, README, license **eklemeden** boş bırak (yerel zaten var).

## 2) Yerel Repo'yu Bağla ve Push Et

```powershell
cd C:\Users\yilma\Desktop\sakura

# git init zaten yapılmış; remote ekle
git remote add origin https://github.com/Alkyonetech/AlkyonePos.git

# gh ile login (browser flow)
gh auth login

# Token'i electron-builder için ortam değişkenine al
$env:GH_TOKEN = gh auth token

# İlk commit + push
git add .
git commit -m "Alkyone POS baseline v1.6.4 — internet update mimarisi"
git branch -M main
git push -u origin main
```

> **Not:** `data/orders.json`, `data/.firewall-ensured*`, `updates/` `.gitignore`'da; canlı restoran verisi commit edilmez.

## 3) İlk Publish (v1.6.4 GitHub Release)

```powershell
# Yine aynı session'da GH_TOKEN set olsun (yeni terminal açtıysan tekrar set et)
$env:GH_TOKEN = gh auth token

# Tam yayın — Setup.exe + latest.yml + APK + latest.json + fix-firewall.bat
node scripts/build-release.js --publish
```

Bittiğinde GitHub'da `v1.6.4` release görünür. Asset listesi:
- `AlkyonePOS Setup 1.6.4.exe`
- `latest.yml` (electron-updater bunu okur)
- `garson-1.6.4.apk`, `yonetici-1.6.4.apk`
- `latest.json`
- `fix-firewall.bat`

## 4) Restoran PC'sine Son Manuel Kurulum

USB ile `release/AlkyonePOS-1.6.4/pos/AlkyonePOS Setup 1.6.4.exe`'yi taşı, kur. Bu Setup, internet-update yeteneğine sahip ilk sürüm — bu noktadan sonra **manuel kurulum yok**.

Açılınca log'a `[Updater] Guncel surum kullaniliyor` veya `[Updater] Yeni surum mevcut...` mesajları düşer (`%APPDATA%\sakura-pos\logs\main.log`).

## 5) Sonraki Sürümler

```powershell
# Versiyonu bump et
# - package.json
# - android/app/build.gradle (versionCode + versionName)
# - data/settings.json (appVersion + apkVersion)

# Sonra:
$env:GH_TOKEN = gh auth token
node scripts/build-release.js --publish
```

Restoran PC'si bir sonraki açılışta:
- `electron-updater` `latest.yml`'i okur → yeni Setup'ı indirir → 60 sn sonra kurar + restart
- `apk-updater` 5 sn sonra GitHub API'yi sorgular → yeni APK ve `latest.json`'u `updates/`'a indirir
- Tabletler 30 dk içinde (veya bir sonraki sorgu turunda) `/api/version` üzerinden yeni sürümü görür → kullanıcıya update diyaloğu

## Akış Şeması

```
geliştirici PC               GitHub Releases            Restoran PC          Tabletler
─────────────                ────────────────           ────────────         ─────────
build --publish ──────────▶ v1.6.5 yayınlanır
                                  │
                              (electron-updater)
                                  │
                                  ▼
                            POS açılır ────────────▶ Setup indir ──▶ kur ──▶ restart
                                  │
                              (apk-updater 30 dk)
                                  │
                                  ▼
                            APK + latest.json ──────────────────────────▶ Tablet
                                                                        açılır
                                                                          │
                                                                     /api/version
                                                                          │
                                                                        APK güncelle
```

## Sorun Giderme

| Belirti | Neden | Çözüm |
|---|---|---|
| `electron-builder ... GH_TOKEN missing` | Token set edilmedi | `$env:GH_TOKEN = gh auth token` |
| `gh release upload ... not found` | Tag yok / release oluşmadı | electron-builder log'una bak; tag `v<version>` mı |
| Restoran PC güncellemiyor | İnternet yok ya da logs'a hata düşer | `%APPDATA%\sakura-pos\logs\main.log` kontrol |
| Tabletler eski sürümü gösteriyor | apk-updater henüz tetiklenmedi | 30 dk bekle veya POS'u yeniden başlat |
| Yanlış bir sürüm publish edildi | Release'i geri al | `gh release delete vX.Y.Z --yes` + yeni patch sürüm publish |

## Güvenlik Notları

- Repo **public** — kaynak kod görünür. Hassas veri (`data/orders.json`, restoran info) `.gitignore`'da
- `android/keystore.properties` ve `.jks` **asla** commit edilmez — kaybolursa gelecek APK'lar uninstall+install ister
- `GH_TOKEN` sadece geliştirici makinesinde, commit'lenmez
- Setup.exe zaten signtool ile imzalı; electron-updater imzayı doğrular
