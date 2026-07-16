import {
    CompiledCustomSqlDimension,
    CompiledMetricQuery,
    CustomDimensionType,
    DimensionType,
    Explore,
    FieldType,
    FilterOperator,
    JoinRelationship,
    MetricType,
    SupportedDbtAdapter,
} from '@lightdash/common';
import { buildQuery } from './helpers';

const LOD_TEST_EXPLORE: Explore = {
    targetDatabase: SupportedDbtAdapter.POSTGRES,
    name: 'sales',
    label: 'sales',
    baseTable: 'sales',
    tags: [],
    joinedTables: [],
    tables: {
        sales: {
            name: 'sales',
            label: 'sales',
            database: 'postgres',
            schema: 'jaffle',
            sqlTable: '"postgres"."jaffle"."sales"',
            primaryKey: ['sale_id'],
            dimensions: {
                product_name: {
                    type: DimensionType.STRING,
                    name: 'product_name',
                    label: 'product_name',
                    table: 'sales',
                    tableLabel: 'sales',
                    fieldType: FieldType.DIMENSION,
                    sql: '${TABLE}.product_name',
                    compiledSql: '"sales".product_name',
                    tablesReferences: ['sales'],
                    hidden: false,
                },
                region: {
                    type: DimensionType.STRING,
                    name: 'region',
                    label: 'region',
                    table: 'sales',
                    tableLabel: 'sales',
                    fieldType: FieldType.DIMENSION,
                    sql: '${TABLE}.region',
                    compiledSql: '"sales".region',
                    tablesReferences: ['sales'],
                    hidden: false,
                },
            },
            metrics: {
                customers_purchasing: {
                    fieldType: FieldType.METRIC,
                    type: MetricType.SUM,
                    name: 'customers_purchasing',
                    table: 'sales',
                    tableLabel: 'sales',
                    label: 'customers purchasing',
                    sql: '${TABLE}.customers_purchasing',
                    compiledSql: 'SUM("sales".customers_purchasing)',
                    tablesReferences: ['sales'],
                    hidden: false,
                },
                total_customers: {
                    fieldType: FieldType.METRIC,
                    type: MetricType.SUM,
                    name: 'total_customers',
                    table: 'sales',
                    tableLabel: 'sales',
                    label: 'total customers',
                    sql: '${TABLE}.total_customers',
                    compiledSql: 'SUM("sales".total_customers)',
                    tablesReferences: ['sales'],
                    hidden: false,
                    ignoreDimensions: ['product_name'],
                    compiledIgnoreDimensions: ['sales.product_name'],
                },
                distinct_customers: {
                    fieldType: FieldType.METRIC,
                    type: MetricType.SUM_DISTINCT,
                    name: 'distinct_customers',
                    table: 'sales',
                    tableLabel: 'sales',
                    label: 'distinct customers',
                    sql: '${TABLE}.amount',
                    compiledSql: 'SUM("sales".amount)',
                    compiledValueSql: '"sales".amount',
                    compiledDistinctKeys: ['"sales".sale_id'],
                    tablesReferences: ['sales'],
                    hidden: false,
                },
                pct_customers_purchasing: {
                    fieldType: FieldType.METRIC,
                    type: MetricType.NUMBER,
                    name: 'pct_customers_purchasing',
                    table: 'sales',
                    tableLabel: 'sales',
                    label: 'pct',
                    sql: '(${customers_purchasing} / ${total_customers}) * 100',
                    compiledSql:
                        '(SUM("sales".customers_purchasing) / SUM("sales".total_customers)) * 100',
                    tablesReferences: ['sales'],
                    hidden: false,
                },
                pct_distinct_over_total: {
                    fieldType: FieldType.METRIC,
                    type: MetricType.NUMBER,
                    name: 'pct_distinct_over_total',
                    table: 'sales',
                    tableLabel: 'sales',
                    label: 'pct distinct over total',
                    sql: '(${distinct_customers} / ${total_customers}) * 100',
                    compiledSql:
                        '(SUM("sales".amount) / SUM("sales".total_customers)) * 100',
                    tablesReferences: ['sales'],
                    hidden: false,
                },
            },
            lineageGraph: {},
        },
    },
};

