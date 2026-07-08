#!/usr/bin/env node
/**
 * Sakura POS — Final Release Paketleyici
 *
 * Calistirma:
 *   node scripts/build-release.js
 *   node scripts/build-release.js --skip-electron     (sadece APK + docs)
 *   node scripts/build-release.js --skip-android      (sadece exe + docs)
 *
 * Yaptigi:
 *   1. package.json ve android/app/build.gradle versiyonlarini okur
 *   2. Electron build (electron-builder)
 *   3. Android build (gradle assembleRelease, iki flavor)
 *   4. release/SakuraPOS-x.y.z/ altinda toplar:
 *        - SakuraPOS Setup x.y.z.exe
 *        - garson-x.y.z.apk, yonetici-x.y.z.apk
 *        - latest.json (manifest)
 *        - docs/ (kullanim klavuzlari)
 *        - DEGISIKLIKLER.txt (kullanicidan beklenir)
 *   5. ZIP'lemez — kullanici USB'ye kendi koyar (master plan §12.1)
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RELEASE_DIR = path.join(ROOT, 'release');

// Marka bilgisi electron-builder config'inden (productName + cikti dizini) —
// boylece isimlendirme sabit "SakuraPOS" degil, aktif markadan turer.
const EB_CONFIG = path.join(ROOT, 'build/electron-builder.json');
const EB = (() => {
  try { return JSON.parse(fs.readFileSync(EB_CONFIG, 'utf8')); } catch (_) { return {}; }
})();
const PRODUCT = EB.productName || 'AlkyonePOS';
const DIST_DIR = path.join(ROOT, (EB.directories && EB.directories.output) || 'dist');

const args = new Set(process.argv.slice(2));
const SKIP_ELECTRON = args.has('--skip-electron');
const SKIP_ANDROID = args.has('--skip-android');
// --publish: electron-builder Setup.exe'yi + latest.yml + blockmap'i GitHub
// Releases'a yukler; APK + latest.json da gh CLI ile ayni release'e iliştirilir.
// Token: GH_TOKEN env var veya gh auth token. Repo: package.json build.publish.
const PUBLISH = args.has('--publish');

// ===== UTIL =====

function log(msg) { console.log(`[release] ${msg}`); }
function err(msg) { console.error(`[release] HATA: ${msg}`); }

function readPkgVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  return pkg.version;
}

function readAndroidVersion() {
  const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle'), 'utf8');
  const m = gradle.match(/versionName\s+"([^"]+)"/);
  return m ? m[1] : null;
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function findFile(dir, predicate) {
  if (!fs.existsSync(dir)) return null;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const p = path.join(cur, entry.name);
      if (entry.isDirectory()) stack.push(p);
      else if (predicate(entry.name, p)) return p;
    }
  }
  return null;
}

function run(cmd, opts = {}) {
  log(`> ${cmd}`);
  const res = spawnSync(cmd, {
    cwd: opts.cwd || ROOT,
    stdio: 'inherit',
    shell: true,
    ...opts,
  });
  if (res.status !== 0) throw new Error(`Komut basarisiz: ${cmd}`);
}

// ===== ADIMLAR =====

function checkVersionsMatch() {
  const pkgV = readPkgVersion();
  const androidV = readAndroidVersion();
  log(`package.json:        ${pkgV}`);
  log(`android build.gradle: ${androidV}`);
  if (pkgV !== androidV) {
    err(`Surum uyumsuz! package.json=${pkgV}, android=${androidV}. Once esitleyin.`);
    process.exit(1);
  }
  return pkgV;
}

function buildElectron() {
  log('Electron build basliyor...');
  if (PUBLISH) {
    // electron-builder GitHub Releases'a Setup.exe + latest.yml + blockmap yukler
    // GH_TOKEN env var (veya gh auth token) gerekli
    log('--publish aktif: GitHub Releases\'a yukleniyor');
    if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
      log('UYARI: GH_TOKEN bulunamadi. Linux/mac: export GH_TOKEN=$(gh auth token)');
    }
    run('npx electron-builder --win --publish always -c build/electron-builder.json');
  } else {
    run('npm run build');
  }
}

function buildLauncher() {
  log('Launcher build basliyor (pkg)...');
  // pkg npm bagimliligi yok — global veya npx ile cagirilmali
  // Yoksa hatayi kapat, kullanici elle build edebilir
  const res = spawnSync('npx', ['--yes', 'pkg', 'launcher.js',
    '-t', 'node18-win-x64',
    '-o', '../dist/SakuraPOS-Launcher.exe'], {
    cwd: path.join(ROOT, 'launcher'),
    stdio: 'inherit',
    shell: true,
  });
  if (res.status !== 0) {
    log('! Launcher build atlandi (pkg yuklu degil veya hata) — el ile yapin: cd launcher && npm run build');
  }
}

function buildAndroid() {
  log('Android build basliyor (iki flavor: garson + yonetici)...');
  const gradlew = process.platform === 'win32' ? '.\\gradlew.bat' : './gradlew';
  run(`${gradlew} :app:assembleGarsonRelease :app:assembleYoneticiRelease`,
    { cwd: path.join(ROOT, 'android') });
}

function collectArtifacts(version) {
  const outDir = path.join(RELEASE_DIR, `${PRODUCT}-${version}`);
  // DEGISIKLIKLER.txt mevcut ve elle doldurulmussa onu kaybetmemek icin
  // baska klasore koymadan once okuyoruz.
  const changelogPath = path.join(outDir, 'DEGISIKLIKLER.txt');
  let preservedChangelog = null;
  try {
    if (fs.existsSync(changelogPath)) {
      preservedChangelog = fs.readFileSync(changelogPath, 'utf8');
    }
  } catch (_) {}
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  if (preservedChangelog && !preservedChangelog.includes('[BU DOSYAYI ELLE DUZENLEYIN')) {
    fs.writeFileSync(changelogPath, preservedChangelog, 'utf8');
  }
  fs.mkdirSync(path.join(outDir, 'pos'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'apk'), { recursive: true });

  // 1. POS exe
  if (!SKIP_ELECTRON) {
    // Once tam versiyon eslesmesi ara, yoksa herhangi bir Setup *.exe (eski build'lerden
    // yanlislikla almamak icin onayla)
    let setupExe = findFile(DIST_DIR,
      (n) => n === `${PRODUCT} Setup ${version}.exe`);
    if (!setupExe) {
      setupExe = findFile(DIST_DIR,
        (n) => n.match(new RegExp(`^${PRODUCT} Setup .*\\.exe$`, 'i')));
    }
    if (!setupExe) throw new Error('Setup exe bulunamadi (dist/ icine bakin)');
    fs.copyFileSync(setupExe, path.join(outDir, 'pos', path.basename(setupExe)));
    log(`+ pos/${path.basename(setupExe)}`);

    // Firewall onarici (saha aciliyet) — Public ag tuzaginda kurallari
    // profile=any olarak yeniden yazar, kullanici cift tiklayinca UAC ister.
    const fwFix = path.join(ROOT, 'scripts', 'fix-firewall.bat');
    if (fs.existsSync(fwFix)) {
      fs.copyFileSync(fwFix, path.join(outDir, 'pos', 'fix-firewall.bat'));
      log(`+ pos/fix-firewall.bat`);
    }

    // Launcher (varsa)
    const launcher = findFile(DIST_DIR,
      (n) => n.match(new RegExp(`^${PRODUCT}-Launcher.*\\.exe$`, 'i')));
    if (launcher) {
      fs.copyFileSync(launcher, path.join(outDir, 'pos', path.basename(launcher)));
      log(`+ pos/${path.basename(launcher)}`);
    } else {
      log(`! Launcher bulunamadi (electron/launcher.html disinda derlenmeli) — atlandi`);
    }
  }

  // 2. APK'lar
  if (!SKIP_ANDROID) {
    const apkRoot = path.join(ROOT, 'android/app/build/outputs/apk');
    const garsonApk = findFile(path.join(apkRoot, 'garson'),
      (n) => n.endsWith('.apk') && n.includes('release'));
    const yoneticiApk = findFile(path.join(apkRoot, 'yonetici'),
      (n) => n.endsWith('.apk') && n.includes('release'));

    if (!garsonApk) throw new Error('garson-release.apk bulunamadi');
    if (!yoneticiApk) throw new Error('yonetici-release.apk bulunamadi');

    fs.copyFileSync(garsonApk, path.join(outDir, 'apk', `garson-${version}.apk`));
    fs.copyFileSync(yoneticiApk, path.join(outDir, 'apk', `yonetici-${version}.apk`));
    log(`+ apk/garson-${version}.apk`);
    log(`+ apk/yonetici-${version}.apk`);
  }

  // 3. latest.json manifest (master plan §12.3)
  const manifest = {
    pos: {
      version,
      file: `pos/${PRODUCT} Setup ${version}.exe`,
      releaseDate: new Date().toISOString().slice(0, 10),
      notes: 'DEGISIKLIKLER.txt dosyasina bakin',
    },
    apk: {
      version,
      minApkVersion: version,
      garsonFile: `apk/garson-${version}.apk`,
      yoneticiFile: `apk/yonetici-${version}.apk`,
    },
  };
  fs.writeFileSync(
    path.join(outDir, 'latest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8'
  );
  log(`+ latest.json`);

  // 4. Dokumantasyon
  const docsSrc = path.join(ROOT, 'docs');
  if (fs.existsSync(docsSrc)) {
    copyDir(docsSrc, path.join(outDir, 'docs'));
    log(`+ docs/`);
  } else {
    log(`! docs/ klasoru yok — atlandi`);
  }

  // 5. DEGISIKLIKLER.txt placeholder — VARSA DOKUNMA (kullanici elle doldurmus olabilir)
  if (!fs.existsSync(changelogPath)) {
    fs.writeFileSync(changelogPath,
      `${PRODUCT} ${version}\n` +
      `Tarih: ${new Date().toISOString().slice(0, 10)}\n\n` +
      `[BU DOSYAYI ELLE DUZENLEYIN — KULLANICIYA NE DEGISTIGINI ANLATIN]\n\n` +
      `Yenilikler:\n  - ...\n\n` +
      `Hata duzeltmeleri:\n  - ...\n\n` +
      `Bilinen sorunlar:\n  - ...\n`,
      'utf8'
    );
    log(`+ DEGISIKLIKLER.txt (sablon — elle duzenlenmeli)`);
  } else {
    log(`= DEGISIKLIKLER.txt korundu (mevcut icerik silinmedi)`);
  }

  // 6. Boyut raporu
  let totalSize = 0;
  const stack = [outDir];
  while (stack.length) {
    const cur = stack.pop();
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const p = path.join(cur, entry.name);
      if (entry.isDirectory()) stack.push(p);
      else totalSize += fs.statSync(p).size;
    }
  }

  return { outDir, totalSize };
}

/**
 * GitHub release'ine APK'lar ve latest.json'u gh CLI ile ekle.
 * electron-builder zaten v<version> tag'iyle release olusturmus oldu;
 * sadece ek asset upload yapiyoruz.
 */
