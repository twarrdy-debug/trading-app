// Applies the last used theme before the first paint (written by lib/theme.ts), so the page doesn't
// flash. A file rather than an inline script, so the Content-Security-Policy can forbid inline scripts.
try {
  var t = JSON.parse(localStorage.getItem('theme') || 'null');
  if (t) {
    var r = document.documentElement;
    r.dataset.theme = t.theme === 'light' ? 'light' : 'dark';
    if (/^#[0-9a-f]{6}$/i.test(t.accent)) r.style.setProperty('--accent', t.accent);
    if (/^#[0-9a-f]{6}$/i.test(t.onAccent)) r.style.setProperty('--on-accent', t.onAccent);
  }
} catch (e) {}
