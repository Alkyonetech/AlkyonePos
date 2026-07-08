const express = require('express');
const { loadSettings, saveSettings } = require('../utils/data');
const { yoneticiRequired } = require('../utils/auth');
const { broadcast } = require('../ws/websocket');

const router = express.Router();

// GET /api/settings
router.get('/', (req, res) => {
  const settings = loadSettings();
  // PIN'leri disariya verme
  const safe = { ...settings };
  if (safe.auth) {
    safe.auth = {
      pinChangedAt: safe.auth.pinChangedAt
    };
  }
  res.json(safe);
});

// PUT /api/settings
router.put('/', yoneticiRequired, (req, res) => {
  const current = loadSettings();
  const updates = req.body;

  // Derin birlestirme (1 seviye)
  for (const key of Object.keys(updates)) {
    if (typeof updates[key] === 'object' && !Array.isArray(updates[key]) && current[key]) {
      current[key] = { ...current[key], ...updates[key] };
    } else {
      current[key] = updates[key];
    }
  }

  // PIN degistirildiyse tarih guncelle
  if (updates.auth && (updates.auth.garsonPin || updates.auth.yoneticiPin)) {
    current.auth.pinChangedAt = new Date().toISOString();
  }

  saveSettings(current);

  if (updates.ui && typeof updates.ui.theme === 'string') {
    broadcast('settings:theme', { theme: current.ui.theme });
  }

  // Online yakalama ayari degistiyse tasimalari canli yeniden yapilandir
  if (updates.onlineCapture) {
    try { require('../services/online-capture').reconcileCapture(current); }
    catch (e) { console.warn('[Yakalama] yeniden yapilandirma hatasi:', e.message); }
  }

  res.json({ success: true });
});

module.exports = router;
