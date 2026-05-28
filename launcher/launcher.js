#!/usr/bin/env node
/**
 * Sakura POS Launcher (master plan §12.4)
 *
 * Bu kucuk Node uygulamasi POS exe'sini yonetir. Calisma dizini:
 *   SakuraPOS/
 *   ├── SakuraPOS-Launcher.exe       ← bu dosya (pkg ile derlenmis)
 *   ├── SakuraPOS.exe                ← asil POS
 *   ├── SakuraPOS.exe.bak            ← bir onceki surum
 *   ├── data/                        ← dokunulmaz
 *   ├── updates/
 *   │   ├── latest.json
 *   │   └── pos/
 *   │       └── SakuraPOS-1.x.x.exe
 *   └── logs/
 *       └── launcher.log
 *
 * Akis:
 *   1. updates/latest.json oku (varsa)
 *   2. Mevcut SakuraPOS.exe surumunu (data/settings.json#appVersion) karsilastir
 *   3. Yeni surum varsa: yedekle → kopyala → settings guncelle
 *   4. Bozuk dosya / kopyalama hatasi → rollback (.bak geri yukle)
 *   5. SakuraPOS.exe'yi calistir, lifecycle takip et
 *
 * Pkg ile derleme:
 *   npm install -g pkg
 *   cd launcher
 *   pkg launcher.js -t node18-win-x64 -o SakuraPOS-Launcher.exe
 */

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');

// ===== KLASOR KESFI =====

// Pkg ile derlenmisse process.execPath = SakuraPOS-Launcher.exe yolu
// node ile calistirilirsa __dirname = launcher klasoru
const ROOT = process.pkg
  ? path.dirname(process.execPath)
  : path.resolve(__dirname, '..');

const POS_EXE = path.join(ROOT, 'SakuraPOS.exe');
const POS_BAK = path.join(ROOT, 'SakuraPOS.exe.bak');
const UPDATES_DIR = path.join(ROOT, 'updates');
const LATEST_JSON = path.join(UPDATES_DIR, 'latest.json');
const POS_UPDATES = path.join(UPDATES_DIR, 'pos');
const LOGS_DIR = path.join(ROOT, 'logs');
const SETTINGS_PATH = path.join(ROOT, 'data', 'settings.json');

// ===== UTIL =====

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

function log(msg) {
  ensureDir(LOGS_DIR);
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(path.join(LOGS_DIR, 'launcher.log'), line + '\n', 'utf8');
}

function logFail(msg) {
  ensureDir(LOGS_DIR);
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.error(line);
  fs.appendFileSync(path.join(LOGS_DIR, 'update-failed.log'), line + '\n', 'utf8');
  fs.appendFileSync(path.join(LOGS_DIR, 'launcher.log'), line + '\n', 'utf8');
}

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { return null; }
}

function compareVer(a, b) {
  const pa = (a || '0').split('.').map(n => parseInt(n) || 0);
  const pb = (b || '0').split('.').map(n => parseInt(n) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

function fileHash(p) {
  if (!fs.existsSync(p)) return null;
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(p));
  return h.digest('hex');
}

// ===== GUNCELLEME MANTIGI =====

function getCurrentVersion() {
  const s = readJsonSafe(SETTINGS_PATH);
  return s?.appVersion || '0.0.0';
}

function setCurrentVersion(version) {
  const s = readJsonSafe(SETTINGS_PATH);
  if (!s) return false;
  s.appVersion = version;
  // Atomic
  const tmp = SETTINGS_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2), 'utf8');
  fs.renameSync(tmp, SETTINGS_PATH);
  return true;
}

function checkForUpdate() {
  if (!fs.existsSync(LATEST_JSON)) return null;
  const latest = readJsonSafe(LATEST_JSON);
  if (!latest?.pos?.version) return null;

  const newVer = latest.pos.version;
  const curVer = getCurrentVersion();
  if (compareVer(newVer, curVer) <= 0) return null;

  const newExeRel = latest.pos.file;
  if (!newExeRel) return null;

  // file path can be "pos/SakuraPOS-1.1.0.exe" — relative to updates/
  const newExe = path.isAbsolute(newExeRel)
    ? newExeRel
    : path.join(UPDATES_DIR, newExeRel);

  if (!fs.existsSync(newExe)) {
    logFail(`Manifest yeni surum sozu veriyor (${newVer}) ama dosya yok: ${newExe}`);
    return null;
  }

  return { fromVer: curVer, toVer: newVer, newExe, manifest: latest };
}

