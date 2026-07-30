import {
    CompiledCustomSqlDimension,
    CompiledMetricQuery,
    CustomDimensionType,
    DimensionType,
    Explore,
    FieldType,
    FilterOperator,
    JoinRelationship,
    MetricQuery,
    MetricType,
    SupportedDbtAdapter,
    TimeFrames,
} from '@lightdash/common';
import { MetricQueryBuilder } from '../MetricQueryBuilder';
import { TotalQueryBuilder } from '../TotalQueryBuilder';
import { buildQuery, SNAPSHOT_DEFAULTS } from './helpers';

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
                order_date: {
                    type: DimensionType.DATE,
                    name: 'order_date',
                    label: 'order_date',
                    table: 'sales',
                    tableLabel: 'sales',
                    fieldType: FieldType.DIMENSION,
                    sql: '${TABLE}.order_date',
                    compiledSql: '"sales".order_date',
                    tablesReferences: ['sales'],
                    hidden: false,
                },
                order_date_month: {
                    type: DimensionType.DATE,
                    name: 'order_date_month',
                    label: 'order_date_month',
                    table: 'sales',
                    tableLabel: 'sales',
                    fieldType: FieldType.DIMENSION,
                    sql: "DATE_TRUNC('MONTH', ${TABLE}.order_date)",
                    compiledSql: `DATE_TRUNC('MONTH', "sales".order_date)`,
                    tablesReferences: ['sales'],
                    hidden: false,
                    timeInterval: TimeFrames.MONTH,
                    timeIntervalBaseDimensionName: 'order_date',
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
                // Second LOD metric with a DIFFERENT ignore set (region), so a
                // multi-group query yields lod_1 (surviving region) AND lod_2
                // (surviving product_name).
                total_by_product: {
                    fieldType: FieldType.METRIC,
                    type: MetricType.SUM,
                    name: 'total_by_product',
                    table: 'sales',
                    tableLabel: 'sales',
                    label: 'total by product',
                    sql: '${TABLE}.total_customers',
                    compiledSql: 'SUM("sales".total_customers)',
                    tablesReferences: ['sales'],
                    hidden: false,
                    ignoreDimensions: ['region'],
                    compiledIgnoreDimensions: ['sales.region'],
                },
                // LOD metric that ignores the base date dimension — used to
                // prove time-grain matching (order_date_month is ignored via
                // its timeIntervalBaseDimensionName).
                customers_ignoring_date: {
                    fieldType: FieldType.METRIC,
                    type: MetricType.SUM,
                    name: 'customers_ignoring_date',
                    table: 'sales',
                    tableLabel: 'sales',
                    label: 'customers ignoring date',
                    sql: '${TABLE}.total_customers',
                    compiledSql: 'SUM("sales".total_customers)',
                    tablesReferences: ['sales'],
                    hidden: false,
                    ignoreDimensions: ['order_date'],
                    compiledIgnoreDimensions: ['sales.order_date'],
                },
                // Aggregate helper used by the nested-aggregate LOD metric.
                max_amount: {
                    fieldType: FieldType.METRIC,
                    type: MetricType.MAX,
                    name: 'max_amount',
                    table: 'sales',
                    tableLabel: 'sales',
                    label: 'max amount',
                    sql: '${TABLE}.amount',
                    compiledSql: 'MAX("sales".amount)',
                    tablesReferences: ['sales'],
                    hidden: false,
                },
                // Nested-aggregate metric (SUM wraps the MAX ref) that is ALSO
                // LOD-active — this overlap must be rejected.
                lod_sum_of_max: {
                    fieldType: FieldType.METRIC,
                    type: MetricType.NUMBER,
                    name: 'lod_sum_of_max',
                    table: 'sales',
                    tableLabel: 'sales',
                    label: 'lod sum of max',
                    sql: 'sum(${max_amount})',
                    compiledSql: 'SUM(MAX("sales".amount))',
                    tablesReferences: ['sales'],
                    hidden: false,
                    ignoreDimensions: ['product_name'],
                    compiledIgnoreDimensions: ['sales.product_name'],
                },
            },
            lineageGraph: {},
        },
    },
};

