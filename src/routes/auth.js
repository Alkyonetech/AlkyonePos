const express = require('express');
const jwt = require('jsonwebtoken');
const { loadSettings } = require('../utils/data');

const router = express.Router();

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { pin, scope } = req.body;
  if (!pin) {
    return res.status(400).json({ error: 'PIN gerekli' });
  }

  const settings = loadSettings();
  let role = null;

  if (pin === settings.auth.yoneticiPin) {
    role = 'yonetici';
  } else if (pin === settings.auth.garsonPin) {
    role = 'garson';
  }

  if (!role) {
    return res.status(401).json({ error: 'Gecersiz PIN' });
  }

  if (scope === 'pos' && role !== 'yonetici') {
    return res.status(403).json({ error: 'POS sistemine yalnizca yonetici girebilir' });
  }

  // Token artık doğrulanmıyor (bkz. utils/auth.js) — yalnızca rolü taşıyan,
  // SÜRESİZ bir işaret olarak üretilir. Böylece eski "süresi dolmuş token"
  // hatası bir daha oluşmaz; ön yüzdeki token mantığı olduğu gibi çalışmaya
  // devam eder.
  const token = jwt.sign(
    { role, iat: Math.floor(Date.now() / 1000) },
    settings.auth.jwtSecret
  );

  res.json({ token, role });
});

module.exports = router;
