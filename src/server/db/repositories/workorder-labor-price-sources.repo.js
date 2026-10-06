import { query } from "../pool.js";

/** Local labor decisions win, including Unknown. Only an unambiguous matching
 * catalog service's current fixed selling policy can supply a missing rate. */
export async function readEffectiveLaborPriceSources({ companyId, locationId, productId }, execute = query) {
  if (!productId) return [];
  const result = await execute(`with product as (
      select * from local_labor_products where company_id=$1 and id=$3 and active=true
    ), local_rates as (
      select distinct on(rate.price_kind) rate.*, product.uom_code as product_uom_code
      from labor_rate_versions rate join local_labor_products product
        on product.company_id=rate.company_id and product.id=rate.labor_product_id
      where rate.company_id=$1 and product.id=$3 and product.active=true
        and (rate.location_id is null or rate.location_id=$2)
      order by rate.price_kind,(rate.location_id is not null) desc,rate.version desc
    ), matched_catalog as (
      select catalog.id, product.id as labor_product_id, product.uom_code
      from product join parts_catalog catalog on catalog.company_id=product.company_id
        and lower(btrim(catalog.part_number))=lower(btrim(product.code))
        and catalog.uom_code=product.uom_code
      where btrim(product.code)<>'' and product.uom_code in ('hr','ea')
        and (select count(*) from parts_catalog candidate
          where candidate.company_id=product.company_id
            and lower(btrim(candidate.part_number))=lower(btrim(product.code))
            and candidate.uom_code=product.uom_code)=1
        and (select count(*) from local_labor_products candidate
          where candidate.company_id=product.company_id and candidate.active=true
            and lower(btrim(candidate.code))=lower(btrim(product.code))
            and candidate.uom_code=product.uom_code)=1
    ), current_policy as (
      select policy.*, catalog.labor_product_id, catalog.uom_code as product_uom_code
      from matched_catalog catalog join inventory_part_selling_policy_versions policy
        on policy.company_id=$1 and policy.catalog_part_id=catalog.id
      where policy.location_id is null or policy.location_id=$2
      order by (policy.location_id is not null) desc,policy.version desc limit 1
    )
    select id,labor_product_id,price_kind,version,location_id,amount,currency,created_at,
      product_uom_code,id as rate_version_id,null::uuid as selling_policy_version_id
    from local_rates
    union all
    select id,labor_product_id,'selling_price',0,location_id,value,currency,created_at,
      product_uom_code,null::uuid,id
    from current_policy where method='fixed' and currency ~ '^[A-Z]{3}$'
      and not exists(select 1 from local_rates where price_kind='selling_price')`,
  [companyId, locationId, productId]);
  return result.rows;
}
