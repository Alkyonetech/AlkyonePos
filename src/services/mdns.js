const Bonjour = require('bonjour-service');

let bonjourInstance = null;

/**
 * mDNS yayini baslat (sakura.local)
 */
function initMdns(name, port) {
  bonjourInstance = new Bonjour.Bonjour();

  bonjourInstance.publish({
    name: name || 'sakura',
    type: 'http',
    port: port || 3000,
    txt: { path: '/', version: '1.0.0' }
  });
}

/**
 * mDNS yayinini durdur
 */
function stopMdns() {
  if (bonjourInstance) {
    bonjourInstance.unpublishAll();
    bonjourInstance.destroy();
    bonjourInstance = null;
  }
}

module.exports = { initMdns, stopMdns };