// FORK: LOD — clone of LOD_TEST_EXPLORE's `sales` table with row-level
// security (`sqlWhere`) and a model `requiredFilters` entry added, used ONLY
// by the RLS-survival test below. Every other test keeps using
// LOD_TEST_EXPLORE unchanged so their snapshots stay byte-identical.
const LOD_TEST_EXPLORE_WITH_RLS: Explore = {
    ...LOD_TEST_EXPLORE,
    tables: {
        ...LOD_TEST_EXPLORE.tables,
        sales: {
            ...LOD_TEST_EXPLORE.tables.sales,
            sqlWhere: `"sales".region != 'INTERNAL'`,
            requiredFilters: [
                {
                    id: 'required-region-filter',
                    target: { fieldRef: 'sales.region' },
                    operator: FilterOperator.NOT_EQUALS,
                    values: ['BANNED'],
                    required: true,
                },
            ],
        },
    },
};

// FORK: LOD — a NON-inflating (ONE_TO_ONE) joined explore. The join is
// inflation-proof (findTablesWithInflationFromJoin returns nothing for
// ONE_TO_ONE), so the experimental fanout rewrite never fires and the LOD
// join-back renders — with the join threaded inside the lod_N CTE.
const LOD_JOINED_EXPLORE: Explore = {
    targetDatabase: SupportedDbtAdapter.POSTGRES,
    name: 'orders',
    label: 'orders',
    baseTable: 'orders',
    tags: [],
    joinedTables: [
        {
            table: 'customers',
            sqlOn: '${orders.customer_id} = ${customers.customer_id}',
            compiledSqlOn: '("orders".customer_id) = ("customers".customer_id)',
            type: undefined,
            tablesReferences: ['orders', 'customers'],
            relationship: JoinRelationship.ONE_TO_ONE,
        },
    ],
    tables: {
        orders: {
            name: 'orders',
            label: 'orders',
            database: 'postgres',
            schema: 'jaffle',
            sqlTable: '"postgres"."jaffle"."orders"',
            primaryKey: ['order_id'],
            dimensions: {
                order_id: {
                    type: DimensionType.STRING,
                    name: 'order_id',
                    label: 'order_id',
                    table: 'orders',
                    tableLabel: 'orders',
                    fieldType: FieldType.DIMENSION,
                    sql: '${TABLE}.order_id',
                    compiledSql: '"orders".order_id',
                    tablesReferences: ['orders'],
                    hidden: false,
                },
                customer_id: {
                    type: DimensionType.STRING,
                    name: 'customer_id',
                    label: 'customer_id',
                    table: 'orders',
                    tableLabel: 'orders',
                    fieldType: FieldType.DIMENSION,
                    sql: '${TABLE}.customer_id',
                    compiledSql: '"orders".customer_id',
                    tablesReferences: ['orders'],
                    hidden: false,
                },
            },
            metrics: {
                // LOD metric on the base table, ignoring the base-table dim.
                total_amount: {
                    fieldType: FieldType.METRIC,
                    type: MetricType.SUM,
                    name: 'total_amount',
                    table: 'orders',
                    tableLabel: 'orders',
                    label: 'total amount',
                    sql: '${TABLE}.amount',
                    compiledSql: 'SUM("orders".amount)',
                    tablesReferences: ['orders'],
                    hidden: false,
                    ignoreDimensions: ['order_id'],
                    compiledIgnoreDimensions: ['orders.order_id'],
                },
            },
            lineageGraph: {},
        },
        customers: {
            name: 'customers',
            label: 'customers',
            database: 'postgres',
            schema: 'jaffle',
            sqlTable: '"postgres"."jaffle"."customers"',
            primaryKey: ['customer_id'],
            dimensions: {
                customer_id: {
                    type: DimensionType.STRING,
                    name: 'customer_id',
                    label: 'customer_id',
                    table: 'customers',
                    tableLabel: 'customers',
                    fieldType: FieldType.DIMENSION,
                    sql: '${TABLE}.customer_id',
                    compiledSql: '"customers".customer_id',
                    tablesReferences: ['customers'],
                    hidden: false,
                },
                country: {
                    type: DimensionType.STRING,
                    name: 'country',
                    label: 'country',
                    table: 'customers',
                    tableLabel: 'customers',
                    fieldType: FieldType.DIMENSION,
                    sql: '${TABLE}.country',
                    compiledSql: '"customers".country',
                    tablesReferences: ['customers'],
                    hidden: false,
                },
            },
            metrics: {},
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
            'cannot be combined with period-over-period or distinct metrics in the same query',
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
        ).toThrow('references both LOD and distinct metrics');
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

    // FORK: LOD — an INERT LOD metric (ignore_dimensions declared, but the
    // ignored dim is not selected) combined with a custom dimension must
    // compile normally: the metric stays at full grain, no lod_ CTE, no throw.
    // total_customers ignores product_name, which is NOT selected here.
    test('compiles an inert LOD metric with a custom dimension', () => {
        const query = buildQuery({
            explore: LOD_TEST_EXPLORE,
            compiledMetricQuery: {
                ...BASE_METRIC_QUERY,
                dimensions: ['sales_region', 'is_emea'],
                metrics: ['sales_total_customers'],
                compiledCustomDimensions: [CUSTOM_SQL_DIMENSION],
            },
        });
        expect(query).not.toContain('lod_');
        expect(query).toMatchSnapshot();
    });

    // FORK: LOD — v1 doesn't support ACTIVE LOD metrics combined with custom
    // dimensions (custom dimensions aren't explore dimensions, so LOD's
    // grouping-by-surviving-dimensions logic can't reason about them). Here
    // product_name (in total_customers' ignore set) IS selected, so LOD
    // activates and the custom dimension must be rejected.
    test('throws when active LOD metric is combined with a custom dimension', () => {
        expect(() =>
            buildQuery({
                explore: LOD_TEST_EXPLORE,
                compiledMetricQuery: {
                    ...BASE_METRIC_QUERY,
                    dimensions: [
                        'sales_product_name',
                        'sales_region',
                        'is_emea',
                    ],
                    metrics: ['sales_total_customers'],
                    compiledCustomDimensions: [CUSTOM_SQL_DIMENSION],
                },
            }),
        ).toThrow('custom dimensions');
    });

    // Sorting by an LOD metric orders by the outer alias fed from the lod_N
    // join-back. The whole query must stay wrapped (ORDER BY in the outer
    // SELECT), not pushed into the base CTE.
    test('sorts by the LOD metric alias with the query wrapped', () => {
        const query = buildQuery({
            explore: LOD_TEST_EXPLORE,
            compiledMetricQuery: {
                ...BASE_METRIC_QUERY,
                dimensions: ['sales_product_name', 'sales_region'],
                metrics: [
                    'sales_customers_purchasing',
                    'sales_total_customers',
                ],
                sorts: [{ fieldId: 'sales_total_customers', descending: true }],
            },
        });
        expect(query).toContain('ORDER BY');
        // ORDER BY reads the outer alias, and appears AFTER the lod_1 CTE.
        expect(query.indexOf('lod_1 AS (')).toBeLessThan(
            query.indexOf('ORDER BY'),
        );
        expect(query.slice(query.indexOf('ORDER BY'))).toContain(
            '"sales_total_customers"',
        );
        expect(query).toMatchSnapshot();
    });

    // A HAVING-style metric filter on an LOD metric must be applied AFTER the
    // lod_base + lod_1 join-back (i.e. in the post-aggregation CTE), never
    // inside lod_base itself.
    test('applies a HAVING-style filter on the LOD metric after the join-back', () => {
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
                    metrics: {
                        id: 'root',
                        and: [
                            {
                                id: 'gt-filter',
                                target: { fieldId: 'sales_total_customers' },
                                operator: FilterOperator.GREATER_THAN,
                                values: [10],
                            },
                        ],
                    },
                },
            },
        });
        // The metric predicate lands after lod_base (post-aggregation), not
        // inside the lod_base CTE definition.
        const predicate = '("sales_total_customers") > (10)';
        const lodBaseCte = query.slice(
            query.indexOf('lod_base AS ('),
            query.indexOf('lod_1 AS ('),
        );
        expect(lodBaseCte).not.toContain(predicate);
        expect(query).toContain(predicate);
        expect(query.indexOf('LEFT JOIN lod_1')).toBeLessThan(
            query.indexOf(predicate),
        );
        expect(query).toMatchSnapshot();
    });

    // Time-grain matching: ignoring the base date dim (sales.order_date) also
    // ignores any selected grain of it (order_date_month), so the LOD CTE
    // groups only by the surviving region dimension.
    test('matches all grains of an ignored base time dimension', () => {
        const query = buildQuery({
            explore: LOD_TEST_EXPLORE,
            compiledMetricQuery: {
                ...BASE_METRIC_QUERY,
                dimensions: ['sales_order_date_month', 'sales_region'],
                metrics: ['sales_customers_ignoring_date'],
            },
        });
        const lodCte = query.slice(
            query.indexOf('lod_1 AS ('),
            query.indexOf('metrics AS ('),
        );
        // lod_1 groups by region only — the month grain is ignored.
        expect(lodCte).toContain('AS "sales_region"');
        expect(lodCte).not.toContain('order_date');
        expect(lodCte.replace(/\s+/g, ' ')).toContain('GROUP BY 1 )');
        expect(query).toMatchSnapshot();
    });

    // Two LOD metrics with different ignore sets in one query produce two CTEs
    // (lod_1, lod_2), each grouped by (and joined on) its own surviving dim.
    test('builds one CTE per distinct surviving-dimension set', () => {
        const query = buildQuery({
            explore: LOD_TEST_EXPLORE,
            compiledMetricQuery: {
                ...BASE_METRIC_QUERY,
                dimensions: ['sales_product_name', 'sales_region'],
                metrics: ['sales_total_customers', 'sales_total_by_product'],
            },
        });
        expect(query).toContain('lod_1 AS (');
        expect(query).toContain('lod_2 AS (');
        // total_customers ignores product_name → lod_1 survives region.
        // total_by_product ignores region → lod_2 survives product_name.
        const lod1 = query.slice(
            query.indexOf('lod_1 AS ('),
            query.indexOf('lod_2 AS ('),
        );
        expect(lod1).toContain('AS "sales_region"');
        expect(lod1).not.toContain('AS "sales_product_name"');
        // lod_2 (total_by_product ignores region) survives product_name only.
        const lod2 = query.slice(
            query.indexOf('lod_2 AS ('),
            query.indexOf('metrics AS ('),
        );
        expect(lod2).toContain('AS "sales_product_name"');
        expect(lod2).not.toContain('AS "sales_region"');
        expect(query).toContain('LEFT JOIN lod_1 ON');
        expect(query).toContain('LEFT JOIN lod_2 ON');
        expect(query).toMatchSnapshot();
    });

    // A joined (non-inflating, ONE_TO_ONE) explore: the LOD metric on the base
    // table ignores the base-table dim, so the surviving dim lives on the
    // joined table. The join SQL must therefore render INSIDE the lod_1 CTE.
    test('renders the join inside the LOD CTE on a joined explore', () => {
        const query = buildQuery({
            explore: LOD_JOINED_EXPLORE,
            compiledMetricQuery: {
                ...BASE_METRIC_QUERY,
                exploreName: 'orders',
                dimensions: ['orders_order_id', 'customers_country'],
                metrics: ['orders_total_amount'],
            },
        });
        const lodCte = query.slice(
            query.indexOf('lod_1 AS ('),
            query.indexOf('metrics AS ('),
        );
        // The join to customers is threaded into lod_1 so the surviving
        // dimension (customers_country) is reachable.
        expect(lodCte).toContain('"postgres"."jaffle"."customers"');
        expect(lodCte).toContain('AS "customers_country"');
        expect(query).toMatchSnapshot();
    });

    // A table calculation referencing an LOD metric reads the outer alias
    // produced by the join-back (not a re-aggregation of the base column).
    test('lets a table calculation read the LOD metric outer alias', () => {
        const query = buildQuery({
            explore: LOD_TEST_EXPLORE,
            compiledMetricQuery: {
                ...BASE_METRIC_QUERY,
                dimensions: ['sales_product_name', 'sales_region'],
                metrics: ['sales_total_customers'],
                tableCalculations: [
                    {
                        name: 'double_total',
                        displayName: 'Double total',
                        sql: '${sales.total_customers} * 2',
                    },
                ],
                compiledTableCalculations: [
                    {
                        name: 'double_total',
                        displayName: 'Double total',
                        sql: '${sales.total_customers} * 2',
                        compiledSql: '"sales_total_customers" * 2',
                        dependsOn: [],
                    },
                ],
            },
        });
        expect(query).toContain('"sales_total_customers" * 2');
        expect(query).toContain('"double_total"');
        expect(query).toMatchSnapshot();
    });

    // FORK: LOD — a metric that is both a nested-aggregate outer metric and
    // LOD-active would have to be built in two CTEs (na_base and lod_N) at
    // once, so it is rejected.
    test('throws when an LOD metric also nests an aggregate reference', () => {
        expect(() =>
            buildQuery({
                explore: LOD_TEST_EXPLORE,
                compiledMetricQuery: {
                    ...BASE_METRIC_QUERY,
                    dimensions: ['sales_product_name', 'sales_region'],
                    metrics: ['sales_lod_sum_of_max'],
                },
            }),
        ).toThrow('cannot use nested aggregate references');
    });

    // Totals path: a grand total goes through TotalQueryBuilder, which strips
    // all dimensions. With no dimension selected there is nothing for the LOD
    // metric to ignore, so LOD is correctly inert at the grand-total grain and
    // the query is a plain aggregate (no lod_ CTE). See the report for why the
    // brief's `CROSS JOIN lod_1` expectation cannot hold on a grand total.
    test('reapplies LOD correctly at the grand-total grain (inert, no dims)', () => {
        const sourceMetricQuery: MetricQuery = {
            exploreName: 'sales',
            dimensions: ['sales_product_name', 'sales_region'],
            metrics: ['sales_customers_purchasing', 'sales_total_customers'],
            filters: {},
            sorts: [],
            limit: 500,
            tableCalculations: [],
        };
        const { metricQuery: totalsQuery } = new TotalQueryBuilder({
            metricQuery: sourceMetricQuery,
            pivotConfiguration: null,
            kind: 'grandTotal',
        }).compileQuery();

        expect(totalsQuery.dimensions).toEqual([]);

        const query = buildQuery({
            explore: LOD_TEST_EXPLORE,
            compiledMetricQuery: {
                ...BASE_METRIC_QUERY,
                ...totalsQuery,
                compiledTableCalculations: [],
                compiledAdditionalMetrics: [],
                compiledCustomDimensions: [],
            },
        });
        expect(query).not.toContain('lod_');
        expect(query).toMatchSnapshot();
    });

    // Totals path (subtotal grain): unlike a grand total, TotalQueryBuilder's
    // columnSubtotal retains a dimension subset (subtotalDimensions) instead
    // of stripping all dimensions. Here the retained dimension (product_name)
    // is itself in total_customers' ignore set, so LOD reactivates at the
    // subtotal grain: all retained dims are ignored, so lod_1 has no GROUP BY
    // and is merged back with a CROSS JOIN (same shape as the grand-total-CTE
    // test above, but reached via a subtotal rather than a bare aggregate).
    test('reactivates LOD at the columnSubtotal grain when the retained dimension is ignored', () => {
        const sourceMetricQuery: MetricQuery = {
            exploreName: 'sales',
            dimensions: ['sales_product_name', 'sales_region'],
            metrics: ['sales_customers_purchasing', 'sales_total_customers'],
            filters: {},
            sorts: [],
            limit: 500,
            tableCalculations: [],
        };
        const { metricQuery: totalsQuery } = new TotalQueryBuilder({
            metricQuery: sourceMetricQuery,
            pivotConfiguration: null,
            kind: 'columnSubtotal',
            subtotalDimensions: ['sales_product_name'],
        }).compileQuery();

        // Only the subtotal dimension survives — region is dropped.
        expect(totalsQuery.dimensions).toEqual(['sales_product_name']);

        const query = buildQuery({
            explore: LOD_TEST_EXPLORE,
            compiledMetricQuery: {
                ...BASE_METRIC_QUERY,
                ...totalsQuery,
                compiledTableCalculations: [],
                compiledAdditionalMetrics: [],
                compiledCustomDimensions: [],
            },
        });
        expect(query).toContain('lod_1 AS (');
        expect(query).toContain('CROSS JOIN lod_1');
        expect(query).toMatchSnapshot();
    });

    // FORK: LOD — a totals query with a BLOCKING metric filter restricts raw
    // rows to `source_dimension_groups`, derived from the FILTERED source
    // query. If an LOD group also pruned a filter on an ignored dimension,
    // that join would silently reinstate the pruned filter. This must throw
    // rather than emit a query with a wrong (narrower) LOD denominator.
    test('throws for a totals query with a metric filter that would reinstate a pruned LOD filter', () => {
        expect(() =>
            buildQuery({
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
                                    id: 'product-filter',
                                    target: { fieldId: 'sales_product_name' },
                                    operator: FilterOperator.EQUALS,
                                    values: ['Product A'],
                                },
                            ],
                        },
                        metrics: {
                            id: 'root',
                            and: [
                                {
                                    id: 'metric-filter',
                                    target: {
                                        fieldId: 'sales_customers_purchasing',
                                    },
                                    operator: FilterOperator.GREATER_THAN,
                                    values: [10],
                                },
                            ],
                        },
                    },
                },
                totalConfiguration: {
                    kind: 'grandTotal',
                    subtotalDimensions: undefined,
                },
            }),
        ).toThrow(
            'the totals row restriction would re-apply the filter the LOD metric ignores',
        );
    });

    // FORK: LOD — same shape as above but WITHOUT a metric filter: no
    // blocking filter means no source-groups join is built, so the grand
    // total legitimately flips to filter-only activation with an unfiltered,
    // one-row CROSS JOIN denominator. Must NOT throw.
    test('does not throw for a totals query with only a pruned dimension filter', () => {
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
                                id: 'product-filter',
                                target: { fieldId: 'sales_product_name' },
                                operator: FilterOperator.EQUALS,
                                values: ['Product A'],
                            },
                        ],
                    },
                },
            },
            totalConfiguration: {
                kind: 'grandTotal',
                subtotalDimensions: undefined,
            },
        });
        expect(query).toContain('lod_1 AS (');
        expect(query).toContain('CROSS JOIN lod_1');
        const lodCte = query.slice(query.indexOf('lod_1 AS ('));
        expect(lodCte).not.toContain('Product A');
        expect(query).toMatchSnapshot();
    });

    // Filter-only activation: product_name is filtered but NOT selected, so the
    // CTE keeps the main query's grain and drops the filter — the population
    // denominator spans all products.
    test('drops the filter on an ignored dimension that is not selected', () => {
        const query = buildQuery({
            explore: LOD_TEST_EXPLORE,
            compiledMetricQuery: {
                ...BASE_METRIC_QUERY,
                dimensions: ['sales_region'],
                metrics: [
                    'sales_customers_purchasing',
                    'sales_total_customers',
                ],
                filters: {
                    dimensions: {
                        id: 'root',
                        and: [
                            {
                                id: 'product-filter',
                                target: { fieldId: 'sales_product_name' },
                                operator: FilterOperator.EQUALS,
                                values: ['Product A'],
                            },
                        ],
                    },
                },
            },
        });
        const lodCte = query.slice(query.indexOf('lod_1 AS ('));
        // Main query is still filtered; the LOD CTE is not.
        expect(query).toContain(`'Product A'`);
        expect(lodCte).not.toContain(`'Product A'`);
        // Same grain as the main query, so the join-back is on region.
        expect(query).toContain('LEFT JOIN lod_1 ON');
        expect(query).toMatchSnapshot();
    });

    // FORK: LOD — row-level security (`sqlWhere`) and a model `requiredFilters`
    // entry must survive into the LOD CTE even when the user's own filter tree
    // prunes to NOTHING (the only filter targets the ignored dimension).
    // `buildDimensionsWhereClause` re-derives both from the explore on every
    // call, independently of the pruned tree — this proves it, since neither
    // source lives in LOD_TEST_EXPLORE and can't leak in by accident.
    test('keeps row-level security and required filters when the filter tree fully prunes', () => {
        const query = buildQuery({
            explore: LOD_TEST_EXPLORE_WITH_RLS,
            compiledMetricQuery: {
                ...BASE_METRIC_QUERY,
                dimensions: ['sales_region'],
                metrics: [
                    'sales_customers_purchasing',
                    'sales_total_customers',
                ],
                filters: {
                    dimensions: {
                        id: 'root',
                        and: [
                            {
                                id: 'product-filter',
                                target: { fieldId: 'sales_product_name' },
                                operator: FilterOperator.EQUALS,
                                values: ['Product A'],
                            },
                        ],
                    },
                },
            },
        });
        const lodCte = query.slice(
            query.indexOf('lod_1 AS ('),
            query.indexOf('LEFT JOIN lod_1 ON'),
        );
        // The pruned user filter is gone from the CTE...
        expect(lodCte).not.toContain('Product A');
        // ...but RLS and the required filter are not derived from that tree,
        // so they still appear.
        expect(lodCte).toContain(`"sales".region != 'INTERNAL'`);
        expect(lodCte).toContain(`'BANNED'`);
        expect(query).toMatchSnapshot();
    });

    // Selected AND filtered: the dimension leaves the GROUP BY and its filter
    // leaves the WHERE. Both knobs, one property.
    test('drops both grain and filter for a selected, filtered ignored dim', () => {
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
                                id: 'product-filter',
                                target: { fieldId: 'sales_product_name' },
                                operator: FilterOperator.EQUALS,
                                values: ['Product A'],
                            },
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
        expect(lodCte).not.toContain(`'Product A'`);
        // region is not ignored by total_customers, so its filter survives.
        expect(lodCte).toContain(`'EMEA'`);
        expect(query).toMatchSnapshot();
    });

    // Two LOD metrics with the same surviving grain but different dropped
    // filters must land in separate CTEs.
    test('builds separate CTEs when metrics drop different filters', () => {
        const query = buildQuery({
            explore: LOD_TEST_EXPLORE,
            compiledMetricQuery: {
                ...BASE_METRIC_QUERY,
                dimensions: ['sales_product_name', 'sales_region'],
                metrics: ['sales_total_customers', 'sales_total_by_product'],
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
        expect(query).toContain('lod_1 AS (');
        expect(query).toContain('lod_2 AS (');
        const lod1 = query.slice(
            query.indexOf('lod_1 AS ('),
            query.indexOf('lod_2 AS ('),
        );
        const lod2 = query.slice(query.indexOf('lod_2 AS ('));
        // total_customers ignores product_name only → keeps the region filter.
        expect(lod1).toContain(`'EMEA'`);
        // total_by_product ignores region → drops it.
        expect(lod2).not.toContain(`'EMEA'`);
        expect(query).toMatchSnapshot();
    });

    // Every selected dimension ignored AND its filter dropped: an unfiltered
    // one-row grand total, CROSS JOINed back.
    test('drops filters on an unfiltered grand-total CTE', () => {
        const query = buildQuery({
            explore: LOD_TEST_EXPLORE,
            compiledMetricQuery: {
                ...BASE_METRIC_QUERY,
                dimensions: ['sales_product_name'],
                metrics: [
                    'sales_customers_purchasing',
                    'sales_total_customers',
                ],
                filters: {
                    dimensions: {
                        id: 'root',
                        and: [
                            {
                                id: 'product-filter',
                                target: { fieldId: 'sales_product_name' },
                                operator: FilterOperator.EQUALS,
                                values: ['Product A'],
                            },
                        ],
                    },
                },
            },
        });
        const lodCte = query.slice(query.indexOf('lod_1 AS ('));
        expect(query).toContain('CROSS JOIN lod_1');
        // Sole filter pruned → the CTE has no WHERE at all.
        expect(lodCte).not.toContain('WHERE');
        expect(query).toMatchSnapshot();
    });

    // A pruned time filter means the CTE spans all periods — warn about it.
    test('warns when a time filter is dropped', () => {
        const { warnings } = new MetricQueryBuilder({
            parameterDefinitions: {},
            intrinsicUserAttributes: SNAPSHOT_DEFAULTS.intrinsicUserAttributes,
            timezone: SNAPSHOT_DEFAULTS.timezone,
            warehouseSqlBuilder: SNAPSHOT_DEFAULTS.warehouseClient,
            explore: LOD_TEST_EXPLORE,
            compiledMetricQuery: {
                ...BASE_METRIC_QUERY,
                dimensions: ['sales_region'],
                metrics: ['sales_customers_ignoring_date'],
                filters: {
                    dimensions: {
                        id: 'root',
                        and: [
                            {
                                id: 'date-filter',
                                target: { fieldId: 'sales_order_date_month' },
                                operator: FilterOperator.EQUALS,
                                values: ['2026-07-01'],
                            },
                        ],
                    },
                },
            },
        }).compileQuery();
        expect(
            warnings.some((w) => w.message.includes('sales_order_date_month')),
        ).toBe(true);
    });

    // An ignored dimension filtered inside an OR group has no well-defined
    // widening — pruning the disjunct would NARROW the CTE. Fail loudly.
    test('throws when an ignored dimension is filtered inside an OR group', () => {
        expect(() =>
            buildQuery({
                explore: LOD_TEST_EXPLORE,
                compiledMetricQuery: {
                    ...BASE_METRIC_QUERY,
                    dimensions: ['sales_region'],
                    metrics: ['sales_total_customers'],
                    filters: {
                        dimensions: {
                            id: 'root',
                            or: [
                                {
                                    id: 'product-filter',
                                    target: { fieldId: 'sales_product_name' },
                                    operator: FilterOperator.EQUALS,
                                    values: ['Product A'],
                                },
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
            }),
        ).toThrow('OR filter group');
    });

    // A nested AND group that fully collapses (every rule inside it targets an
    // ignored dimension) is itself a dropped OR disjunct — removing it narrows
    // the CTE exactly like dropping a bare leaf would. Must fail the same way.
    test('throws when a nested filter group fully collapses inside an OR group', () => {
        expect(() =>
            buildQuery({
                explore: LOD_TEST_EXPLORE,
                compiledMetricQuery: {
                    ...BASE_METRIC_QUERY,
                    dimensions: ['sales_region'],
                    metrics: ['sales_total_customers'],
                    filters: {
                        dimensions: {
                            id: 'root',
                            or: [
                                {
                                    id: 'region-filter',
                                    target: { fieldId: 'sales_region' },
                                    operator: FilterOperator.EQUALS,
                                    values: ['EMEA'],
                                },
                                {
                                    id: 'nested-and',
                                    and: [
                                        {
                                            id: 'product-filter',
                                            target: {
                                                fieldId: 'sales_product_name',
                                            },
                                            operator: FilterOperator.EQUALS,
                                            values: ['Product A'],
                                        },
                                    ],
                                },
                            ],
                        },
                    },
                },
            }),
        ).toThrow('OR filter group');
    });

    // Guard widening: previously this query compiled because the LOD metric was
    // inert (product_name not selected). Filtering it now forms a group, so the
    // custom-dimension guard fires. Correct — a custom dimension sits in the row
    // grain but is excluded from the CTE's GROUP BY.
    test('throws on custom dimensions when activation is filter-only', () => {
        expect(() =>
            buildQuery({
                explore: LOD_TEST_EXPLORE,
                compiledMetricQuery: {
                    ...BASE_METRIC_QUERY,
                    dimensions: ['sales_region', 'is_emea'],
                    metrics: ['sales_total_customers'],
                    compiledCustomDimensions: [CUSTOM_SQL_DIMENSION],
                    filters: {
                        dimensions: {
                            id: 'root',
                            and: [
                                {
                                    id: 'product-filter',
                                    target: { fieldId: 'sales_product_name' },
                                    operator: FilterOperator.EQUALS,
                                    values: ['Product A'],
                                },
                            ],
                        },
                    },
                },
            }),
        ).toThrow('custom dimensions');
    });

    test('throws on distinct metrics when activation is filter-only', () => {
        expect(() =>
            buildQuery({
                explore: LOD_TEST_EXPLORE,
                compiledMetricQuery: {
                    ...BASE_METRIC_QUERY,
                    dimensions: ['sales_region'],
                    metrics: [
                        'sales_total_customers',
                        'sales_distinct_customers',
                    ],
                    filters: {
                        dimensions: {
                            id: 'root',
                            and: [
                                {
                                    id: 'product-filter',
                                    target: { fieldId: 'sales_product_name' },
                                    operator: FilterOperator.EQUALS,
                                    values: ['Product A'],
                                },
                            ],
                        },
                    },
                },
            }),
        ).toThrow(
            'cannot be combined with period-over-period or distinct metrics in the same query',
        );
    });

    test('throws on nested-aggregate overlap when activation is filter-only', () => {
        expect(() =>
            buildQuery({
                explore: LOD_TEST_EXPLORE,
                compiledMetricQuery: {
                    ...BASE_METRIC_QUERY,
                    dimensions: ['sales_region'],
                    metrics: ['sales_lod_sum_of_max'],
                    filters: {
                        dimensions: {
                            id: 'root',
                            and: [
                                {
                                    id: 'product-filter',
                                    target: { fieldId: 'sales_product_name' },
                                    operator: FilterOperator.EQUALS,
                                    values: ['Product A'],
                                },
                            ],
                        },
                    },
                },
            }),
        ).toThrow('cannot use nested aggregate references');
    });
});
