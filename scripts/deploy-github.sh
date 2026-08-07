#!/usr/bin/env bash
# Creates the private GitHub repo, uploads the secrets from .env, and pushes.
# Secrets are read straight from .env into `gh secret set` — they are never
# written to any file in the repo.
#
#   bash scripts/deploy-github.sh [repo-name]
set -euo pipefail

REPO="${1:-ajel}"
cd "$(dirname "$0")/.."

[[ -f .env ]] || { echo "No .env found — nothing to upload."; exit 1; }

# shellcheck disable=SC1091
set -a; source .env; set +a

require() {
  [[ -n "${!1:-}" ]] || { echo "Missing $1 in .env"; exit 1; }
}
for var in ANTHROPIC_API_KEY AYRSHARE_API_KEY AZURE_STORAGE_ACCOUNT AZURE_WRITE_SAS AZURE_READ_SAS; do
  require "$var"
done

if gh repo view "$REPO" >/dev/null 2>&1; then
  echo "Repo $REPO already exists — pushing to it."
else
  echo "Creating private repo: $REPO"
  gh repo create "$REPO" --private --source=. --remote=origin \
    --description "Arabic breaking-news automation: The Spectator Index to Snapchat"
fi

# `gh secret set` needs the fully-qualified OWNER/REPO, not the bare name.
REPO_FULL="$(gh repo view "$REPO" --json nameWithOwner -q .nameWithOwner)"
echo "Uploading secrets to $REPO_FULL…"
gh secret set ANTHROPIC_API_KEY     --repo "$REPO_FULL" --body "$ANTHROPIC_API_KEY"
gh secret set AYRSHARE_API_KEY      --repo "$REPO_FULL" --body "$AYRSHARE_API_KEY"
gh secret set AZURE_STORAGE_ACCOUNT --repo "$REPO_FULL" --body "$AZURE_STORAGE_ACCOUNT"
gh secret set AZURE_CONTAINER       --repo "$REPO_FULL" --body "${AZURE_CONTAINER:-ajel-media}"
gh secret set AZURE_WRITE_SAS       --repo "$REPO_FULL" --body "$AZURE_WRITE_SAS"
gh secret set AZURE_READ_SAS        --repo "$REPO_FULL" --body "$AZURE_READ_SAS"

git push -u origin HEAD

cat <<'DONE'

Pushed. The workflow runs every 30 minutes.

IMPORTANT — do not run both schedulers at once. The Mac agent and GitHub Actions
keep separate state and would post the same story twice (and burn double quota).
Turn the local one off now that the cloud one is live:

    npm run uninstall-agent

Trigger a run by hand any time:  gh workflow run ajel.yml
Watch it:                        gh run watch
DONE
