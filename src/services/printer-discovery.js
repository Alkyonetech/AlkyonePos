/**
 * Windows yazici kesfi + HAYALET/KOPYA BYPASS alt sistemi (sadece Windows'ta).
 *
 * Sorun: POS-80C gibi ucuz USB termal yazicilar her takilip cikarildiginda
 * Windows'ta kopya olusturur:
 *   "POS-80C", "POS-80C (Kopya 1)", "POS-80C (Copy 2)", "POS-80C (1)" ...
 * Eski kopyalar olu USB portuna (orn. USB001) bagli kalir, cevrimdisi gorunur
 * ya da port artik mevcut degildir. Sadece BIR tanesi gercekten basar.
 *
 * Bu modul:
 *   - Tum yazicilari zengin durumla listeler (WorkOffline, PrinterStatus,
 *     DetectedErrorState, portun gercekten var olup olmadigi)
 *   - Hayalet/kopya isimlerini tespit eder (Kopya/Copy/#n/(n) ekleri)
 *   - Modeli (POS-80C vb.) eslestirir, calisan termali PUANLAYARAK secer
 *   - findWorkingThermal() ile cozumlenmis hedefi dondurur (UNC veya isim)
 *
 * Native modul yok — `powershell` (Get-CimInstance Win32_Printer + Get-PrinterPort)
 * ve eski Windows icin `wmic` fallback'i.
 */

const { spawnSync } = require('child_process');
const os = require('os');

const HOSTNAME = os.hostname();

/* ---------------------------------------------------------------------------
 * Siniflandirma kaliplari
 * ------------------------------------------------------------------------- */

/** Termal/POS yazici sinifi — surucu/port/model anahtar kelimeleri. */
const THERMAL_PATTERNS = [
  /thermal/i, /receipt/i, /\bpos\b/i, /\bescpos\b/i, /esc[\/\s\-]?pos/i,
  /generic.*text/i, /text.*only/i,
  /pos[\-\s]?80/i, /pos[\-\s]?58/i, /pos\s?\d{2,3}\s?c?/i,   // POS-80C, POS80, POS58
  /sunlux/i, /rp\s?80/i, /rp\s?58/i,
  /epson\s*tm/i, /\btm[\-\s]?[tum]\d/i,
  /\bstar\b.*(tsp|mc|sp)/i, /bixolon/i, /xprinter/i, /\bxp[\-\s]?\d/i,
  /hprt/i, /gprinter/i, /citizen.*ct/i, /seiko.*rp/i, /partner.*rp/i,
  /\b58mm\b/i, /\b80mm\b/i,
];

/**
 * Hayalet/kopya isim ekleri (Turkce + Ingilizce Windows):
 *   "POS-80C (Kopya 1)", "POS-80C (Copy 2)", "POS-80C (1)",
 *   "POS-80C - Kopya", "POS-80C Copy 1", "POS-80C #2"
 */
const GHOST_NAME_PATTERNS = [
  /\(\s*kopya\s*\d*\s*\)/i,
  /\(\s*copy\s*\d*\s*\)/i,
  /\(\s*\d+\s*\)\s*$/i,
  /[-\s]+kopya(\s*\d+)?\s*$/i,
  /[-\s]+copy(\s*\d+)?\s*$/i,
  /\bkopya\s*\d+\b/i,
  /\bcopy\s*\d+\b/i,
  /#\s*\d+\s*$/i,
];

function isGhostName(name) {
  const s = String(name || '');
  return GHOST_NAME_PATTERNS.some(rx => rx.test(s));
}

/** Sanal/sahte yazicilar — asla otomatik termal hedefi olamaz. */
const VIRTUAL_PATTERNS = [
  /microsoft print to pdf/i, /xps document writer/i, /onenote/i,
  /\bfax\b/i, /pdfcreator/i, /\bcutepdf/i, /\bdopdf/i, /print to file/i,
  /adobe pdf/i, /foxit/i, /\bsnagit/i, /quicken pdf/i,
];

function isVirtual(p) {
  const hay = `${p.name || ''} ${p.driver || ''}`;
  if (VIRTUAL_PATTERNS.some(rx => rx.test(hay))) return true;
  // NUL: portu hicbir zaman gercek cihaz degil
  if (p.portType === 'null') return true;
  return false;
}

function classifyThermal(p) {
  const hay = `${p.name || ''} ${p.driver || ''} ${p.port || ''}`;
  return THERMAL_PATTERNS.some(rx => rx.test(hay));
}

function classifyPort(portName) {
  const s = String(portName || '').toUpperCase();
  if (s.startsWith('USB')) return 'usb';
  if (s.startsWith('COM')) return 'serial';
  if (s.startsWith('LPT')) return 'parallel';
  if (s.startsWith('WSD-') || s.includes('WSD')) return 'wsd';
  if (/^\d+\.\d+\.\d+\.\d+/.test(s) || s.startsWith('IP_') || s.startsWith('TCPIP')) return 'tcp';
  if (s.startsWith('FILE') || s.startsWith('PORTPROMPT')) return 'file';
  if (s === 'NUL' || s.startsWith('NUL:')) return 'null';
  return 'other';
}

