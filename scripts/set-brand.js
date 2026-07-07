#!/usr/bin/env node
/**
 * Aktif markayi sabitler: brand/.active dosyasina yazar. Build/electron oncesi
 * calisir; paketlenen uygulama bu dosyadan markasini okur.
 *   node scripts/set-brand.js alkyone
 *   node scripts/set-brand.js sakura
 */
const fs = require('fs');
const path = require('path');

const key = (process.argv[2] || '').toLowerCase().trim();
const brandDir = path.join(__dirname, '..', 'brand');
const valid = fs.readdirSync(brandDir).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''));

if (!valid.includes(key)) {
  console.error(`Gecersiz marka: '${key}'. Gecerli: ${valid.join(', ')}`);
  process.exit(1);
}
fs.writeFileSync(path.join(brandDir, '.active'), key + '\n', 'utf8');
console.log(`[set-brand] aktif marka -> ${key}`);
