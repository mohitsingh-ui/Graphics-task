# GitHub as the source of truth

Every push to `main` runs the tests. If they pass, GitHub Actions pushes the code to Apps Script and updates **both** web apps to the new version. The links never change.

```
edit code → git push → tests run → clasp push → Public + Internal deployments updated
```

**Rule:** never edit code in the Apps Script editor. The next push overwrites it.

---

## One-time setup (about 20 minutes)

### 1. Put the code on GitHub
Create a **private** repo, then from the project folder:
```bash
git remote add origin https://github.com/YOUR-ORG/graphics-team-portal.git
git branch -M main
git push -u origin main
```
The first run will fail at the deploy step because the secrets aren't set yet. That's expected.

### 2. Create the Apps Script project (one time, from your computer)
Sign in as the **owner account** (e.g. graphics@rosierfoods.com):
```bash
npm install -g @google/clasp@2.4.2
clasp login
clasp create --type standalone --title "Graphics Team Portal" --rootDir src
clasp push
```
Then:
1. Run `clasp open` → choose **setup** → **Run** → approve permissions.
2. Go to **Deploy → New deployment → Web app**. Make the two deployments (Public = *Anyone*, Internal = *Anyone within rosierfoods.com*, both *Execute as: Me*).

### 3. Collect four values

| Secret name | Where to find it |
|---|---|
| `SCRIPT_ID` | Apps Script → ⚙ Project Settings → **Script ID** (also in your local `.clasp.json`) |
| `PUBLIC_DEPLOYMENT_ID` | Deploy → Manage deployments → the "Anyone" one → **Deployment ID** |
| `INTERNAL_DEPLOYMENT_ID` | Same, for the "within domain" one |
| `CLASPRC_JSON` | The whole contents of `~/.clasprc.json` on your computer (Windows: `C:\Users\YOU\.clasprc.json`) |

### 4. Add them to GitHub
1. In the repo, go to **Settings → Environments → New environment**. Name it `production`.
2. Under **Deployment protection rules**, optionally require your approval before each deploy.
3. In that environment, add the four values as **Environment secrets**.

### 5. Turn on Apps Script API access
The owner account must have **Google Apps Script API: On** at https://script.google.com/home/usersettings.

### 6. Test it
Make any small change, commit and push. Watch the **Actions** tab. Both steps should be green, and Manage deployments in Apps Script should show a new version on both web apps.

---

## Daily workflow
```bash
git checkout -b fix-upload-message      # optional: work on a branch
# …edit files in src/…
npm test                                # optional: run tests locally
git commit -am "Clearer upload error"
git push                                # PR → tests run; merge to main → deploys
```

## Security notes
- `CLASPRC_JSON` is a refresh token for the owner Google account. It can edit that account's Apps Script projects. Keep it safe:
  - Keep the repo **private** and limit who has write access to `main`. Use **Settings → Branches → protect `main`** and require pull requests.
  - Store it as an **environment** secret, so pull requests from forks can't read it.
  - If it leaks, open https://myaccount.google.com/permissions as the owner, remove "Google Apps Script clasp", run `clasp login` again, and update the secret.
- The workflow deletes the credentials file at the end of every run.
- No portal data is in the repo. Tasks, files and settings stay in the owner's Sheet and Drive.

## Troubleshooting
| Error in Actions | Fix |
|---|---|
| `User has not enabled the Apps Script API` | Step 5, on the owner account |
| `invalid_grant` / login errors | The token expired or was revoked. Run `clasp login` again locally and paste the new `~/.clasprc.json` into the secret |
| `Missing CLASPRC_JSON or SCRIPT_ID` | Secrets are missing, or not inside the `production` environment |
| Push works but the site doesn't change | Deployment IDs are wrong. Copy them again from Manage deployments (they start with `AKfycb…`) |
| Tests fail | The deploy is skipped on purpose. Fix the failing test shown in the log |
