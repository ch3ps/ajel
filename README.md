# Ajel (عاجل)

Unattended Arabic breaking-news automation: watches [The Spectator Index](https://www.thespectatorindex.com),
translates new **BREAKING** posts to formal news Arabic with Claude, renders a 1080×1920 story card
(background photo of the concerned parties, عاجل badge, translated headline), and posts it to a
Snapchat Public Profile via Zernio.

## Pipeline

```
scrape (cheerio, SSR HTML) → filter new BREAKING → translate+analyze (claude-sonnet-5, structured output)
→ pick background (Wikimedia Commons → country flag → category gradient) → render (Playwright, Tajawal font)
→ host PNG (Azure Blob) → post story (Zernio) → record state.json
```

Runs every 5 minutes via launchd. Cadence guardrails: BREAKING-tagged posts only, max 1 story per
20 minutes (`MIN_MINUTES_BETWEEN_POSTS`), posts older than 6h skipped (`MAX_ITEM_AGE_HOURS`),
first run seeds the backlog without posting.

Background-image methodology (deterministic, license-safe):
1. Wikimedia Commons search per entity — scored (photos ≥800px, portrait/official bonus, group-shot
   and logo/map/icon rejection). Skipped entirely for sensitive stories (death/crime/arrest) so a
   person's face is never paired with such headlines.
2. Country flag (public domain) for the most central country.
3. Category-themed dark gradient built into the template — never fails.

## Commands

```bash
npm run scrape          # print current BREAKING items (no side effects)
npm run once            # run the full pipeline once (respects DRY_RUN)
node test/render-test.js pact|oil|css   # render sample cards without a Claude call
npm run install-agent   # load launchd agent (every 5 min)
npm run uninstall-agent
```

## Setup

1. `cp .env.example .env` and fill in:
   - `ANTHROPIC_API_KEY` — translation/analysis.
   - Posting provider — **pending**: Zernio's Snapchat integration is "coming soon" (not usable yet).
     Options as of 2026-08: Ayrshare ($149/mo, live today) or the official Snap Public Profile API
     (free, requires Snap Business account + allowlist approval). `src/post.js` is written for the
     Zernio shape and will be swapped to the chosen provider.
   - `AZURE_STORAGE_ACCOUNT` — Zernio only accepts media URLs, so the PNG is hosted on Azure Blob.
     Existing account `stikycqa241333188` works. One-time container creation:
     ```bash
     az storage container create --account-name stikycqa241333188 --name ajel-media --public-access blob --auth-mode key
     ```
2. Test: `npm run once` with `DRY_RUN=1` — renders to `out/` without posting.
3. Go live: set `DRY_RUN=0`, run `npm run once` to verify one real post, then `npm run install-agent`.

Logs: `logs/ajel.log` (JSON lines). Dedup/cap state: `state.json` (delete it to re-seed).

Note: launchd only runs while this Mac is awake — for 24/7 coverage move the same code to a small
always-on container later.
