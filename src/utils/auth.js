const jwt = require('jsonwebtoken');
const { loadSettings } = require('./data');

/**
 * JWT token dogrulama middleware
 */
function authRequired(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Yetkilendirme gerekli' });
  }

  const token = header.slice(7);
  try {
    const settings = loadSettings();
    const decoded = jwt.verify(token, settings.auth.jwtSecret);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Gecersiz veya suresi dolmus token' });
  }
}

/**
 * Yonetici yetkisi gerekli middleware
 */
function yoneticiRequired(req, res, next) {
  authRequired(req, res, () => {
    if (req.user.role !== 'yonetici') {
      return res.status(403).json({ error: 'Yonetici yetkisi gerekli' });
    }
    next();
  });
}

/**
 * Garson veya yonetici yetkisi gerekli middleware
 */
function garsonRequired(req, res, next) {
  authRequired(req, res, () => {
    if (!['garson', 'yonetici'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Garson veya yonetici yetkisi gerekli' });
    }
    next();
  });
}

module.exports = { authRequired, yoneticiRequired, garsonRequired };
