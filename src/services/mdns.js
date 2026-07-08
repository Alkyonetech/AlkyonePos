const Bonjour = require('bonjour-service');

const PKG_VERSION = (() => {
  try { return require('../../package.json').version; } catch (_) { return '0.0.0'; }
})();

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
    txt: { path: '/', version: PKG_VERSION }
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
