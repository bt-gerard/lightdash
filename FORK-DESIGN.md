# LOD Metrics (`ignore_dimensions`) — Design

**Date:** 2026-07-16
**Reference:** [lightdash/lightdash#16181](https://github.com/lightdash/lightdash/issues/16181) — specifically the `ignore_dimensions` proposal by pv-judit in the issue thread.
**Context:** Upstream is not accepting external PRs for this right now, so this ships in a maintained fork deployed to Cloud Run. The implementation must remain upstream-PR-ready in case that changes.

## Problem

Lightdash computes every metric at the query's full dimension grain (one GROUP BY for all metrics). Ratio metrics whose denominator conceptually lives at a coarser grain produce wrong results on sparse data: rows missing from the fact table silently drop their contribution to the denominator.

Worked example (from the issue). Base table `sales_w_total_customers` (sparse — no Product B + South row):

| product_name | region | customers_purchasing | total_customers |
|---|---|---|---|
| Product A | North | 3 | 10 |
| Product B | North | 2 | 10 |
| Product A | South | 1 | 2 |

Query grouped by `product_name` only, `pct = customers_purchasing / total_customers`:

- Today: Product B → 2 / **10 = 20% (wrong)** — South's 2 customers are lost because no B+South row exists.
- With LOD (`total_customers` has `ignore_dimensions: [product_name]`): Product B → 2 / **12 = 16.67% (correct)** — the denominator is computed in its own CTE without grouping by product.

## Goals

- `ignore_dimensions` on YAML-defined metrics (model-level and column-level): compute the metric in a CTE grouped by (selected dimensions − ignored dimensions), joined back to the main query.
- Correct on BigQuery with non-reaggregatable aggregates (`hll_count.merge`, count distinct) — the primary production use case.
- Dialect-portable SQL (CTE text + dialect-abstracted quoting/null-safe joins), snapshot-tested on all supported warehouses.
- Minimal, clearly-marked diff against upstream to keep fork syncs cheap and a future upstream PR viable.

## Non-goals (v1)

- **Grid densification**: manufacturing missing dimension combinations (e.g. a Product B + South = 0% row). Row set is unchanged from today. Possible v2 as an opt-in per-metric flag.
- **FIXED / INCLUDE semantics** (Tableau-style fixed-grain expressions such as `FIXED claim_id: MIN_BY(...)`). Only EXCLUDE semantics ship.
- **Custom/additional metrics UI** (`AdditionalMetric`): YAML-only in v1.
- **Combination with `distinct_keys` or period-over-period metrics** on the same metric: compile error in v1.
- **Interaction with upstream's experimental fanout CTEs**: LOD metrics are excluded from that path; documented limitation (the flag is not used in our deployment).
- **MetricFlow** path: untouched.

## Decisions (settled during design)

| Decision | Choice |
|---|---|
| Scope | Exactly the issue's `ignore_dimensions` proposal (EXCLUDE semantics), joins allowed |
| Filter semantics | Filters on ignored dimensions are dropped inside the LOD CTE; all other filters apply. See `FORK-DESIGN-LOD-FILTER-SCOPE.md` |
| Join-back / row set | Main query drives; LEFT JOIN LOD CTE on surviving dims, CROSS JOIN when none survive. No densification |
| Time dimensions | Base dimension name in `ignore_dimensions` matches ALL its granularity variants; exact grain names also accepted |
| Warehouse verification | BigQuery with real data (production warehouse); other dialects via snapshots; Postgres via local stack as second check |
| Gating | Env var `LIGHTDASH_LOD_METRICS_ENABLED` read directly from `process.env` in `lodCtes.ts` (not `lightdashConfig`), default ON in the fork image; kill switch without redeploy |
| Fork CI | GCP Cloud Build trigger → Artifact Registry, images tagged `<upstream-version>-lod.<n>` |
| Upstream syncs | Manual, on demand: merge upstream release tags (not main), run test suites, rebuild |
| Upstream-PR readiness | Conventional commits, Lightdash code conventions, tests in their existing patterns, removable fork markers |

## YAML contract

```yaml
metrics:
  total_customers:
    type: number
    sql: "hll_count.merge(${customers_purchasing_hll})"
    ignore_dimensions:
      - product_name          # bare name → dimension in the metric's own table
      - orders.order_date     # table.dimension → dimension on a joined table
```

Reference resolution rules:

- Bare `dimension_name` resolves within the metric's table; `table.dimension_name` resolves across the explore.
- A base time dimension name (e.g. `order_date`) matches all its granularity fields (`order_date_day`, `order_date_month`, …). An exact grain name (e.g. `order_date_month`) matches only that grain.

## Architecture

### Layer 1 — Definition & compilation (packages/common)

All changes are additive lines in existing files:

| File | Change |
|---|---|
| `packages/common/src/types/dbt.ts` | `ignore_dimensions?: string[]` on `DbtColumnLightdashMetric`; copy through in `convertModelMetric` |
| `packages/common/src/types/field.ts` | `ignoreDimensions?: string[]` on `Metric`; `compiledIgnoreDimensions?: string[]` on compiled properties |
| `packages/common/src/dbt/schemas/lightdashMetadata.json` | property added to the metric schema |
| `packages/common/src/schemas/json/lightdash-dbt-2.0.json` | property added to all three metric blocks (column-level, model-level, explore-scoped) |
| `packages/common/src/compiler/exploreCompiler.ts` | validation + resolution in `compileMetric` (mirrors `distinctKeys` handling) |

`compileMetric` behavior:

- Resolve each entry to an existing dimension; union its `tablesReferences` into the metric's.
- Emit `compiledIgnoreDimensions` (resolved field IDs) on `CompiledMetric`.
- `CompileError` on: unknown field, reference to a metric, `ignore_dimensions` on a non-aggregate/post-calculation metric, or combined with `distinct_keys` / period-over-period. Compile errors surface in the UI like any other metric compile error; the rest of the explore keeps working.

`pnpm generate-api` regenerates the OpenAPI spec (the `Metric` type flows through TSOA responses).

### Layer 2 — SQL generation (packages/backend)

All LOD logic lives in a new module `packages/backend/src/utils/QueryBuilder/lodCtes.ts`, modeled on the period-over-period CTE pattern. `MetricQueryBuilder.ts` gets exactly three insertion points, each marked with a `// FORK: LOD` comment (markers are fork-maintenance aids, stripped if/when this is PR'd upstream):

1. **`getMetricsSQL()`**: LOD-active metrics are skipped from the main SELECT (same mechanism distinct/nested-aggregate metrics use).
2. **`compileQuery()`**: one transform step, positioned after the PoP/dedup/nested-agg CTE transforms and before the post-aggregation CTEs (metric filters, totals, table calcs).
3. **Final projection/join assembly**: LOD metric columns projected from their CTEs; join clauses appended.

**LOD-active detection:** a metric is LOD-active iff `compiledIgnoreDimensions` intersects the selected dimensions (after time-grain expansion). No intersection → the metric stays in the main SELECT untouched; non-LOD queries generate byte-identical SQL to upstream.

**CTE construction:** LOD-active metrics are grouped by surviving-dimension set (selected − ignored). One CTE per distinct set:

```sql
lod_1 AS (
  SELECT
    <surviving dimension selects, same aliases as the main query>,
    <metric aggregate SQL> AS "metric_id"
  FROM <same base table + same join tree as the main query>
  WHERE <main query's dimension filters, minus those on ignored dimensions>
  GROUP BY 1..n   -- omitted when no dimensions survive
)
```

The main query's join tree is reused verbatim. The dimension-filter SQL is
recompiled per CTE from a filter tree with the ignored dimensions' rules pruned,
so the CTE spans the full population of those dimensions.

**Join-back:** main grouped query drives. `LEFT JOIN lod_1 ON <null-safe equality per surviving dimension alias>` (via `warehouseSqlBuilder.getNullSafeEqualJoinSql`, dialect-portable), or `CROSS JOIN` when no dimensions survive. Post-calculation metrics referencing an LOD metric are rewritten to the CTE column via the existing `replaceMetricReferencesWithCteReferences`. Sorting/HAVING on LOD metrics work on final projected aliases; the step sets `requiresQueryInCTE` the same way PoP does.

**Totals:** inherited for free — `TotalQueryBuilder` re-compiles through `MetricQueryBuilder` at the totals grain, so LOD totals are computed by the same CTE logic with fewer dimensions (verified by test, not assumed).

**Gating:** `LIGHTDASH_LOD_METRICS_ENABLED` is read directly from `process.env` in `lodCtes.ts` (`isLodMetricsEnabled()`), not threaded through `parseConfig.ts`/`lightdashConfig` — a deliberate choice to keep the upstream diff smaller (no config-schema surface, one self-contained module). Default ON in the fork's deploy config. OFF → legacy behavior, byte-identical SQL to upstream (snapshot-asserted).

## Error handling & edge cases

- Unknown/invalid references, disallowed metric kinds, disallowed combinations → `CompileError` at explore compile (see Layer 1).
- Dimension later removed from the model → next refresh recompiles and the metric errors with a clear message. No `ValidationService` changes needed (explore compile errors already flow into validation).
- All selected dimensions ignored → valid; one-row grand-total CTE, CROSS JOIN.
- LOD metric with metric-level `filters:` → works; the `CASE WHEN` wrapper is inside the metric's compiled SQL, which moves into the CTE untouched.
- NULL dimension values → null-safe join equality; NULL groups match their CTE row.
- Unmatched main rows (defensive; the LOD CTE's rows are normally a superset of the main query's, since pruning a filter only widens it) → LEFT JOIN leaves the LOD value NULL rather than dropping the row.
- Exception to that superset property: when a pruned filter targets a dimension carrying a model `required_filters` default, the default is re-injected into the CTE (see `FORK-DESIGN-LOD-FILTER-SCOPE.md`). If the user's filter was WIDER than that default, the CTE is narrower than the main query and the NULL above is reachable in practice, not merely defensive.
- Ignored dimension filtered but not selected → LOD activates; the CTE keeps the main query's grain and drops that filter.
- Ignored dimension filtered inside an `or` group → `ParameterError`; pruning a disjunct would narrow the CTE. This covers both a rule directly inside the `or` group and a nested subgroup that fully collapses after pruning (e.g. `A or (B and C)` where B and C both target ignored dimensions).

## Testing

1. **Unit** (`packages/common` — `exploreCompiler.test.ts`): reference resolution, time-grain matching, every `CompileError` case.
2. **Snapshots** (new `lodQueries.test.ts` under `packages/backend/src/utils/QueryBuilder/metricQueryBuilderSnapshots/`, mirroring `periodOverPeriodQueries.test.ts`): subset join-back; grand-total CROSS JOIN; derived ratio metric rewriting; filters inside the CTE; time-grain switching; sort + metric filter on an LOD metric; joined-table explore; totals path; **flag OFF → byte-identical to upstream snapshots**.
3. **Integration (BigQuery)**: dev stack + a BigQuery project with an HLL model reproducing the issue dataset; assert real numbers through the API (33% / 16.67% one-dim case; 30% / 20% / 50% two-dim case). Postgres via local docker stack as a second dialect check.
4. **Sync regression**: every upstream merge runs the full upstream snapshot suite (flag-off byte-identity) plus the LOD suite.

## Fork setup & deployment

- **Repo:** GitHub fork of `lightdash/lightdash` under the org. Local remotes: `origin` = fork, `upstream` = official. `lod-metrics` = deploy branch. Feature developed on a branch off the latest upstream **release tag**, merged to `lod-metrics`.
- **`FORK.md`** at repo root: list of files changed vs upstream, sync runbook, image/versioning convention.
- **Build:** `cloudbuild.yaml` in the fork; Cloud Build trigger on push to `lod-metrics` (plus manual runs) builds the root `dockerfile` and pushes to Artifact Registry, tagged `<upstream-version>-lod.<n>` and the git SHA. GCP resource creation (registry repo, trigger, Cloud Run repoint) requires project/region details and explicit confirmation at execution time.
- **Deploy:** repoint the Cloud Run service **`lightdash-fork`** to the Artifact Registry image with `LIGHTDASH_LOD_METRICS_ENABLED=true`. First deploy is an **unmodified** fork build to validate the pipeline; the feature image follows.
- **Sync runbook (manual, on demand):** `git fetch upstream` → merge the target release tag → resolve (expected conflict surface: the three marked insertion points) → run backend tests + both snapshot suites → build → deploy.

## Conventions (upstream-PR readiness)

- **Commits:** conventional-commit style (`feat:`, `fix:`, `docs:`, `chore:`), subject ≤ 50 chars, no attribution trailers.
- **Code:** Lightdash CLAUDE.md conventions — intentional strict types (no duck typing, `null` over optional for absent values), `assertUnreachable` for exhaustive switches, minimal comments, `JSON.parse` wrapped in try/catch, package-specific lint/typecheck commands, `pnpm generate-api` when API types change.
- **Tests:** follow existing patterns (snapshot files, mock explores) so the suite reads native to the repo.
- **Fork markers** (`// FORK: LOD`) are the only intentionally non-upstream artifact; they are grep-able (`grep -rn "FORK:"`) and trivially removable for an upstream PR.

## Implementation phases (for the plan)

1. **Fork setup**: create fork, remotes, branch off release tag, `FORK.md`, `cloudbuild.yaml`, Cloud Build trigger, Artifact Registry, deploy unmodified image to Cloud Run.
2. **Definition layer**: types, schemas, converter, compiler + unit tests, `generate-api`.
3. **SQL generation**: `lodCtes.ts`, three insertion points, config flag, snapshot tests.
4. **Verification**: BigQuery integration testing with the issue dataset, Postgres check, totals/pivot verification, deploy feature image.
