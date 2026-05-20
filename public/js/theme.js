// Sakura tema uygulayici — tum sayfalarda body[data-theme] kurar
(function () {
  function apply(theme) {
    try {
      if (document.body) document.body.setAttribute('data-theme', theme);
      document.documentElement.setAttribute('data-theme', theme);
    } catch (_) {}
  }

  // 1) Onceki secimi anlik uygula (sakura'dan krem'e gecikme flash'i olmasin)
  try {
    const cached = localStorage.getItem('sakura_theme');
    if (cached) apply(cached);
  } catch (_) {}

  // 2) Sunucudan guncel temayi cek
  function load() {
    fetch('/api/settings', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(s => {
        if (!s) return;
        const theme = (s.ui && s.ui.theme) || 'sakura';
        try { localStorage.setItem('sakura_theme', theme); } catch (_) {}
        apply(theme);
      })
      .catch(() => {});
  }

  if (document.body) load();
  else document.addEventListener('DOMContentLoaded', load);

  // 3) Disardan tetiklenebilir (WS settings:theme event'i geldiginde POS/admin cagirir)
  window.__sakuraApplyTheme = function (theme) {
    if (!theme) return;
    try { localStorage.setItem('sakura_theme', theme); } catch (_) {}
    apply(theme);
  };
})();
