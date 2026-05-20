// Sunucu saat senkronu (master plan §6.2 — sunucu otoritesi)
// /api/time'den offset hesaplar; serverNow() yerel saatten bagimsiz, sunucu saati doner.
// 5 dakikada bir yeniden senkronize olur.

(function () {
  let offset = 0; // ms (server - local)
  let synced = false;
  let lastSyncedAt = 0;

  async function sync() {
    try {
      const t0 = Date.now();
      const res = await fetch('/api/time', { cache: 'no-store' });
      if (!res.ok) return;
      const t1 = Date.now();
      const data = await res.json();
      const rtt = t1 - t0;
      // Roundtrip ortalamasini tahmin et: sunucu cevabi yarisinda olusturmus kabul et
      offset = data.now + Math.floor(rtt / 2) - t1;
      synced = true;
      lastSyncedAt = t1;
    } catch (_) { /* offline — yerel saat kullanilir */ }
  }

  // Sayfa acildiginda + her 5dk'da bir
  sync();
  setInterval(sync, 5 * 60 * 1000);

  window.serverNow = function () { return Date.now() + offset; };
  window.serverDate = function () { return new Date(window.serverNow()); };
  window.timeOffset = function () { return offset; };
  window.timeSynced = function () { return synced; };
})();
