# Sakura POS Launcher

Master plan §12.4'teki tabanlı küçük bir Node uygulaması.
Kullanıcının çalıştırdığı **asıl uygulama** budur — POS exe'si bu launcher
tarafından yönetilir (yeni sürüm geldiyse güncellenir, sonra başlatılır).

## Çalıştırma (geliştirme)

```bash
cd launcher
node launcher.js
```

Beklenen davranış:
- `..\data\settings.json#appVersion` ile `..\updates\latest.json#pos.version` karşılaştırılır
- Yeni sürüm varsa `..\SakuraPOS.exe` yedeklenir, yeni `.exe` üstüne kopyalanır
- `..\SakuraPOS.exe` çalıştırılır ve launcher çıkar

## Derleme (Windows .exe)

`pkg` ile (ortak araç):

```bash
npm install -g pkg
cd launcher
npm run build
```

Çıktı: `..\dist\SakuraPOS-Launcher.exe` (~35 MB).

Daha küçük dosya istiyorsan `npm run build:compressed` (~12 MB).

> **Not:** `pkg` Windows'ta tek dosya bağımsız `.exe` üretir; node runtime gerektirmez.
> Restoran bilgisayarına Node.js kurmak zorunda kalmazsın.

## Klasör yapısı (release)

```
SakuraPOS/
├── SakuraPOS-Launcher.exe       ← bu derlenen .exe
├── SakuraPOS.exe                ← electron-builder çıktısı (asıl POS)
├── SakuraPOS.exe.bak            ← bir önceki sürüm (rollback için)
├── data/                        ← dokunulmaz, kullanıcı verileri
├── updates/
│   ├── latest.json
│   └── pos/SakuraPOS-1.x.x.exe
└── logs/
    ├── launcher.log
    └── update-failed.log
```

## Akış (özet)

1. `updates/latest.json` oku
2. Yeni sürüm > mevcut sürüm mü?
3. Evet → boyut kontrolü, hash, yedekle, kopyala, settings.json güncelle
4. POS'u başlat (`SakuraPOS.exe`)
5. POS 30 sn içinde crash ederse → otomatik rollback, eski sürümle yeniden başlat
6. Launcher çıkış

## Hata akışları

- **`latest.json` yok** → güncelleme yok, POS direkt başlatılır
- **Yeni `.exe` çok küçük** (< 1 MB) → bozuk varsayılır, atlanır
- **Kopyalama hatası** → rollback otomatik
- **POS erken crash** → rollback + eski sürümle yeniden deneme
- **`SakuraPOS.exe` yok ama `.bak` var** → `.bak` primary olarak kullanılır
- **Hem `.exe` hem `.bak` yok** → kurulum bozulmuş, hata logu, çıkış

## Loglar

- `logs/launcher.log` — her açılış, her güncelleme adımı
- `logs/update-failed.log` — sadece başarısız güncellemeler (geliştiriciye gönderilir)
