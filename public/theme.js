// Applied in <head> before first paint so there is no flash of the wrong theme.
(function () {
  var t = 'dark';
  try { t = JSON.parse(localStorage.getItem('iram_theme')) || 'dark'; } catch (e) {}
  document.documentElement.setAttribute('data-theme', t === 'light' ? 'light' : 'dark');
  var de = document.documentElement, np = 'left', ns = 'full';
  try { if (localStorage.getItem('iram_ui') !== '9') { localStorage.setItem('iram_navsize', 'compact'); localStorage.setItem('iram_nav', 'top'); localStorage.removeItem('iram_accent'); localStorage.setItem('iram_ui', '9'); } } catch (e) {}
  try {
    var p = localStorage.getItem('iram_nav'); if (p === 'top' || p === 'bottom') np = p;
    var z = localStorage.getItem('iram_navsize'); if (z === 'compact' || z === 'tiny') ns = 'compact';
  } catch (e) {}
  de.setAttribute('data-nav', np); de.setAttribute('data-navsize', ns);
  try {
    var a = localStorage.getItem('iram_accent'); if (a) document.documentElement.setAttribute('data-accent', a);
    if (localStorage.getItem('iram_motion') === 'off') document.documentElement.setAttribute('data-motion', 'off');
  } catch (e) {}
})();
