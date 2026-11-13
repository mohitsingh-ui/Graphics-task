# Rosier portal — Android apps

Two tiny apps that open the portal in Chrome (so company Google login works):

- **Rosier Graphics** (team) — opens the internal web app link.
- **Rosier Creative Request** (requesters) — opens the public form link.

Build: GitHub → Actions → **Build Android app** → Run workflow → paste link(s) → Run.
Download: open the finished run → Artifacts → `Rosier-Portal-APKs` → unzip.

Portal updates appear in the app automatically; rebuild only to change the link, name or icon.
`app/rosier-portal.keystore` signs every build with the same key so new APKs install over old ones — keep the repo private.
