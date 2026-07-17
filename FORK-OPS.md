# Fork Operations Runbook

Step-by-step instructions to sync `lod-metrics` with upstream and publish a
new image to Artifact Registry. Context and design: `FORK.md`.

Expected time: ~20–30 min, mostly waiting on tests and the image build.
Frequency: weekly (or whenever you want upstream fixes).

## Prerequisites (once per machine)

- Remotes: `origin` = `bt-gerard/lightdash`, `upstream` =
  `lightdash/lightdash` (`git remote -v` to check).
- Node 20.19 via fnm and pnpm via corepack:
  ```bash
  eval "$(fnm env)" && fnm use 20.19
  ```
- `sfw` (Socket Firewall) installed: `npm i -g sfw`.
- 1Password unlocked — commits are SSH-signed and every rebased commit gets
  re-signed. If 1Password is locked, commits hang or fail.
- `gcloud` authenticated against project `playvalve-data-dev`.

## 1. Preflight

```bash
cd ~/workspace/lightdash
git checkout lod-metrics
git status --short          # must be clean; stash anything uncommitted
git stash -u                # if needed
git fetch upstream --tags
git tag --sort=-creatordate | head -1     # newest upstream release tag
```

Rebase onto the **latest release tag**, not raw `main` — upstream releases
roughly daily so the tag is at most hours behind, and it gives the image a
meaningful version. Everything below uses `$TAG`:

```bash
TAG=0.3404.0   # <- replace with the tag from above
```

Optional: preview the conflict surface without touching anything:

```bash
git merge-tree --write-tree --name-only HEAD $TAG
```

Only files under our diff surface should conflict (`grep -rn "FORK: LOD"
packages/` lists it, plus the generated files and JSON schemas which can't
carry markers).

## 2. Rebase

```bash
git rebase $TAG
```

If it completes with no conflicts, skip to step 3. Otherwise resolve each
stop with the recipes below, then:

```bash
git add <resolved files>
git rebase --continue        # repeat until "Successfully rebased"
```

**Orientation gotcha:** during a rebase the sides are inverted vs a merge —
`--ours` = the upstream base you're rebasing onto, `--theirs` = your fork
commit being replayed.

### Recipe A — source or test files

Keep upstream's surrounding changes and re-apply only our marked additions
(the `// FORK: LOD` hunks). Typical case: upstream added/removed code right
where we appended ours. If upstream *deleted* a block we appended after
(happened with the warehouse-column tests in `translator.test.ts`), keep the
deletion and keep only our block.

### Recipe B — generated files (`packages/backend/src/generated/*`)

Never hand-merge these. Take the upstream side and regenerate:

```bash
git checkout --ours packages/backend/src/generated/swagger.json
CYPRESS_INSTALL_BINARY=0 sfw pnpm install --frozen-lockfile
pnpm generate-api
# sanity check: diff vs upstream must be ONLY our fields
git diff $TAG --stat -- packages/backend/src/generated/
git add packages/backend/src/generated/
git rebase --continue
```

The diff should be ~20 lines (`ignoreDimensions` / `compiledIgnoreDimensions`).
Anything else means regeneration picked up an unrelated local change — stop
and investigate.

### Bail out

If a conflict looks like a real upstream refactor of the query builder (not
a positional clash), abort and treat it as development work, not a sync:

```bash
git rebase --abort
```

The branch is untouched after an abort.

## 3. Reinstall dependencies

Upstream moves the lockfile almost every release. Even if the rebase had no
conflicts:

```bash
CYPRESS_INSTALL_BINARY=0 sfw pnpm install --frozen-lockfile
pnpm generate-api
git status --short   # if generated files changed, commit: "chore: regenerate api spec"
```

(`CYPRESS_INSTALL_BINARY=0` skips the Cypress binary download, which fails
behind sfw's proxy and isn't needed for the sync.)

## 4. Verify

All four gates must pass. No green, no push — ever.

