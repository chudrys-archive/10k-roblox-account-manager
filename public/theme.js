// Applied in <head> before first paint so there is no flash of the wrong theme.
(function () {
  var t = 'dark';
  try { t = JSON.parse(localStorage.getItem('iram_theme')) || 'dark'; } catch (e) {}
  document.documentElement.setAttribute('data-theme', t === 'light' ? 'light' : 'dark');
})();
