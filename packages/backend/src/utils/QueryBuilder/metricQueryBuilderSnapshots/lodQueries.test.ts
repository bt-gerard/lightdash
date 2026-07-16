import {
    CompiledMetricQuery,
    DimensionType,
    Explore,
    FieldType,
    FilterOperator,
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
            },
            lineageGraph: {},
        },
    },
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
});
