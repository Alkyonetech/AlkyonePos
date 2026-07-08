const fs = require('fs');
const path = require('path');
const { getBrand } = require('../../brand');

// Veri dizini markadan gelir: Sakura -> data/, Alkyone -> data-alkyone/.
// (getBrand ayrica eski SAKURA_DATA_DIR / yeni POS_DATA_DIR override'larini isler.)
const DATA_DIR = getBrand().dataDirAbs;

/**
 * Atomic write: once .tmp dosyaya yaz, sonra rename
 */
function atomicWrite(filePath, data) {
  const tmpPath = filePath + '.tmp';
  const content = JSON.stringify(data, null, 2);
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

/**
 * JSON dosyasini guvenli oku
 */
function readJSON(fileName) {
  const filePath = path.join(DATA_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(content);
}

/**
 * JSON dosyasini atomic yaz
 */
function writeJSON(fileName, data) {
  const filePath = path.join(DATA_DIR, fileName);
  atomicWrite(filePath, data);
}

/**
 * Settings'i oku
 */
function loadSettings() {
  return readJSON('settings.json');
}

/**
 * Settings'i kaydet
 */
function saveSettings(data) {
  writeJSON('settings.json', data);
}

/**
 * Menu'yu oku
 */
function loadMenu() {
  return readJSON('menu.json');
}

/**
 * Menu'yu kaydet
 */
function saveMenu(data) {
  writeJSON('menu.json', data);
}

/**
 * Masalari oku
 */
function loadTables() {
  return readJSON('tables.json');
}

/**
 * Masalari kaydet
 */
function saveTables(data) {
  writeJSON('tables.json', data);
}

/**
 * Siparisleri oku
 */
function loadOrders() {
  return readJSON('orders.json');
}

/**
 * Siparisleri kaydet
 */
function saveOrders(data) {
  writeJSON('orders.json', data);
}

/**
 * Musteri/adres defterini oku (yoksa bos yapi)
 */
function loadCustomers() {
  return readJSON('customers.json') || { customers: [] };
}

/**
 * Musteri/adres defterini kaydet
 */
function saveCustomers(data) {
  writeJSON('customers.json', data);
}

/**
 * Bekleyen online (yazicidan yakalanan) siparisleri oku — yoksa bos yapi.
 * Bunlar HENUZ satisa/rapora islenmemis, onay bekleyen ham yakalamalardir.
 */
function loadIncoming() {
  return readJSON('incoming.json') || { pending: [] };
}

/**
 * Bekleyen online siparisleri kaydet
 */
function saveIncoming(data) {
  writeJSON('incoming.json', data);
}

/**
 * Telefonu normalize et — sadece rakamlar (lookup anahtari).
 * Bas '0' ve ulke kodu '90' onekleri sadelestirilir ki 0555.. == 90555.. == 555..
 */
function normPhone(s) {
  let d = String(s || '').replace(/\D/g, '');
  if (d.startsWith('90') && d.length > 10) d = d.slice(2);
  if (d.startsWith('0')) d = d.slice(1);
  return d;
}

/**
 * Rapor kaydet
 */
function saveReport(date, data) {
  const reportsDir = path.join(DATA_DIR, 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  const filePath = path.join(reportsDir, `${date}.json`);
  atomicWrite(filePath, data);
}

/**
 * Rapor oku
 */
function loadReport(date) {
  const filePath = path.join(DATA_DIR, 'reports', `${date}.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(content);
}

/**
 * Rapor listesini getir
 */
function listReports() {
  const reportsDir = path.join(DATA_DIR, 'reports');
  if (!fs.existsSync(reportsDir)) {
    return [];
  }
  return fs.readdirSync(reportsDir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''))
    .sort()
    .reverse();
}

/**
 * Veri butunluk kontrolu - bozuk dosyalari yedekten geri yukle.
 * Sunucu acilisinda cagrilmali.
 */
function checkDataIntegrity() {
  const files = ['menu.json', 'tables.json', 'orders.json', 'settings.json'];
  const results = [];
  for (const file of files) {
    const filePath = path.join(DATA_DIR, file);
    if (!fs.existsSync(filePath)) {
      results.push({ file, status: 'missing' });
      continue;
    }
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      JSON.parse(raw);
      results.push({ file, status: 'ok' });
    } catch (err) {
      console.warn(`[Veri] ${file} bozuk (${err.message}), yedekten geri yukleniyor...`);
      const restored = restoreFromBackup(file);
      results.push({ file, status: restored ? 'restored' : 'failed' });
      if (!restored) {
        console.error(`[Veri] ${file} geri yuklenemedi! Manuel mudahale gerekir.`);
      }
    }
  }
  return results;
}

/**
 * Son yedekten dosya geri yukle.
 * Yedek yapisi: backups/<timestamp>/<fileName>
 */
function restoreFromBackup(fileName) {
  const backupsDir = path.join(DATA_DIR, 'backups');
  if (!fs.existsSync(backupsDir)) return false;

  // Timestamp klasorlerini en yeniden eskiye sirala
  const candidates = fs.readdirSync(backupsDir)
    .filter(d => {
      const sub = path.join(backupsDir, d);
      return fs.statSync(sub).isDirectory() &&
        fs.existsSync(path.join(sub, fileName));
    })
    .sort()
    .reverse();

  if (candidates.length === 0) return false;

  const backupPath = path.join(backupsDir, candidates[0], fileName);

  // Yedegin de gecerli JSON oldugundan emin ol
  try {
    JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  } catch (e) {
    // Bu yedek de bozuk — bir oncekini dene
    if (candidates.length > 1) {
      for (const ts of candidates.slice(1)) {
        const p = path.join(backupsDir, ts, fileName);
        try {
          JSON.parse(fs.readFileSync(p, 'utf8'));
          fs.copyFileSync(p, path.join(DATA_DIR, fileName));
          console.log(`[Veri] ${fileName} eski yedekten geri yuklendi: ${ts}`);
          return true;
        } catch (_) { /* devam */ }
      }
    }
    return false;
  }

  fs.copyFileSync(backupPath, path.join(DATA_DIR, fileName));
  console.log(`[Veri] ${fileName} yedekten geri yuklendi: ${candidates[0]}`);
  return true;
}

module.exports = {
  DATA_DIR,
  atomicWrite,
  readJSON,
  writeJSON,
  loadSettings,
  saveSettings,
  loadMenu,
  saveMenu,
  loadTables,
  saveTables,
  loadOrders,
  saveOrders,
  loadCustomers,
  saveCustomers,
  loadIncoming,
  saveIncoming,
  normPhone,
  saveReport,
  loadReport,
  listReports,
  checkDataIntegrity,
  restoreFromBackup
};
