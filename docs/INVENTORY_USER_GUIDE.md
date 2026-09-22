# Using the local Inventory workspace

Open http://localhost:5173 and select **Inventory**. Stock is the default. Select the physical shop in each working view. The current implementation adds Purchases, Receiving, Tasks and Reports; it does not complete every advanced feature in the full plan.

## Stock and adding goods

Search the part and open its details. **New part** creates a catalog record without adding quantity. Review tracking and stocking unit before receiving.

Choose **Add stock**, select the shop, enter the amount or scan each serial on its own line, and confirm the goods physically arrived. Choose **Undamaged** for usable goods or **Damaged / held for inspection** and enter the actual hold location and findings. Receive usable and held portions as separate receipts. A held receipt creates a Stock damage task and is excluded from usable quantity. A reused existing shop QR cannot be registered as another new unit.

After an interrupted submission, reopen the same part and use **Check receipt**. The saved request is recovered before any retry.

## Purchasing and receiving against an order

Configure **Settings > Purchase Order Approval** first: enter the approval limit and select one or more existing Office/Admin users or roles. The settings apply across the selected company's locations. Only selected approvers can approve; Admin has no automatic override. The PO currency must match the limit currency.

1. Open **Purchases > Purchase orders > All Purchase Orders**, select the shop, and choose **New purchase order** to open its separate dialog.
2. Add the supplier, parts, quantities, prices and **Expected Delivery Date**. Save a draft if you want to finish later, or choose **Save / Place Order**.
3. A total at or below the limit goes directly to **Ordered**. A higher total becomes **Awaiting Approval**. An authorized approver opens that same PO and chooses **Approve**, which changes it to **Ordered**.
4. Communicate with the supplier through your normal method; **Record supplier communication** stores the reference. The application does not send email automatically.
5. When all outstanding goods arrive, open the PO and choose **Receive Order**, then **Confirm received**. This records delivery and changes the PO to **Received** without posting stock.
6. Choose **Add to inventory** for each received line. Enter quantities/serial identities and confirm stock using the existing receipt dialog. Completed lines cannot be added again; the table shows **Added to inventory** when all quantities are posted.

All POs stay in **All Purchase Orders**, in a compact table. The **Filters** button shows or hides search, status and supplier filters. The only statuses are **Draft**, **Awaiting Approval**, **Ordered**, **Received**, and **Cancelled**. Expected Delivery Date is a field. A short delivery keeps the order **Ordered** and its remaining quantities outstanding; confirm **Received** when all outstanding quantities arrive, then add the parts to inventory separately. **Cancel outstanding quantities** requires a reason and preserves quantities already received. Open purchase views refresh every three seconds.

Deployment requires migrations through `146_purchase_delivery_confirmation.sql`. Migration `144_purchase_order_approval.sql` establishes approval settings. It maps existing pending approvals to Awaiting Approval and existing approved/partially received orders to Ordered. Approval settings start unconfigured; an administrator must save a limit and approvers before new orders can be placed.

## Marking damaged stock already on your shelf

1. Open the part in **Stock** and choose **Mark stock damaged**, or open **Tasks > Stock damage**.
2. Choose the actual shop and part, enter quantity and scan shop QR labels or exact serials where applicable, the physical hold location, and damage findings.
3. Confirm damage after physically separating the goods. The amount leaves usable stock and appears as an inspection task.

Open the task to send it for repair. An administrator can approve inspected stock for use or confirm scrap disposal. These actions also require the explicit capability and part policy configured under **Tasks > Returns & repairs > Reuse settings**. For serialized goods, validate every affected serial again before release or disposal. Physical identity and history are retained.

Vehicle-installed parts still start in the vehicle/workorder removal workflow. Their handoff, return and inspection remain in **Tasks > Returns & repairs**; shelf damage does not create a fake vehicle removal.

## Transfers

At the source shop, open **Tasks > Transfers > Dispatch transfer**. Select the part, amount/serials, destination and actual carrier/handoff reference, then confirm physical dispatch.

At the destination shop, open the same transfer and enter the amount/serials actually received plus the storage reference. A short receipt leaves the remaining amount in transit. The same serial travels between shops; do not use Add stock for transferred goods. Ordinary transfers cannot cross companies.

## Cycle counts

