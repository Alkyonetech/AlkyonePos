// Basit bir placeholder ikon olusturucu
// Gercek ikon daha sonra tasarlanabilir
const fs = require('fs');
const path = require('path');

// 1x1 pixel seffaf PNG (placeholder)
// Gercek uretimde tasarimci ikonu koyacak
const placeholderPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAABhSURBVFhH7c0xDQAgDETRsgBL4AMX4IMFHIAP6qAmTWd4yU3/hPsBAAAAAAD+7qnuu09sbuOk6mNi/e6TOsBaOrC2Djh1YKVP/GzgoAdO+sQ3eh4AAAAAAPAP3P0CDyUqEGs/XJwAAAAASUVORK5CYII=',
  'base64'
);

fs.writeFileSync(path.join(__dirname, 'icon.png'), placeholderPng);
console.log('Placeholder icon.png olusturuldu');
console.log('Not: Gercek .ico dosyasi icin tasarimci ikonu gerekli');
