const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../utils/data');

const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
const MAX_BACKUP_HOURS = 168; // 7 gun * 24 saat

/**
 * Yedek olustur - tum data dosyalarini kopyala
 */
function createBackup() {
  if (!fs.existsSync(BACKUPS_DIR)) {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  }

  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const backupSubDir = path.join(BACKUPS_DIR, timestamp);

  fs.mkdirSync(backupSubDir, { recursive: true });

  const files = ['menu.json', 'tables.json', 'orders.json', 'settings.json'];
  for (const file of files) {
    const src = path.join(DATA_DIR, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(backupSubDir, file));
    }
  }

  console.log(`[Yedek] Olusturuldu: ${timestamp}`);
  cleanOldBackups();
}

/**
 * Eski yedekleri sil (7 gun rolling)
 */
function cleanOldBackups() {
  if (!fs.existsSync(BACKUPS_DIR)) return;

  const dirs = fs.readdirSync(BACKUPS_DIR)
    .filter(d => fs.statSync(path.join(BACKUPS_DIR, d)).isDirectory())
    .sort();

  while (dirs.length > MAX_BACKUP_HOURS) {
    const oldest = dirs.shift();
    const oldPath = path.join(BACKUPS_DIR, oldest);
    fs.rmSync(oldPath, { recursive: true, force: true });
    console.log(`[Yedek] Eski yedek silindi: ${oldest}`);
  }
}

let backupInterval = null;

/**
 * Saatlik yedek zamanlayicisini baslat
 */
function initBackupScheduler() {
  // Ilk yedegi hemen al
  createBackup();

  // Saatte bir tekrarla
  backupInterval = setInterval(createBackup, 60 * 60 * 1000);
}

/**
 * Zamanlayiciyi durdur
 */
function stopBackupScheduler() {
  if (backupInterval) {
    clearInterval(backupInterval);
    backupInterval = null;
  }
}

module.exports = {
  createBackup,
  cleanOldBackups,
  initBackupScheduler,
  stopBackupScheduler
};
