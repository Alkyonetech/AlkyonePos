/**
 * Jenerik marka uygulayici — her sayfa bunu yukler, isim/logo/renk aktif markadan
 * gelir. Hicbir HTML'de marka ismi sabit kalmasin diye:
 *   - document.title icindeki {brand} yer tutucusu veya bilinen marka adlari degisir
 *   - [data-brand="name|short|tagline"] -> metin
 *   - [data-brand-logo] <img> -> logo src
 *   - CSS degiskenleri: --brand-primary/--brand-accent/--brand-bg
 *   - window.BRAND ve 'brand:ready' event
 */
(function () {
  function apply(b) {
    // Uzun ad (marka POS) -> name; kisa ad -> shortName. Uzun once (sira onemli).
    var REPL = [
      ['Alkyone POS', b.name], ['Sakura POS', b.name],
      ['Alkyone', b.shortName], ['Sakura', b.shortName],
    ];
    window.BRAND = b;
    var r = document.documentElement.style;
    if (b.colors) {
      r.setProperty('--brand-primary', b.colors.primary || '#7C5CFF');
      r.setProperty('--brand-accent', b.colors.accent || b.colors.primary || '#5CE0D8');
      r.setProperty('--brand-bg', b.colors.bg || '#0B0B14');
      r.setProperty('--brand-splash', b.colors.splashText || b.colors.primary || '#fff');
    }
    // Baslik: once {brand} yer tutucusu, sonra bilinen adlar (uzun->name, kisa->short)
    if (document.title.indexOf('{brand}') >= 0) {
      document.title = document.title.replace(/\{brand\}/g, b.name);
    } else {
      REPL.forEach(function (p) {
        if (p[1] && document.title.indexOf(p[0]) >= 0) document.title = document.title.split(p[0]).join(p[1]);
      });
    }
    document.querySelectorAll('[data-brand]').forEach(function (el) {
      var w = el.getAttribute('data-brand');
      el.textContent = w === 'short' ? b.shortName : w === 'tagline' ? b.tagline : b.name;
    });
    document.querySelectorAll('[data-brand-logo]').forEach(function (el) {
      if (el.tagName === 'IMG') el.src = b.logoUrl;
      else el.style.backgroundImage = "url('" + b.logoUrl + "')";
    });
    document.dispatchEvent(new CustomEvent('brand:ready', { detail: b }));
  }
  fetch('/api/brand').then(function (r) { return r.json(); }).then(apply).catch(function () {
    apply({ name: 'POS', shortName: 'POS', tagline: '', colors: {}, logoUrl: '/brand/logo.svg' });
  });
})();
