const { app, BrowserWindow, Tray, Menu, nativeImage, dialog, shell } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

// Tek instance kontrolu
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

let mainWindow = null;
let tray = null;
let serverProcess = null;
let serverReady = false;

// Dev modda projenin kendi data/ klasorunu kullan
const isDev = !app.isPackaged;
const DATA_DIR = isDev
  ? path.join(__dirname, '..', 'data')
  : path.join(app.getPath('userData'), 'data');

// v1.8.0 marka degisikligi: eski %APPDATA%/SakuraPOS/data klasorunu
// %APPDATA%/AlkyonePOS/data'ya tek seferlik tasi. Yoksa eski musterilerin
// veri kaybi olur.
function migrateLegacyUserData() {
  if (isDev) return;
  try {
    const appData = app.getPath('appData');
    const legacyDir = path.join(appData, 'SakuraPOS', 'data');
    const newDir = DATA_DIR;
    if (fs.existsSync(legacyDir) && !fs.existsSync(path.join(newDir, 'settings.json'))) {
      fs.mkdirSync(path.dirname(newDir), { recursive: true });
      const copyRec = (src, dst) => {
        if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
        for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
          const s = path.join(src, entry.name);
          const d = path.join(dst, entry.name);
          if (entry.isDirectory()) copyRec(s, d);
          else fs.copyFileSync(s, d);
        }
      };
      copyRec(legacyDir, newDir);
      console.log('[Migration] Eski SakuraPOS verisi AlkyonePOS klasorune tasindi:', legacyDir, '->', newDir);
    }
  } catch (e) {
    console.warn('[Migration] Hata:', e.message);
  }
}
// Updates klasoru: production'da launcher .exe'nin yaninda (SakuraPOS/updates/),
// dev'de proje kokunde
const UPDATES_DIR = isDev
  ? path.join(__dirname, '..', 'updates')
  : path.join(path.dirname(app.getPath('exe')), 'updates');
const PORT = 3000;

// Data klasorunu hazirla
function ensureDataDir() {
  migrateLegacyUserData();
  const dirs = [DATA_DIR, path.join(DATA_DIR, 'reports'), path.join(DATA_DIR, 'backups')];
  for (const d of dirs) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }

  // Varsayilan dosyalar
  const defaults = {
    'menu.json': { version: 1, categories: [] },
    'tables.json': { version: 1, tables: [] },
    'orders.json': { orders: [] },
    'settings.json': {
      restaurant: { name: '', address: '', phone: '', logo: '' },
      network: { port: PORT, mdnsName: 'sakura', lastKnownIp: '' },
      auth: { garsonPin: '1234', yoneticiPin: '9999', jwtSecret: 'alkyone-' + Date.now(), pinChangedAt: null },
      setupCompleted: false,
      operations: { dayCloseHour: 4, vatRate: 10, currency: 'TL' },
      printer: { enabled: false, type: 'escpos', connection: 'usb', device: 'auto', paperWidth: 58, encoding: 'PC857' },
      startup: { autoStart: true, kioskMode: false, kioskUrl: '/pos' },
      printers: {
        receipt: {
          enabled: true,
          model: 'Sunlux RP8020',
          connection: 'usb',
          device: 'auto',
          paperWidth: 80,
          encoding: 'PC857'
        },
        kitchen: {
          enabled: true,
          connection: 'usb',
          device: 'auto',
          paperWidth: 58,
          encoding: 'PC857'
        }
      },
      appVersion: app.getVersion(),
      apkVersion: app.getVersion(),
      minApkVersion: '1.0.0'
    }
  };

  // userData'da dosya yoksa: ONCE paketteki extraResources'tan kopyala (gercek
  // menu, masalar, ayarlar dahil), yoksa bos default'a dus.
  // Production'da: process.resourcesPath/data/<file>
  // Dev'de: <repo>/data/<file>
  const bundledDir = isDev
    ? path.join(__dirname, '..', 'data')
    : path.join(process.resourcesPath, 'data');
  for (const [file, data] of Object.entries(defaults)) {
    const fp = path.join(DATA_DIR, file);
    if (fs.existsSync(fp)) continue;
    const bundled = path.join(bundledDir, file);
    if (fs.existsSync(bundled)) {
      try {
        fs.copyFileSync(bundled, fp);
        console.log(`[Veri] ${file} paketten kopyalandi`);
        continue;
      } catch (e) {
        console.warn(`[Veri] ${file} paketten kopyalanamadi: ${e.message}`);
      }
    }
    fs.writeFileSync(fp, JSON.stringify(data, null, 2));
    console.log(`[Veri] ${file} bos default ile olusturuldu`);
  }

  // OZEL DURUM: Kullanici eski bir surumden upgrade ediyorsa userData'da
  // BOS bir menu.json kalmis olabilir (paketleme bug'i, eski version vb.).
  // Boyle bir durumda paketteki dolu menuyu yedeklenip uzerine yaz.
  try {
    const menuFp = path.join(DATA_DIR, 'menu.json');
    if (fs.existsSync(menuFp)) {
      const cur = JSON.parse(fs.readFileSync(menuFp, 'utf8'));
      const isEmpty = !cur.categories || cur.categories.length === 0;
      if (isEmpty) {
        const bundledMenu = path.join(bundledDir, 'menu.json');
        if (fs.existsSync(bundledMenu)) {
          const bundled = JSON.parse(fs.readFileSync(bundledMenu, 'utf8'));
          if (bundled.categories && bundled.categories.length > 0) {
            // Eski (bos) menuyu yedekle
            const backupFp = path.join(DATA_DIR, `menu.empty-${Date.now()}.json`);
            fs.copyFileSync(menuFp, backupFp);
            fs.copyFileSync(bundledMenu, menuFp);
            console.log(`[Veri] Bos menu.json paketteki ${bundled.categories.length} kategorili menu ile degistirildi`);
          }
        }
      }
    }
  } catch (e) {
    console.warn('[Veri] menu.json bos kontrol hatasi:', e.message);
  }
}