// Minimal inflating-join shape (primaryKey + one-to-many-ish join), mirroring
// the fixture in fanoutQueries.test.ts (EXPLORE / METRIC_QUERY_TWO_TABLES),
// but with an LOD metric (ignoreDimensions) added on the base table.
const LOD_FANOUT_EXPLORE: Explore = {
    targetDatabase: SupportedDbtAdapter.POSTGRES,
    name: 'table1',
    label: 'table1',
    baseTable: 'table1',
    tags: [],
    joinedTables: [
        {
            table: 'table2',
            sqlOn: '${table1.shared} = ${table2.shared}',
            compiledSqlOn: '("table1".shared) = ("table2".shared)',
            type: undefined,
            tablesReferences: ['table1', 'table2'],
            relationship: JoinRelationship.MANY_TO_ONE,
        },
    ],
    tables: {
        table1: {
            name: 'table1',
            label: 'table1',
            database: 'database',
            schema: 'schema',
            sqlTable: '"db"."schema"."table1"',
            primaryKey: ['dim1'],
            dimensions: {
                dim1: {
                    type: DimensionType.NUMBER,
                    name: 'dim1',
                    label: 'dim1',
                    table: 'table1',
                    tableLabel: 'table1',
                    fieldType: FieldType.DIMENSION,
                    sql: '${TABLE}.dim1',
                    compiledSql: '"table1".dim1',
                    tablesReferences: ['table1'],
                    hidden: false,
                },
                shared: {
                    type: DimensionType.STRING,
                    name: 'shared',
                    label: 'shared',
                    table: 'table1',
                    tableLabel: 'table1',
                    fieldType: FieldType.DIMENSION,
                    sql: '${TABLE}.shared',
                    compiledSql: '"table1".shared',
                    tablesReferences: ['table1'],
                    hidden: false,
                },
            },
            metrics: {
                metric1: {
                    type: MetricType.MAX,
                    fieldType: FieldType.METRIC,
                    table: 'table1',
                    tableLabel: 'table1',
                    name: 'metric1',
                    label: 'metric1',
                    sql: '${TABLE}.number_column',
                    compiledSql: 'MAX("table1".number_column)',
                    tablesReferences: ['table1'],
                    hidden: false,
                    ignoreDimensions: ['dim1'],
                    compiledIgnoreDimensions: ['table1.dim1'],
                },
            },
            lineageGraph: {},
        },
        table2: {
            name: 'table2',
            label: 'table2',
            database: 'database',
            schema: 'schema',
            sqlTable: '"db"."schema"."table2"',
            primaryKey: ['dim2'],
            dimensions: {
                dim2: {
                    type: DimensionType.NUMBER,
                    name: 'dim2',
                    label: 'dim2',
                    table: 'table2',
                    tableLabel: 'table2',
                    fieldType: FieldType.DIMENSION,
                    sql: '${TABLE}.dim2',
                    compiledSql: '"table2".dim2',
                    tablesReferences: ['table2'],
                    hidden: false,
                },
                shared: {
                    type: DimensionType.STRING,
                    name: 'shared',
                    label: 'shared',
                    table: 'table2',
                    tableLabel: 'table2',
                    fieldType: FieldType.DIMENSION,
                    sql: '${TABLE}.shared',
                    compiledSql: '"table2".shared',
                    tablesReferences: ['table2'],
                    hidden: false,
                },
            },
            metrics: {
                metric3: {
                    type: MetricType.SUM,
                    fieldType: FieldType.METRIC,
                    table: 'table2',
                    tableLabel: 'table2',
                    name: 'metric3',
                    label: 'metric3',
                    sql: '${TABLE}.number_column',
                    compiledSql: 'SUM("table2".number_column)',
                    tablesReferences: ['table2'],
                    hidden: false,
                },
            },
            lineageGraph: {},
        },
    },
};

// FORK: LOD — custom SQL dimension on the LOD test explore, used to prove
// custom dimensions don't crash LOD dimension resolution (getDimensionFromId
// throws for custom dimension ids since they aren't explore dimensions).
const CUSTOM_SQL_DIMENSION: CompiledCustomSqlDimension = {
    id: 'is_emea',
    name: 'Is EMEA',
    table: 'sales',
    type: CustomDimensionType.SQL,
    sql: "${sales.region} = 'EMEA'",
    dimensionType: DimensionType.BOOLEAN,
    compiledSql: '"sales".region = \'EMEA\'',
    tablesReferences: ['sales'],
};

