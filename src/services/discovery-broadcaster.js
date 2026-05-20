// UDP broadcast yayicisi — istemcilerin sunucuyu bulmasi icin.
// Her 2sn'de bir tum aktif IPv4 arayuzlerinden 255.255.255.255:5354
// ve interface-specific broadcast adresine JSON paket gonderir.
//
// Paket formati:
//   { "app": "sakura-pos", "version": "1.0.0", "port": 3000,
//     "ips": ["192.168.1.103", ...], "ts": 1234567890 }
//
// APK tarafi: 5354 portunu dinler, ilk paket ile baglanir.

const dgram = require('dgram');
const os = require('os');

const DISCOVERY_PORT = 5354;
const BROADCAST_INTERVAL = 2000;

let socket = null;
let timer = null;

function ipv4Interfaces() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    if (!list) continue;
    for (const i of list) {
      if (i.family !== 'IPv4' || i.internal) continue;
      out.push(i);
    }
  }
  return out;
}

function broadcastAddrFor(addr, netmask) {
  const a = addr.split('.').map(n => parseInt(n, 10));
  const m = netmask.split('.').map(n => parseInt(n, 10));
  return a.map((octet, i) => (octet & m[i]) | (~m[i] & 0xff)).join('.');
}

function startDiscoveryBroadcaster(port, version) {
  if (socket) return;
  socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  socket.on('error', (err) => {
    console.warn('[discovery] socket hata:', err.message);
  });

  socket.bind(0, () => {
    try { socket.setBroadcast(true); } catch (_) {}
  });

  function tick() {
    const ifaces = ipv4Interfaces();
    const ips = ifaces.map(i => i.address);
    const msg = Buffer.from(JSON.stringify({
      app: 'sakura-pos',
      version: version || '1.0.0',
      port: port || 3000,
      ips,
      ts: Date.now(),
    }));

    // 1) Sinirsiz broadcast (cogu sistemde varsayilan arayuzde)
    socket.send(msg, DISCOVERY_PORT, '255.255.255.255', () => {});

    // 2) Her arayuz icin yonlendirilmis broadcast (Wi-Fi + Ethernet ayri ayri)
    for (const i of ifaces) {
      try {
        const bcast = broadcastAddrFor(i.address, i.netmask);
        socket.send(msg, DISCOVERY_PORT, bcast, () => {});
      } catch (_) {}
    }
  }

  tick();
  timer = setInterval(tick, BROADCAST_INTERVAL);

  console.log(`[Sakura POS] UDP discovery broadcast aktif (port ${DISCOVERY_PORT}, interval ${BROADCAST_INTERVAL}ms)`);
  return { stop: stopDiscoveryBroadcaster };
}

function stopDiscoveryBroadcaster() {
  if (timer) { clearInterval(timer); timer = null; }
  if (socket) { try { socket.close(); } catch (_) {} socket = null; }
}

module.exports = { startDiscoveryBroadcaster, stopDiscoveryBroadcaster, DISCOVERY_PORT };
