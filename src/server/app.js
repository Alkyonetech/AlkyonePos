const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { initWebSocket } = require('../ws/websocket');
const { loadSettings } = require('../utils/data');
const { getBrand, publicBrand } = require('../../brand');

const BRAND = getBrand();
const UPDATES_DIR = BRAND.updatesDirAbs;

function createServer() {
  const app = express();
  const server = http.createServer(app);

  // Middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: false }));

  // CORS - yerel ag icin
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  // Statik dosyalar — JS/CSS/HTML icin no-cache header'i ZORLA
  // (WebView ETag uzerinden eski surumu yapistirip JS hatasi almasini onler).
  // Express 5'te static.setHeaders bazen tetiklenmedigi icin kendi middleware'imizle
  // header'i ONCE set ediyoruz; sonra static donderiyor.
  const noCacheExt = new Set(['.js', '.css', '.html', '.json']);
  app.use((req, res, next) => {
    // path uzantisina bak — query string olabilir
    const cleanPath = req.path.split('?')[0];
    const ext = path.extname(cleanPath).toLowerCase();
    if (noCacheExt.has(ext) || cleanPath === '/' || /^\/(pos|garson|yonetici|admin|rapor)\/?$/.test(cleanPath)) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    next();
  });
  // Ilk kurulum gate — restaurant.name bos veya setupCompleted=false ise
  // tum sayfa istekleri /setup.html'e yonlendirilir. API ve assets serbest.
  app.use((req, res, next) => {
    const p = req.path;
    if (p.startsWith('/api/') || p.startsWith('/assets/') || p.startsWith('/updates/') ||
        p.startsWith('/brand/') ||
        p.startsWith('/css/') || p.startsWith('/js/') || p.startsWith('/img/') ||
        p === '/setup.html' || p === '/favicon.ico' || p.endsWith('.css') || p.endsWith('.js')) {
      return next();
    }
    try {
      const s = loadSettings();
      const needsSetup = !s.restaurant?.name || s.setupCompleted === false;
      if (needsSetup && p !== '/setup.html') {
        return res.redirect('/setup.html');
      }
    } catch (_) { /* settings okunamazsa gecmeye izin ver */ }
    next();
  });

  app.use(express.static(path.join(__dirname, '../../public'), {
    etag: false,
    lastModified: false,
    cacheControl: false,
  }));
  app.use('/assets', express.static(path.join(__dirname, '../../assets')));

  // APK guncelleme dagitimi: tabletler GET /updates/apk/<role>-<ver>.apk
  // Klasor yoksa otomatik olustur — restoran sahibi APK'lari buraya birakir
  try { fs.mkdirSync(path.join(UPDATES_DIR, 'apk'), { recursive: true }); } catch (_) {}
  app.use('/updates/apk', express.static(path.join(UPDATES_DIR, 'apk'), {
    fallthrough: false,
    setHeaders: (res) => {
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Cache-Control', 'no-cache');
    },
  }));

  // Marka (brand) — UI isim/logo/renk/ozellikleri buradan cekilir, hicbir sey
  // sabit degil. Tek build; marka ismi ILK KURULUMDA girilir ve sonraki her
  // acilista ayarlardan (restaurant.name/logo) okunarak markanin uzerine
  // yazilir. Boylece EXE/APK icindeki jenerik varsayilan, kurulan restoranin
  // adiyla "brand update" olarak baslar.
  app.get('/api/brand', (req, res) => {
    const b = publicBrand();
    try {
      const s = loadSettings();
      const rname = (s.restaurant?.name || '').trim();
      if (rname) {
        b.name = rname;
        b.shortName = rname;
      }
      if (s.restaurant?.logo) b.logoUrl = s.restaurant.logo; // data URL veya yol
    } catch (_) { /* ayarlar okunamazsa jenerik marka doner */ }
    res.json(b);
  });
  app.get('/brand/logo.svg', (req, res) => {
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(BRAND.logoFileAbs);
  });

  // API Routes
  app.use('/api/auth', require('../routes/auth'));
  app.use('/api/menu', require('../routes/menu'));
  app.use('/api/tables', require('../routes/tables'));
  app.use('/api/orders', require('../routes/orders'));
  app.use('/api/reports', require('../routes/reports'));
  app.use('/api/settings', require('../routes/settings'));
  app.use('/api/print', require('../routes/print'));
  // Alkyone 2.0 analitik + manuel giris — yalnizca ozellik acik markada.
  if (BRAND.features && BRAND.features.analytics) {
    app.use('/api/alkyone', require('../routes/alkyone'));
  }
  app.use('/api', require('../routes/system'));

  // Sayfa route'lari (HTML — no-cache)
  function sendNoCacheHtml(res, file) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, '../../public/' + file));
  }
  app.get('/pos',      (req, res) => sendNoCacheHtml(res, 'pos.html'));
  app.get('/garson',   (req, res) => sendNoCacheHtml(res, 'garson.html'));
  app.get('/yonetici', (req, res) => sendNoCacheHtml(res, 'yonetici.html'));
  app.get('/admin',    (req, res) => sendNoCacheHtml(res, 'admin.html'));
  app.get('/rapor',    (req, res) => sendNoCacheHtml(res, 'rapor.html'));

  // Alkyone 2.0 sayfalari (analitik pano + maliyet + atik) — yalnizca acik markada
  if (BRAND.features && BRAND.features.analytics) {
    app.get('/analitik', (req, res) => sendNoCacheHtml(res, 'alkyone/dashboard.html'));
    app.get('/maliyet',  (req, res) => sendNoCacheHtml(res, 'alkyone/cost.html'));
    app.get('/fire',     (req, res) => sendNoCacheHtml(res, 'alkyone/waste.html'));
  }

  // 404 - Express 5 wildcard syntax
  app.all('/api/{*splat}', (req, res) => {
    res.status(404).json({ error: 'Endpoint bulunamadi' });
  });

  // SPA fallback
  app.get('{*splat}', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/index.html'));
  });

  // Hata yakalama
  app.use((err, req, res, next) => {
    console.error('[Hata]', err.message);
    res.status(err.status || 500).json({
      error: err.message || 'Sunucu hatasi'
    });
  });

  // WebSocket
  const wss = initWebSocket(server);

  return { app, server, wss };
}

module.exports = { createServer };
