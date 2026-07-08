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
    // Metindeki bilinen marka adlarini aktif markaya cevir (uzun once).
    function swap(str) {
      if (!str) return str;
      if (str.indexOf('{brand}') >= 0) return str.replace(/\{brand\}/g, b.name);
      REPL.forEach(function (p) {
        if (p[1] && str.indexOf(p[0]) >= 0) str = str.split(p[0]).join(p[1]);
      });
      return str;
    }

    // Baslik
    document.title = swap(document.title);

    // Gorunur marka etiketleri — HTML'de sabit yazan "Sakura/Alkyone" metinlerini
    // (giris logolari, ust bar basliklari, karsilama) aktif markaya cevir. Yalnizca
    // tek metin dugumu iceren, marka gostermeye ayrilmis elemanlar hedeflenir.
    var BRAND_SELECTORS = '.pin-logo, .logo, .header-logo, .success-sub, .app-title, [data-brand-text]';
    document.querySelectorAll(BRAND_SELECTORS).forEach(function (el) {
      if (el.children.length === 0) {
        var t = swap(el.textContent);
        if (t !== el.textContent) el.textContent = t;
      }
    });
    // index.html gibi baslik ekranlarindaki h1
    document.querySelectorAll('h1').forEach(function (el) {
      if (el.children.length === 0) {
        var t = swap(el.textContent);
        if (t !== el.textContent) el.textContent = t;
      }
    });

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

  // ===== Guncelleme bildirim banner'i =====
  // /api/version posUpdateAvailable=true ise (GitHub'da daha yeni surum var)
  // ust tarafta bir cubuk gosterir. Launcher/setup sayfalarinda gosterilmez.
  function showUpdateBanner(v) {
    if (document.getElementById('pos-update-banner')) return;
    if (sessionStorage.getItem('updBannerDismissed_' + v.latestPosVersion)) return;
    var bar = document.createElement('div');
    bar.id = 'pos-update-banner';
    bar.setAttribute('style',
      'position:fixed;top:0;left:0;right:0;z-index:99999;background:var(--brand-primary,#7C5CFF);' +
      'color:#fff;padding:8px 14px;font:14px/1.4 system-ui,sans-serif;display:flex;align-items:center;' +
      'gap:10px;box-shadow:0 2px 10px rgba(0,0,0,.35)');
    var msg = document.createElement('span');
    msg.style.flex = '1';
    msg.innerHTML = '⬆ Yeni surum mevcut: <b>v' + v.latestPosVersion +
      '</b> — guncelleme hazir, uygulama yeniden baslatildiginda kurulacak.';
    var close = document.createElement('button');
    close.textContent = 'Kapat';
    close.setAttribute('style',
      'background:rgba(255,255,255,.2);color:#fff;border:1px solid rgba(255,255,255,.5);' +
      'border-radius:6px;padding:4px 10px;cursor:pointer;font-size:13px');
    close.onclick = function () {
      sessionStorage.setItem('updBannerDismissed_' + v.latestPosVersion, '1');
      bar.remove();
    };
    bar.appendChild(msg);
    bar.appendChild(close);
    (document.body || document.documentElement).appendChild(bar);
  }

  function checkUpdate() {
    var p = location.pathname;
    if (p.indexOf('launcher') >= 0 || p.indexOf('setup') >= 0) return;
    fetch('/api/version').then(function (r) { return r.json(); }).then(function (v) {
      if (v && v.posUpdateAvailable && v.latestPosVersion) showUpdateBanner(v);
    }).catch(function () {});
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkUpdate);
  } else { checkUpdate(); }
})();
