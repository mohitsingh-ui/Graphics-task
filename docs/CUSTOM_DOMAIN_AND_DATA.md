# Custom domain & data storage

## Part 1 — Using your own domain (free)

Apps Script web apps always live at a `script.google.com/macros/s/…/exec` address. Google doesn't let you point a domain straight at them. There are two free ways to put your own domain in front.

### Option A — Google Sites on a subdomain (recommended)
Example: `design.rosierfoods.com` shows the request form, with a button for team sign-in. Google Sites is included with Workspace.

1. **Allow embedding:** in the portal, go to **Settings → Portal links**, tick *Allow the request form and dashboard to be embedded*, and click **Save**.
   - Review links are never embeddable. That stops another site from tricking someone into clicking Approve.
2. **Build the site:** go to https://sites.google.com, signed in as the owner account, and create a blank site.
   - **Insert → Embed → By URL:** paste the **Public** `/exec` URL and choose "Whole page". Stretch the box to full width and make it about 2,500 px tall.
   - Add a button called **Graphics team sign-in** that links to the **Internal** `/exec` URL. Set it to open in a new tab; sign-in is more reliable in its own tab than inside a frame.
3. **Publish:** click **Publish**, give the site a web address, and set *Who can view* to **Anyone** (or your organisation only, if requests come only from staff).
4. **Connect the domain:**
   1. In Sites, open **Settings → Custom domains → Start setup** and enter `design.rosierfoods.com`.
   2. Sites needs your domain verified in Workspace. It already is, since your email runs on it.
   3. Wherever your DNS is managed (Shopify, GoDaddy, Cloudflare, etc.), add:
      ```
      Type: CNAME   Name: design   Value: ghs.googlehosted.com
      ```
   4. DNS changes take anywhere from a few minutes to 24 hours to work. Google then issues the HTTPS certificate automatically.

### Option B — a simple redirect (5 minutes)
Your store is already on `rosierfoods.com`, so a redirect is the quickest route.

- **Shopify:** go to **Online Store → Navigation → URL Redirects → Create**, redirect from `/request-creative` to the Public `/exec` URL, and do the same for `/design-team` to the Internal `/exec` URL.
- **Cloudflare or another DNS host:** create a redirect rule on `design.rosierfoods.com` pointing to the `/exec` URL.

People type your short address. The browser then lands on the Google address, so the bar shows `script.google.com` once the page opens.

### What stays on Google's address
- **Review links in emails** still use the Public `/exec` URL. They carry a one-time token, so they're meant to be clicked rather than typed, and they work exactly as before.
- **External visitors:** people outside rosierfoods.com may see a small Google notice saying the app was "created by a Google Apps Script user". Google adds this and it can't be removed. Team members on your domain don't see it.

---

## Part 2 — Where data is saved

**Nothing is stored in the browser or on GitHub.** Every action is written to Google straight away.

| Data | Saved in | When |
|---|---|---|
| Requirements, tasks, assignments, comments, progress, approvals, decisions, notifications, settings, team | The database **Google Sheet** in `Graphics Team Portal/00_System/` | The moment the action succeeds. The browser only shows "Saved" after Google confirms the write. |
| Reference files, every creative version (V1, V2, …) | **Google Drive** → `01_Incoming_References/`, `02_Creative_Submissions/<year>/<task>/` | Uploaded straight to Drive during the upload |
| Final approved files | **Google Drive** → `03_Approved_Creatives/<year>/<task>/` (a separate copy) | The moment it's approved |
| Nightly database backup | **Google Drive** → `00_System/Backups/` (the latest 30 days are kept) | Every night at about 2 AM |

### Why data doesn't get lost
- **Writes are confirmed.** Each save runs under a lock and is flushed to the Sheet before the user sees success. If it fails, the user gets an error and the action isn't half-done.
- **Nothing is overwritten or deleted.**
  - New versions sit next to old ones.
  - Approvals stay on record even after a later change.
  - The portal never deletes a creative file.
- **History:** every change is logged in `TaskActivity` with who did it and when.
- **Backups, three layers deep:**
  1. Google Sheets keeps its own version history.
  2. The portal makes a nightly copy of the Sheet into Drive.
  3. Drive keeps anything moved to Trash for 30 days.
- **Restore:**
  1. Open the backup you want in `00_System/Backups`.
  2. Set it as the `SPREADSHEET_ID` script property, or copy its tabs over the live sheet.
  3. Redeploy.

  The last backup time is shown in **Settings → Database**.

### What to watch
- **Storage:** everything counts against the **owner account's** Drive storage. Check it in Google Drive → Storage. A Workspace Business Starter account has 30 GB; higher plans have more.
- **Keep the owner account alive:** if that account is ever deleted, its files go too. Use a shared account such as `graphics@rosierfoods.com` and never delete it.
- **Optional Shared Drive:** for files that should belong to the company rather than to one account, create a Shared Drive. Put its folder ID in the `ROOT_FOLDER_ID` script property **before** running `setup()`.
