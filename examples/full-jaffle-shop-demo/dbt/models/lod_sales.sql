with customers as (
    select 'n' || i::text as customer_id, 'North' as region from generate_series(1, 10) i
    union all
    select 's' || i::text, 'South' from generate_series(1, 2) i
),

purchases as (
    select 'n1' as customer_id, 'Product A' as product_name
    union all select 'n2', 'Product A'
    union all select 'n3', 'Product A'
    union all select 's1', 'Product A'
    union all select 'n4', 'Product B'
    union all select 'n5', 'Product B'
)

select
    c.customer_id,
    c.region,
    p.product_name
from customers c
left join purchases p using (customer_id)
