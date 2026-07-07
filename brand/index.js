/**
 * Jenerik marka (brand) motoru — TEK URUN.
 *
 * Kod HICBIR yerde marka ismini sabitlemez. Varsayilan isim/logo/renk build'e
 * gomulu jenerik config'ten (brand/<key>.json) gelir; ancak URUNUN GORUNEN ADI
 * ILK KURULUMDA girilir ve calisma aninda ayarlardan (restaurant.name/logo)
 * markanin uzerine yazilir (bkz. src/server/app.js -> GET /api/brand).
 *
 * Aktif marka cozum sirasi:
 *   1) POS_BRAND ortam degiskeni
 *   2) brand/.active dosyasi (build sirasinda yazilir)
 *   3) 'alkyone' (tek varsayilan config)
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

  // Veri dizini: acik override > marka varsayilani.
  const explicit = process.env.POS_DATA_DIR;
  cfg.dataDirAbs = explicit ? path.resolve(explicit) : path.join(ROOT, cfg.dataDir);

  const explicitUpd = process.env.POS_UPDATES_DIR;
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