Use **Count** or **Tasks > Cycle counts > Record count**. Select the part, refresh its current stock, then record physically observed usable quantity or every observed shop QR/serial. Zero is a real observation; blank is not zero. Exclude separately held/repair stock from the usable count.

An administrator reviews the variance and approves it. If stock or an exact identity changed after observation, the task requires a recount instead of posting a stale adjustment. Each part count is independent. Missing serials keep their identity and become unavailable with unknown custody after approval. Found/unknown serials require separate investigation and are not invented by the count.

**Opening inventory upload** remains a separate existing import workflow. Its legacy serialization behavior is not yet revised to the complete proposed opening-stock design.

## Upload supplier bills to a purchase order

After the PO is **Received**, choose **Upload bill** in its table row or open the PO's **Bills** section. The upload is linked to that same PO and supplier automatically. Select a PDF, JPG, PNG or WebP file (up to 10 MB), optionally enter the supplier invoice reference, and upload it.

Multiple bills can be attached to a PO. Open the PO to see and download its files. Re-uploading the same file to the same PO does not create a duplicate. Files use the existing encrypted invoice storage and company/location access checks.

Uploading a bill does not add stock, mark the PO paid, create another PO or send money. Use **Add to inventory** separately. The separate Bills tab is removed; previously recorded bill/payment data is retained. This upload flow stores documents rather than extracting accounting totals.

Deployment requires migration `147_purchase_order_bill_documents.sql`.

## Reports and recovery

**Reports** shows usable, reserved, held/repair, tracked total and available quantities; recorded issues in the last 30 days; outstanding PO commitments and supplier money by currency; and quantities in transit. Export covers the displayed stock page. Unknown costs are counted explicitly. Stock valuation is not yet published.

If a purchase, task or bill save loses its response, use **Check saved action / Recover saved command**. Do not create a new duplicate action. Submitted commands survive reload; PO drafts also resume. Unsubmitted task and bill fields do not yet have full draft persistence.

## Not yet part of this delivery

Full bin/position balances and picking; redesigned opening registration; tire fitment/rotation/retread; core deposits and related credits; warranty/supplier return claims; valuation/cost layers and effective pricing; broader configurable approval rules; bulk count sessions; task attachments; integrated uploaded-bill exception matching; and physical scanner/printer acceptance are still pending. The implementation review tracks the remaining full-plan scope.

### Purchase requests and approval

**Purchases** opens on a single **Needs ordering** list. The Category column identifies **Suggestion** or **Part request**. This flow is independent of work order requests.

1. Select the shop and choose **New request**, or choose **Request** on a stock suggestion.
2. Submit the part, quantity and optional supplier/notes. Every request starts as **Approval waiting**, including requests created by Office or Admin.
3. Office or Admin selects **Approve**. The request becomes **Approved** and records the approver's user ID and time.
4. Office or Admin can **Update** the approved quantity, supplier and notes.
5. Once goods arrive, select **Mark Added**, select or create the inventory part, and confirm the receipt. Stock and **Added** status are saved together. Serialized parts require each unit identity. Older requests marked Added without a receipt show **Add to inventory** to complete receiving.

Use the **Approval waiting**, **Approved**, and **Added** tabs to filter the list. **Needs ordering** includes suggestions and requests still waiting or approved. Suggestions with an active request are hidden to prevent duplicate requests. After marking one Added, the suggestion stays hidden until the stock or stocking policy changes.

Existing purchase orders and bills remain under the **Purchase orders** button. Work order request approvals are not changed by this new Purchases flow.

Office/Admin can also choose **Request part** beside **Add part / Scan part** on the work order Parts screen, or on a typed part row. The dialog carries the typed description and work order reference into a Purchases request with **Approval waiting** status. It does not create an approved work order part plan.

Requested purchase parts stay visible in the work order Parts table after submission and reload. Their quantity and Approval waiting / Approved / Added status refresh automatically every three seconds while the page is visible.

The work order Parts section uses a compact Part / Qty / Status / Action table. Add part and Scan are in the header; Add part opens the stock picker and Request part option. Source opens Purchases. Received requested parts show Ready to issue only when enough stock is available. The Issue action opens the inventory selection workflow; the existing reservation and usage checks still apply. Other details and actions are under the three-dot button. Labor and older Requests & supply are collapsed below.
