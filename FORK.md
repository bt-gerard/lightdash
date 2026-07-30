# Fork: LOD Metrics (`ignore_dimensions`)

This fork of [lightdash/lightdash](https://github.com/lightdash/lightdash) adds
Level-of-Detail metrics — an `ignore_dimensions` property on YAML metric
definitions (see lightdash/lightdash#16181). Design doc: `FORK-DESIGN.md`.

## Base version

- Upstream release tag: `0.3443.0`
- Fork repo: `bt-gerard/lightdash` (may move into the `playvalve` org later)
- Deploy branch: `lod-metrics`. Local remotes: `origin` = fork, `upstream` = official.

## What this fork changes vs upstream

New files (no upstream conflicts possible):
- `packages/backend/src/utils/QueryBuilder/lodCtes.ts` (+ `lodCtes.test.ts`)
- `packages/backend/src/utils/QueryBuilder/metricQueryBuilderSnapshots/lodQueries.test.ts` (+ snapshot)
- `examples/full-jaffle-shop-demo/dbt/models/lod_sales.{sql,yml}` — verification fixture (LOD demo model + metadata)
- `FORK.md`, `FORK-DESIGN.md`, `cloudbuild.yaml`

Modified files — every touched hunk in upstream *source* is marked `// FORK: LOD`
(`grep -rn "FORK: LOD" packages/` lists that diff surface). Some touched files
can't carry inline markers: the JSON schemas have no comment syntax and the
`packages/backend/src/generated/*` files are regenerated wholesale. Dev-only
tooling (e.g. `scripts/dev-fast-start.sh`) is also excluded from the marker
convention — its hunks are unmarked because it never ships upstream.
- `packages/common/src/types/dbt.ts` — `ignore_dimensions` YAML property + converter copy-through
- `packages/common/src/types/field.ts` — `ignoreDimensions` on `Metric`, `compiledIgnoreDimensions` on compiled properties
- `packages/common/src/dbt/schemas/lightdashMetadata.json` — schema property (no comment syntax; unmarked)
- `packages/common/src/schemas/json/lightdash-dbt-2.0.json` — schema property, all 3 metric blocks (no comment syntax; unmarked)
- `packages/common/src/compiler/exploreCompiler.ts` — resolution + validation (LOD-local `merge()` aggregation detection)
- `packages/common/src/compiler/translator.test.ts`, `exploreCompiler.test.ts` — tests
- `packages/backend/src/utils/QueryBuilder/MetricQueryBuilder.ts` — 3 insertion points + interaction guards
- `packages/backend/src/generated/*` — regenerated wholesale (`pnpm generate-api`; unmarked)
- `scripts/dev-fast-start.sh` — dev-tooling hardening, unmarked (dev-only, never upstreamed)

## Feature gate

`LIGHTDASH_LOD_METRICS_ENABLED=true` (set on the Cloud Run service). Unset or any other value → upstream behavior, byte-identical SQL (snapshot-asserted). **Flag-off semantics.** With the flag off, a metric that declares `ignore_dimensions` still compiles and runs — it just silently computes at the query's full grain, exactly like upstream. This is intentional: the flag is a kill switch, not a validator. Compile-time validation of `ignore_dimensions` (unknown field, disallowed metric kind, disallowed combinations) still applies regardless of the flag, so a broken definition surfaces its `CompileError` whether or not LOD SQL generation is enabled. ## v1 limitations (unsupported combinations fail loudly; inflation matches upstream) LOD + period-over-period, LOD + `sum_distinct`/`average_distinct`,
- LOD metrics must be dedup-aware aggregates (e.g. `hll_count.merge`) when the
  underlying value repeats across rows; a plain `SUM` re-adds repeated values.
- LOD metrics also drop dimension filters on their ignored dimensions (see
  `FORK-DESIGN-LOD-FILTER-SCOPE.md`), which means a query combining an LOD metric
  with custom dimensions, distinct metrics or nested-aggregate references can now
  fail where it previously compiled — the metric used to be inert when its ignored
  dimension was filtered but not selected.

## CLI: point your binaries at the fork (`LIGHTDASH_CLI`)

`lightdash deploy` compiles dbt YAML into explores **client-side** (via
`@lightdash/common`) and uploads the compiled result. The published
`@lightdash/cli` on npm doesn't know `ignore_dimensions`: the YAML schemas
don't reject unknown properties, so the upstream CLI won't error — its
converter silently drops the property and the metric deploys without LOD,
computing at full grain with no warning. Anyone deploying dbt projects to the
fork service must therefore use the CLI built from this branch.

Convention: expose the fork binary through the `LIGHTDASH_CLI` env var and
invoke `$LIGHTDASH_CLI` (instead of a globally-installed `lightdash`) in
scripts and CI:

```bash
# build once from this branch (repo root); tsc --build also builds common
pnpm install && pnpm -F cli build

export LIGHTDASH_CLI="$FORK_REPO/packages/cli/dist/index.js"
"$LIGHTDASH_CLI" deploy
```

Rebuild the CLI after every upstream sync so its compiler matches the deployed
image — a version-skewed CLI reintroduces the silent-drop failure mode.

## Image build & deploy

Cloud Build trigger on push to `lod-metrics` runs `cloudbuild.yaml`, pushing
`us-central1-docker.pkg.dev/playvalve-data-dev/lightdash/lightdash:<UPSTREAM_TAG>-lod.<n>`
(also tagged with the git SHA). Bump `_LOD_SUFFIX` in `cloudbuild.yaml` when
releasing. Deploys to the Cloud Run service **`lightdash-fork`**
(us-central1) — a separate service from `lightdash-test`, with
`LIGHTDASH_LOD_METRICS_ENABLED=true`.

## Upstream sync runbook

See `FORK-OPS.md` for the full step-by-step: rebase onto the latest upstream
release tag, conflict recipes, test gates, version bump, force-push, image
build to Artifact Registry, and Cloud Run deploy/rollback.

## Verification

**2026-07-16 — Postgres (local dev stack), end-to-end through the real API** with
`LIGHTDASH_LOD_METRICS_ENABLED=true` and the `lod_sales` fixture model
(12 customers: 10 North / 2 South; purchases: A←n1,n2,n3,s1; B←n4,n5):

- Grouped by `product_name`: A → 4/12 = 33.33% ✓, B → 2/**12** = 16.67% ✓
  (upstream computes B as 2/10 = 20% — the bug in lightdash#16181).
- Grouped by `product_name` + `region`: A/North 3/10 = 30% ✓,
  A/South 1/2 = 50% ✓, B/North 2/10 = 20% ✓.
- Compiled SQL confirmed: `lod_1` grouped by surviving dims only, null-safe
  LEFT JOIN back, derived `pct` reads CTE columns (never re-aggregates).

**2026-07-17 — BigQuery (production dialect + real production data)**, via a
local project connected to `playvalve-gemini` (fusebox love_island, target
prod): LOD metrics defined directly on the pre-cross-join
`fct_taxonomy_economy_agg_safeguard` table (`hll_count.merge(unique_users)`
with `ignore_dimensions` = all 16 event/taxonomy dims) reproduce the
cross-joined `mart_taxonomy_economy_agg_view` (agg_level=0) **byte-identically
on every existing dimension combination** — same HLL DAU denominators, spend
counts, and `% Active Users Spending` — for both grand (item_category) and
subset (platform × item_category) grains on 2026-07-14 data. Only designed
difference: the cross join additionally emits synthetic zero-rows for missing
combinations (v1 has no densification). This validates replacing the
~216M-rows/day cross-joined cubes with query-time LOD CTEs.

**2026-07-30 — Postgres (local dev stack), end-to-end through the real API**, on
branch `lod-filter-scope` with `LIGHTDASH_LOD_METRICS_ENABLED=true` and the
`lod_sales` fixture. Verifies the filter-scope change (see
`FORK-DESIGN-LOD-FILTER-SCOPE.md`), where `ignore_dimensions` now also drops
dimension filters on the ignored dimensions inside the LOD CTE.

- **No regression on the 2026-07-16 numbers.** Grouped by `product_name`:
  A → 4/12 = 33.33% ✓, B → 2/**12** = 16.67% ✓. Grouped by
  `product_name` + `region`: A/North 3/10 = 30% ✓, A/South 1/2 = 50% ✓,
  B/North 2/10 = 20% ✓. Non-purchasing customers surface as `product_name`
  NULL rows carrying the correct grain-level denominators (12; 10/2).
- **Filter-only activation (the new behaviour).** Grouped by `region` with a
  filter `product_name = 'Product A'` — `product_name` is ignored by
  `total_customers` and is NOT selected: North 3/**10** = 30%, South 1/**2**
  = 50%. Under the previous semantics both rows would have read 100%
  (3/3 and 1/1), because the filter reached the denominator.
- **Compiled SQL confirmed.** `lod_base` keeps
  `WHERE (("lod_sales".product_name) IN ('Product A'))`; `lod_1` has **no
  WHERE clause at all** (sole filter pruned, tree collapsed) and groups by
  `region` — the same grain as the main query, since activation was
  filter-only rather than grain-driven. Null-safe LEFT JOIN back on `region`.

Not covered by this entry: BigQuery. The reach case (denominator 149,092 vs
73,301) and the taxonomy-cube regression still need a BigQuery project with an
LOD explore deployed by a CLI built from this branch.
