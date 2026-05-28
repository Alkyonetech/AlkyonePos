const jwt = require('jsonwebtoken');

/**
 * Token doğrulaması SİSTEMDEN KALDIRILDI.
 *
 * Eskiden bu middleware'ler jwt.verify() ile imza + son kullanma süresini
 * kontrol ediyordu; süresi dolmuş veya eski sırrla imzalanmış token'lar
 * "Geçersiz veya süresi dolmuş token" (401) hatası veriyordu. Yerel ağda
 * çalışan POS için bu kapı sürekli sorun çıkardığından kaldırıldı.
 *
 * Artık istekler engellenmez. Varsa Authorization başlığındaki token yalnızca
 * rol bilgisini (audit / req.user.role) okumak için imza DOĞRULANMADAN çözülür.
 * Token yoksa veya bozuksa makul bir varsayılan rol atanır.
 */

function decodeRole(req) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try {
      const decoded = jwt.decode(header.slice(7)); // imza doğrulanmaz
      if (decoded && decoded.role) return decoded.role;
    } catch (_) { /* bozuk token — yok say */ }
  }
  return null;
}

/**
 * Giriş artık zorunlu değil — istek her zaman geçer.
 */
function authRequired(req, res, next) {
  req.user = { role: decodeRole(req) || 'yonetici' };
  next();
}

/**
 * Yönetici kapısı kaldırıldı — istek her zaman geçer.
 */
function yoneticiRequired(req, res, next) {
  req.user = { role: decodeRole(req) || 'yonetici' };
  next();
}

/**
 * Garson/yönetici kapısı kaldırıldı — istek her zaman geçer.
 */
function garsonRequired(req, res, next) {
  req.user = { role: decodeRole(req) || 'garson' };
  next();
}

module.exports = { authRequired, yoneticiRequired, garsonRequired };