const BASE_METRIC_QUERY: CompiledMetricQuery = {
    exploreName: 'sales',
    dimensions: [],
    metrics: [],
    filters: {},
    sorts: [],
    limit: 500,
    tableCalculations: [],
    compiledTableCalculations: [],
    additionalMetrics: [],
    compiledAdditionalMetrics: [],
    compiledCustomDimensions: [],
};

describe('MetricQueryBuilder snapshot: LOD queries (FORK: LOD)', () => {
    beforeEach(() => {
        process.env.LIGHTDASH_LOD_METRICS_ENABLED = 'true';
    });
    afterEach(() => {
        delete process.env.LIGHTDASH_LOD_METRICS_ENABLED;
    });

    // All selected dimensions are ignored → the LOD CTE has no GROUP BY and is
    // merged back with a CROSS JOIN (grand-total semantics).
    test('grand-total CTE with CROSS JOIN when all dims are ignored', () => {
        const query = buildQuery({
            explore: LOD_TEST_EXPLORE,
            compiledMetricQuery: {
                ...BASE_METRIC_QUERY,
                dimensions: ['sales_product_name'],
                metrics: [
                    'sales_customers_purchasing',
                    'sales_total_customers',
                ],
            },
        });
        expect(query).toContain('lod_1 AS (');
        expect(query).toContain('CROSS JOIN lod_1');
        expect(query).toMatchSnapshot();
    });

    // Some selected dimensions survive the ignore set → the LOD CTE groups by
    // the surviving dims and is merged back with a null-safe LEFT JOIN.
    test('LEFT JOINs on surviving dims when some dims survive', () => {
        const query = buildQuery({
            explore: LOD_TEST_EXPLORE,
            compiledMetricQuery: {
                ...BASE_METRIC_QUERY,
                dimensions: ['sales_product_name', 'sales_region'],
                metrics: [
                    'sales_customers_purchasing',
                    'sales_total_customers',
                ],
            },
        });
        // lod_1 groups by the surviving dimension only (region), not product_name
        const lodCte = query.slice(query.indexOf('lod_1 AS ('));
        expect(lodCte.replace(/\s+/g, ' ')).toContain('GROUP BY 1 )');
        expect(query).toContain('LEFT JOIN lod_1 ON');
        expect(query).toMatchSnapshot();
    });

    // Dimension filters must be applied inside the LOD CTE as well as the main
    // grouped query, so the coarser-grain aggregate respects the same filters.
    test('applies dimension filters inside the LOD CTE', () => {
        const query = buildQuery({
            explore: LOD_TEST_EXPLORE,
            compiledMetricQuery: {
                ...BASE_METRIC_QUERY,
                dimensions: ['sales_product_name', 'sales_region'],
                metrics: [
                    'sales_customers_purchasing',
                    'sales_total_customers',
                ],
                filters: {
                    dimensions: {
                        id: 'root',
                        and: [
                            {
                                id: 'region-filter',
                                target: { fieldId: 'sales_region' },
                                operator: FilterOperator.EQUALS,
                                values: ['EMEA'],
                            },
                        ],
                    },
                },
            },
        });
        const lodCte = query.slice(query.indexOf('lod_1 AS ('));
        expect(lodCte).toContain('WHERE');
        expect(query).toMatchSnapshot();
    });

    // The ignored dimension is not selected, so the metric is at full grain and
    // no LOD CTE is generated.
    test('is inert when ignored dimension is not selected', () => {
        const query = buildQuery({
            explore: LOD_TEST_EXPLORE,
            compiledMetricQuery: {
                ...BASE_METRIC_QUERY,
                dimensions: ['sales_region'],
                metrics: ['sales_total_customers'],
            },
        });
        expect(query).not.toContain('lod_');
        expect(query).toMatchSnapshot();
    });

    // With the feature flag off, LOD is completely inert regardless of the
    // ignore_dimensions metadata.
    test('is inert when the flag is off', () => {
        delete process.env.LIGHTDASH_LOD_METRICS_ENABLED;
        const query = buildQuery({
            explore: LOD_TEST_EXPLORE,
            compiledMetricQuery: {
                ...BASE_METRIC_QUERY,
                dimensions: ['sales_product_name'],
                metrics: ['sales_total_customers'],
            },
        });
        expect(query).not.toContain('lod_');
    });

    // LOD metrics cannot be combined with distinct metrics in the same query.
    test('throws when LOD metric is combined with a sum_distinct metric', () => {
        expect(() =>
            buildQuery({
                explore: LOD_TEST_EXPLORE,
                compiledMetricQuery: {
                    ...BASE_METRIC_QUERY,
                    dimensions: ['sales_product_name'],
                    metrics: [
                        'sales_total_customers',
                        'sales_distinct_customers',
                    ],
                },
            }),
        ).toThrow(
            'LOD metrics cannot be combined with period-over-period or distinct metrics in the same query',
        );
    });

    // A non-aggregate metric (pct = a / b) that references an LOD metric must
    // have its references rewritten to read the CTE columns in the outer
    // SELECT, instead of inlining+re-aggregating in the main SELECT.
    test('rewrites derived metric refs to CTE columns', () => {
        const query = buildQuery({
            explore: LOD_TEST_EXPLORE,
            compiledMetricQuery: {
                ...BASE_METRIC_QUERY,
                dimensions: ['sales_product_name'],
                metrics: [
                    'sales_customers_purchasing',
                    'sales_total_customers',
                    'sales_pct_customers_purchasing',
                ],
            },
        });
        // pct must NOT be aggregated inline in the main select (before lod_base)
        const mainSelect = query.slice(0, query.indexOf('lod_base'));
        expect(mainSelect).not.toContain('sales_pct_customers_purchasing');
        // outer select divides the base CTE column by the LOD CTE column
        expect(query).toContain('lod_base."sales_customers_purchasing"');
        expect(query).toContain('lod_1."sales_total_customers"');
        expect(query).toMatchSnapshot();
    });

    // A metric referencing BOTH an LOD metric and a distinct metric would need
    // to be rewritten against two conflicting CTE registries at once.
    test('throws when derived metric references both LOD and distinct metrics', () => {
        expect(() =>
            buildQuery({
                explore: LOD_TEST_EXPLORE,
                compiledMetricQuery: {
                    ...BASE_METRIC_QUERY,
                    dimensions: ['sales_product_name'],
                    metrics: [
                        'sales_distinct_customers',
                        'sales_total_customers',
                        'sales_pct_distinct_over_total',
                    ],
                },
            }),
        ).toThrow(
            'Metrics referencing both LOD and distinct metrics are not supported',
        );
    });

    // LOD metrics cannot be combined with the experimental fanout rewrite
    // (metric-inflating joins) — that rewrite replaces finalSelectParts in a
    // way that would conflict with the LOD join-back.
    test('throws when LOD metric is combined with a metric-inflating join', () => {
        expect(() =>
            buildQuery({
                explore: LOD_FANOUT_EXPLORE,
                compiledMetricQuery: {
                    ...BASE_METRIC_QUERY,
                    dimensions: ['table1_dim1'],
                    metrics: ['table1_metric1', 'table2_metric3'],
                },
            }),
        ).toThrow('metric-inflating joins');
    });

    // FORK: LOD — regression coverage: with the flag on but no LOD-active
    // metric selected, getLodGroups must bail out before it ever tries to
    // resolve dimensions, so a custom dimension in the query doesn't crash it.
    test('compiles a custom dimension query with no LOD metric selected', () => {
        const query = buildQuery({
            explore: LOD_TEST_EXPLORE,
            compiledMetricQuery: {
                ...BASE_METRIC_QUERY,
                dimensions: ['sales_region', 'is_emea'],
                metrics: ['sales_customers_purchasing'],
                compiledCustomDimensions: [CUSTOM_SQL_DIMENSION],
            },
        });
        expect(query).not.toContain('lod_');
        expect(query).toMatchSnapshot();
    });

    // FORK: LOD — v1 doesn't support LOD metrics combined with custom
    // dimensions (custom dimensions aren't explore dimensions, so LOD's
    // grouping-by-surviving-dimensions logic can't reason about them).
    test('throws when LOD metric is combined with a custom dimension', () => {
        expect(() =>
            buildQuery({
                explore: LOD_TEST_EXPLORE,
                compiledMetricQuery: {
                    ...BASE_METRIC_QUERY,
                    dimensions: ['sales_region', 'is_emea'],
                    metrics: ['sales_total_customers'],
                    compiledCustomDimensions: [CUSTOM_SQL_DIMENSION],
                },
            }),
        ).toThrow('custom dimensions');
    });
});