// Ilk kurulum gerekiyor mu?
function isFirstRun() {
  const settingsPath = path.join(DATA_DIR, 'settings.json');
  if (!fs.existsSync(settingsPath)) return true;
  try {
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    return !s.restaurant?.name || s.setupCompleted === false;
  } catch { return true; }
}

// Port kullaniliyorsa once kapat
function killPort(port) {
  return new Promise((resolve) => {
    const net = require('net');
    const server = net.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        // Port kullaniliyor — process'i oldurmaya calis
        const { execSync } = require('child_process');
        try {
          if (process.platform === 'win32') {
            const output = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: 'utf8' });
            const lines = output.trim().split('\n');
            for (const line of lines) {
              const pid = line.trim().split(/\s+/).pop();
              if (pid && pid !== '0') {
                try { execSync(`taskkill /PID ${pid} /F`); } catch {}
              }
            }
          }
        } catch {}
        // Biraz bekle
        setTimeout(resolve, 500);
      } else {
        resolve();
      }
    });
    server.once('listening', () => {
      server.close();
      resolve();
    });
    server.listen(port);
  });
}

// Sunucu health check — gercekten HTTP yanit verene kadar bekle
function waitForServer(maxRetries = 20) {
  return new Promise((resolve) => {
    const http = require('http');
    let attempts = 0;
    function check() {
      attempts++;
      const req = http.get(`http://localhost:${PORT}/api/health`, (res) => {
        if (res.statusCode === 200) {
          console.log('[Server] Health check basarili, sayfa yuklenebilir');
          resolve(true);
        } else {
          retry();
        }
      });
      req.on('error', retry);
      req.setTimeout(1000, () => { req.destroy(); retry(); });
    }
    function retry() {
      if (attempts >= maxRetries) {
        console.log('[Server] Health check timeout, yine de devam ediliyor');
        resolve(false);
      } else {
        setTimeout(check, 500);
      }
    }
    check();
  });
}

