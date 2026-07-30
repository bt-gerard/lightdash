# LOD Metrics — `ignore_dimensions` also ignores filters

**Date:** 2026-07-30
**Status:** Approved, not implemented
**Amends:** `FORK-DESIGN.md` (the "Filter semantics" decision, line 45, is reversed by this document)
**Supersedes:** `FORK-DESIGN-IGNORE-FILTERS.md` — a rejected design that added a second YAML property. Deleted in the same commit as this document; it was never committed.

## Problem

`ignore_dimensions` currently controls **grain only**. Every dimension `WHERE`
filter is spliced into the LOD CTE unchanged (`lodCtes.ts:147`, fed by
`MetricQueryBuilder.ts:5476`), which is Tableau EXCLUDE semantics: filter first,
then aggregate coarser.

That makes the feature's main intended use — a population denominator — wrong
whenever the population dimension is filtered. Reach ("% of DAU performing an
action") needs the denominator to span all ad networks while the numerator is
restricted to one. Today both get the filter, so the ratio is
`engaged_in_Ogury / DAU_in_Ogury` instead of `engaged_in_Ogury / DAU`.

Verified against production BigQuery on 2026-07-29: with an `ad_network = Ogury`
filter, DAU resolves to 73,301 (Ogury's reach) where the intended denominator is
149,092 (total DAU). `ad_network` is not a partition of users — a user appears
under many networks in the same period, and per-network DAU sums to ~2M against a
true total of 149,092 — so no amount of post-processing recovers the total from
the filtered rows.

## Definition

A dimension listed in `ignore_dimensions` is removed from the LOD CTE's
`GROUP BY` **and** from its `WHERE`. Grain and scope are one knob, not two.

No YAML change. No new property. This is a semantics change to the existing
`ignore_dimensions`.

## Activation

A metric is LOD-active when an ignored dimension is selected **or** filtered.
The filtered case is new.

| Ignored dimension is… | `GROUP BY` | `WHERE` | CTE |
|---|---|---|---|
| selected + filtered | dropped | dropped | coarser **and** wider |
| selected only | dropped | — | coarser (current behaviour) |
| **filtered only** | — | dropped | **same grain, wider** ← new |
| neither | — | — | none; metric stays in the main SELECT |

Row 3 is the reach case. Consequence worth internalising: **an LOD CTE is no
longer necessarily coarser than the main query.** Filter-only activation produces
a CTE with an identical `GROUP BY` and a wider `WHERE`, joined back on every
selected dimension.

Row 4 preserves the existing no-op property: a metric declaring
`ignore_dimensions` in an explore costs nothing in queries that neither select
nor filter those dimensions, and flag-off queries stay byte-identical to
upstream.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Scope of the change | Grain and scope tied to one property | Author states the population once; no second vocabulary to learn |
| Direction | Drop-listed: only the named dimensions lose their filters | Filters on unnamed dimensions still narrow the CTE, so a date or country filter added later still applies |
| Time/date dimensions | Dropped uniformly, like any other dimension | One rule, no exceptions. Emit a query warning when a time filter is pruned |
| Ignored dimension inside an `or` group | `ParameterError` | Pruning a disjunct *narrows* the CTE — the opposite of "ignore" — and dropping the whole group silently discards unrelated conditions. Neither is a defensible widening, so fail loudly |
| Feature flag | None new; ships under `LIGHTDASH_LOD_METRICS_ENABLED` | One property, one meaning. A second flag would make the fork carry three live semantics |
| Existing LOD guards | Unchanged, deliberately widened | See "Guard blast radius" |
| YAML / schema surface | None | Nothing to add to either JSON schema; no `pnpm generate-api` |

## Non-goals

- **A second property** (`ignore_filters`) letting grain and scope be set
  independently. Rejected: the case that motivated it needs both knobs on the
  same field anyway, and a property that is silently a no-op when the field is
  selected is a trap.
- **Keeping the filter while dropping the grain.** This combination becomes
  unexpressible for a *selected* dimension. Accepted cost of one knob.
- **Per-filter UI toggles** ("this filter does not apply to metric X"). Not in
  this change.
- **Grid densification**, **FIXED/INCLUDE semantics**, **custom/additional
  metrics** — unchanged non-goals from `FORK-DESIGN.md`.

## Architecture

The entire change is in `packages/backend`. `packages/common` is untouched:
`compiledIgnoreDimensions` already carries everything needed, so there are no
type changes, no schema edits, and no OpenAPI regeneration.

### `lodCtes.ts`

| Change | Detail |
|---|---|
| `LodGroup` type | Add `ignoredFilterFieldIds: string[]` — the filtered field IDs this group's CTE must drop |
| Activation gate (`:51`) | `if (ignoredSelected.size === 0 && ignoredFiltered.size === 0) return;` |
| Group key (`:55`) | `` `${surviving.join('|')}::${[...ignoredFiltered].sort().join('|')}` `` |
| `groupLodMetrics` params | Add `filterTargetFieldIds: string[]` (from the query's dimension filter tree) and `dimensionsById` for time-grain expansion |
| `buildLodCteParts` params | Replace `dimensionFiltersSQL: string \| undefined` with `dimensionFiltersSQLByCte: Record<string, string \| undefined>`, keyed by `cteName` (`:115`, consumed at `:147`) |
| New helper | `collectFilterTargetFieldIds(group: FilterGroup \| undefined): string[]` — recursive walk collecting rule target field IDs, so the gate is unit-testable without a builder |
| New helper | `getIgnoredFilteredFieldIds(filterTargetFieldIds, compiledIgnoreDimensions, dimensionsById)` — mirror of `getIgnoredSelectedDimensionIds` (`:21`) for filter targets |

**Why the group key must change.** Metric A declares `ignore_dimensions:
[ad_network]`; metric B declares `[ad_network, country]`, with `country`
filtered but not selected. Both produce the same surviving-dimension set, so
under the current key they collapse into one CTE and metric A silently inherits
B's widened `WHERE`. This is a wrong-numbers bug introduced by the feature, not
a pre-existing one, and it is the first test to write.

**Matching filter targets to ignored dimensions** is simpler than the
period-over-period equivalent. `compiledIgnoreDimensions` holds `table.name`
references; filter rule targets hold item IDs (`table_name`). Comparison is
therefore string-level, plus one lookup in `exploreDimensions` per filter target
to expand `timeIntervalBaseDimensionName` — so `ignore_dimensions: [order_date]`
matches a filter on `order_date_month`, consistent with the grain-matching rule
in `FORK-DESIGN.md:69`. A filter targeting a custom SQL dimension can never
match an `ignore_dimensions` entry (those resolve to explore dimensions at
compile time), so unlike `isFilterOnPopComparisonTimeDimension` (`:629-688`) no
dimension resolution and no `FieldReferenceError` handling is required.

### `MetricQueryBuilder.ts`

Four marked changes, all modelled on the existing period-over-period pruner.

1. **`getDimensionsFilterGroupWithoutIgnoredFields(ignoredFieldIds, filterGroup)`**
   — structural clone of `getDimensionsFilterGroupWithoutPopTimeFilters`
   (`:690-733`): recursive reduce over the tree, collapse groups emptied by
   pruning to `undefined`. One deliberate divergence: when a matching rule is
   found inside an `or` group, throw `ParameterError` instead of pruning.

2. **`getLodDimensionsFilterSQL(ignoredFieldIds)`** — clone of
   `getPopDimensionsFilterSQL` (`:735-744`): prune the tree, then
   `buildDimensionsWhereClause(pruned)`.

3. **`getLodGroups()` (`:1498`)** — pass `collectFilterTargetFieldIds(
   compiledMetricQuery.filters.dimensions)` into `groupLodMetrics`, alongside
   the already-resolved `selectedDimensions`.

4. **LOD block (`:5471-5485`)** — build one WHERE clause per group via
   `getLodDimensionsFilterSQL(group.ignoredFilterFieldIds)` and pass the map as
   `dimensionFiltersSQLByCte`, replacing the single shared
   `dimensionsSQL.filtersSQL` at `:5476`. Push a `QueryWarning` when any pruned
   field is a time dimension; `warnings` is already in scope (`:5029`) and
   `QueryWarning` accepts a bare `{ message }` (`:5772`).

## Security and correctness guarantees

**RLS and required filters cannot be pruned.** `buildDimensionsWhereClause`
(`:1124-1170`) composes three sources, and only the middle one derives from the
tree passed in:

```ts
const allSqlFilters = [
    ...tableSqlWhereWithReplacedAttributes,  // table sqlWhere + user attributes
    ...nestedFilterWhere,                    // the passed tree  ← the only pruned input
    ...requiredFiltersWhere,                 // model requiredFilters
];
```

Both outer sources are re-derived from the explore on every call. Structural
pruning of the tree therefore cannot drop row-level security or a model's
required filters, and no denylist is needed to protect them.

**Metric-level `filters:`** live inside the metric's own compiled SQL (a
`CASE WHEN` wrapper) and move into the CTE untouched. `ignore_dimensions` does
not reach them — consistent with `FORK-DESIGN.md:129`.

**Dashboard filters** are merged into `filters.dimensions` before the builder
runs, so they prune like any other filter. This follows from the definition: a
filter is a filter regardless of origin.

**`required_filters` resurrection is intentional.**
`getNestedDimensionFilterSQLFromModelFilters` (`:1974-2034`) omits a model
required filter only when `isFilterRuleInQuery` (`:2014`) finds the user's own
filter on that dimension *in the tree it was passed*. Pruning the user's filter
flips that check, so the model's default is re-added to the LOD CTE. On a table
declaring `required_filters` over its partition column this is a useful
guardrail — the CTE gets the model's default window rather than an unbounded
scan — but the resulting denominator is scoped to the model default, not to what
the user asked for. Hence the query warning on pruned time filters. On tables
without `required_filters`, a pruned date filter does mean a full-partition
scan; that is the documented cost of naming a date dimension in
`ignore_dimensions`.

## Guard blast radius

Four existing guards key off `lodGroups.length > 0`, the codebase's definition
of "LOD activated":

| Guard | Location | Reachable in practice |
|---|---|---|
| Custom dimensions | `:1561` | **Yes** — the realistic one |
| PoP / distinct metrics | `:5405` | Rare; requires the user to combine them in one chart |
| Experimental fanout | `:5419` | Dead — the flag is not enabled in this deployment (`FORK-DESIGN.md:37`) |
| Nested-aggregate overlap | `:5434` | Rare; the LOD metric must itself be a nested-agg outer metric |

Because filter-only activation forms groups where none formed before, these
guards now fire on queries that previously compiled. Worked example: a query
selecting a custom dimension plus a metric declaring
`ignore_dimensions: [ad_network]`, filtering `ad_network = Ogury` without
selecting it. Today the metric is inert, the guard never runs, the chart works.
After this change a group forms, `:1561` throws, and the chart fails.

The error is correct — a custom dimension sits in the row grain but is
partitioned out of the CTE's `GROUP BY` (`:1535`), so the join-back would hand
every row differing only by custom-dimension value the same coarse value. That
was harmless while LOD was inert and is a wrong-numbers risk once the CTE
exists. **No guard is loosened**: trading a hard error for silently wrong
numbers is the wrong direction. The mitigations are a test per guard and a
release note.

## Edge cases

| Case | Behaviour |
|---|---|
| Ignored dimension neither selected nor filtered | Metric inert; no CTE; identical SQL to today |
| Ignored dimension filtered, not selected | CTE at the full selected grain with the filter dropped; `LEFT JOIN` on all selected dimensions |
| All selected dimensions ignored **and** all filters dropped | One-row unfiltered grand total, `CROSS JOIN` (existing path at `lodCtes.ts:160`) |
| Two metrics, same surviving dims, different ignored sets | Two separate CTEs (new group key) |
| Ignored dimension filtered inside an `or` group | `ParameterError` naming metric and field |
| Pruned filter is on a `required_filters` dimension | Model default re-applied inside the CTE; warning emitted if it is a time dimension |
| Filter targets a custom SQL dimension | Never matches an ignored dimension; filter survives into the CTE |
| Every filter pruned | `buildDimensionsWhereClause` still emits RLS / required filters, or no `WHERE` at all |
| Flag off | Byte-identical to upstream (snapshot-asserted) |

## Testing

1. **Unit — `lodCtes.test.ts`**: the four-row activation table; the
   A-ignores-`[x]` / B-ignores-`[x,y]` key collision producing two CTEs;
   `collectFilterTargetFieldIds` over nested groups; time-grain expansion of
   filter targets.
2. **Snapshots — `lodQueries.test.ts`**: filter-only activation (same grain,
   wider `WHERE`); selected + filtered; divergent ignored sets → two CTEs;
   pruned time filter (asserting both the SQL and the warning); `or`-group
   `ParameterError`; one case per guard proving it fires on filter-only
   activation; flag-off byte-identity.
3. **Integration — Postgres** (`lod_sales` fixture): re-assert the existing
   33.33% / 16.67% and 30% / 20% / 50% results are unchanged when no filter
   touches an ignored dimension, then add a filtered variant.
4. **Integration — BigQuery (reach)**: the `ad_network = Ogury` case must yield
   denominator **149,092** (not 73,301), numerator **3,651**, reach **2.45%**.
5. **Integration — BigQuery (taxonomy regression)**: the 16-ignored-dim metric
   on `fct_taxonomy_economy_agg_safeguard` with a filter on one ignored
   dimension, compared against the cross-joined cube at `agg_level=0`. The
   2026-07-17 verification (`FORK.md:96-107`) ran without such a filter, so this
   is a new data point, not a re-run. Expectation — to be confirmed, not
   assumed — is that dropping the filter moves the LOD numbers *toward* the
   cube, since `agg_level=0` DAU is all-users regardless of event.

## Phases

1. **`lodCtes.ts`**: `LodGroup` field, activation gate, group key, the two new
   helpers, per-CTE WHERE plumbing in `buildLodCteParts` + unit tests.
2. **Pruner**: `getDimensionsFilterGroupWithoutIgnoredFields`,
   `getLodDimensionsFilterSQL`, wire `getLodGroups()` and the LOD block, time
   filter warning + snapshot tests.
3. **Guards**: one test per guard for filter-only activation; release note.
4. **Verification & docs**: Postgres, both BigQuery checks; amend
   `FORK-DESIGN.md` line 45 and its filter-semantics prose; update `FORK.md`
   (v1 limitations + a verification entry).

## When this is the wrong tool

Dropping a filter costs one extra full scan of the base table per distinct
filter scope, because the CTE cannot reuse the main query's narrowed row set.
When the goal is a *numerator* restricted to a subset rather than a *denominator*
spanning one, conditional aggregation inside the metric is free by comparison —
verified on the real table:
`hll_count.merge(CASE WHEN ad_network IN (...) THEN unique_engaged_active_users_hll END)`
gives Ogury 3,651 and Ogury+Yandex 7,759 (a correct HLL union, not the 8,285
sum) with no additional scan and no effect on the denominator. Reach needs both:
conditional aggregation for the numerator, `ignore_dimensions` for the
denominator.