function publishApksToGitHub(version, outDir) {
  log('GitHub Releases\'a APK + latest.json yukleniyor...');
  const tag = `v${version}`;
  const garson    = path.join(outDir, 'apk', `garson-${version}.apk`);
  const yonetici  = path.join(outDir, 'apk', `yonetici-${version}.apk`);
  const manifest  = path.join(outDir, 'latest.json');
  const fwScript  = path.join(outDir, 'pos', 'fix-firewall.bat');

  // gh CLI mevcut mu?
  const check = spawnSync('gh', ['--version'], { stdio: 'pipe', shell: true });
  if (check.status !== 0) {
    err('gh CLI bulunamadi. APK ve latest.json yuklenmedi. Yukleyin: https://cli.github.com');
    err('Setup.exe + latest.yml yine de GitHub\'a yuklendi (electron-builder).');
    return;
  }

  const files = [garson, yonetici, manifest, fwScript].filter(f => fs.existsSync(f));
  const r = spawnSync('gh',
    ['release', 'upload', tag, ...files, '--clobber'],
    { cwd: ROOT, stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    err(`gh release upload basarisiz (release '${tag}' var mi?). Manuel: gh release upload ${tag} ...`);
    return;
  }
  log(`+ GitHub release ${tag} guncellendi: ${files.length} ek dosya`);
}

// ===== ANA AKIS =====

function main() {
  log('='.repeat(60));
  log(`${PRODUCT} — RELEASE PAKETLEYICI`);
  log('='.repeat(60));

  const version = checkVersionsMatch();
  log(`Hedef surum: ${version}`);

  if (!SKIP_ELECTRON) {
    buildElectron();
    buildLauncher();
  }
  if (!SKIP_ANDROID) buildAndroid();

  const { outDir, totalSize } = collectArtifacts(version);

  // --publish modunda APK'lari ve latest.json'u GitHub release'ine ekle
  if (PUBLISH && !SKIP_ANDROID) {
    publishApksToGitHub(version, outDir);
  }

  log('='.repeat(60));
  log(`PAKET HAZIR: ${outDir}`);
  log(`Toplam boyut: ${(totalSize / 1024 / 1024).toFixed(1)} MB`);
  log('='.repeat(60));
  log('');
  log('Sonraki adimlar:');
  log('  1. DEGISIKLIKLER.txt dosyasini elle duzenleyin');
  log('  2. test/update-checklist.md icindeki kontrolleri yapin');
  log('  3. release/ klasorunu USB veya WeTransfer ile restorana gonderin');
  log('');
}

try {
  main();
} catch (e) {
  err(e.message);
  process.exit(1);
}