```bash
pnpm -F common test && pnpm -F common typecheck:fast
pnpm -F backend test && pnpm -F backend typecheck:fast
```

Snapshot policy when the backend suite reports snapshot diffs:

- **Flag-off byte-identity snapshots** (`lodQueries.test.ts`, flag-off cases):
  these assert "our SQL == upstream SQL when LOD is disabled". If upstream
  intentionally changed base SQL generation, re-record (`pnpm -F backend test
  -- -u`) and eyeball the diff — it should mirror an upstream change you can
  point at in their changelog.
- **LOD snapshots** (flag-on cases): a diff means *our feature's output
  changed*. Do not blind-update — review the SQL, understand why, fix or
  consciously accept.

## 5. Bump base version references

```bash
# FORK.md      -> "Upstream release tag: `<TAG>`"
# cloudbuild.yaml -> _UPSTREAM_TAG: '<TAG>'  and reset  _LOD_SUFFIX: '1'
git add FORK.md cloudbuild.yaml
git commit -m "chore: bump fork base to $TAG"
```

(`_LOD_SUFFIX` only increments when re-releasing on the *same* upstream tag,
e.g. after a fork-side hotfix.)

## 6. Push

A rebase rewrites history, so this must be a force push:

```bash
git push --force-with-lease origin lod-metrics
```

`--force-with-lease` refuses to clobber the remote if someone else pushed
since your fetch. Never use plain `--force`.

## 7. Build & publish to Artifact Registry

Images land in `us-central1-docker.pkg.dev/playvalve-data-dev/lightdash/lightdash`
tagged `<TAG>-lod.<suffix>` and `<git sha>`.

**Path A — Cloud Build trigger** (once the GitHub connection is set up):
the push in step 6 triggers `cloudbuild.yaml` automatically; the trigger
maps `_GIT_SHA` to `$SHORT_SHA`. Watch it:

```bash
gcloud builds list --project playvalve-data-dev --region us-central1 --limit 3
```

**Path B — manual submit** (works today, no trigger needed). `SHORT_SHA` is
empty on manual builds, so pass `_GIT_SHA` explicitly:

```bash
gcloud builds submit \
  --project playvalve-data-dev \
  --config cloudbuild.yaml \
  --substitutions _GIT_SHA=$(git rev-parse --short HEAD) \
  .
```

The build uses BuildKit on an `E2_HIGHCPU_32` machine, ~30 min, 1 h timeout.

Confirm the image exists:

```bash
gcloud artifacts docker images list \
  us-central1-docker.pkg.dev/playvalve-data-dev/lightdash/lightdash \
  --include-tags --limit 5
```

## 8. Deploy (Cloud Run)

Target service: **`lightdash-fork`** (us-central1) with
`LIGHTDASH_LOD_METRICS_ENABLED=true`. NOTE: this service does not exist yet —
it must NOT share the database of `lightdash-test` (which serves
lightdash.bluetile.com). Once it exists:

```bash
gcloud run deploy lightdash-fork \
  --project playvalve-data-dev \
  --region us-central1 \
  --image us-central1-docker.pkg.dev/playvalve-data-dev/lightdash/lightdash:$TAG-lod.1
```

Smoke test after deploy: open an LOD chart (e.g. `% Active Users Spending`
on the economy safeguard explore) and check the compiled SQL contains
`lod_base` / `lod_1` CTEs, and that a non-LOD chart still runs.

## Rollback

- **Mid-rebase:** `git rebase --abort` — nothing changed.
- **After force-push, before deploy:** the old branch tip is in `git reflog`
  (`lod-metrics@{1}`); `git push --force-with-lease origin <old-sha>:lod-metrics`.
- **After deploy:** point Cloud Run back at the previous image tag — old
  images stay in Artifact Registry, that's the primary rollback lever. A bad
  sync never needs to be fixed under time pressure; redeploy the last good
  tag and fix the branch calmly.
