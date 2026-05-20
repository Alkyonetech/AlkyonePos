const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { initWebSocket } = require('../ws/websocket');

const UPDATES_DIR = process.env.SAKURA_UPDATES_DIR
  || path.join(__dirname, '../../updates');

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

  // API Routes
  app.use('/api/auth', require('../routes/auth'));
  app.use('/api/menu', require('../routes/menu'));
  app.use('/api/tables', require('../routes/tables'));
  app.use('/api/orders', require('../routes/orders'));
  app.use('/api/reports', require('../routes/reports'));
  app.use('/api/settings', require('../routes/settings'));
  app.use('/api/print', require('../routes/print'));
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
