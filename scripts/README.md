This directory contains `check-playwright-version.js`. It verifies that the
worker package and Docker image use the same Playwright version.

## BrowserThing rename rollout

The release workflow publishes new images only under `browserthing`,
regardless of the current GitHub repository name. Existing packages under
`playwright-distributed` stay available without new releases. The deployment
smoke test and release check use the new image paths.

After the rename changes have been reviewed:

1. Rename the existing GitHub repository to `browserthing`. Do not create a
   replacement repository at `playwright-distributed`; GitHub needs that
   name unused to preserve redirects.
2. Update the local remote:
   `git remote set-url origin git@github.com:mbroton/browserthing.git`.
   Merge the reviewed changes and publish a new version tag through the
   release workflow.
3. Make the new GHCR server and worker packages public and confirm that both
   images can be pulled without authentication. Keep the existing packages
   under the old name available for users of previous releases.
4. Run the README quick start from an empty directory before announcing the
   rename. It must download from the new repository URL and use the new
   image paths.