// Sunucuyu baslat
function startServer() {
  return new Promise(async (resolve) => {
    // Once portu temizle
    await killPort(PORT);

    // Sunucu environment
    const env = {
      ...process.env,
      SAKURA_DATA_DIR: DATA_DIR,
      SAKURA_UPDATES_DIR: UPDATES_DIR,
      PORT: String(PORT)
    };
    const serverPath = path.join(__dirname, '..', 'src', 'server', 'index.js');

    serverProcess = fork(serverPath, [], { env, silent: true });

    serverProcess.stdout.on('data', (data) => {
      const msg = data.toString();
      console.log('[Server]', msg.trim());
      if (msg.includes('Sunucu calisiyor')) {
        serverReady = true;
      }
    });

    serverProcess.stderr.on('data', (data) => {
      console.error('[Server Error]', data.toString().trim());
    });

    serverProcess.on('exit', (code) => {
      console.log('[Server] Kapandi, kod:', code);
      serverReady = false;
    });

    // stdout mesajini bekle, sonra health check yap
    const checkReady = () => {
      if (serverReady) {
        waitForServer().then(() => resolve());
      } else {
        setTimeout(checkReady, 200);
      }
    };
    checkReady();

    // 15 saniye mutlak timeout
    setTimeout(() => resolve(), 15000);
  });
}

// Mevcut kiosk konfigürasyonunu settings.json'dan oku
function readKioskConfig() {
  try {
    const sp = path.join(DATA_DIR, 'settings.json');
    if (!fs.existsSync(sp)) return { kiosk: false, url: '/pos' };
    const s = JSON.parse(fs.readFileSync(sp, 'utf8'));
    return {
      kiosk: !!(s.startup && s.startup.kioskMode),
      url: (s.startup && s.startup.kioskUrl) || '/pos',
    };
  } catch (_) {
    return { kiosk: false, url: '/pos' };
  }
}

// Ana pencere
function createWindow() {
  const cfg = readKioskConfig();
  const winOpts = {
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    title: 'Alkyone POS',
    icon: getIconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  };
  if (cfg.kiosk) {
    // Kiosk modu: tam ekran, taskbar gizli, alt-tab dahil OS bypass denemeleri engellenir.
    // Cikis: Ctrl+Shift+Q (asagidaki accelerator).
    winOpts.kiosk = true;
    winOpts.fullscreen = true;
    winOpts.frame = false;
    winOpts.autoHideMenuBar = true;
    // Cikis kazara olmasin: minimize/maximize buton yok, manuel close engelli.
  }

  mainWindow = new BrowserWindow(winOpts);

  // Cache temizle (eski JS kalmasin)
  mainWindow.webContents.session.clearCache();
  try { mainWindow.webContents.session.clearStorageData({ storages: ['shadercache', 'cachestorage'] }); } catch (_) {}

  if (cfg.kiosk) {
    // Kiosk modunda dogrudan POS sayfasina git (launcher splash atla)
    mainWindow.loadURL(`http://localhost:${PORT}${cfg.url}`);
    // Kullanici yanlislikla F11/Esc ile cikmasin: kapat olaylarini bastir
    mainWindow.setMenuBarVisibility(false);
    mainWindow.setMenu(null);
  } else {
    // Normal mod: Launcher'i LOKAL dosya olarak ac (sunucu bagimsiz)
    const launcherPath = path.join(__dirname, 'launcher.html');
    mainWindow.loadFile(launcherPath);
  }

  // Kapatinca tray'e kucult (kiosk modunda da app.isQuitting set edilmeden cikilamaz)
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      if (!cfg.kiosk) mainWindow.hide();
      // Kiosk modunda hide sahibi de kacis yolu olur — pencereyi acik tut
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Kiosk modunda gizli cikis kombinasyonu: Ctrl+Shift+Q
  if (cfg.kiosk) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.control && input.shift && input.key.toLowerCase() === 'q') {
        app.isQuitting = true;
        app.quit();
      }
    });
  }
}

