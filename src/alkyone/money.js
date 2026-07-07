/**
 * Para = tam sayi, kurus (minor unit). Spec Kural #1: ASLA float ile para tutma.
 * 10.50 TL -> 1050 kurus.
 *
 * Mevcut Sakura menu/siparis verisi fiyatlari TAM TL tam sayisi olarak tutuyor
 * ( or. 360 = 360 TL). SQLite'a yazarken kurusa cevrilir (x100).
 */

/** TL (tam veya ondalik) -> kurus tam sayi. */
function tlToKurus(tl) {
  const n = Number(tl);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** Kurus -> gosterim stringi ("1.234,50"). */
function formatKurus(kurus) {
  const k = Math.round(Number(kurus) || 0);
  const neg = k < 0;
  const abs = Math.abs(k);
  const lira = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, '0');
  const liraStr = lira.toLocaleString('tr-TR');
  return (neg ? '-' : '') + liraStr + ',' + cents;
}

module.exports = { tlToKurus, formatKurus };
