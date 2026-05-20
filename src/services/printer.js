/**
 * Yazici cikis modulu — iki profil destegi (master plan §yazici).
 *
 * Profiller:
 *   settings.printers.receipt → musteri adisyonu (Sunlux RP8020 vb.)
 *   settings.printers.kitchen → mutfak fisi (otomatik bulunan USB)
 *
 * Profil sekli:
 *   {
 *     enabled: bool,
 *     model: "Sunlux RP8020"   // opsiyonel, otomatik bulma icin
 *     connection: "usb" | "tcp" | "file",
 *     device: "\\\\HOST\\Share" | "auto" | "/path/to.bin",
 *     host: "192.168.1.50",     // tcp icin
 *     port: 9100,               // tcp icin
 *     paperWidth: 58 | 80,
 *     encoding: "PC857"
 *   }
 *
 * "device": "auto" + connection: "usb" → printer-discovery.js ile cozumlenir.
 *
 * Geriye uyumluluk: settings.printer (eski tek-yazici) hala calisir, "receipt"
 * profili gibi davranir.
 *
 * Native modul yok (escpos, node-thermal-printer, usb). Saf net + fs.
 */

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawnSync } = require('child_process');
const { formatReceipt, formatKitchenTicket } = require('./escpos');
const { findWorkingThermal } = require('./printer-discovery');
const { DATA_DIR } = require('../utils/data');

const DEFAULT_TCP_PORT = 9100;
const DEFAULT_TIMEOUT = 5000;

/** Cozumlenmis profil cache — discover cagrilarini tekrarlamamak icin */
const resolvedDeviceCache = new Map();

/**
 * Profili al ve gercek device path'ini cozumle.
 * "auto" device → Windows'ta keşfedilir, sonucu cache'lenir.
 */
function resolveProfile(profile, opts = {}) {
  if (!profile) throw new Error('Yazici profili tanimsiz');
  if (!profile.enabled) {
    const e = new Error('Yazici devre disi');
    e.code = 'PRINTER_DISABLED';
    throw e;
  }

  const out = { ...profile };

  if (profile.connection === 'usb') {
    // Sabit device verilmisse (manuel UNC/port) oldugu gibi kullan
    if (profile.device && profile.device !== 'auto') {
      out.device = profile.device;
      return out;
    }

    // "auto" -> hayalet/kopya bypass eden alt sistem ile calisan termali bul
    const cacheKey = (profile.model || '') + '|auto|' + (opts.exclude || '');
    let resolved;
    if (resolvedDeviceCache.has(cacheKey)) {
      resolved = resolvedDeviceCache.get(cacheKey);
    } else {
      const found = findWorkingThermal({ model: profile.model, exclude: opts.exclude });
      if (!found) {
        throw new Error(profile.model
          ? `'${profile.model}' modeli bulunamadi (Windows yazici listesinde calisan termal yok)`
          : 'Otomatik bulunabilir calisan termal yazici yok');
      }
      resolved = {
        target: found.target,                 // 'unc' | 'raw'
        device: found.uncPath || null,        // paylasimli ise UNC yolu
        winName: found.name,                  // RAW spooler icin yazici adi
        meta: {
          name: found.name, port: found.port, isGhost: found.isGhost,
          workOffline: found.workOffline, statusText: found.statusText,
          score: found.score, reasons: found.reasons,
        },
      };
      resolvedDeviceCache.set(cacheKey, resolved);
    }

    out._target = resolved.target;
    out._winName = resolved.winName;
    out.device = resolved.device;
  }

  return out;
}

/** Manuel cache temizleme — admin "yazicilari yenile" diyince */
function clearDiscoveryCache() { resolvedDeviceCache.clear(); }

/**
 * Profili kullanarak ham buffer'i gonder. Ornek:
 *   await sendBuffer(profile, formatReceipt(order, settings))
 */
async function sendBuffer(profile, buf) {
  switch (profile.connection) {
    case 'tcp':
      return sendTcp(buf, profile.host, profile.port || DEFAULT_TCP_PORT);
    case 'file':
      return sendFile(buf, profile.device || path.join(DATA_DIR, 'print-out.bin'));
    case 'usb':
      // Paylasimli yazici -> UNC yoluna yaz (en saglam)
      if (profile.device) return sendFile(buf, profile.device);
      // Paylasilmayan yerel yazici -> Windows spooler'a RAW gonder (isim ile)
      if (profile._target === 'raw' && profile._winName) {
        return rawPrintWindows(profile._winName, buf);
      }
      throw new Error('USB yazici icin hedef cozumlenemedi (paylasim yok / RAW yok)');
    default:
      throw new Error(`Bilinmeyen yazici baglantisi: ${profile.connection}`);
  }
}

/** Adisyonu (musteri) yazicidan bas. */
async function printReceipt(order, settings) {
  const profile = getProfile(settings, 'receipt');
  const resolved = resolveProfile(profile);
  const buf = formatReceipt(order, mergeSettingsForFormat(settings, resolved));
  return sendBuffer(resolved, buf);
}

/** Mutfak fisini yazdir (yeni eklenen kalemleri vurgular). */
async function printKitchenTicket(order, settings, opts = {}) {
  const receiptProfile = getProfile(settings, 'receipt');
  const profile = getProfile(settings, 'kitchen');
  const resolved = resolveProfile(profile, {
    exclude: receiptProfile?.model || receiptProfile?.deviceName,
  });
  const buf = formatKitchenTicket(order, mergeSettingsForFormat(settings, resolved), opts);
  return sendBuffer(resolved, buf);
}

/**
 * Profilini settings'ten cikart. Geriye uyumluluk:
 *   - settings.printers.<role> varsa onu kullan
 *   - yoksa eski settings.printer'i 'receipt' profili gibi davran
 *   - kitchen yok ve eski sema varsa: kitchen otomatik kapali kabul et
 */
