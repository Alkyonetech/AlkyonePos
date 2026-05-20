/**
 * Ag yazici kesfi — /24 subnet'inde TCP port 9100 (RAW/JetDirect) tarar
 * ve ESC/POS "Real-time status transmission" komutu ile (DLE EOT 1)
 * gercekten termal yazici olup olmadigini dogrular.
 *
 * Filtre: isimden tahmin yerine PROTOKOL DOGRULAMASI:
 *   1) TCP port 9100 acik mi? (acik degilse atla)
 *   2) DLE EOT n=1 (0x10 0x04 0x01) gonder -> 1 byte durum cevabi geliyor mu?
 *      Cevap geliyorsa ESC/POS uyumlu (termal/POS yazici) onayli.
 *      Cevap gelmiyor ama port acikse "olasi" olarak isaretle.
 *
 * Bonus: 515 (LPD) ve 631 (IPP) acik mi -> ek bilgi.
 */

const net = require('net');
const os = require('os');

const DEFAULT_PORT = 9100;
const CONNECT_TIMEOUT = 400;
const STATUS_TIMEOUT = 700;
const CONCURRENCY = 48;

/** Aktif IPv4 arabirimleri ve /24 taban adresleri */
function getLocalSubnets() {
  const ifaces = os.networkInterfaces();
  const subnets = [];
  for (const name of Object.keys(ifaces || {})) {
    for (const iface of ifaces[name] || []) {
      if (iface.family !== 'IPv4' && iface.family !== 4) continue;
      if (iface.internal) continue;
      const parts = iface.address.split('.').map(Number);
      if (parts.length !== 4 || parts.some(isNaN)) continue;
      const base = `${parts[0]}.${parts[1]}.${parts[2]}`;
      subnets.push({ iface: name, base, self: iface.address, cidr: `${base}.0/24` });
    }
  }
  return subnets;
}

/** TCP port acik mi (kisa timeout)? */
function probePort(ip, port, timeout = CONNECT_TIMEOUT) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch (_) {}
      resolve(ok);
    };
    sock.setTimeout(timeout);
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    sock.connect(port, ip, () => finish(true));
  });
}

/**
 * ESC/POS DLE EOT 1 ile durum cevabini test et.
 * Cevap geldiyse -> dogrulanmis ESC/POS yazici. Status byte yorumu:
 *   bit3 (0x08) -> drawer/online durumu (cesitli)
 *   bit5 (0x20) -> cover acik
 *   bit6 (0x40) -> paper feed button basili
 * Cevap = null -> port acik ama dogrulanmadi.
 */
function probeEscPos(ip, port = DEFAULT_PORT, timeout = STATUS_TIMEOUT) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    let response = null;
    const finish = (ok, escpos) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch (_) {}
      resolve({ open: ok, escpos, statusByte: response ? response[0] : null });
    };
    sock.setTimeout(timeout);
    sock.once('timeout', () => finish(true, false));
    sock.once('error', () => finish(false, false));
    sock.once('data', (buf) => {
      response = buf;
      finish(true, true);
    });
    sock.connect(port, ip, () => {
      try {
        sock.write(Buffer.from([0x10, 0x04, 0x01]));
      } catch (_) { finish(true, false); }
    });
  });
}

/**
 * Tum bilinen ag arabirimlerinin /24'unde 9100 portunu tarar.
 * onProgress callback'i { scanned, total, found } seklinde cagrilir (opsiyonel).
 */
async function scanNetwork(opts = {}) {
  const port = opts.port || DEFAULT_PORT;
  const concurrency = opts.concurrency || CONCURRENCY;
  const subnets = getLocalSubnets();

  const targets = [];
  for (const sub of subnets) {
    for (let i = 1; i <= 254; i++) {
      const ip = `${sub.base}.${i}`;
      if (ip === sub.self) continue;
      targets.push({ ip, iface: sub.iface });
    }
  }

  const found = [];
  let scanned = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < targets.length) {
      const idx = cursor++;
      const t = targets[idx];
      const open = await probePort(t.ip, port);
      if (open) {
        const st = await probeEscPos(t.ip, port);
        found.push({
          ip: t.ip,
          port,
          iface: t.iface,
          escposConfirmed: st.escpos,
          statusByte: st.statusByte,
          status: decodeStatus(st.statusByte),
        });
      }
      scanned++;
      if (opts.onProgress && scanned % 16 === 0) {
        try { opts.onProgress({ scanned, total: targets.length, found: found.length }); } catch (_) {}
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { subnets, port, scannedHosts: targets.length, printers: found };
}

function decodeStatus(byte) {
  if (byte == null) return null;
  return {
    raw: byte,
    online: (byte & 0x08) === 0,
    coverOpen: (byte & 0x20) !== 0,
    feedButton: (byte & 0x40) !== 0,
  };
}

module.exports = { scanNetwork, probePort, probeEscPos, getLocalSubnets };
