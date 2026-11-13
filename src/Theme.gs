/**
 * Theme.gs — portal colour themes (Settings → Look & feel). Every page
 * includes <?!= themeCss_() ?> after the base styles, which overrides the CSS
 * variables. A custom accent colour can be layered on any theme.
 */

var THEMES = {
  rosier:   { label: 'Rosier (warm)', accent: '#a56312' },
  ocean:    { label: 'Ocean blue', accent: '#1f6fb2' },
  forest:   { label: 'Forest green', accent: '#2e6f40' },
  plum:     { label: 'Plum', accent: '#7b3f8f' },
  rose:     { label: 'Rose', accent: '#b23a5b' },
  slate:    { label: 'Slate', accent: '#3e4c59' },
  midnight: { label: 'Midnight (dark)', accent: '#e0a052', dark: true }
};

function hexRgb_(hex) { var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); if (!m) return null; var n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function mix_(rgb, to, t) { return '#' + rgb.map(function (c, i) { var v = Math.round(c + (to[i] - c) * t); return ('0' + v.toString(16)).slice(-2); }).join(''); }

/** The CSS for the current theme ('' for the default look). */
function themeCss_() {
  var s;
  try { s = settings_(); } catch (e) { return ''; }
  var themeId = s.theme, accentHex = s.accentColor;
  // A team member's own colours (Profile → Look & feel), when the leader allows it.
  if (s.allowPersonalTheme) {
    try {
      var em = activeEmail_();
      var pf = em ? dbGet_('Profiles', em) : null;
      if (pf && pf.theme && THEMES[pf.theme]) { themeId = pf.theme; accentHex = pf.accentColor || ''; }
    } catch (e) { /* fall back to the team theme */ }
  }
  var th = THEMES[themeId] || THEMES.rosier;
  var accent = hexRgb_(accentHex) || hexRgb_(th.accent);
  if (!th.dark && themeId === 'rosier' && !accentHex) return '';
  var v = {};
  if (th.dark) {
    v = { '--bg': '#131519', '--surface': '#1c1f25', '--surface-2': '#22262d', '--line': '#2f343c', '--line-strong': '#3c424c',
      '--text': '#eceae6', '--text-2': '#b7b2a9', '--text-3': '#8d887f', '--muted-soft': '#2a2e35',
      '--ok': '#5fbf87', '--ok-soft': '#1e3427', '--warn': '#e0b052', '--warn-soft': '#3a3020', '--bad': '#f07a6e', '--bad-soft': '#3d2522',
      '--info': '#7fb0ea', '--info-soft': '#1f2c3d', '--shadow': '0 1px 2px rgba(0,0,0,.4)', '--shadow-lg': '0 12px 32px rgba(0,0,0,.5)' };
    v['--accent'] = mix_(accent, [0, 0, 0], 0);
    v['--accent-ink'] = mix_(accent, [255, 255, 255], .25);
    v['--accent-soft'] = mix_(accent, [28, 31, 37], .78);
  } else {
    v['--accent'] = mix_(accent, [0, 0, 0], 0);
    v['--accent-ink'] = mix_(accent, [0, 0, 0], .25);
    v['--accent-soft'] = mix_(accent, [255, 255, 255], .88);
  }
  return '<style id="theme">:root{' + Object.keys(v).map(function (k) { return k + ':' + v[k]; }).join(';') + '}' +
    (th.dark ? 'input,select,textarea{background:var(--surface-2);color:var(--text);border-color:var(--line-strong)}' +
      '.btn{background:var(--surface-2);color:var(--text);border-color:var(--line-strong)}.btn.primary,.btn.ok{color:#111}' +
      'table.t th{background:var(--surface-2)}.modal{background:var(--surface)}' : '') + '</style>';
}

function api_listThemes() {
  return respond_(function () {
    currentUser_();
    return Object.keys(THEMES).map(function (k) { return { id: k, label: THEMES[k].label, accent: THEMES[k].accent, dark: !!THEMES[k].dark }; });
  });
}
