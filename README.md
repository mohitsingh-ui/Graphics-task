# Graphics Team Portal

A requirement-to-approval portal for an in-house graphics team. It is built entirely on Google: **Apps Script** runs the backend, **Google Sheets** stores the data, **Google Drive** stores the files, and **Google Workspace sign-in** handles team login.

- **Requesters** raise a brief through a public form. They don't need a login.
- **The team leader** reviews incoming briefs, assigns them, tracks workload, manages approvals, and runs reports.
- **Designers** sign in and see only their own tasks. They upload versions and send them for approval.
- **Reviewers** approve a creative or request changes through a secure link. They don't need a login, and they never see who designed it.

## Repository layout

```
src/                     ← everything that gets pushed to Apps Script
  appsscript.json        manifest (scopes, time zone, V8)
  Code.gs                doGet router: form / review / app
  Config.gs              schema, statuses, transitions, default settings
  Util.gs                errors, API wrapper, ids, validation
  Db.gs                  Sheets table layer + script lock
  Auth.gs                identity + role checks (server-side)
  Drive.gs               folders, resumable uploads, previews
  Setup.gs               setup(), triggers, admin recovery
  Requirements.gs        public intake API
  Tasks.gs               workflow engine, dashboards, task detail
  Uploads.gs             chunked uploads, version creation, file access
  Approvals.gs           submit for approval, review tokens, decisions
  Review.gs              public review page API
  Notifications.gs       audit log, in-app + email notifications
  Reports.gs             analytics + CSV export
  Admin.gs               team, settings, hourly maintenance
  Styles.html, Common.js.html          shared UI
  Form.html, Review.html, NoAccess.html  public pages
  App.html + AppCore/AppViews/AppTask/AppAdmin.js.html  team app
test/                    ← local tests only (never deployed)
  gas-mock.js            in-memory stand-ins for Google services
  scenarios.test.js      the 12 acceptance scenarios + security checks
  ui-harness.js, ui.test.js   headless-browser walkthrough + responsive checks
docs/DEPLOYMENT.md       setup, deployment, onboarding, backup, troubleshooting
docs/GITHUB_DEPLOY.md    GitHub as source of truth: auto test + deploy on push
.github/workflows/       CI: tests on every PR, deploy to Apps Script on main
```

## Quick start

**Code lives in GitHub.** Pushing to `main` tests and deploys automatically. See [docs/GITHUB_DEPLOY.md](docs/GITHUB_DEPLOY.md). Don't edit code in the Apps Script editor.

Full instructions are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

1. Create an Apps Script project from the account that will own the portal. A shared account such as `graphics@yourdomain` is best.
2. Push `src/` to the project with `clasp push`, or paste the files in by hand.
3. Run `setup()` once from the editor. This creates the Sheet, the Drive folders, the first team leader, and the hourly trigger.
4. Deploy twice:
   - **Public** — *Execute as: Me*, *Who has access: Anyone*
   - **Internal** — *Execute as: Me*, *Who has access: Anyone within your domain*
5. Paste both `/exec` URLs into **Settings → Portal links**.

## Running the tests

```
npm test            # backend acceptance scenarios (Node 18+)
npm run test:ui     # browser walkthrough (needs Playwright + Chromium)
```

The tests load the real `src/*.gs` files and run them against in-memory stand-ins for Sheets, Drive, Cache, Mail, and the Drive upload API. They check that the logic is correct. They do **not** replace a test on a real deployment; see the testing checklist in the deployment guide.
