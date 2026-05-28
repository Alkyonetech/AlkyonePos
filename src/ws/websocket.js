const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');

let wss = null;

/**
 * WebSocket sunucusunu baslat
 */
function initWebSocket(server) {
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.role = null;
    ws.subscribedEvents = new Set();

    // URL'den token al (?token=xxx). Token DOĞRULANMAZ — yalnızca rol bilgisi
    // için imzasız çözülür. Süresi dolmuş/geçersiz token bağlantıyı engellemez.
    try {
      const url = new URL(req.url, 'http://localhost');
      const token = url.searchParams.get('token');
      if (token) {
        const decoded = jwt.decode(token);
        if (decoded && decoded.role) ws.role = decoded.role;
      }
    } catch (err) {
      // Token yoksa veya bozuksa anonim baglanti
    }

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        handleMessage(ws, msg);
      } catch (err) {
        // Gecersiz mesaj
      }
    });

    ws.on('close', () => {
      ws.isAlive = false;
    });
  });

  // 15 saniyede bir ping
  const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 15000);

  wss.on('close', () => {
    clearInterval(pingInterval);
  });

  return wss;
}

/**
 * Gelen WebSocket mesajlarini isle
 */
function handleMessage(ws, msg) {
  switch (msg.type) {
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong' }));
      break;
    case 'subscribe':
      if (Array.isArray(msg.events)) {
        msg.events.forEach(e => ws.subscribedEvents.add(e));
      }
      break;
  }
}

/**
 * Tum bagli cihazlara event gonder
 */
function broadcast(eventType, payload) {
  if (!wss) return;

  const message = JSON.stringify({ type: eventType, data: payload, timestamp: Date.now() });

  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // OPEN
      client.send(message);
    }
  });
}

/**
 * WebSocket instance'ini al
 */
function getWss() {
  return wss;
}

module.exports = { initWebSocket, broadcast, getWss };
