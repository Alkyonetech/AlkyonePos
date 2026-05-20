const express = require('express');
const { loadTables, saveTables } = require('../utils/data');
const { yoneticiRequired } = require('../utils/auth');
const { broadcast } = require('../ws/websocket');

const router = express.Router();

// GET /api/tables
router.get('/', (req, res) => {
  const tables = loadTables();
  res.json(tables);
});

// PUT /api/tables
router.put('/', yoneticiRequired, (req, res) => {
  const current = loadTables();
  const { version, tables } = req.body;

  if (version !== undefined && version !== current.version) {
    return res.status(409).json({
      error: 'Masa duzeni baska cihazda degisti',
      currentVersion: current.version
    });
  }

  const newData = {
    version: (current.version || 0) + 1,
    tables: tables || current.tables
  };

  saveTables(newData);
  broadcast('tables:refresh', newData);
  res.json(newData);
});

module.exports = router;
