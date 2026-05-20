/**
 * APK Auto-Updater — GitHub Releases'tan tablet APK'larini ve latest.json
 * manifestini surekli guncel tutar.
 *
 * Akis (sunucu acilirken bir kez calisir, sonra her 30 dakikada bir):
 *   1. GitHub API: GET /repos/<owner>/<repo>/releases/latest
 *   2. Asset listesinde garson-X.Y.Z.apk, yonetici-X.Y.Z.apk, latest.json bul
 *   3. UPDATES_DIR/apk/ altinda yoksa indir (atomik: .tmp + rename)
 *   4. latest.json'u UPDATES_DIR/latest.json'a yaz
 *
 * Tabletler /api/version uzerinden bu manifesti gorur ve mevcut akisi ile
 * /updates/apk/<file> uzerinden yeni APK'yi yerel ag uzerinden indirir
 * (tabletlerin internete erisimine ihtiyaci yoktur).
 *
 * Hata davranisi: sessiz log, mevcut dosyalar yerinde kalir.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const https = require('https');
const { URL } = require('url');

const DEFAULT_OWNER = 'Alkyonetech';
const DEFAULT_REPO = 'AlkyonePos';
const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 dakika
const USER_AGENT = 'sakura-pos-apk-updater';

let timer = null;

function logInfo(msg) { console.log(`[apk-updater] ${msg}`); }
function logWarn(msg) { console.warn(`[apk-updater] ${msg}`); }

/**
 * GitHub API'ye GET istegi at, JSON dondur.
 * Token verilirse Authorization header'i ekler (rate limit yumusatmak icin).
 */
function ghJson(url, token) {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent': USER_AGENT,
      'Accept': 'application/vnd.github+json',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    https.get(url, { headers, timeout: 15000 }, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        return ghJson(res.headers.location, token).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} ${url}`));
      }
      let buf = '';
      res.on('data', (c) => buf += c);
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); }
        catch (e) { reject(new Error('JSON parse: ' + e.message)); }
      });
    }).on('error', reject).on('timeout', function () {
      this.destroy(new Error('GitHub API timeout'));
    });
  });
}

/**
 * Bir asset URL'sini hedef dosyaya indir. Atomik: .tmp -> rename.
 * GitHub asset URL'leri 302 redirect ile S3'e gider.
 */
function downloadAsset(url, destPath, token) {
  return new Promise((resolve, reject) => {
    const tmp = destPath + '.tmp';
    const headers = {
      'User-Agent': USER_AGENT,
      'Accept': 'application/octet-stream',
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    function follow(u, redirectsLeft) {
      if (redirectsLeft < 0) return reject(new Error('Cok fazla redirect'));
      https.get(u, { headers, timeout: 60000 }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          res.resume();
          return follow(res.headers.location, redirectsLeft - 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} ${u}`));
        }
        const out = fs.createWriteStream(tmp);
        res.pipe(out);
        out.on('finish', () => {
          out.close((err) => {
            if (err) return reject(err);
            fs.rename(tmp, destPath, (err2) => {
              if (err2) return reject(err2);
              resolve();
            });
          });
        });
        out.on('error', (e) => {
          try { fs.unlinkSync(tmp); } catch (_) {}
          reject(e);
        });
      }).on('error', reject).on('timeout', function () {
        this.destroy(new Error('Asset download timeout'));
      });
    }

    follow(url, 5);
  });
}

/**
 * Tek bir cek dongusu — yeni release var mi, asset eksik mi, indir.
 */
async function checkOnce({ owner, repo, updatesDir, token }) {
  const apkDir = path.join(updatesDir, 'apk');
  await fsp.mkdir(apkDir, { recursive: true });

  let release;
  try {
    release = await ghJson(
      `https://api.github.com/repos/${owner}/${repo}/releases/latest`,
      token
    );
  } catch (e) {
    logWarn(`GitHub API erisilemedi: ${e.message}`);
    return { ok: false, reason: e.message };
  }

  if (!release || !Array.isArray(release.assets)) {
    return { ok: false, reason: 'release.assets yok' };
  }

  const tag = release.tag_name || '';
  const ver = tag.replace(/^v/, '');
  if (!ver) {
    return { ok: false, reason: 'tag_name yok' };
  }

  const want = {
    [`garson-${ver}.apk`]: path.join(apkDir, `garson-${ver}.apk`),
    [`yonetici-${ver}.apk`]: path.join(apkDir, `yonetici-${ver}.apk`),
    'latest.json': path.join(updatesDir, 'latest.json'),
  };

  const results = [];
  for (const asset of release.assets) {
    if (!(asset.name in want)) continue;
    const dest = want[asset.name];
    if (fs.existsSync(dest)) {
      const st = fs.statSync(dest);
      if (st.size === asset.size) {
        results.push({ name: asset.name, status: 'cached' });
        continue;
      }
    }
    try {
      await downloadAsset(asset.browser_download_url, dest, token);
      results.push({ name: asset.name, status: 'downloaded', size: asset.size });
      logInfo(`+ ${asset.name} (${(asset.size / 1024).toFixed(0)} KB)`);
    } catch (e) {
      results.push({ name: asset.name, status: 'error', error: e.message });
      logWarn(`! ${asset.name}: ${e.message}`);
    }
  }

  return { ok: true, version: ver, results };
}

/**
 * Periyodik kontrol baslat.
 *   opts.owner / opts.repo  -> GitHub repo (default Alkyonetech/AlkyonePos)
 *   opts.updatesDir         -> UPDATES_DIR yolu (mecburi)
 *   opts.token              -> GITHUB_TOKEN env (opsiyonel, rate limit icin)
 *   opts.intervalMs         -> default 30 dakika
 */
function startApkUpdater(opts = {}) {
  if (timer) return;
  const cfg = {
    owner: opts.owner || process.env.SAKURA_GH_OWNER || DEFAULT_OWNER,
    repo:  opts.repo  || process.env.SAKURA_GH_REPO  || DEFAULT_REPO,
    updatesDir: opts.updatesDir,
    token: opts.token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null,
    intervalMs: opts.intervalMs || CHECK_INTERVAL_MS,
  };
  if (!cfg.updatesDir) throw new Error('startApkUpdater: updatesDir gerekli');

  const tick = () => {
    checkOnce(cfg)
      .then((r) => {
        if (r.ok && r.results?.some(x => x.status === 'downloaded')) {
          logInfo(`Surum ${r.version} indirildi.`);
        }
      })
      .catch((e) => logWarn(`tick hata: ${e.message}`));
  };

  // Acilista 5 sn sonra (sunucu listen icin) + sonra periyodik
  setTimeout(tick, 5000);
  timer = setInterval(tick, cfg.intervalMs);
  logInfo(`Aktif. Kaynak: github.com/${cfg.owner}/${cfg.repo}, hedef: ${cfg.updatesDir}, periyot: ${(cfg.intervalMs / 60000).toFixed(0)} dk`);

  return { stop: stopApkUpdater };
}

function stopApkUpdater() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { startApkUpdater, stopApkUpdater, checkOnce };
