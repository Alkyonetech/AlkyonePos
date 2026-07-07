/**
 * Bos bir marka veri dizinini varsayilan dosyalarla tohumlar.
 *
 * GUVENLIK: yalnizca EKSIK dosyalari yazar; var olan bir dosyaya ASLA dokunmaz.
 * Boylece Sakura'nin dolu data/ dizini hicbir kosulda degistirilmez — yeni bir
 * marka (or. Alkyone) ilk kez calistiginda data-alkyone/ tohumlanir.
 */
const fs = require('fs');
const path = require('path');
const { getBrand } = require('../../brand');

function defaultSettings(brand) {
  return {
    restaurant: { name: '', address: '', phone: '', logo: '' },
    network: { port: brand.defaultPort || 3000, mdnsName: brand.mdnsName || 'pos', lastKnownIp: '' },
    auth: { garsonPin: '1234', yoneticiPin: '9999', jwtSecret: `${brand.key}-pos-secret-change-me`, pinChangedAt: null },
    operations: { dayCloseHour: 4, vatRate: 10, currency: 'TL' },
    startup: { autoStart: true, kioskMode: false, kioskUrl: '/pos' },
    printer: { enabled: false, type: 'escpos', connection: 'usb', device: 'auto', paperWidth: 58, encoding: 'CP1254_32' },
    printers: {
      receipt: { enabled: true, model: 'POS-80C', connection: 'usb', device: 'auto', paperWidth: 80, encoding: 'CP1254_32' },
      kitchen: { enabled: true, connection: 'usb', device: 'auto', paperWidth: 58, encoding: 'CP1254_32' },
    },
    receiptTemplate: {
      headerLines: [], showRestaurantName: true, showAddress: true, showPhone: true,
      subHeaderText: '', showDateTime: true, showTableNo: true, showOrderId: true,
      showItemUnitPrice: true, showItemNotes: true, showSubtotal: true, showDiscount: true,
      showVat: false, showPaymentMethod: true, footerLines: ['Teşekkür ederiz!'], footerFeedLines: 3,
    },
    appVersion: '2.0.0', apkVersion: '2.0.0', minApkVersion: '1.0.0', setupCompleted: false,
  };
}

function ensureSeed() {
  const brand = getBrand();
  const dir = brand.dataDirAbs;
  fs.mkdirSync(dir, { recursive: true });

  const files = {
    'settings.json': () => defaultSettings(brand),
    'menu.json': () => ({ version: 1, categories: [] }),
    'tables.json': () => ({ version: 1, tables: [] }),
    'orders.json': () => ({ orders: [] }),
  };
  const created = [];
  for (const [name, factory] of Object.entries(files)) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) continue; // VAR OLAN dosyaya dokunma
    fs.writeFileSync(p, JSON.stringify(factory(), null, 2), 'utf8');
    created.push(name);
  }
  return created;
}

module.exports = { ensureSeed };
