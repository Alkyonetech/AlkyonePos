#!/usr/bin/env node
/**
 * Sakura Sushi Fulya — Erkayasoft QR menü API'sinden POS menü içe aktarıcı.
 *
 * Çalıştırma:
 *   node scripts/import-menu-from-erkayasoft.js
 *
 * Yaptığı:
 *   1. https://erkayasoft.com/qrmenu/sakura/api/categories.php?status=active
 *   2. Her kategori için: products.php?category_id=...&status=active
 *   3. data/menu.json dosyasını üretir (POS şemasına uygun)
 *
 * Notlar:
 *   - price_kurus kuruş cinsinden (36000 = 360 TL) — 100'e bölüp tam TL alıyoruz
 *   - Kategori adı "Çorbalar / Soups" formatında — slash'ten önce TR, sonra EN
 *   - Ürün adı "1    Wonton Çorbası / Wonton Soup" formatında — baştaki sıra
 *     numarası ve slash ayırıcısı temizlenir
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const API_BASE = 'https://erkayasoft.com/qrmenu/sakura/api';

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} ${url}`));
      }
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => buf += c);
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); }
        catch (e) { reject(new Error('JSON parse: ' + e.message)); }
      });
    }).on('error', reject);
  });
}

function splitName(name) {
  // "Çorbalar / Soups" → { tr: "Çorbalar", en: "Soups" }
  // "Wonton Çorbası / Wonton Soup" → { tr: "Wonton Çorbası", en: "Wonton Soup" }
  if (!name) return { tr: '', en: '' };
  const idx = name.indexOf('/');
  if (idx < 0) return { tr: name.trim(), en: name.trim() };
  return {
    tr: name.slice(0, idx).trim(),
    en: name.slice(idx + 1).trim(),
  };
}

function cleanItemName(raw) {
  // "1    Wonton Çorbası / Wonton Soup" → "Wonton Çorbası", "Wonton Soup"
  // Baştaki numara + boşluklar kaldırılır
  if (!raw) return { tr: '', en: '' };
  const stripped = raw.replace(/^\s*\d+\s*[\.\-)]?\s*/, '').trim();
  return splitName(stripped);
}

function slugCategory(tr) {
  // Türkçe karakterleri ASCII'leştir, kategori id için
  return tr
    .toLowerCase()
    .replace(/ç/g, 'c').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ı/g, 'i')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function main() {
  console.log('[import] Kategoriler aliniyor...');
  const cats = await fetchJson(API_BASE + '/categories.php?status=active');
  cats.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  console.log(`[import] ${cats.length} kategori bulundu`);

  const outCategories = [];
  let nextItemId = 1;

  for (const cat of cats) {
    const names = splitName(cat.name_tr);
    const slug = slugCategory(names.tr) || `cat-${cat.id}`;
    console.log(`[import] [${cat.id}] ${names.tr} / ${names.en}`);

    const products = await fetchJson(
      API_BASE + `/products.php?category_id=${cat.id}&status=active`
    );

    const items = products.map((p) => {
      const itemNames = cleanItemName(p.name_tr);
      const desc = p.description_tr ? splitName(p.description_tr).tr : '';
      const priceTL = Math.round((p.price_kurus || 0) / 100);
      return {
        id: nextItemId++,
        name: itemNames.tr,
        nameEn: itemNames.en || itemNames.tr,
        price: priceTL,
        desc: desc,
        visible: true,
      };
    });

    outCategories.push({
      id: slug,
      name: names.tr,
      nameEn: names.en || names.tr,
      items,
    });
    console.log(`           → ${items.length} urun`);
  }

  const out = {
    version: 1,
    categories: outCategories,
  };

  const dataDir = path.resolve(__dirname, '..', 'data');
  const menuPath = path.join(dataDir, 'menu.json');

  // Mevcut menu.json'u yedekle
  if (fs.existsSync(menuPath)) {
    const backupPath = path.join(dataDir, `menu.backup-${Date.now()}.json`);
    fs.copyFileSync(menuPath, backupPath);
    console.log(`[import] Eski menu yedeklendi: ${path.basename(backupPath)}`);
  }

  fs.writeFileSync(menuPath, JSON.stringify(out, null, 2), 'utf8');

  const totalItems = outCategories.reduce((s, c) => s + c.items.length, 0);
  console.log('='.repeat(50));
  console.log(`[import] HAZIR: ${outCategories.length} kategori, ${totalItems} urun`);
  console.log(`[import] Yazildi: ${menuPath}`);
  console.log('='.repeat(50));
}

main().catch((e) => {
  console.error('[import] HATA:', e.message);
  process.exit(1);
});
