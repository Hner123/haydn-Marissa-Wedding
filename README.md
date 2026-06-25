# Wedding Invitation — folder guide

- **`Wedding Invitation.html`** — the working master file. This is the one to open/edit. It is fully self-contained (the photo and all gallery images are embedded inside it — no other files are needed to view it).

- **`deploy/index.html`** — the file to publish. An exact copy of the master, named `index.html` so Netlify serves it at the site root.
  - **How to publish:** drag the whole `deploy` folder onto Netlify.

- **`source/couple-photo.png`** — the original hero photo (already embedded in the HTML; kept here only as the source asset).

- **`archive/`** — old timestamped backups (`backup` … `backup8`) saved while editing. Safe to delete once you're happy with the current version.
