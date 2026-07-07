/**
 * Jenerik marka (brand) motoru.
 *
 * Tek kod tabani, N adet beyaz-etiket urun. Kod HICBIR yerde marka ismini
 * sabitlemez; isim / logo / renk / appId / veri-dizini hepsi aktif marka
 * config'inden (brand/<key>.json) turer. Yeni marka eklemek = yeni bir
 * brand/<key>.json + brand/assets/<key>/logo.svg birakmak. Sifir kod degisikligi.
 *
 * Aktif marka cozum sirasi:
 *   1) POS_BRAND ortam degiskeni  (build script'leri bunu set eder)
 *   2) brand/.active dosyasi       (build sirasinda yazilan sabit marka)
 *   3) 'alkyone'                   (varsayilan / amiral marka)
 *
 * Sakura (mevcut canli musteri) ayri bir marka instance'idir; verisi data/
 * dizininde ve dokunulmaz.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEFAULT_BRAND = 'alkyone';

function availableBrands() {
  return fs.readdirSync(__dirname)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, ''));
}

function resolveBrandKey() {
  const brands = availableBrands();
  const pick = (k) => k && brands.includes(k) ? k : null;

  // 1) Ortam degiskeni
  let key = pick((process.env.POS_BRAND || '').toLowerCase().trim());

  // 2) Build sirasinda yazilan .active dosyasi
  if (!key) {
    try {
      const active = fs.readFileSync(path.join(__dirname, '.active'), 'utf8').trim().toLowerCase();
      key = pick(active);
    } catch (_) { /* yok */ }
  }

  // 3) Varsayilan
  if (!key) {
    if (process.env.POS_BRAND) {
      console.warn(`[Brand] Bilinmeyen POS_BRAND='${process.env.POS_BRAND}', '${DEFAULT_BRAND}' varsayiliyor.`);
    }
    key = DEFAULT_BRAND;
  }
  return key;
}

let cached = null;

function getBrand() {
  if (cached) return cached;
  const key = resolveBrandKey();
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, `${key}.json`), 'utf8'));

  // Veri dizini: acik override > marka varsayilani. Sakura icin eski
  // SAKURA_DATA_DIR degiskeni de desteklenir (mevcut kurulumlar bozulmasin).
  const explicit = process.env.POS_DATA_DIR
    || (key === 'sakura' ? process.env.SAKURA_DATA_DIR : null);
  cfg.dataDirAbs = explicit ? path.resolve(explicit) : path.join(ROOT, cfg.dataDir);

  const explicitUpd = process.env.POS_UPDATES_DIR
    || (key === 'sakura' ? process.env.SAKURA_UPDATES_DIR : null);
  cfg.updatesDirAbs = explicitUpd ? path.resolve(explicitUpd) : path.join(ROOT, cfg.updatesDir);

  cfg.sqliteFileAbs = path.join(cfg.dataDirAbs, 'analytics.db');
  cfg.logoFileAbs = path.join(__dirname, 'assets', key, cfg.logo || 'logo.svg');

  cached = cfg;
  return cfg;
}

/** Istemciye/UI'a guvenle gonderilebilecek alanlar (sirlar haric). */
function publicBrand() {
  const b = getBrand();
  return {
    key: b.key,
    name: b.name,
    shortName: b.shortName,
    tagline: b.tagline,
    colors: b.colors,
    features: b.features,
    logoUrl: '/brand/logo.svg',
  };
}

module.exports = { getBrand, publicBrand, resolveBrandKey, availableBrands };
