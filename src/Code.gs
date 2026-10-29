/**
 * Code.gs — web app entry point and page routing.
 *
 * The same code is deployed twice (see docs/DEPLOYMENT.md):
 *   Public   — Execute as: Me · Access: Anyone       → form + review pages
 *   Internal — Execute as: Me · Access: Anyone within your domain → dashboards
 *
 * Routes (?p=):
 *   form    — requirement form (default for anyone who isn't a team member)
 *   review  — creative review page (&t=<token>)
 *   app     — team dashboards (default for team members); &r=<route> deep link
 */

function doGet(e) {
  var p = (e && e.parameter) || {};
  var page = String(p.p || '');
  var s;
  try { s = settings_(); } catch (err) {
    return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;padding:40px">The portal isn’t set up yet. The administrator needs to run <code>setup()</code>.</p>');
  }

  if (page === 'review') {
    // The review page is never embeddable, so its Approve button can't be clickjacked.
    return render_('Review', { token: TOKEN_RE.test(String(p.t || '')) ? String(p.t) : '' }, 'Review creative · ' + s.companyName, false);
  }

  if (page === 'share') {
    return render_('Share', { token: TOKEN_RE.test(String(p.t || '')) ? String(p.t) : '' }, 'Shared task · ' + s.companyName, false);
  }

  if (page === 'batch') {
    // Never embeddable, so its Approve buttons can't be clickjacked.
    return render_('Batch', { token: TOKEN_RE.test(String(p.t || '')) ? String(p.t) : '' }, 'Review creatives · ' + s.companyName, false);
  }

  if (page === 'app' || page === '') {
    var email = activeEmail_();
    var member = email ? userByEmail_(email) : null;
    if (member && bool_(member.active)) {
      var route = String(p.r || '').replace(/[^\w\-\/]/g, '').slice(0, 80);
      // Pre-load the first screen's data into the page so it opens without extra round trips.
      var pre = { api_bootstrap: api_bootstrap(), api_getNotifications: api_getNotifications() };
      if (!route || route === 'overview') {
        if (member.role === ROLES.LEADER) pre.api_leaderDashboard = api_leaderDashboard();
        else pre.api_designerDashboard = api_designerDashboard();
      }
      return render_('App', { route: route, pre: pre }, s.portalName, s.allowEmbedding);
    }
    if (page === 'app') {
      return render_('NoAccess', { email: email, publicUrl: s.publicUrl }, s.portalName);
    }
  }
  var formBoot = {};
  if (page === 'my') formBoot.tab = 'my';
  if (page === 'my' && TOKEN_RE.test(String(p.t || ''))) formBoot.track = String(p.t);
  var who = activeEmail_();
  var tm = who ? userByEmail_(who) : null;
  if (tm && bool_(tm.active)) { formBoot.name = tm.name; formBoot.email = tm.email; formBoot.backUrl = s.internalUrl || ''; }
  return render_('Form', formBoot, 'Request a creative · ' + s.companyName, s.allowEmbedding);
}

function render_(file, boot, title, embeddable) {
  var t = HtmlService.createTemplateFromFile(file);
  // Boot data is JSON-encoded and "<" escaped so it can't break out of the script tag.
  t.bootJson = JSON.stringify(boot || {}).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, '');
  return t.evaluate()
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(embeddable ? HtmlService.XFrameOptionsMode.ALLOWALL : HtmlService.XFrameOptionsMode.DEFAULT);
}

/** Used inside templates: <?!= include_('Styles') ?> */
function include_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}
