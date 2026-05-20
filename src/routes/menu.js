const express = require('express');
const { loadMenu, saveMenu } = require('../utils/data');
const { yoneticiRequired } = require('../utils/auth');
const { broadcast } = require('../ws/websocket');

const router = express.Router();

// GET /api/menu
router.get('/', (req, res) => {
  const menu = loadMenu();
  res.json(menu);
});

// PUT /api/menu
router.put('/', yoneticiRequired, (req, res) => {
  const currentMenu = loadMenu();
  const { version, categories } = req.body;

  // Version kontrolu
  if (version !== undefined && version !== currentMenu.version) {
    return res.status(409).json({
      error: 'Menu baska cihazda degisti, yeniden yukleyin',
      currentVersion: currentMenu.version
    });
  }

  const newMenu = {
    version: (currentMenu.version || 0) + 1,
    categories: categories || currentMenu.categories
  };

  saveMenu(newMenu);
  broadcast('menu:updated', {});
  res.json(newMenu);
});

module.exports = router;
