import { Dropdown } from "../../forms/Dropdown.jsx";
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
  SOURCE_LABELS,
  localizedFitmentOptions,
  partRequestLabel,
} from "./part-request-model.js";
import { RequestSummary } from "./RequestSummary.jsx";
import { RepairHistorySuggestions } from "./RepairHistorySuggestions.jsx";
import { useOfficeRequestReview } from "./useOfficeRequestReview.js";
import { GetPartsFlow } from "../../../features/inventory/GetPartsFlow.jsx";
import { interfaceText } from "../../../i18n/index.js";
import { SectionHelpDisclosure } from "../SectionHelpDisclosure.jsx";

export function OfficeRequestCard({ request, detail, onChanged }) {
  const locale = "en";
  const t = (key) => interfaceText(locale, key);
  const review = useOfficeRequestReview({ request, detail, onChanged, locale });
  const pending = ["submitted", "needs_info"].includes(request.approvalStatus);

  return (
    <article className="part-request-card office-part-request-card">
      <RequestSummary request={request} />
      {pending ? (
        <>
          <div className="part-review-heading">
            <div className="part-review-heading-copy">
              <strong>{t("parts.reviewRequest")}</strong>
              <SectionHelpDisclosure label={t("parts.reviewRequestHelp")}><p>{t("parts.reviewRequestHelp")}</p></SectionHelpDisclosure>
            </div>
            <div className="part-review-heading-actions">
              {request.requestedByName ? <span>{t("parts.requestedBy")} {request.requestedByName}</span> : null}
              <button type="button" onClick={review.findSuggestion} disabled={Boolean(review.busy)}>
                <SearchMd />
                {review.busy === "identify" ? t("parts.finding") : t("parts.findSuggestion")}
              </button>
            </div>
          </div>
          <div className="part-office-fields">
            <PartCatalogCombobox
              workorderId={detail.workorder.id}
              purpose="request"
              value={review.form.partNumber}
              onChange={review.updatePartNumber}
              onSelect={review.selectCatalogPart}
              label={t("parts.partNumber")}
              inputPolicy="identifier"
            />
            <QuantityUnitInput
              id={`request-quantity-${request.id}`}
              quantity={review.form.quantity}
              uomCode={review.form.uomCode}
              onQuantityChange={(value) => review.update("quantity", value)}
              onUomCodeChange={review.updateRequestUnit}
              quantityLabel={t("parts.quantity")}
              unitLabel={t("parts.unit")}
            />
            <label className="part-field-wide">{t("parts.description")}<NarrativeField singleLine value={review.form.description} onChange={(event) => review.update("description", event.target.value)} /></label>
            <label className="part-field-wide">{t("parts.repairOrder")}<input {...textEntryProps("identifier")} value={review.form.repairOrder} onChange={(event) => review.update("repairOrder", event.target.value)} /></label>
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
                label={t("parts.fitment")}
                value={review.form.fitmentStatus}
                onChange={(value) => review.update("fitmentStatus", value)}
                options={localizedFitmentOptions(locale)}
                className="part-fitment-select"
              />
              <label>{t("parts.fitmentNote")}<NarrativeField singleLine value={review.form.fitmentNotes} onChange={(event) => review.update("fitmentNotes", event.target.value)} placeholder={t("parts.fitmentNotePlaceholder")} /></label>
            </div>
          </div>
          <div className="part-review-section">
            <div className="part-review-section-heading">
              <strong>{t("parts.supply")}</strong>
              <span>{t("parts.approvedQuantity")}: {formatQuantityUnit(review.form.quantity, review.form.uomCode)}</span>
            </div>
            <div className="inventory-summary">
              {request.inventory.length ? request.inventory.map((item) => (
                <span key={item.id}><strong>{formatQuantityUnit(item.quantityAvailable, item.uomCode || review.form.uomCode)}</strong> {t("parts.available")} · {item.locationName || t("parts.source.inventory")}{item.binLocation ? ` · ${item.binLocation}` : ""}</span>
              )) : <span>{t("parts.inventoryNotTracked")}</span>}
            </div>
            <AllocationEditor
              allocations={review.allocations}
              setAllocations={review.setAllocations}
              quantity={review.form.quantity}
              uomCode={review.form.uomCode}
              inventory={request.inventory}
              locale={locale}
            />
          </div>
          <div className="part-response-composer">
            <div className="part-response-heading">
              <label htmlFor={`part-response-${request.id}`}>{t("parts.messageToMechanic")}</label>
              <SectionHelpDisclosure label={t("parts.responseHelp")}><p>{t("parts.responseHelp")}</p></SectionHelpDisclosure>
            </div>
            <NarrativeField
              id={`part-response-${request.id}`}
              ref={review.responseRef}
              value={review.form.reason}
              onChange={(event) => review.update("reason", event.target.value)}
              placeholder={t("parts.responsePlaceholder")}
              rows="3"
            />
            <div className="part-decision-actions">
              <ApproveButton
                onClick={() => review.decide("approved")}
                busy={review.busy === "approved"}
                disabled={Boolean(review.busy)}
                label={t("parts.approveRequest")}
                busyLabel={t("parts.approving")}
              />
              <button type="button" onClick={() => review.decide("needs_info")} disabled={Boolean(review.busy)}>
                {review.busy === "needs_info" ? t("parts.sendingQuestion") : t("parts.askMechanic")}
              </button>
              <button className="part-decline-button" type="button" onClick={() => review.decide("rejected")} disabled={Boolean(review.busy)}>
                {review.busy === "rejected" ? t("parts.declining") : t("parts.decline")}
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          {request.approvalStatus === "approved" && request.catalogPartId ? (
            <details className="part-get-parts-flow">
              <summary>{t("parts.getParts")}</summary>
              <GetPartsFlow
                workorderId={detail.workorder.id}
                catalogPartId={request.catalogPartId}
                partLabel={request.partNumber || request.description || t("parts.selectedPart")}
                destinationLocationId={detail.workorder.locationId}
                defaultQuantity={request.quantity}
                defaultUomCode={request.uomCode}
                onComplete={onChanged}
              />
            </details>
          ) : null}
          {request.repairOrder ? <p className="part-repair-order">{request.repairOrder}</p> : null}
          {request.allocations.length ? (
            <div className="part-allocation-list office-allocation-list">
              {request.allocations.map((allocation) => {
                const nextStatuses = Array.isArray(allocation.nextStatuses) ? allocation.nextStatuses : [];
                const statusLabel = partRequestLabel(locale, "allocation", allocation.status, ALLOCATION_STATUS_LABELS[allocation.status] || allocation.status);
                return (
                  <label key={allocation.id}>
                    <span>{partRequestLabel(locale, "source", allocation.sourceType, SOURCE_LABELS[allocation.sourceType])} · {formatQuantityUnit(allocation.quantity, allocation.uomCode || request.uomCode)}</span>
                    {nextStatuses.length ? (
                      <Dropdown value={allocation.status} onChange={(event) => review.updateAllocation(allocation, event.target.value)} disabled={review.busy === allocation.id}>
                        <option value={allocation.status}>{statusLabel}</option>
                        {nextStatuses.map((status) => <option value={status} key={status}>{partRequestLabel(locale, "allocation", status, ALLOCATION_STATUS_LABELS[status] || status)}</option>)}
                      </Dropdown>
                    ) : <span className="allocation-source-status">{statusLabel}</span>}
                  </label>
                );
              })}
            </div>
          ) : null}
          {request.approvalStatus === "approved" && request.allocations.some((allocation) => ["purchase", "unknown"].includes(allocation.sourceType)) ? (
            <button className="part-price-button" type="button" onClick={review.findPrices} disabled={review.busy === "prices"}>
              <SearchMd /> {review.busy === "prices" ? t("parts.searchingCurrentPrices") : t("parts.findCurrentPrices")}
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