// Tray ikonu — kiosk modunda gosterilmez (kullanici yanlislikla cikmasin)
function createTray() {
  const cfg = readKioskConfig();
  if (cfg.kiosk) {
    // Kiosk modunda tray yok — kacis sadece Ctrl+Shift+Q ile
    return;
  }
  const icon = getTrayIcon();
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Alkyone POS', type: 'normal', enabled: false },
    { type: 'separator' },
    { label: 'POS Ekrani', click: () => showWindow(`http://localhost:${PORT}/pos`) },
    { label: 'Admin Panel', click: () => showWindow(`http://localhost:${PORT}/admin`) },
    { label: 'Raporlar', click: () => showWindow(`http://localhost:${PORT}/rapor`) },
    { type: 'separator' },
    { label: 'Tarayicida Ac', click: () => shell.openExternal(`http://localhost:${PORT}/pos`) },
    { type: 'separator' },
    { label: 'Kiosk Modu Ac', click: () => toggleKioskMode(true) },
    { type: 'separator' },
    { label: 'Cikis', click: () => { app.isQuitting = true; app.quit(); } }
  ]);

  tray.setToolTip('Alkyone POS');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => showWindow(`http://localhost:${PORT}/pos`));
}

// Kiosk modunu settings'e yaz ve uygulamayi yeniden baslat
function toggleKioskMode(enable) {
  try {
    const sp = path.join(DATA_DIR, 'settings.json');
    const s = JSON.parse(fs.readFileSync(sp, 'utf8'));
    s.startup = s.startup || {};
    s.startup.kioskMode = !!enable;
    fs.writeFileSync(sp, JSON.stringify(s, null, 2), 'utf8');
    // Yeniden baslatarak kiosk ayarini uygula
    dialog.showMessageBox({
      type: 'info',
      title: 'Kiosk Modu',
      message: enable
        ? 'Kiosk modu acildi. Uygulama yeniden baslatilacak. Cikis: Ctrl+Shift+Q'
        : 'Kiosk modu kapatildi. Uygulama yeniden baslatilacak.',
      buttons: ['Tamam']
    }).then(() => {
      app.relaunch();
      app.isQuitting = true;
      app.quit();
    });
  } catch (e) {
    dialog.showErrorBox('Hata', 'Kiosk modu degistirilemedi: ' + e.message);
  }
}

function showWindow(url) {
  if (!mainWindow) createWindow();
  if (url) mainWindow.loadURL(url);
  mainWindow.show();
  mainWindow.focus();
}

const ASSETS_DIR = path.join(__dirname, '..', 'assets');

function getIconPath() {
  // Oncelik: assets/icon.ico, fallback: electron/icon.ico
  const assetsIco = path.join(ASSETS_DIR, 'icon.ico');
  if (fs.existsSync(assetsIco)) return assetsIco;
  const localIco = path.join(__dirname, 'icon.ico');
  if (fs.existsSync(localIco)) return localIco;
  return undefined;
}

function getTrayIcon() {
  const assetsPng = path.join(ASSETS_DIR, 'icon.png');
  if (fs.existsSync(assetsPng)) {
    return nativeImage.createFromPath(assetsPng).resize({ width: 16, height: 16 });
  }
  const localPng = path.join(__dirname, 'icon.png');
  if (fs.existsSync(localPng)) {
    return nativeImage.createFromPath(localPng).resize({ width: 16, height: 16 });
  }
  // Fallback: 16x16 sakura rengi ikon
  const buf = nativeImage.createEmpty();
  return buf;
}

