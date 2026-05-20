/**
 * Basit dosya logger — data/logs/server.log
 * Rolling: 5MB asinca server.log -> server.log.1 -> server.log.2 (3 dosya)
 * console.log/error/warn baski hala stdout'a gider, ek olarak dosyaya yazilir.
 */

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./data');

const LOGS_DIR = path.join(DATA_DIR, 'logs');
const LOG_FILE = path.join(LOGS_DIR, 'server.log');
const MAX_SIZE = 5 * 1024 * 1024;
const KEEP = 3;

let installed = false;

function ensureDir() {
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function rotateIfNeeded() {
  try {
    if (!fs.existsSync(LOG_FILE)) return;
    const st = fs.statSync(LOG_FILE);
    if (st.size < MAX_SIZE) return;
    // server.log.2 sil, .1 -> .2, mevcut -> .1
    for (let i = KEEP - 1; i >= 1; i--) {
      const a = LOG_FILE + '.' + i;
      const b = LOG_FILE + '.' + (i + 1);
      if (fs.existsSync(a)) {
        try { if (fs.existsSync(b)) fs.unlinkSync(b); fs.renameSync(a, b); } catch (_) {}
      }
    }
    try { fs.renameSync(LOG_FILE, LOG_FILE + '.1'); } catch (_) {}
  } catch (_) {}
}

function write(level, args) {
  try {
    ensureDir();
    rotateIfNeeded();
    const line = `[${new Date().toISOString()}] [${level}] ` +
      args.map(a => typeof a === 'string' ? a : safeJson(a)).join(' ') + '\n';
    fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch (_) { /* logging asla crash etmesin */ }
}

function safeJson(v) {
  try { return JSON.stringify(v); } catch (_) { return String(v); }
}

function install() {
  if (installed) return;
  installed = true;
  const origLog = console.log.bind(console);
  const origErr = console.error.bind(console);
  const origWarn = console.warn.bind(console);
  console.log = (...a) => { origLog(...a); write('INFO', a); };
  console.error = (...a) => { origErr(...a); write('ERROR', a); };
  console.warn = (...a) => { origWarn(...a); write('WARN', a); };

  process.on('uncaughtException', (err) => {
    write('FATAL', ['uncaughtException', err.stack || err.message || String(err)]);
  });
  process.on('unhandledRejection', (reason) => {
    write('FATAL', ['unhandledRejection', reason && reason.stack ? reason.stack : String(reason)]);
  });
}

module.exports = { install, LOG_FILE, LOGS_DIR };