/* Win32_Printer.PrinterStatus -> metin */
const STATUS_TEXT = {
  1: 'other', 2: 'unknown', 3: 'idle', 4: 'printing',
  5: 'warmup', 6: 'stopped', 7: 'offline',
};

/* ---------------------------------------------------------------------------
 * Sistem yazici listesi (zengin durum + mevcut portlar)
 * ------------------------------------------------------------------------- */

const PS_QUERY = [
  "$ErrorActionPreference='SilentlyContinue';",
  "$ports=@(Get-PrinterPort | Select-Object -ExpandProperty Name);",
  "$pr=Get-CimInstance Win32_Printer | Select-Object Name,ShareName,PortName,Shared,DriverName,WorkOffline,PrinterStatus,DetectedErrorState,Default;",
  "[pscustomobject]@{ports=$ports;printers=$pr} | ConvertTo-Json -Compress -Depth 4",
].join('');

/**
 * Tum sistem yazicilarini zengin durumla listele.
 * Dondurur: [{ name, share, port, portType, driver, isShared, uncPath,
 *              isThermal, isGhost, workOffline, status, statusText,
 *              detectedError, isDefault, portExists }]
 */
function listWindowsPrinters() {
  if (process.platform !== 'win32') return [];

  // 1) Modern Windows: Win32_Printer + Get-PrinterPort
  try {
    const ps = spawnSync('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', PS_QUERY],
      { encoding: 'utf8', timeout: 6000 });
    if (ps.status === 0 && ps.stdout && ps.stdout.trim()) {
      const parsed = JSON.parse(ps.stdout);
      const portList = toArray(parsed.ports).map(x => String(x).toUpperCase());
      const portSet = new Set(portList);
      const printers = toArray(parsed.printers);
      return printers.map(p => normalize({
        name: p.Name,
        share: p.ShareName,
        port: p.PortName,
        isShared: !!p.Shared,
        driver: p.DriverName,
        workOffline: !!p.WorkOffline,
        status: typeof p.PrinterStatus === 'number' ? p.PrinterStatus : null,
        detectedError: typeof p.DetectedErrorState === 'number' ? p.DetectedErrorState : null,
        isDefault: !!p.Default,
      }, portSet));
    }
  } catch (_) { /* fall through */ }

  // 2) Fallback: Get-Printer (port mevcudiyeti/offline bilinmez)
  try {
    const ps = spawnSync('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command',
       'Get-Printer | Select-Object Name,ShareName,PortName,Shared,DriverName,PrinterStatus | ConvertTo-Json -Compress'],
      { encoding: 'utf8', timeout: 5000 });
    if (ps.status === 0 && ps.stdout && ps.stdout.trim()) {
      const arr = toArray(JSON.parse(ps.stdout));
      return arr.map(p => normalize({
        name: p.Name, share: p.ShareName, port: p.PortName,
        isShared: !!p.Shared, driver: p.DriverName,
      }, null));
    }
  } catch (_) { /* fall through */ }

  // 3) Eski Windows: wmic
  try {
    const wm = spawnSync('wmic',
      ['printer', 'get', 'Name,ShareName,PortName,Shared,DriverName,WorkOffline', '/format:csv'],
      { encoding: 'utf8', timeout: 5000 });
    if (wm.status === 0 && wm.stdout) {
      return parseWmicCsv(wm.stdout).map(p => normalize(p, null));
    }
  } catch (_) { /* ignore */ }

  return [];
}

function toArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function parseWmicCsv(out) {
  const lines = out.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < headers.length) continue;
    const row = {};
    headers.forEach((h, idx) => row[h] = (cols[idx] || '').trim());
    rows.push({
      name: row.name,
      share: row.sharename,
      port: row.portname,
      isShared: /true/i.test(row.shared),
      driver: row.drivername,
      workOffline: /true/i.test(row.workoffline),
    });
  }
  return rows;
}

function normalize(p, portSet) {
  const share = (p.share || '').trim();
  const uncPath = share ? `\\\\${HOSTNAME}\\${share}` : null;
  const port = (p.port || '').trim();
  const status = p.status != null ? p.status : null;
  const out = {
    name: (p.name || '').trim(),
    share,
    port,
    portType: classifyPort(port),
    driver: (p.driver || '').trim(),
    isShared: !!p.isShared && !!share,
    uncPath,
    workOffline: !!p.workOffline,
    status,
    statusText: status != null ? (STATUS_TEXT[status] || 'unknown') : null,
    detectedError: p.detectedError != null ? p.detectedError : null,
    isDefault: !!p.isDefault,
    // portSet null ise bilemiyoruz -> "var" kabul et (eski Windows fallback)
    portExists: portSet ? portSet.has(port.toUpperCase()) : true,
  };
  out.isThermal = classifyThermal(out);
  out.isGhost = isGhostName(out.name);
  return out;
}