function getProfile(settings, role) {
  if (settings.printers && settings.printers[role]) {
    return settings.printers[role];
  }
  if (role === 'receipt' && settings.printer) {
    return settings.printer;
  }
  return { enabled: false };
}

/** Format fonksiyonlari settings.printer.paperWidth/restaurant'a bakar — eski semayi taklit et. */
function mergeSettingsForFormat(settings, resolvedProfile) {
  return {
    ...settings,
    printer: {
      paperWidth: resolvedProfile.paperWidth || 58,
      encoding: resolvedProfile.encoding || 'ASCII',
    },
  };
}

function sendTcp(buf, host, port) {
  if (!host) throw new Error('TCP yazici icin host gerekir');
  return new Promise((resolve, reject) => {
    const sock = new net.Socket();
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      try { sock.destroy(); } catch (_) {}
      err ? reject(err) : resolve();
    };

    sock.setTimeout(DEFAULT_TIMEOUT);
    sock.once('timeout', () => finish(new Error('Yazici TCP timeout')));
    sock.once('error', finish);

    sock.connect(port, host, () => {
      sock.write(buf, (err) => {
        if (err) return finish(err);
        setTimeout(() => finish(), 200);
      });
    });
  });
}

function sendFile(buf, device) {
  return new Promise((resolve, reject) => {
    fs.writeFile(device, buf, (err) => {
      if (err) reject(new Error(`Yaziciya yazma hatasi (${device}): ${err.message}`));
      else resolve();
    });
  });
}

/**
 * Paylasilmayan yerel Windows yazicisina HAM ESC/POS gonder.
 * winspool.drv P/Invoke (OpenPrinter/StartDocPrinter/WritePrinter) ile RAW
 * is olusturur — boylece sadece YAZICI ADI yeterli, paylasim/port gerekmez,
 * hayalet kopyalar zaten secimde elenmistir.
 */
const RAW_PRINT_PS = `param([string]$PrinterName,[string]$FilePath)
$src=@"
using System;
using System.Runtime.InteropServices;
public class SakuraRaw {
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]
 public struct DI { [MarshalAs(UnmanagedType.LPWStr)] public string n;[MarshalAs(UnmanagedType.LPWStr)] public string o;[MarshalAs(UnmanagedType.LPWStr)] public string t; }
 [DllImport("winspool.drv",CharSet=CharSet.Unicode,SetLastError=true)] public static extern bool OpenPrinter(string s,out IntPtr h,IntPtr d);
 [DllImport("winspool.drv",SetLastError=true)] public static extern bool ClosePrinter(IntPtr h);
 [DllImport("winspool.drv",CharSet=CharSet.Unicode,SetLastError=true)] public static extern bool StartDocPrinter(IntPtr h,int l,ref DI di);
 [DllImport("winspool.drv",SetLastError=true)] public static extern bool EndDocPrinter(IntPtr h);
 [DllImport("winspool.drv",SetLastError=true)] public static extern bool StartPagePrinter(IntPtr h);
 [DllImport("winspool.drv",SetLastError=true)] public static extern bool EndPagePrinter(IntPtr h);
 [DllImport("winspool.drv",SetLastError=true)] public static extern bool WritePrinter(IntPtr h,byte[] b,int c,out int w);
 public static string Send(string p,byte[] b){ IntPtr h;
  if(!OpenPrinter(p,out h,IntPtr.Zero)) return "OpenPrinter:"+Marshal.GetLastWin32Error();
  DI di=new DI(); di.n="Sakura POS"; di.t="RAW";
  if(!StartDocPrinter(h,1,ref di)){ClosePrinter(h);return "StartDoc:"+Marshal.GetLastWin32Error();}
  StartPagePrinter(h); int w; bool ok=WritePrinter(h,b,b.Length,out w);
  EndPagePrinter(h); EndDocPrinter(h); ClosePrinter(h);
  return ok?("OK:"+w):("Write:"+Marshal.GetLastWin32Error()); } }
"@
Add-Type -TypeDefinition $src -Language CSharp
$bytes=[System.IO.File]::ReadAllBytes($FilePath)
$r=[SakuraRaw]::Send($PrinterName,$bytes)
if($r -like "OK:*"){exit 0} else {[Console]::Error.WriteLine($r);exit 1}`;

function rawPrintWindows(printerName, buf) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      return reject(new Error('RAW yazdirma sadece Windows destekli'));
    }
    const stamp = `${process.pid}-${Date.now()}`;
    const tmp = path.join(os.tmpdir(), `sakura-print-${stamp}.bin`);
    const ps1 = path.join(os.tmpdir(), `sakura-print-${stamp}.ps1`);
    try {
      fs.writeFileSync(tmp, buf);
      fs.writeFileSync(ps1, RAW_PRINT_PS, 'utf8');
      const r = spawnSync('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
         '-File', ps1, '-PrinterName', printerName, '-FilePath', tmp],
        { encoding: 'utf8', timeout: 15000 });
      if (r.status === 0) return resolve();
      const msg = (r.stderr || r.stdout || `exit ${r.status}`).toString().trim();
      reject(new Error(`RAW yazdirma hatasi ('${printerName}'): ${msg}`));
    } catch (e) {
      reject(new Error(`RAW yazdirma hatasi ('${printerName}'): ${e.message}`));
    } finally {
      try { fs.unlinkSync(tmp); } catch (_) {}
      try { fs.unlinkSync(ps1); } catch (_) {}
    }
  });
}

module.exports = {
  printReceipt,
  printKitchenTicket,
  resolveProfile,
  sendBuffer,
  getProfile,
  clearDiscoveryCache,
};
