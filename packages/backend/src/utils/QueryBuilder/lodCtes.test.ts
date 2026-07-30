import {
    DimensionType,
    FieldType,
    FilterOperator,
    MetricType,
} from '@lightdash/common';
import {
    buildLodCteParts,
    collectFilterTargetFieldIds,
    getIgnoredFilteredFieldIds,
    getIgnoredSelectedDimensionIds,
    getNonAggregateMetricsReferencingLod,
    groupLodMetrics,
} from './lodCtes';

const dim = (
    table: string,
    name: string,
    timeIntervalBaseDimensionName?: string,
) =>
    ({
        fieldType: FieldType.DIMENSION,
        type: DimensionType.STRING,
        table,
        name,
        label: name,
        tableLabel: table,
        sql: `\${TABLE}.${name}`,
        compiledSql: `"${table}".${name}`,
        tablesReferences: [table],
        hidden: false,
        ...(timeIntervalBaseDimensionName
            ? { timeIntervalBaseDimensionName }
            : {}),
    }) as never;

describe('getIgnoredSelectedDimensionIds', () => {
    it('matches exact dimension refs', () => {
        expect(
            getIgnoredSelectedDimensionIds(
                [dim('sales', 'product_name'), dim('sales', 'region')],
                ['sales.product_name'],
            ),
        ).toEqual(['sales_product_name']);
    });

    it('matches all grains of a base time dimension', () => {
        expect(
            getIgnoredSelectedDimensionIds(
                [
                    dim('sales', 'order_date_month', 'order_date'),
                    dim('sales', 'order_date_year', 'order_date'),
                    dim('sales', 'region'),
                ],
                ['sales.order_date'],
            ),
        ).toEqual(['sales_order_date_month', 'sales_order_date_year']);
    });

    it('matches an exact grain name without touching siblings', () => {
        expect(
            getIgnoredSelectedDimensionIds(
                [
                    dim('sales', 'order_date_month', 'order_date'),
                    dim('sales', 'order_date_year', 'order_date'),
                ],
                ['sales.order_date_month'],
            ),
        ).toEqual(['sales_order_date_month']);
    });

    it('returns empty when nothing intersects', () => {
        expect(
            getIgnoredSelectedDimensionIds(
                [dim('sales', 'region')],
                ['sales.product_name'],
            ),
        ).toEqual([]);
    });
});

describe('groupLodMetrics', () => {
    const metric = (name: string, ignore: string[]) => ({
        metricId: `sales_${name}`,
        metric: {
            name,
            table: 'sales',
            compiledIgnoreDimensions: ignore,
        } as never,
    });

    it('is empty when no metric intersects the selection', () => {
        expect(
            groupLodMetrics({
                selectedDimensions: [dim('sales', 'region')],
                filterTargetFieldIds: [],
                dimensionsById: {},
                metrics: [metric('m1', ['sales.product_name'])],
            }),
        ).toEqual([]);
    });

    it('groups metrics with the same surviving set into one CTE', () => {
        const groups = groupLodMetrics({
            selectedDimensions: [
                dim('sales', 'product_name'),
                dim('sales', 'region'),
            ],
            filterTargetFieldIds: [],
            dimensionsById: {},
            metrics: [
                metric('m1', ['sales.product_name']),
                metric('m2', ['sales.product_name']),
                metric('m3', ['sales.product_name', 'sales.region']),
            ],
        });
        expect(groups).toHaveLength(2);
        expect(groups[0]).toEqual({
            cteName: 'lod_1',
            survivingDimensionIds: ['sales_region'],
            ignoredFilterFieldIds: [],
            metricIds: ['sales_m1', 'sales_m2'],
        });
        expect(groups[1]).toEqual({
            cteName: 'lod_2',
            survivingDimensionIds: [],
            ignoredFilterFieldIds: [],
            metricIds: ['sales_m3'],
        });
    });

    const dimensionsById = {
        sales_region: dim('sales', 'region'),
        sales_product_name: dim('sales', 'product_name'),
        sales_country: dim('sales', 'country'),
    } as never;

    it('activates when an ignored dimension is filtered but not selected', () => {
        const groups = groupLodMetrics({
            selectedDimensions: [dim('sales', 'region')],
            filterTargetFieldIds: ['sales_product_name'],
            dimensionsById,
            metrics: [metric('m1', ['sales.product_name'])],
        });
        expect(groups).toEqual([
            {
                cteName: 'lod_1',
                survivingDimensionIds: ['sales_region'],
                ignoredFilterFieldIds: ['sales_product_name'],
                metricIds: ['sales_m1'],
            },
        ]);
    });

    it('stays inert when the ignored dimension is neither selected nor filtered', () => {
        expect(
            groupLodMetrics({
                selectedDimensions: [dim('sales', 'region')],
                filterTargetFieldIds: ['sales_country'],
                dimensionsById,
                metrics: [metric('m1', ['sales.product_name'])],
            }),
        ).toEqual([]);
    });

    // Same surviving set, different dropped filters — these must NOT share a
    // CTE, or one metric silently inherits the other's widened WHERE.
    it('separates metrics that drop different filters', () => {
        const groups = groupLodMetrics({
            selectedDimensions: [dim('sales', 'product_name')],
            filterTargetFieldIds: ['sales_country'],
            dimensionsById,
            metrics: [
                metric('m1', ['sales.product_name']),
                metric('m2', ['sales.product_name', 'sales.country']),
            ],
        });
        expect(groups).toHaveLength(2);
        expect(groups[0].ignoredFilterFieldIds).toEqual([]);
        expect(groups[0].metricIds).toEqual(['sales_m1']);
        expect(groups[1].ignoredFilterFieldIds).toEqual(['sales_country']);
        expect(groups[1].metricIds).toEqual(['sales_m2']);
        expect(groups[0].survivingDimensionIds).toEqual(
            groups[1].survivingDimensionIds,
        );
    });

    it('shares one CTE when surviving dims and dropped filters both match', () => {
        const groups = groupLodMetrics({
            selectedDimensions: [dim('sales', 'product_name')],
            filterTargetFieldIds: ['sales_country'],
            dimensionsById,
            metrics: [
                metric('m1', ['sales.product_name', 'sales.country']),
                metric('m2', ['sales.product_name', 'sales.country']),
            ],
        });
        expect(groups).toHaveLength(1);
        expect(groups[0].metricIds).toEqual(['sales_m1', 'sales_m2']);
    });
});

