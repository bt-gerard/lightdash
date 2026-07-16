import {
    getItemId,
    isNonAggregateMetric,
    parseAllReferences,
    type CompiledDimension,
    type CompiledMetric,
} from '@lightdash/common';

export const isLodMetricsEnabled = (): boolean =>
    process.env.LIGHTDASH_LOD_METRICS_ENABLED === 'true';

export type LodGroup = {
    cteName: string;
    survivingDimensionIds: string[];
    metricIds: string[];
};

// An ignored ref "table.name" matches a selected dimension when it IS that
// dimension, or when it is the base of that dimension's time grain
// (order_date matches order_date_month via timeIntervalBaseDimensionName).
export const getIgnoredSelectedDimensionIds = (
    selectedDimensions: CompiledDimension[],
    compiledIgnoreDimensions: string[],
): string[] => {
    const ignoredRefs = new Set(compiledIgnoreDimensions);
    return selectedDimensions
        .filter((d) => {
            if (ignoredRefs.has(`${d.table}.${d.name}`)) return true;
            return (
                d.timeIntervalBaseDimensionName !== undefined &&
                ignoredRefs.has(`${d.table}.${d.timeIntervalBaseDimensionName}`)
            );
        })
        .map((d) => getItemId({ table: d.table, name: d.name }));
};

export const groupLodMetrics = (params: {
    selectedDimensions: CompiledDimension[];
    metrics: Array<{ metricId: string; metric: CompiledMetric }>;
}): LodGroup[] => {
    const groupsByKey = new Map<string, LodGroup>();
    params.metrics.forEach(({ metricId, metric }) => {
        const ignoreDims = metric.compiledIgnoreDimensions;
        if (!ignoreDims || ignoreDims.length === 0) return;
        const ignoredSelected = new Set(
            getIgnoredSelectedDimensionIds(
                params.selectedDimensions,
                ignoreDims,
            ),
        );
        if (ignoredSelected.size === 0) return; // not LOD-active for this query
        const surviving = params.selectedDimensions
            .map((d) => getItemId({ table: d.table, name: d.name }))
            .filter((id) => !ignoredSelected.has(id));
        const key = surviving.join('|');
        const existing = groupsByKey.get(key);
        if (existing) {
            existing.metricIds.push(metricId);
        } else {
            groupsByKey.set(key, {
                cteName: `lod_${groupsByKey.size + 1}`,
                survivingDimensionIds: surviving,
                metricIds: [metricId],
            });
        }
    });
    return Array.from(groupsByKey.values());
};

// Non-aggregate metrics (e.g. pct = a / b) whose SQL templates reference an
// LOD metric, transitively (pct -> pct2 -> lod_metric). These must be computed
// in the LOD outer SELECT with their refs rewritten to CTE columns, rather than
// inlined and re-aggregated in the main SELECT (which would be wrong once the
// LOD metric moves to its own coarser-grain CTE).
export const getNonAggregateMetricsReferencingLod = (params: {
    allMetrics: Array<[string, CompiledMetric]>;
    lodMetricIds: Set<string>;
}): Set<string> => {
    const nonAggRefs = new Map<string, Set<string>>();
    for (const [metricId, metric] of params.allMetrics) {
        if (isNonAggregateMetric(metric)) {
            const refIds = new Set<string>();
            for (const ref of parseAllReferences(metric.sql, metric.table)) {
                refIds.add(
                    getItemId({ table: ref.refTable, name: ref.refName }),
                );
            }
            nonAggRefs.set(metricId, refIds);
        }
    }
    const result = new Set<string>();
    let changed = true;
    while (changed) {
        changed = false;
        for (const [metricId, refIds] of nonAggRefs) {
            if (!result.has(metricId)) {
                for (const refId of refIds) {
                    if (params.lodMetricIds.has(refId) || result.has(refId)) {
                        result.add(metricId);
                        changed = true;
                        break;
                    }
                }
            }
        }
    }
    return result;
};

export const buildLodCteParts = (params: {
    lodGroups: LodGroup[];
    dimensionSelects: Record<string, string>;
    sqlFrom: string;
    joinParts: Array<string | undefined>;
    dimensionFiltersSQL: string | undefined;
    metricSelects: Record<string, string>;
    baseCteName: string;
    fieldQuoteChar: string;
    getNullSafeEqualJoinSql: (left: string, right: string) => string;
}): { ctes: string[]; joins: string[]; metricSelects: string[] } => {
    const {
        lodGroups,
        dimensionSelects,
        sqlFrom,
        joinParts,
        dimensionFiltersSQL,
        metricSelects,
        baseCteName,
        fieldQuoteChar: q,
        getNullSafeEqualJoinSql,
    } = params;
    const ctes: string[] = [];
    const joins: string[] = [];
    const outerMetricSelects: string[] = [];

    lodGroups.forEach((group) => {
        const dimSelects = group.survivingDimensionIds.map(
            (id) => dimensionSelects[id],
        );
        const groupMetricSelects = group.metricIds.map(
            (id) => metricSelects[id],
        );
        const cteParts: Array<string | undefined> = [
            `SELECT\n${[...dimSelects, ...groupMetricSelects].join(',\n')}`,
            sqlFrom,
            ...joinParts,
            dimensionFiltersSQL,
            group.survivingDimensionIds.length > 0
                ? `GROUP BY ${group.survivingDimensionIds
                      .map((_, i) => i + 1)
                      .join(',')}`
                : undefined,
        ];
        ctes.push(
            `${group.cteName} AS (\n${cteParts
                .filter((p): p is string => p !== undefined)
                .join('\n')}\n)`,
        );

        if (group.survivingDimensionIds.length === 0) {
            joins.push(`CROSS JOIN ${group.cteName}`);
        } else {
            joins.push(
                `LEFT JOIN ${group.cteName} ON ${group.survivingDimensionIds
                    .map((id) =>
                        getNullSafeEqualJoinSql(
                            `${baseCteName}.${q}${id}${q}`,
                            `${group.cteName}.${q}${id}${q}`,
                        ),
                    )
                    .join(' AND ')}`,
            );
        }

        outerMetricSelects.push(
            ...group.metricIds.map(
                (id) => `  ${group.cteName}.${q}${id}${q} AS ${q}${id}${q}`,
            ),
        );
    });

    return { ctes, joins, metricSelects: outerMetricSelects };
};
