# Deployment & operations guide

This guide covers setup, deployment, access, onboarding, testing, backup and troubleshooting. It assumes your company uses **Google Workspace**, with team emails on your own domain.

---

## 1. How it fits together

| Piece | What it is | Where it lives |
|---|---|---|
| Backend | Google Apps Script (V8) | One script project owned by the *portal owner* account |
| Database | One Google Sheet with 14 tabs | `Graphics Team Portal/00_System/` in the owner's Drive |
| Files | Google Drive | `Graphics Team Portal/` folders, all private |
| Team sign-in | Google Workspace account | Checked against the `Users` tab on every request |
| Public pages | The same script, deployed a second time with access set to "Anyone" | Request form + review links |

### Why there are two deployments
- The **Internal** deployment is restricted to your domain. Because of that, Google tells the script who is signed in (`Session.getActiveUser()`), and the script uses that email to decide who you are.
- The **Public** deployment lets anyone open the request form and review links. On this deployment the signed-in email is blank, so every internal API refuses to run there. This holds even if someone calls the internal functions directly.

### Drive access model
- Every file is stored in the owner's Drive, and **no folder or file is ever shared publicly**.
- When a designer or reviewer needs to see a file, the server reads it (using the owner's access) and sends the image or file to the browser.
  - Large files and non-image types (PSD, AI, PDF, video) are shown using Drive's own thumbnail renderer, which the server fetches.
  - Reviewers can view or download originals up to 20 MB.
- Designers get **no** Drive access. Team leaders are added as editors on the root folder automatically, so they can manage folders.
- The owner's OAuth token is used only on the server (`UrlFetchApp`). It is never sent to a browser.

### How anonymous review stays secure
1. When a designer submits a version, the server creates a random 256-bit token.
2. Only the token's SHA-256 hash is stored, in the `ReviewTokens` tab. The raw token exists only inside the link.
3. A token covers exactly one creative version. A reviewer who holds it can see:
   - title, purpose, campaign, product, dimensions, version, submit date
   - the file itself
   - earlier feedback on that same creative

   That's all. It never exposes designer details, task IDs, internal notes, or Drive links.
4. A link stops working when any of these happens:
   - its expiry date passes (14 days by default)
   - a leader revokes it
   - a decision is made on that version (so it can't be approved twice)
   - a newer version is submitted
   - the task is cancelled or put on hold
5. A decision is written while holding a lock, and the token is re-checked inside the lock, so two people clicking at once can't both record a decision.
6. If the reviewer gives an email that belongs to the designer of that creative, the approval is refused.

---

## 2. What it costs and what limits apply

**No paid services are used.** Apps Script, Sheets, Drive and MailApp all come with Google Workspace. The limits below are set by Google and depend on your Workspace edition. Check Google's current "Apps Script quotas" page, because these numbers change.

| Limit | Typical Workspace value | Effect here |
|---|---|---|
| Emails per day (MailApp) | ~1,500 recipients | Notifications and review-link emails. In-app notifications keep working after the quota runs out. Settings shows how many emails are left today. |
| Script run time | 6 min per call | Every call here takes seconds. Uploads are sent in 4 MB pieces, so large files are fine. |
| UrlFetch calls/day | ~100,000 | Each 4 MB upload chunk uses one call. A 200 MB PSD uses about 50. |
| Simultaneous executions | ~30 | Fine for a team of ~50 people. |
| Drive storage | The owner account's quota | Every version is kept, so watch storage on the owner account. |

**Google Sheets as a database:** comfortable up to roughly 5,000–10,000 tasks and 50,000 activity rows. Each write takes a lock, so busy moments queue up and nothing gets corrupted. Users may see "The portal is busy" if many people act in the same second. If you outgrow this, archive old rows (see section 8). Don't switch databases silently.

**Not guaranteed:**
- Review links work outside your company only if the Public deployment is set to "Anyone".
  - Some Workspace admins block this. Check **Admin console → Apps → Google Workspace → Drive and Docs → Sharing settings**, and look for any policy that restricts Apps Script web app access.
  - If "Anyone" is blocked, reviewers must be in your domain.

---

## 3. One-time setup

### 3.1 Choose the owner account
Use a shared mailbox such as `graphics@yourdomain.com`, not someone's personal account. Every file, the database, and all outgoing email belong to this account. If the owner leaves the company, the portal stops working.

### 3.2 Create the script project

**Option A — clasp + GitHub (recommended)**
```bash
npm install -g @google/clasp
clasp login                       # sign in as the owner account
clasp create --type standalone --title "Graphics Team Portal" --rootDir src
clasp push
```
Commit everything except `.clasp.json` and `.clasprc.json`, which are already in `.gitignore`.

**Option B — by hand**
1. Go to script.google.com → New project.
2. For each `src/*.gs` file, create a script file with the same name (without `.gs`) and paste the contents in.
3. For each `src/*.html` file, create an HTML file with the same name (e.g. `Common.js` for `Common.js.html`) and paste the contents in.
4. Open Project Settings and tick "Show appsscript.json". Replace its contents with `src/appsscript.json`.

### 3.3 Optional Script Properties
Set these before running `setup()` if you need them. They live under **Project Settings → Script properties**.

| Property | Use |
|---|---|
| `ADMIN_EMAIL` | The first team leader. If you leave this out, the owner account becomes the leader. |
| `ROOT_FOLDER_ID` | Use an existing Drive folder (for example, in a Shared Drive) as the portal root. |
| `SPREADSHEET_ID` | Use an existing, empty spreadsheet as the database. |

Script Properties are the only place configuration IDs are kept. No passwords or secrets are stored anywhere: sign-in comes from Google, and the Drive token comes from the script's own authorisation.

### 3.4 Run setup
1. In the editor, choose the `setup` function and click **Run**.
2. Approve the permissions prompt (Sheets, Drive, external requests, send mail, triggers).
3. The log prints the database and Drive URLs.

`setup()` does the following:
- creates the 14 sheets, with text formatting and edit protection
- creates the Drive folders `00_System`, `01_Incoming_References`, `02_Creative_Submissions`, `03_Approved_Creatives`, `04_Brand_Guidelines` and `05_Exports`
- adds the first team leader
- seeds default departments
- sets your email domain
- installs the hourly maintenance trigger

It is safe to run again: it only adds what is missing.

Only the owner can run `setup()`, `installTriggers()` and `promoteAdminFromProperty()`. Calls from the web app are refused.

---

## 4. Deploying the web apps

Open **Deploy → New deployment → type: Web app**, and do this twice:

| | Public | Internal |
|---|---|---|
| Description | `public` | `internal` |
| Execute as | **Me (owner)** | **Me (owner)** |
| Who has access | **Anyone** | **Anyone within *yourdomain.com*** |
| Serves | `?` (form), `?p=review&t=…` | `?p=app` (dashboards) — also the form for non-members |

Then, signed in as a team leader, open the **Internal** URL and go to **Settings → Portal links**:
- **Public web app URL** = the Public `/exec` URL. Review links and the "copy request-form link" button use this.
- **Internal web app URL** = the Internal `/exec` URL. Notification emails link here.

Share the **Public** URL with the company as "the place to request a creative". Share the **Internal** URL only with the graphics team.

**Updating code later:** run `clasp push`, then **Deploy → Manage deployments → edit each deployment → Version: New version**. Editing an existing deployment keeps both URLs the same.

**Why "Execute as: Me" is safe:** every function a browser can call starts by checking who is signed in, and checks again before touching any task. Functions whose names end in `_` cannot be called from a browser at all. The script never sends privileged data to the client.

---

## 5. Team leader & team onboarding

1. **First leader:** this is created by `setup()`. To add more leaders, go to **Team Management → Add team member → Role: Team leader**.
2. **Designers:** go to **Team Management → Add team member**, enter their company Google email, and choose role *Designer*.
   - They get an email with the Internal link.
   - There are no passwords. They sign in with Google.
3. **Removing access:** click **Deactivate**. Access is cut off on their very next click.
   - Their open tasks stay assigned so you can reassign them. The team page shows how many need reassigning.
4. **Lost all leaders?** Set the `ADMIN_EMAIL` script property and run `promoteAdminFromProperty()` from the editor as the owner.
5. **Brand guidelines:** upload them to `04_Brand_Guidelines`.
   - Share that one file with your domain as view-only.
   - Paste the link in **Settings → Brand guidelines link**. It then appears on the request form and on every task.

---

## 6. Day-to-day workflow

```
Requester submits form ─▶ REQ-2026-0001 + task GFX-2026-0001 (New Requirement)
Leader reviews/assigns  ─▶ Assigned ─▶ (designer sets progress) In Progress
Designer uploads V1     ─▶ Draft ─▶ "Submit for approval" ─▶ Submitted for Approval
                           review link emailed to leader (+ requester if enabled)
Reviewer opens link     ─▶ Approve  ─▶ creative Approved (copy saved to 03_Approved_Creatives)
                        ─▶ Changes  ─▶ Changes Requested ─▶ designer uploads V2 ─▶ Resubmitted
All required creatives approved ─▶ Approved ─▶ Completed (automatic; can be switched off)
```

**Status rules** (also shown in Settings):
- Manual moves are made by leaders. A designer can only start work (Assigned → In Progress).
- Submitted, Changes Requested, Resubmitted and Approved are set **only by the review workflow**.
- **Completed** needs every required creative approved. A leader can override this, but only by giving a reason, which is logged.
- Setting progress to 100% never completes a task.
- Uploading a new version of an already-approved creative needs a fresh approval. The earlier approval stays on record.

---

## 7. Testing

### 7.1 Automated (local)
```bash
npm test             # 20 backend scenarios: the 12 acceptance tests + security, status rules, reassignment, reports, triggers, page rendering
npm run test:ui      # headless Chrome: form → assign → upload → review → feedback, plus no horizontal scroll at 820px and 390px
```

### 7.2 Live checklist (do this once after deploying)
1. In a private window, open the Public URL and submit a brief with a reference image. You should see a REQ ID, and a confirmation email should arrive.
2. Open the Internal URL as the leader. The brief should be in **Requirements**. Assign it to a test designer.
3. As the designer (a second account), open the Internal URL. Only that task should be visible.
   - Change `r=task/...` in the URL to another task's ID. You should get "Task not found".
4. Upload a PNG with "Send for approval" ticked. The file should appear in `02_Creative_Submissions/<year>/<task>/`.
5. Open the review link from the email in a private window on your phone.
   - You should not see a designer name.
   - Request changes.
6. As the designer, check that the feedback banner shows. Upload V2 and submit it.
7. Approve via the new link. Then reopen the old V1 link: it should say a newer version exists.
8. As the leader, use **Revoke links** on a version. Its link should now show "no longer active".
9. Check **Reports** and download the Tasks CSV.

---

## 8. Backup & recovery

- **Database:**
  - Sheets keeps version history (**File → Version history**).
  - For a scheduled backup, add a weekly time-driven trigger that copies the spreadsheet into `00_System/backups`, or take a monthly copy by hand (**File → Make a copy**).
- **Files:** every version is kept, and nothing is ever deleted by the portal. Trashed files can be restored for 30 days.
- **Restore:**
  1. Restore the Sheet from version history, or point the `SPREADSHEET_ID` script property at a restored copy.
  2. Redeploy. No code changes are needed.
- **Archiving when it gets large:**
  1. Copy the spreadsheet.
  2. In the live sheet, delete `TaskActivity` and `Notifications` rows older than a year.
  3. Keep `Tasks` and `CreativeVersions` intact; reports need them.
- **Moving to a new owner:** transfer ownership of the root folder and spreadsheet. Then create the script under the new owner (or transfer it) and run `setup()` with `ROOT_FOLDER_ID` and `SPREADSHEET_ID` set.

---

## 9. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Team member sees "hasn't been added" | They're signed in with a personal Gmail, or they haven't been added on the Team page. Use **Sign in with a different Google account**. |
| Everyone sees the request form instead of the dashboard | They opened the Public URL. Use the Internal URL. |
| "The portal isn't set up yet" | `setup()` hasn't run under the deploying account, or `SPREADSHEET_ID` points to a file the owner can't open. |
| Review link says "isn't valid" | The link was cut off when it was pasted. Create a new link from the task (**New link**). |
| Review link works inside the company but not outside | The Public deployment isn't set to "Anyone", or your Workspace policy blocks anonymous web-app access (see section 2). |
| "Something went wrong (ref ab12cd34)" | Open **Executions** in the Apps Script editor and search for the ref to see the full error. |
| "The portal is busy" | Many writes happened in the same few seconds. Retry. If it happens often, archive old rows. |
| Upload fails part-way | Usually a network drop. Retry the file. Upload sessions expire after 6 hours. |
| No preview for a PSD/AI file | Drive hasn't generated a thumbnail yet (this can take a minute), or it can't for that file. Use Download. |
| "A portal Drive folder is missing" | Someone moved or trashed it. Restore it from Trash, or run `setup()` to recreate it. **Settings → Google Drive** shows the folder health. |
| Emails stopped | The daily MailApp quota ran out (Settings shows what's left). In-app notifications still work. |
| Reminder emails never arrive | The trigger was deleted. Run `installTriggers()` from the editor. |

---

## 10. Security summary

- Roles are checked on the server for every call; the UI hides buttons too, but that is not what protects data.
- Designers asking for another designer's task get "not found", not "forbidden", so task IDs can't be probed.
- All input is validated server-side for type, length, format, allowed values and URL scheme.
- Values that would start a spreadsheet formula (`= + - @`) are escaped, both in the database and in CSV exports.
- Uploads are checked for file extension, size and file signature ("magic bytes"). Uploaded files are renamed safely.
- There is no client-side session state to steal. Review tokens are 256-bit, stored hashed, scoped to one version, expiring and revocable.
- Public endpoints are rate-limited per email/token. Bots are filtered by a hidden form field.
- Errors show users a friendly message plus a reference number; full details go only to the Apps Script execution log.
- Every assignment, upload, submission, status change, link action and decision is written to `TaskActivity` with the actor and a timestamp.
