/**
 * Launcher rollback / update senaryolari testi.
 * Calistirma: node test/launcher.test.js
 *
 * Yaptigi:
 *   - Gecici klasorde fake bir SakuraPOS kurulumu olustur
 *   - launcher.js'i o klasorde calistir
 *   - 4 senaryoyu dener:
 *      1. Guncelleme yok -> exe degismez
 *      2. Yeni surum var -> exe degisir, .bak olusur, settings.appVersion guncellenir
 *      3. "Yeni" exe cok kucuk (bozuk) -> rollback, eski exe geri gelir
 *      4. Eski yedek varken sadece .bak duruyorsa -> .bak'i exe yapar
 *
 * Native bir POS calistirilmaz — fake exe sadece data dosyasi (laucher only does file ops).
 * spawn cagrisi PowerShell veya bash sayesinde bos exe'yi calistirabilir; spawn senkron
 * hatasi durumunda rollback testi tetikleniyor olur.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const crypto = require('crypto');

const LAUNCHER = path.resolve(__dirname, '..', 'launcher', 'launcher.js');

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

function makeTempRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sakura-launcher-'));
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'updates', 'pos'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
  return dir;
}

function writeBigFile(p, sizeBytes, marker) {
  const buf = Buffer.alloc(sizeBytes);
  Buffer.from(marker).copy(buf, 0);
  fs.writeFileSync(p, buf);
}

function runLauncher(rootDir) {
  // launcher.js root'u: process.pkg yoksa __dirname/.. — yani launcher/'in bir ustu.
  // Test icin launcher.js'i bir kopya ile cagiriyoruz: ROOT'u bizim tmp klasorumuze
  // gostermek icin ortam degiskeni yok; bunun yerine pkg modu taklit edilir:
  // process.execPath = sahte bir path, ROOT bu path'in dirname'i olur.
  // Ama spawnSync('node', [launcher.js]) -> process.pkg false. Cozum: gecici bir
  // wrapper script olusturup ROOT'u override edelim.
  const wrapper = path.join(rootDir, '_run.js');
  fs.writeFileSync(wrapper, `
    process.pkg = { entrypoint: ${JSON.stringify(rootDir)} };
    Object.defineProperty(process, 'execPath', { value: ${JSON.stringify(path.join(rootDir, 'SakuraPOS-Launcher.exe'))} });
    require(${JSON.stringify(LAUNCHER)});
  `);
  const r = spawnSync(process.execPath, [wrapper], {
    cwd: rootDir, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, SAKURA_LAUNCHER_NO_START: '1' },
  });
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status };
}

function sha(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

console.log('=== LAUNCHER TEST ===\n');

// === 1. Guncelleme yok ===
console.log('1. Guncelleme yokken exe degismiyor');
{
  const root = makeTempRoot();
  const exePath = path.join(root, 'SakuraPOS.exe');
  writeBigFile(exePath, 2 * 1024 * 1024, 'OLD');
  fs.writeFileSync(path.join(root, 'data', 'settings.json'), JSON.stringify({ appVersion: '1.0.0' }));

  const before = sha(fs.readFileSync(exePath));
  runLauncher(root);
  const after = sha(fs.readFileSync(exePath));
  test('Exe SHA degismedi', () => { if (before !== after) throw new Error('Exe degismis'); });
  test('.bak yok', () => { if (fs.existsSync(exePath + '.bak')) throw new Error('.bak olusmus'); });
}

// === 2. Yeni surum var, basariyla guncelleniyor ===
console.log('\n2. Yeni surum: exe degisiyor, .bak olusuyor, version yukseliyor');
{
  const root = makeTempRoot();
  const exePath = path.join(root, 'SakuraPOS.exe');
  writeBigFile(exePath, 2 * 1024 * 1024, 'OLD-V100');
  fs.writeFileSync(path.join(root, 'data', 'settings.json'), JSON.stringify({ appVersion: '1.0.0' }));

  // Yeni exe (yeterince buyuk)
  const newExe = path.join(root, 'updates', 'pos', 'SakuraPOS-1.1.0.exe');
  writeBigFile(newExe, 3 * 1024 * 1024, 'NEW-V110');
  fs.writeFileSync(path.join(root, 'updates', 'latest.json'), JSON.stringify({
    pos: { version: '1.1.0', file: 'pos/SakuraPOS-1.1.0.exe' }
  }));

  const oldHash = sha(fs.readFileSync(exePath));
  runLauncher(root);

  const newHash = sha(fs.readFileSync(exePath));
  test('Exe degisti (yeni hash)', () => { if (oldHash === newHash) throw new Error('Exe degismedi'); });
  test('.bak olustu', () => { if (!fs.existsSync(exePath + '.bak')) throw new Error('.bak yok'); });
  test('.bak hash eski exe ile ayni', () => {
    const bakHash = sha(fs.readFileSync(exePath + '.bak'));
    if (bakHash !== oldHash) throw new Error('.bak hash uyusmuyor');
  });
  test('settings.appVersion 1.1.0', () => {
    const s = JSON.parse(fs.readFileSync(path.join(root, 'data', 'settings.json'), 'utf8'));
    if (s.appVersion !== '1.1.0') throw new Error('Version: ' + s.appVersion);
  });
}

// === 3. "Yeni" exe bozuk (cok kucuk) ===
console.log('\n3. Bozuk yeni exe -> rollback (orjinal exe korunur)');
{
  const root = makeTempRoot();
  const exePath = path.join(root, 'SakuraPOS.exe');
  writeBigFile(exePath, 2 * 1024 * 1024, 'GOOD-OLD');
  fs.writeFileSync(path.join(root, 'data', 'settings.json'), JSON.stringify({ appVersion: '1.0.0' }));

  // Bozuk yeni exe (1KB — minimum 1MB sarttı)
  const newExe = path.join(root, 'updates', 'pos', 'SakuraPOS-1.1.0.exe');
  writeBigFile(newExe, 1024, 'BROKEN');
  fs.writeFileSync(path.join(root, 'updates', 'latest.json'), JSON.stringify({
    pos: { version: '1.1.0', file: 'pos/SakuraPOS-1.1.0.exe' }
  }));

  const goodHash = sha(fs.readFileSync(exePath));
  runLauncher(root);

  const afterHash = sha(fs.readFileSync(exePath));
  test('Exe degismedi (rollback dogru)', () => { if (goodHash !== afterHash) throw new Error('Exe degismis (rollback olmamis)'); });
  test('settings.appVersion 1.0.0 (yukselmedi)', () => {
    const s = JSON.parse(fs.readFileSync(path.join(root, 'data', 'settings.json'), 'utf8'));
    if (s.appVersion !== '1.0.0') throw new Error('Version yanlis: ' + s.appVersion);
  });
  test('update-failed.log var', () => {
    const f = path.join(root, 'logs', 'update-failed.log');
    if (!fs.existsSync(f)) throw new Error('update-failed.log yok');
  });
}

// === 4. Sadece .bak varsa, otomatik geri yukle ===
console.log('\n4. SakuraPOS.exe yok, sadece .bak var -> .bak geri yuklenir');
{
  const root = makeTempRoot();
  const exePath = path.join(root, 'SakuraPOS.exe');
  const bakPath = path.join(root, 'SakuraPOS.exe.bak');
  writeBigFile(bakPath, 2 * 1024 * 1024, 'BAK-RESTORE');
  fs.writeFileSync(path.join(root, 'data', 'settings.json'), JSON.stringify({ appVersion: '1.0.0' }));

  runLauncher(root);
  test('Exe geri yuklendi', () => { if (!fs.existsSync(exePath)) throw new Error('Exe yok'); });
  test('Yeni exe icerigi .bak ile ayni', () => {
    const a = sha(fs.readFileSync(exePath));
    const b = sha(fs.readFileSync(bakPath));
    if (a !== b) throw new Error('Hash uyumsuz');
  });
}

console.log('\n========================================');
console.log(`Toplam: ${passed + failed}, Basarili: ${passed}, Basarisiz: ${failed}`);
console.log('========================================');
process.exit(failed === 0 ? 0 : 1);