describe('buildLodCteParts', () => {
    const base = {
        dimensionSelects: {
            sales_product_name:
                '  "sales".product_name AS "sales_product_name"',
            sales_region: '  "sales".region AS "sales_region"',
        },
        sqlFrom: 'FROM "db"."schema"."sales" AS "sales"',
        joinParts: [],
        dimensionFiltersSQLByCte: {
            lod_1: `WHERE ( ( "sales".region ) IN ('North') )`,
        },
        metricSelects: {
            sales_total: '  hll_count.merge("sales".total) AS "sales_total"',
        },
        baseCteName: 'lod_base',
        fieldQuoteChar: '"',
        getNullSafeEqualJoinSql: (l: string, r: string) =>
            `${l} IS NOT DISTINCT FROM ${r}`,
    };

    it('builds a grouped CTE with LEFT JOIN on surviving dims', () => {
        const parts = buildLodCteParts({
            ...base,
            lodGroups: [
                {
                    cteName: 'lod_1',
                    survivingDimensionIds: ['sales_region'],
                    ignoredFilterFieldIds: [],
                    metricIds: ['sales_total'],
                },
            ],
        });
        expect(parts.ctes[0]).toContain('lod_1 AS (');
        expect(parts.ctes[0]).toContain('AS "sales_region"');
        expect(parts.ctes[0]).toContain('GROUP BY 1');
        expect(parts.ctes[0]).toContain(
            `WHERE ( ( "sales".region ) IN ('North') )`,
        );
        expect(parts.joins).toEqual([
            'LEFT JOIN lod_1 ON lod_base."sales_region" IS NOT DISTINCT FROM lod_1."sales_region"',
        ]);
        expect(parts.metricSelects).toEqual([
            '  lod_1."sales_total" AS "sales_total"',
        ]);
    });

    it('CROSS JOINs and omits GROUP BY when no dimensions survive', () => {
        const parts = buildLodCteParts({
            ...base,
            lodGroups: [
                {
                    cteName: 'lod_1',
                    survivingDimensionIds: [],
                    ignoredFilterFieldIds: [],
                    metricIds: ['sales_total'],
                },
            ],
        });
        expect(parts.ctes[0]).not.toContain('GROUP BY');
        expect(parts.joins).toEqual(['CROSS JOIN lod_1']);
    });

    it('gives each CTE its own WHERE clause', () => {
        const parts = buildLodCteParts({
            ...base,
            dimensionFiltersSQLByCte: {
                lod_1: `WHERE ( ( "sales".region ) IN ('North') )`,
                lod_2: undefined,
            },
            lodGroups: [
                {
                    cteName: 'lod_1',
                    survivingDimensionIds: ['sales_region'],
                    ignoredFilterFieldIds: [],
                    metricIds: ['sales_total'],
                },
                {
                    cteName: 'lod_2',
                    survivingDimensionIds: ['sales_region'],
                    ignoredFilterFieldIds: ['sales_country'],
                    metricIds: ['sales_total'],
                },
            ],
        });
        expect(parts.ctes[0]).toContain('WHERE');
        expect(parts.ctes[1]).not.toContain('WHERE');
    });
});

