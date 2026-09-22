# Inventory prices and tax

## Research and product decisions

Research checked 2026-09-15, before implementation.

| Source | Observed guidance | Application decision |
|---|---|---|
| [Odoo pricelists](https://www.odoo.com/documentation/19.0/applications/sales/sales/products_prices/prices/pricing.html) | Price rules can vary by customer, quantity, currency and date, separately from a product cost. | Keep internal and selling prices independent of purchase evidence. Advanced customer/tier rules remain a later layer. |
| [Odoo taxes](https://www.odoo.com/documentation/19.0/applications/finance/accounting/taxes.html) | Product taxes are applied to document lines; tax mappings depend on business context; ordering matters for compound taxes. | Reusable, explicitly configured tax profiles with named ordered components. No inferred local rates or automatic legal classification. |
| [Stripe price tax behavior](https://docs.stripe.com/tax/products-prices-tax-codes-tax-behavior) | Inclusive and exclusive prices have different meanings; behavior belongs to the price. | Save inclusivity with each price version and label it beside the amount. |
| [Stripe manual tax rates](https://docs.stripe.com/tax/tax-rates) | Preserve historical rates; choose a rounding level; distinguish exempt treatment and explicit rates. | Immutable profile versions, distinct zero-rated/exempt/out-of-scope states and defined line-preview rounding. |
| [PostgreSQL numeric](https://www.postgresql.org/docs/current/datatype-numeric.html) | Exact numeric storage is appropriate for money; binary floating point is inexact. | Decimal database fields and exact integer/rational arithmetic; decimal strings across the API. |

| [SIX ISO 4217 maintenance](https://www.six-group.com/en/products-services/financial-information/market-reference-data/data-standards.html) | Official current currency list declares currency minor units. | Version the numeric-minor-unit currency metadata from List One (published 2026-01-01); reject unsupported and N.A. minor-unit codes instead of assuming two decimals. |

## Scope

The Inventory part detail is the owner of catalog prices. Purchase cost is a source observation. Internal price is a separately configured internal-use charge; selling price is a separately configured customer charge. Neither changes physical stock or rewrites acquisition cost. Internal price is not automatically exempt.

Tax jurisdiction and actual rates must be entered explicitly. Until configured, show Tax not configured and leave the tax-inclusive total Unknown. An explicit zero price is distinct from an unset price, and a zero tax rate is distinct from missing tax information.

Company tax profiles can be reused across parts. Changes create new versions; earlier prices retain their original profile version. Price edits carry amount, currency, tax treatment, exact profile version where applicable, reason and actor. Existing price records retain unknown historical tax treatment; do not assume they were tax-exclusive.

Price checks use saved or clearly labeled draft prices, a quantity and optional percentage discount. They show the entered-price subtotal, discount, net before tax, named tax components and total. Inclusive subtotals already include tax. Unknown tax treatment leaves net, tax and total unknown. Rates are percentages, optionally applied on prior component taxes in their explicit order. Calculations use exact decimals, with HALF_UP rounding to the currency minor unit for displayed line components; inclusive rounding must reconcile base + tax = total. This is an operational line preview, not a posted invoice or jurisdiction compliance engine.

## Operator workflow

Open a part → change Internal or Selling price → choose currency and tax treatment → choose/create a reusable tax profile when taxable → review breakdown → save with a reason. Common fields remain visible, with compound-rate configuration and history under explicit optional controls. Keep draft values and the same request key on a failed retry; reject conflicting concurrent edits.

Office/Admin permissions protect purchase/internal/selling detail and edits. Mechanics and public scan routes gain no financial fields. Company boundaries apply to every profile/version reference.

## Existing integrations

Workorder parts currently lack an authoritative commercial snapshot. Legacy allocation unit_price lacks currency and financial meaning. Odoo outbound currently maps standard_price (cost) to price_unit and omits explicit tax identifiers. These are not silently reinterpreted. This release owns Inventory price configuration and calculation; using these amounts for future billable transactions requires an explicit price/tax snapshot and reviewed export mapping.

Invoice tax totals are evidence about the original supplier document, not a default tax rate for selling every part. Purchase-tax recovery, landed-cost allocation, core deposits, discounts on posted documents, tax filing and automatic rate lookup are outside this catalog-pricing slice.

## Migration and rollout

Add migration135; preserve133/134 and all historical source values. Rehearse a fresh installation and a populated134 upgrade on isolated databases. Verify old price amount/currency/reason/version IDs unchanged, unknown tax backfill, price/profile scope and concurrent edits. Back up a hosted target before any later authorized rollout. Rollback must preserve new price history; prefer forward repair once new versions exist. No deployment or production mutation is authorized by this implementation.

## Calculation contract

- Multiply unit price by quantity using exact decimals; round the extended subtotal to the currency minor unit. Round the percentage discount on that subtotal, then subtract it.
- For tax-exclusive prices, round each tax component HALF_UP. A compound component uses the discounted base plus earlier rounded taxes.
- For tax-inclusive prices, derive the unrounded base and each ordered component from the gross amount. Round and reconcile residual minor units deterministically so the displayed base plus component taxes equals gross. No component may become negative.
- Saved-price previews resolve their exact historic tax version, including after archival. New assignments require a current active profile in the same company and currency.
- Missing price or unclassified tax is an explicit blocker. Preview values never create a sale, invoice, stock movement or Workorder charge.
