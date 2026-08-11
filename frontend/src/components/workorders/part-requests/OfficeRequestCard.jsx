import { SearchMd } from "@untitledui/icons";
import { AnchoredSelect } from "../../forms/AnchoredSelect.jsx";
import { NarrativeField } from "../../forms/NarrativeField.jsx";
import { QuantityUnitInput } from "../../forms/QuantityUnitInput.jsx";
import { formatQuantityUnit } from "../../forms/quantity-unit-model.js";
import { textEntryProps } from "../../forms/text-entry-policy.js";
import { ApproveButton } from "../ApproveButton.jsx";
import { AllocationEditor } from "./AllocationEditor.jsx";
import { PartCatalogCombobox } from "./PartCatalogCombobox.jsx";
import {
  ALLOCATION_STATUS_LABELS,
  FITMENT_OPTIONS,
  SOURCE_LABELS,
} from "./part-request-model.js";
import { RequestSummary } from "./RequestSummary.jsx";
import { RepairHistorySuggestions } from "./RepairHistorySuggestions.jsx";
import { useOfficeRequestReview } from "./useOfficeRequestReview.js";

export function OfficeRequestCard({ request, detail, onChanged }) {
  const review = useOfficeRequestReview({ request, detail, onChanged });
  const pending = ["submitted", "needs_info"].includes(request.approvalStatus);

  return (
    <article className="part-request-card office-part-request-card">
      <RequestSummary request={request} />
      {pending ? (
        <>
          <div className="part-review-heading">
            <div>
              <strong>Review request</strong>
              <span>Verify the part, decide how it will be supplied, and send one clear response.</span>
            </div>
            <div className="part-review-heading-actions">
              {request.requestedByName ? <span>Requested by {request.requestedByName}</span> : null}
              <button type="button" onClick={review.findSuggestion} disabled={Boolean(review.busy)}>
                <SearchMd />
                {review.busy === "identify" ? "Finding" : "Find suggestion"}
              </button>
            </div>
          </div>
          <div className="part-office-fields">
            <PartCatalogCombobox
              workorderId={detail.workorder.id}
              value={review.form.partNumber}
              onChange={review.updatePartNumber}
              onSelect={review.selectCatalogPart}
              label="Part number"
              inputPolicy="identifier"
            />
            <QuantityUnitInput
              id={`request-quantity-${request.id}`}
              quantity={review.form.quantity}
              uomCode={review.form.uomCode}
              onQuantityChange={(value) => review.update("quantity", value)}
              onUomCodeChange={review.updateRequestUnit}
              quantityLabel="Quantity"
              unitLabel="Unit"
            />
            <label className="part-field-wide">Description<NarrativeField singleLine value={review.form.description} onChange={(event) => review.update("description", event.target.value)} /></label>
            <label className="part-field-wide">Repair order<input {...textEntryProps("identifier")} value={review.form.repairOrder} onChange={(event) => review.update("repairOrder", event.target.value)} /></label>
            {review.form.catalogPartId ? <div className="part-field-wide">
              <RepairHistorySuggestions
                workorderId={detail.workorder.id}
                catalogPartId={review.form.catalogPartId}
                partNumber={review.form.partNumber}
                assetId={detail.workorder.asset?.id || detail.workorder.assetId}
                onApply={(text) => review.update("repairOrder", text)}
                disabled={Boolean(review.busy)}
              />
            </div> : null}
            <div className="part-fitment-fields part-field-wide">
              <AnchoredSelect
                label="Fitment"
                value={review.form.fitmentStatus}
                onChange={(value) => review.update("fitmentStatus", value)}
                options={FITMENT_OPTIONS}
                className="part-fitment-select"
              />
              <label>Fitment note<NarrativeField singleLine value={review.form.fitmentNotes} onChange={(event) => review.update("fitmentNotes", event.target.value)} placeholder="How fitment was checked" /></label>
            </div>
          </div>
          <div className="part-review-section">
            <div className="part-review-section-heading">
              <strong>Supply</strong>
              <span>Approved quantity: {formatQuantityUnit(review.form.quantity, review.form.uomCode)}</span>
            </div>
            <div className="inventory-summary">
              {request.inventory.length ? request.inventory.map((item) => (
                <span key={item.id}><strong>{formatQuantityUnit(item.quantityAvailable, item.uomCode || review.form.uomCode)}</strong> available · {item.locationName || "Inventory"}{item.binLocation ? ` · ${item.binLocation}` : ""}</span>
              )) : <span>Inventory is not tracked for this part yet.</span>}
            </div>
            <AllocationEditor
              allocations={review.allocations}
              setAllocations={review.setAllocations}
              quantity={review.form.quantity}
              uomCode={review.form.uomCode}
              inventory={request.inventory}
            />
          </div>
          <div className="part-response-composer">
            <label htmlFor={`part-response-${request.id}`}>Message to mechanic</label>
            <NarrativeField
              id={`part-response-${request.id}`}
              ref={review.responseRef}
              value={review.form.reason}
              onChange={(event) => review.update("reason", event.target.value)}
              placeholder="Optional for approval. Required when asking a question or declining."
              rows="3"
            />
            <span>This response will also appear in the workorder chat and activity history.</span>
            <div className="part-decision-actions">
              <ApproveButton
                onClick={() => review.decide("approved")}
                busy={review.busy === "approved"}
                disabled={Boolean(review.busy)}
                label="Approve request"
                busyLabel="Approving"
              />
              <button type="button" onClick={() => review.decide("needs_info")} disabled={Boolean(review.busy)}>
                {review.busy === "needs_info" ? "Sending question" : "Ask mechanic"}
              </button>
              <button className="part-decline-button" type="button" onClick={() => review.decide("rejected")} disabled={Boolean(review.busy)}>
                {review.busy === "rejected" ? "Declining" : "Decline"}
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          {request.repairOrder ? <p className="part-repair-order">{request.repairOrder}</p> : null}
          {request.allocations.length ? (
            <div className="part-allocation-list office-allocation-list">
              {request.allocations.map((allocation) => (
                <label key={allocation.id}>
                  <span>{SOURCE_LABELS[allocation.sourceType]} · {formatQuantityUnit(allocation.quantity, allocation.uomCode || request.uomCode)}</span>
                  <select value={allocation.status} onChange={(event) => review.updateAllocation(allocation, event.target.value)} disabled={review.busy === allocation.id}>
                    {Object.entries(ALLOCATION_STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                  </select>
                </label>
              ))}
            </div>
          ) : null}
          {request.approvalStatus === "approved" && request.allocations.some((allocation) => ["purchase", "unknown"].includes(allocation.sourceType)) ? (
            <button className="part-price-button" type="button" onClick={review.findPrices} disabled={review.busy === "prices"}>
              <SearchMd /> {review.busy === "prices" ? "Searching current prices" : "Find current prices"}
            </button>
          ) : null}
          {review.pricing?.listings?.length ? (
            <div className="part-price-results">
              {review.pricing.listings.slice(0, 3).map((listing) => (
                <a href={listing.url} target="_blank" rel="noreferrer" key={listing.url}>
                  <span>{listing.vendor}</span>
                  <strong>${listing.itemPrice.toFixed(2)}</strong>
                </a>
              ))}
            </div>
          ) : null}
        </>
      )}
      {review.message ? (
        <p
          className={review.messageTone === "success" ? "part-request-message part-request-success" : "part-request-error"}
          role={review.messageTone === "success" ? "status" : "alert"}
        >
          {review.message}
        </p>
      ) : null}
    </article>
  );
}