describe('getNonAggregateMetricsReferencingLod', () => {
    const totalMetricFixture = {
        fieldType: FieldType.METRIC,
        type: MetricType.SUM,
        name: 'total',
        table: 'sales',
        tableLabel: 'sales',
        label: 'total',
        sql: '${TABLE}.total',
        compiledSql: 'SUM("sales".total)',
        tablesReferences: ['sales'],
        hidden: false,
    } as never;
    const pctMetricFixture = {
        fieldType: FieldType.METRIC,
        type: MetricType.NUMBER,
        name: 'pct',
        table: 'sales',
        tableLabel: 'sales',
        label: 'pct',
        sql: '${total} * 100',
        compiledSql: 'SUM("sales".total) * 100',
        tablesReferences: ['sales'],
        hidden: false,
    } as never;
    const pct2MetricFixture = {
        fieldType: FieldType.METRIC,
        type: MetricType.NUMBER,
        name: 'pct2',
        table: 'sales',
        tableLabel: 'sales',
        label: 'pct2',
        sql: '${pct} * 2',
        compiledSql: 'SUM("sales".total) * 100 * 2',
        tablesReferences: ['sales'],
        hidden: false,
    } as never;

    it('finds direct and transitive non-aggregate referencers', () => {
        const result = getNonAggregateMetricsReferencingLod({
            allMetrics: [
                ['sales_total', totalMetricFixture],
                ['sales_pct', pctMetricFixture],
                ['sales_pct2', pct2MetricFixture],
            ],
            lodMetricIds: new Set(['sales_total']),
        });
        expect(result).toEqual(new Set(['sales_pct', 'sales_pct2']));
    });

    it('is empty when no non-aggregate metric references an LOD metric', () => {
        const result = getNonAggregateMetricsReferencingLod({
            allMetrics: [
                ['sales_total', totalMetricFixture],
                ['sales_pct', pctMetricFixture],
            ],
            lodMetricIds: new Set(['sales_other']),
        });
        expect(result).toEqual(new Set());
    });
});

describe('collectFilterTargetFieldIds', () => {
    const rule = (fieldId: string) => ({
        id: `${fieldId}-rule`,
        target: { fieldId },
        operator: FilterOperator.EQUALS,
        values: ['x'],
    });

    it('returns an empty list for no filters', () => {
        expect(collectFilterTargetFieldIds(undefined)).toEqual([]);
    });

    it('collects targets from a flat AND group', () => {
        expect(
            collectFilterTargetFieldIds({
                id: 'root',
                and: [rule('sales_region'), rule('sales_product_name')],
            } as never),
        ).toEqual(['sales_region', 'sales_product_name']);
    });

    it('collects targets from nested groups of both kinds', () => {
        expect(
            collectFilterTargetFieldIds({
                id: 'root',
                and: [
                    rule('sales_region'),
                    { id: 'nested', or: [rule('sales_product_name')] },
                ],
            } as never),
        ).toEqual(['sales_region', 'sales_product_name']);
    });
});

describe('getIgnoredFilteredFieldIds', () => {
    const dimensionsById = {
        sales_region: dim('sales', 'region'),
        sales_product_name: dim('sales', 'product_name'),
        sales_order_date_month: dim('sales', 'order_date_month', 'order_date'),
    } as never;

    it('matches an exact dimension ref', () => {
        expect(
            getIgnoredFilteredFieldIds({
                filterTargetFieldIds: ['sales_region', 'sales_product_name'],
                compiledIgnoreDimensions: ['sales.product_name'],
                dimensionsById,
            }),
        ).toEqual(['sales_product_name']);
    });

    it('matches a grain filter via the base time dimension', () => {
        expect(
            getIgnoredFilteredFieldIds({
                filterTargetFieldIds: ['sales_order_date_month'],
                compiledIgnoreDimensions: ['sales.order_date'],
                dimensionsById,
            }),
        ).toEqual(['sales_order_date_month']);
    });

    it('never matches an unknown or custom dimension target', () => {
        expect(
            getIgnoredFilteredFieldIds({
                filterTargetFieldIds: ['is_emea'],
                compiledIgnoreDimensions: ['sales.region'],
                dimensionsById,
            }),
        ).toEqual([]);
    });

    it('deduplicates a field filtered more than once', () => {
        expect(
            getIgnoredFilteredFieldIds({
                filterTargetFieldIds: ['sales_region', 'sales_region'],
                compiledIgnoreDimensions: ['sales.region'],
                dimensionsById,
            }),
        ).toEqual(['sales_region']);
    });
});
