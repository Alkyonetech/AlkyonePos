const path = require('path');
const { install: installLogger } = require('../utils/logger');
installLogger();

const { createServer } = require('./app');
const { loadSettings, checkDataIntegrity } = require('../utils/data');
const { initMdns } = require('../services/mdns');
const { startDiscoveryBroadcaster } = require('../services/discovery-broadcaster');
const { initBackupScheduler } = require('../services/backup');

async function main() {
  // Acilista veri butunlugu — bozuk dosyalari yedekten geri yukle
  const integrity = checkDataIntegrity();
  const fixed = integrity.filter(r => r.status === 'restored');
  if (fixed.length > 0) {
    console.log(`[Sakura POS] ${fixed.length} dosya yedekten geri yuklendi: ${fixed.map(f => f.file).join(', ')}`);
  }

  const settings = loadSettings();
  const port = settings.network.port || 3000;

  const { app, server, wss } = createServer();

  server.listen(port, '0.0.0.0', () => {
    console.log(`[Sakura POS] Sunucu calisiyor: http://0.0.0.0:${port}`);
    console.log(`[Sakura POS] Yerel erisim: http://localhost:${port}`);

    // mDNS yayini
    try {
      initMdns(settings.network.mdnsName, port);
      console.log(`[Sakura POS] mDNS: ${settings.network.mdnsName}.local`);
    } catch (err) {
      console.warn('[Sakura POS] mDNS baslatma hatasi:', err.message);
    }

    // UDP broadcast yayicisi (mDNS yedek/alternatif)
    try {
      startDiscoveryBroadcaster(port, '1.0.0');
    } catch (err) {
      console.warn('[Sakura POS] UDP broadcast baslatma hatasi:', err.message);
    }

    // Otomatik yedek zamanlayici
    initBackupScheduler();
    console.log('[Sakura POS] Otomatik yedek zamanlayici aktif');

    // Offline surum: GitHub uzerinden APK auto-updater KAPALIDIR. Tablet
    // APK'lari yalnizca yerel agdan /updates/apk/ uzerinden dagitilir; bu
    // klasore dosyalar elle yerlestirilir.
  });
}

main().catch((err) => {
  console.error('[Sakura POS] Baslatma hatasi:', err);
  process.exit(1);
});