/* ---------------------------------------------------------------------------
 * Calisan termal secimi (puanlama)
 * ------------------------------------------------------------------------- */

function norm(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, '');
}

/**
 * Bir adayi puanla. Yuksek = daha iyi. `reasons` aciklama uretir (log/admin).
 */
function scoreCandidate(p, model) {
  const reasons = [];
  let score = 0;

  if (model) {
    const needle = norm(model);
    const hay = norm(p.name) + norm(p.driver) + norm(p.port);
    if (hay.includes(needle)) { score += 100; reasons.push('model eslesti'); }
  }

  if (p.isThermal) { score += 25; reasons.push('termal sinifi'); }

  if (p.isGhost) { score -= 45; reasons.push('hayalet/kopya isim'); }
  else { score += 30; reasons.push('orijinal isim'); }

  if (p.workOffline) { score -= 60; reasons.push('WorkOffline'); }
  else { score += 50; reasons.push('cevrimici'); }

  if (p.statusText === 'offline') { score -= 60; reasons.push('durum: offline'); }
  else if (p.statusText === 'idle' || p.statusText === 'printing' || p.statusText === 'warmup') {
    score += 25; reasons.push(`durum: ${p.statusText}`);
  }

  // Olu/orphan port (kopyalarda tipik) — kaybedilmis USB001 vb.
  if (!p.portExists) { score -= 35; reasons.push('port mevcut degil'); }
  else { score += 15; }

  if (p.isDefault) { score += 10; reasons.push('varsayilan yazici'); }

  // Paylasilan yazici fs.writeFile(UNC) ile en saglam yol
  if (p.isShared && p.uncPath) { score += 15; reasons.push('paylasimli (UNC)'); }

  // Calisilabilir port tipleri
  if (['usb', 'serial', 'parallel', 'tcp'].includes(p.portType)) score += 8;
  if (p.portType === 'null' || p.portType === 'file') { score -= 25; reasons.push(`port tipi: ${p.portType}`); }

  // Esitlik bozucu: kisa/sade isim (eksiz orijinal)
  score -= Math.min(p.name.length, 40) * 0.05;

  return { score, reasons };
}

/**
 * Calisan termal yaziciyi bul ve cozumle.
 *
 * @param {object} opts
 * @param {string} [opts.model]    "POS-80C" gibi — varsa once buna gore eler
 * @param {string} [opts.exclude]  bu model/isimdeki adaylari disla (mutfak !=
 *                                  adisyon yazicisi icin)
 * @returns {object|null} {
 *   name, uncPath, port, portType, isShared, isGhost, workOffline,
 *   statusText, score, reasons, target: 'unc'|'raw',
 *   candidates: [...siralanmis tum adaylar]
 * }
 */
function findWorkingThermal(opts = {}) {
  const { model, exclude } = opts;
  // Sanal yazicilari (PDF/XPS/Fax/NUL) bastan ele — asla termal hedefi olamaz
  let all = listWindowsPrinters().filter(p => !isVirtual(p));
  if (all.length === 0) return null;

  // Aday havuzu: model verildiyse model eslesenler; yoksa termal sinifi.
  // Eslesme yoksa null don — rastgele/yanlis cihaza basmaktansa hata ver.
  let pool;
  if (model) {
    const needle = norm(model);
    pool = all.filter(p => (norm(p.name) + norm(p.driver) + norm(p.port)).includes(needle));
    if (pool.length === 0) pool = all.filter(p => p.isThermal); // model yok -> termal
  } else {
    pool = all.filter(p => p.isThermal);
  }
  if (pool.length === 0) return null; // gercek termal/model yok

  // exclude: adisyon yazicisini mutfak aramasindan cikar (sifirlanirsa yoksay)
  if (exclude) {
    const ex = norm(exclude);
    const filtered = pool.filter(p =>
      !(norm(p.name).includes(ex) || norm(p.driver).includes(ex)));
    if (filtered.length > 0) pool = filtered;
  }

  const ranked = pool
    .map(p => {
      const { score, reasons } = scoreCandidate(p, model);
      return { ...p, score, reasons };
    })
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best) return null;

  // Hedef cozumleme: paylasimli -> UNC (fs.writeFile); degilse -> RAW spooler (isim)
  best.target = (best.isShared && best.uncPath) ? 'unc' : 'raw';
  best.candidates = ranked;
  return best;
}

/* ---------------------------------------------------------------------------
 * Geriye uyumlu yardimcilar
 * ------------------------------------------------------------------------- */

/** Modele gore (calisan, hayalet olmayan) yazici bul. */
function findByModel(model) {
  if (!model) return null;
  const found = findWorkingThermal({ model });
  return found || null;
}

/** Otomatik secim: calisan ilk termal (excludeName ile birini disla). */
function autoPickPrinter(excludeName) {
  return findWorkingThermal({ exclude: excludeName }) || null;
}

module.exports = {
  listWindowsPrinters,
  findWorkingThermal,
  findByModel,
  autoPickPrinter,
  isGhostName,
  classifyThermal,
  classifyPort,
  HOSTNAME,
};