// ===== FIREWALL GUVENLIK AGI =====
// installer.nsh kurali Public agda uygulanmadigi (eski private,domain kapsami)
// veya POS installer disinda calistirildigi durumlar icin calisma aninda
// idempotent olarak profile=any kurali ekler. Marker dosyasi sayesinde UAC
// makine basina en fazla bir kez sorulur (basariyla eklenince bir daha denenmez).
function ensureFirewallRule() {
  if (process.platform !== 'win32') return;
  if (isDev) return; // gelistirme makinesinde UAC ile rahatsiz etme

  const marker = path.join(DATA_DIR, '.firewall-ensured-v2');
  try {
    if (fs.existsSync(marker)) return;
  } catch (_) {}

  // Tek satirlik, idempotent: once sil, sonra profile=any ekle (3 kural).
  const cmds = [
    'netsh advfirewall firewall delete rule name="Alkyone POS"',
    'netsh advfirewall firewall add rule name="Alkyone POS" dir=in action=allow protocol=TCP localport=3000 profile=any',
    'netsh advfirewall firewall add rule name="Alkyone POS" dir=out action=allow protocol=TCP localport=3000 profile=any',
    'netsh advfirewall firewall delete rule name="Alkyone POS mDNS"',
    'netsh advfirewall firewall add rule name="Alkyone POS mDNS" dir=in action=allow protocol=UDP localport=5353 profile=any',
    'netsh advfirewall firewall delete rule name="Alkyone POS Discovery"',
    'netsh advfirewall firewall add rule name="Alkyone POS Discovery" dir=out action=allow protocol=UDP remoteport=5354 profile=any',
    'netsh advfirewall firewall add rule name="Alkyone POS Discovery" dir=in action=allow protocol=UDP localport=5354 profile=any',
  ];

  const { exec } = require('child_process');
  const writeMarker = () => {
    try { fs.writeFileSync(marker, new Date().toISOString()); } catch (_) {}
  };

  // 1) Once dogrudan dene — uygulama zaten yetkili calisiyorsa (installer'dan
  //    hemen sonra, ya da elevated baslatildiysa) UAC'siz gecer.
  exec(cmds.join(' & '), { windowsHide: true }, (err, stdout) => {
    if (!err && /Ok\.|Tamam\./i.test(stdout || '')) {
      console.log('[Firewall] Kural profile=any olarak guncellendi (dogrudan)');
      writeMarker();
      return;
    }
    // 2) Yetki yok — tek seferlik elevated calistir (UAC bir kez sorulur).
    try {
      const bat = path.join(app.getPath('temp'), `sakura-fw-${Date.now()}.bat`);
      fs.writeFileSync(bat, '@echo off\r\n' + cmds.map(c => c + ' >nul 2>&1').join('\r\n') + '\r\n');
      const ps = `Start-Process -FilePath '${bat}' -Verb RunAs -WindowStyle Hidden -Wait`;
      exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${ps}"`,
        { windowsHide: true }, (e2) => {
          try { fs.unlinkSync(bat); } catch (_) {}
          if (e2) {
            console.warn('[Firewall] Elevated kural eklenemedi (UAC reddedildi olabilir):', e2.message);
          } else {
            console.log('[Firewall] Kural profile=any olarak guncellendi (elevated)');
            writeMarker();
          }
        });
    } catch (e3) {
      console.warn('[Firewall] Kural guncellenemedi:', e3.message);
    }
  });
}

// ===== OTOMATIK BASLATMA =====
// Windows'a giriste POS otomatik calissin (settings.startup.autoStart === true).
// Kullanici Admin Panel'den degistirebilir; bu fonksiyon settings degerini
// OS'taki login-item kaydiyla senkronize tutar.
function syncAutoStart() {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return;
  if (isDev) return; // Geliştirme modunda otomatik baslatma kayit etme
  try {
    const settingsPath = path.join(DATA_DIR, 'settings.json');
    if (!fs.existsSync(settingsPath)) return;
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const want = !!(s.startup && s.startup.autoStart);

    // Production'da launcher'i isaret et (varsa); yoksa SakuraPOS.exe
    const installDir = path.dirname(app.getPath('exe'));
    const launcherExe = path.join(installDir, 'AlkyonePOS-Launcher.exe');
    const targetExe = fs.existsSync(launcherExe)
      ? launcherExe
      : app.getPath('exe');

    app.setLoginItemSettings({
      openAtLogin: want,
      path: targetExe,
      args: ['--auto-start'],
    });
  } catch (e) {
    console.error('[AutoStart] Senkron hatasi:', e.message);
  }
}

