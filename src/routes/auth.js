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

  const token = jwt.sign(
    { role, iat: Math.floor(Date.now() / 1000) },
    settings.auth.jwtSecret,
    { expiresIn: '24h' }
  );

  res.json({ token, role });
});

module.exports = router;