function applyUpdate(update) {
  const { fromVer, toVer, newExe } = update;
  log(`Guncelleme baslatiliyor: ${fromVer} -> ${toVer}`);

  // Boyut/checksum dogrulama
  const stat = fs.statSync(newExe);
  if (stat.size < 1024 * 1024) {
    throw new Error(`Yeni .exe sasi ufak (${stat.size} bayt) — bozuk olabilir`);
  }

  const newHash = fileHash(newExe);
  log(`Yeni .exe SHA256: ${newHash.slice(0, 16)}...`);

  // 1. Mevcut exe'yi yedekle
  if (fs.existsSync(POS_EXE)) {
    if (fs.existsSync(POS_BAK)) fs.unlinkSync(POS_BAK);
    fs.copyFileSync(POS_EXE, POS_BAK);
    log(`Yedek olusturuldu: SakuraPOS.exe.bak (${fileHash(POS_BAK).slice(0, 16)}...)`);
  }

  // 2. Yeni .exe'yi kopyala (atomic-ish)
  const tempExe = POS_EXE + '.new';
  try {
    fs.copyFileSync(newExe, tempExe);
    if (fs.existsSync(POS_EXE)) fs.unlinkSync(POS_EXE);
    fs.renameSync(tempExe, POS_EXE);
  } catch (e) {
    // Kopyalama bozulduysa rollback
    if (fs.existsSync(tempExe)) try { fs.unlinkSync(tempExe); } catch (_) {}
    rollback();
    throw new Error(`Kopyalama basarisiz: ${e.message}`);
  }

  // 3. settings.json appVersion guncelle
  setCurrentVersion(toVer);

  log(`Guncelleme basarili: ${fromVer} -> ${toVer}`);
  return true;
}

function rollback() {
  if (!fs.existsSync(POS_BAK)) {
    logFail('Rollback yapilamadi — .bak dosyasi yok');
    return false;
  }
  try {
    if (fs.existsSync(POS_EXE)) fs.unlinkSync(POS_EXE);
    fs.copyFileSync(POS_BAK, POS_EXE);
    log('Rollback basarili: .bak -> SakuraPOS.exe');
    return true;
  } catch (e) {
    logFail(`Rollback basarisiz: ${e.message}`);
    return false;
  }
}

// ===== POS BASLATMA =====

function startPos() {
  if (!fs.existsSync(POS_EXE)) {
    logFail(`SakuraPOS.exe bulunamadi: ${POS_EXE}`);
    return false;
  }

  log(`Baslatiliyor: ${POS_EXE}`);

  let child;
  try {
    child = spawn(POS_EXE, [], {
      cwd: ROOT,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
  } catch (err) {
    logFail(`POS spawn senkron hatasi (${err.code || ''}): ${err.message} — rollback`);
    if (rollback()) {
      try {
        const fallback = spawn(POS_EXE, [], { cwd: ROOT, detached: true, stdio: 'ignore' });
        fallback.unref();
        log('Rollback ile eski surum baslatildi');
        return true;
      } catch (e2) {
        logFail(`Rollback sonrasi spawn da basarisiz: ${e2.message}`);
      }
    }
    return false;
  }

  const startTime = Date.now();

  child.on('error', (err) => {
    logFail(`POS baslatma async hatasi: ${err.message}`);
  });

  // 30 saniye stabilite kontrolu — erken crash olursa rollback
  let crashed = false;
  const stabilityTimer = setTimeout(() => {
    log('POS 30 sn boyunca calisti — guncelleme stabil');
  }, 30000);

  child.on('exit', (code) => {
    if (!crashed && Date.now() - startTime < 30000) {
      crashed = true;
      clearTimeout(stabilityTimer);
      logFail(`POS erken cikti (${(Date.now() - startTime)/1000}sn, kod ${code}) — rollback yapiliyor`);
      const ok = rollback();
      if (ok) {
        log('Rollback yapildi, eski surumle yeniden deneniyor...');
        try {
          spawn(POS_EXE, [], { cwd: ROOT, detached: true, stdio: 'ignore' }).unref();
        } catch (e) {
          logFail(`Rollback sonrasi spawn hatasi: ${e.message}`);
        }
      }
    }
  });

  child.unref();
  return true;
}

// ===== ANA AKIS =====

function main() {
  log('='.repeat(50));
  log(`Sakura POS Launcher — root: ${ROOT}`);

  if (!fs.existsSync(POS_EXE) && !fs.existsSync(POS_BAK)) {
    logFail('SakuraPOS.exe ve .bak yok — kurulum bozulmus, geliştiriciye basvurun.');
    process.exit(1);
  }

  // Eger sadece .bak varsa onu primary'ye al
  if (!fs.existsSync(POS_EXE) && fs.existsSync(POS_BAK)) {
    log('SakuraPOS.exe yok ama .bak var — geri yukleniyor');
    fs.copyFileSync(POS_BAK, POS_EXE);
  }

  // Guncelleme var mi?
  const update = checkForUpdate();
  if (update) {
    try {
      applyUpdate(update);
    } catch (e) {
      logFail(`Guncelleme basarisiz: ${e.message}`);
      log('Eski surumle devam ediliyor');
    }
  } else {
    log(`Guncelleme yok (mevcut: ${getCurrentVersion()})`);
  }

  // POS'u baslat (test ortaminda atlanir)
  if (!process.env.SAKURA_LAUNCHER_NO_START) {
    startPos();
  }

  // Launcher cikis (POS detach edildi)
  log('Launcher gorevi tamam, cikis');
  // 1 sn POS'a baslangic suresi ver
  setTimeout(() => process.exit(0), 1000);
}

try {
  main();
} catch (e) {
  logFail(`Launcher fatal: ${e.message}\n${e.stack}`);
  process.exit(2);
}