// ===== OTOMATIK GUNCELLEME (electron-updater) =====
// Sunucu acilirken sessizce GitHub Releases'a bakar; yeni Setup.exe varsa
// arkaplanda indirir, 60 sn lutuf suresi sonra quit + install + restart yapar.
// Tum eventler data/logs/<son>.log icine gider, kullaniciya UI gosterilmez.
function initAutoUpdater() {
  if (isDev) {
    console.log('[Updater] Dev mod — devre disi');
    return;
  }
  try {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;

    // electron-log yerine kendi console wrap'imiz; src/utils/logger.js zaten
    // server tarafinda console'u logla yonlendiriyor. Burada main process
    // konsoluna yaziyoruz; production'da electron-builder log dosyasi
    // %APPDATA%/sakura-pos/logs/main.log altinda tutulur (electron-updater
    // varsayilan logger'i bu klasore yazar).
    autoUpdater.logger = {
      info:  (m) => console.log('[Updater]', m),
      warn:  (m) => console.warn('[Updater]', m),
      error: (m) => console.error('[Updater]', m),
      debug: () => {},
    };

    autoUpdater.on('checking-for-update', () => console.log('[Updater] Kontrol ediliyor...'));
    autoUpdater.on('update-available', (info) =>
      console.log('[Updater] Yeni surum mevcut:', info.version));
    autoUpdater.on('update-not-available', () =>
      console.log('[Updater] Guncel surum kullaniliyor'));
    autoUpdater.on('download-progress', (p) =>
      console.log(`[Updater] Indiriliyor: %${p.percent.toFixed(1)} (${(p.transferred / 1024 / 1024).toFixed(1)} / ${(p.total / 1024 / 1024).toFixed(1)} MB)`));
    autoUpdater.on('error', (err) =>
      console.warn('[Updater] Hata:', err && err.message ? err.message : err));

    autoUpdater.on('update-downloaded', (info) => {
      console.log('[Updater] Indirildi:', info.version, '— 60 sn sonra kurulup yeniden baslatilacak');
      // Lutuf suresi: aktif yazici isi/sipariş varsa biraz nefes alsin
      setTimeout(() => {
        console.log('[Updater] quitAndInstall (silent + restart)');
        try {
          // (silent=true, isForceRunAfter=true) — sessiz kur, sonra otomatik baslat
          autoUpdater.quitAndInstall(true, true);
        } catch (e) {
          console.error('[Updater] quitAndInstall hata:', e.message);
        }
      }, 60 * 1000);
    });

    // Acilista bir kez kontrol et — kullanici secimine gore "sadece acilista"
    autoUpdater.checkForUpdates().catch((e) =>
      console.warn('[Updater] checkForUpdates hata:', e && e.message ? e.message : e));
  } catch (e) {
    console.warn('[Updater] Baslatma hatasi:', e.message);
  }
}

// ===== APP LIFECYCLE =====
app.on('ready', async () => {
  ensureDataDir();

  // Once pencereyi ac (launcher lokal dosya, sunucu gerektirmez)
  createWindow();
  createTray();

  // Firewall kuralini garanti et (Public ag / eski installer durumu)
  ensureFirewallRule();

  // Sunucuyu arka planda baslat (launcher kendisi bekleyecek)
  startServer();

  // Otomatik baslatma ayarlarini OS ile senkronize et
  syncAutoStart();

  // Otomatik guncelleme: sunucu start ile paralel, sessiz, sadece acilista
  // (kullanicinin secimi: "Tamamen otomatik sessiz kur" + "Sadece acilista")
  initAutoUpdater();

  // settings.json degisirse autoStart + kioskMode ayarlarini yansit
  // (Admin Panel'den degisikligi yakala — kiosk on/off'da uygulamayi yeniden baslat)
  let lastKioskState = readKioskConfig().kiosk;
  try {
    const sp = path.join(DATA_DIR, 'settings.json');
    if (fs.existsSync(sp)) {
      let debounce = null;
      fs.watch(sp, () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          syncAutoStart();
          const cur = readKioskConfig().kiosk;
          if (cur !== lastKioskState) {
            lastKioskState = cur;
            // Kiosk ayari degisti — relaunch ki yeni mod uygulansin
            console.log('[Kiosk] Mode changed, relaunching');
            app.relaunch();
            app.isQuitting = true;
            app.quit();
          }
        }, 500);
      });
    }
  } catch (_) {}

  // --auto-start ile baslatildiysa pencereyi tray'e gizle (sessizce baslat)
  if (process.argv.includes('--auto-start') && mainWindow) {
    mainWindow.hide();
  }
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  // macOS'ta pencere kapaninca cikma
  if (process.platform !== 'darwin') {
    // Tray aktifken cikma
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (serverProcess) {
    serverProcess.kill();
  }
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
});
