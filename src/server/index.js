const path = require('path');
const { install: installLogger } = require('../utils/logger');
installLogger();

const { getBrand } = require('../../brand');
const { ensureSeed } = require('../utils/seed');
const { createServer } = require('./app');
const { loadSettings, checkDataIntegrity } = require('../utils/data');
const { initMdns } = require('../services/mdns');
const { startDiscoveryBroadcaster } = require('../services/discovery-broadcaster');
const { initBackupScheduler } = require('../services/backup');

const BRAND = getBrand();
const TAG = `[${BRAND.name}]`;

async function main() {
  // Bos marka veri dizinini tohumla (var olan dosyalara dokunmaz — Sakura guvende)
  const seeded = ensureSeed();
  if (seeded.length > 0) {
    console.log(`${TAG} yeni veri dizini tohumlandi (${BRAND.dataDirAbs}): ${seeded.join(', ')}`);
  }

  // Acilista veri butunlugu — bozuk dosyalari yedekten geri yukle
  const integrity = checkDataIntegrity();
  const fixed = integrity.filter(r => r.status === 'restored');
  if (fixed.length > 0) {
    console.log(`${TAG} ${fixed.length} dosya yedekten geri yuklendi: ${fixed.map(f => f.file).join(', ')}`);
  }

  const settings = loadSettings();
  const port = (settings.network && settings.network.port) || BRAND.defaultPort || 3000;

  const { app, server, wss } = createServer();

  // Alkyone: acilista menu.json -> items senkronu (analitik icin urun eslemesi hazir)
  if (BRAND.features && BRAND.features.sqlite) {
    try {
      const n = require('../alkyone/writer').syncMenu();
      console.log(`${TAG} analitik: ${n} menu urunu items'a senkronlandi`);
    } catch (err) {
      console.warn(`${TAG} menu senkron hatasi:`, err.message);
    }
  }

  server.listen(port, '0.0.0.0', () => {
    console.log(`${TAG} Sunucu calisiyor: http://0.0.0.0:${port}`);
    console.log(`${TAG} Yerel erisim: http://localhost:${port}`);

    // mDNS yayini
    try {
      const mdnsName = (settings.network && settings.network.mdnsName) || BRAND.mdnsName;
      initMdns(mdnsName, port);
      console.log(`${TAG} mDNS: ${mdnsName}.local`);
    } catch (err) {
      console.warn(`${TAG} mDNS baslatma hatasi:`, err.message);
    }

    // UDP broadcast yayicisi (mDNS yedek/alternatif) — marka kimligiyle
    try {
      startDiscoveryBroadcaster(port, BRAND.productName, BRAND.discoveryApp);
    } catch (err) {
      console.warn(`${TAG} UDP broadcast baslatma hatasi:`, err.message);
    }

    // Otomatik yedek zamanlayici
    initBackupScheduler();
    console.log(`${TAG} Otomatik yedek zamanlayici aktif`);

    // Offline surum: tablet APK'lari yalnizca yerel agdan /updates/apk/ uzerinden
    // dagitilir; bu klasore dosyalar elle yerlestirilir.
  });
}

main().catch((err) => {
  console.error(`${TAG} Baslatma hatasi:`, err);
  process.exit(1);
});
