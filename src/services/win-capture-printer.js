// ===== WINDOWS YAKALAMA YAZICISI KURULUMU (spooler tee) =====
// Windows'ta 127.0.0.1:<port> adresine RAW baski yollayan bir Standart TCP/IP
// yazici portu + "Generic / Text Only" surucusuyle bir yazici olusturur.
// Platform (Yemeksepeti/Trendyol/Getir) yazdirmayi BU yaziciya yonlendirdiginde
// baski RAW olarak bizim TCP dinleyicimize (online-capture) duser; biz hem
// yakalar hem de tee ile fiziksel yaziciya geciririz. Ozel port-monitor DLL'i
// gerekmez; yalnizca Windows'un yerlesik PowerShell cmdlet'leri kullanilir.
//
// NOT: Yonetici (elevated) hak gerektirir — UAC bir kez sorulur.

const { exec } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PRINTER_NAME = 'Alkyone Online Yakalama';
const PORT_NAME = 'Alkyone9100';

function runElevatedPs(script) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      return reject(new Error('Bu islem yalnizca Windows uzerinde calisir'));
    }
    const ps1 = path.join(os.tmpdir(), `alkyone-cap-${Date.now()}.ps1`);
    try {
      fs.writeFileSync(ps1, script, 'utf8');
    } catch (e) {
      return reject(new Error('Gecici script yazilamadi: ' + e.message));
    }
    // Elevated (RunAs) calistir ve bitmesini bekle
    const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${ps1}'"`;
    exec(cmd, { windowsHide: true }, (err) => {
      try { fs.unlinkSync(ps1); } catch (_) {}
      if (err) return reject(new Error('Elevated PowerShell hatasi (UAC reddedilmis olabilir): ' + err.message));
      resolve();
    });
  });
}

/**
 * Yakalama yazicisini ve RAW portunu olustur (idempotent).
 * @param {number} port TCP RAW port (online-capture ile ayni olmali; genelde 9100)
 */
function setupWindowsCapturePrinter(port = 9100) {
  const p = parseInt(port, 10) || 9100;
  const script = `
$ErrorActionPreference = 'Stop'
if (-not (Get-PrinterPort -Name '${PORT_NAME}' -ErrorAction SilentlyContinue)) {
  Add-PrinterPort -Name '${PORT_NAME}' -PrinterHostAddress '127.0.0.1' -PortNumber ${p}
}
if (-not (Get-Printer -Name '${PRINTER_NAME}' -ErrorAction SilentlyContinue)) {
  Add-Printer -Name '${PRINTER_NAME}' -DriverName 'Generic / Text Only' -PortName '${PORT_NAME}'
}
`.trim();
  return runElevatedPs(script);
}

/** Yakalama yazicisini ve portunu kaldir. */
function removeWindowsCapturePrinter() {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
Remove-Printer -Name '${PRINTER_NAME}'
Remove-PrinterPort -Name '${PORT_NAME}'
`.trim();
  return runElevatedPs(script);
}

module.exports = { setupWindowsCapturePrinter, removeWindowsCapturePrinter, PRINTER_NAME, PORT_NAME };
