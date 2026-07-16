# Fork: LOD Metrics (`ignore_dimensions`)

This fork of [lightdash/lightdash](https://github.com/lightdash/lightdash) adds
Level-of-Detail metrics — an `ignore_dimensions` property on YAML metric
definitions (see lightdash/lightdash#16181). Design doc: `FORK-DESIGN.md`.

## Base version

- Upstream release tag: `0.3388.0`
- Fork repo: `bt-gerard/lightdash` (may move into the `playvalve` org later)
- Deploy branch: `lod-metrics`. Local remotes: `origin` = fork, `upstream` = official.

## What this fork changes vs upstream

New files (no upstream conflicts possible):
- `packages/backend/src/utils/QueryBuilder/lodCtes.ts` (+ `lodCtes.test.ts`)
- `packages/backend/src/utils/QueryBuilder/metricQueryBuilderSnapshots/lodQueries.test.ts` (+ snapshot)
- `FORK.md`, `FORK-DESIGN.md`, `cloudbuild.yaml`

Modified upstream files — every touched hunk is marked `// FORK: LOD`
(`grep -rn "FORK: LOD" packages/` lists the full diff surface):
- `packages/common/src/types/dbt.ts` — `ignore_dimensions` YAML property + converter copy-through
- `packages/common/src/types/field.ts` — `ignoreDimensions` on `Metric`, `compiledIgnoreDimensions` on compiled properties
- `packages/common/src/dbt/schemas/lightdashMetadata.json` — schema property
- `packages/common/src/schemas/json/lightdash-dbt-2.0.json` — schema property (all 3 metric blocks)
- `packages/common/src/compiler/exploreCompiler.ts` — resolution + validation (LOD-local `merge()` aggregation detection)
- `packages/common/src/compiler/translator.test.ts`, `exploreCompiler.test.ts` — tests
- `packages/backend/src/utils/QueryBuilder/MetricQueryBuilder.ts` — 3 insertion points + interaction guards
- `packages/backend/src/generated/*` — regenerated (`pnpm generate-api`)

## Feature gate

`LIGHTDASH_LOD_METRICS_ENABLED=true` (set on the Cloud Run service). Unset or
any other value → upstream behavior, byte-identical SQL (snapshot-asserted).

## v1 limitations (all fail loudly with ParameterError, never wrong SQL)

- LOD + period-over-period, LOD + `sum_distinct`/`average_distinct`,
  LOD + nested-aggregate references, LOD + custom dimensions,
  LOD on explores with metric-inflating (fanout) joins: unsupported.
- Row set is unchanged (no sparse-grid densification) — LOD fixes values on
  existing rows.
- LOD metrics must be dedup-aware aggregates (e.g. `hll_count.merge`) when the
  underlying value repeats across rows; a plain `SUM` re-adds repeated values.

## Image build & deploy

Cloud Build trigger on push to `lod-metrics` runs `cloudbuild.yaml`, pushing
`us-central1-docker.pkg.dev/playvalve-data-dev/lightdash/lightdash:<UPSTREAM_TAG>-lod.<n>`
(also tagged with the git SHA). Bump `_LOD_SUFFIX` in `cloudbuild.yaml` when
releasing. Deploys to the Cloud Run service **`lightdash-fork`**
(us-central1) — a separate service from `lightdash-test`, with
`LIGHTDASH_LOD_METRICS_ENABLED=true`.

## Upstream sync runbook (manual, on demand)

1. `git fetch upstream --tags`
2. `git checkout lod-metrics && git merge <new-release-tag>`
3. Resolve conflicts — expected surface is only the `// FORK: LOD` hunks
   (find them: `grep -rn "FORK: LOD" packages/`)
4. `pnpm install && pnpm -F common test && pnpm -F backend test`
   — the LOD snapshot suite includes flag-off byte-identity coverage, so an
   upstream change that alters base SQL shows up as a snapshot diff to review
5. `pnpm generate-api` if upstream changed controllers/types
6. Update the base version here and `_UPSTREAM_TAG` in `cloudbuild.yaml`;
   reset `_LOD_SUFFIX` to 1
7. Push, let Cloud Build build, deploy, smoke-test an LOD chart

## Verification

**2026-07-16 — Postgres (local dev stack), end-to-end through the real API** with
`LIGHTDASH_LOD_METRICS_ENABLED=true` and the `lod_sales` fixture model
(12 customers: 10 North / 2 South; purchases: A←n1,n2,n3,s1; B←n4,n5):

- Grouped by `product_name`: A → 4/12 = 33.33% ✓, B → 4/**12** = 16.67% ✓
  (upstream computes B as 2/10 = 20% — the bug in lightdash#16181).
- Grouped by `product_name` + `region`: A/North 3/10 = 30% ✓,
  A/South 1/2 = 50% ✓, B/North 2/10 = 20% ✓.
- Compiled SQL confirmed: `lod_1` grouped by surviving dims only, null-safe
  LEFT JOIN back, derived `pct` reads CTE columns (never re-aggregates).

BigQuery (production dialect) verification pending — planned against the
`lightdash-fork` Cloud Run service or a BQ-connected dev project.
