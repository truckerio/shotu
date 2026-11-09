import { useId } from "react";
import { WorkorderCustomerChat } from "./WorkorderCustomerChat.jsx";
import "./workorder-chat-workspace.css";

export function WorkorderChatWorkspace({
  audience,
  onAudienceChange,
  canReadInternal,
  canReadCustomer,
  canSendCustomer,
  internalContent,
  companyId,
  locationId,
  workorderId,
  customerDocument,
  onPrepareEstimate,
}) {
  const id = useId();
  const selected = (audience === "customer" || !canReadInternal) && canReadCustomer
    ? "customer"
    : "internal";
  const bothAudiences = canReadInternal && canReadCustomer;
  const selectWithArrow = (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = event.key === "ArrowRight" ? "customer" : "internal";
    onAudienceChange?.(next);
    event.currentTarget.querySelector(`#${CSS.escape(`${id}-${next}-tab`)}`)?.focus();
  };

  return <div className="workorder-chat-workspace">
    {bothAudiences ? <div className="workorder-chat-audiences" role="tablist" aria-label="Chat audience" onKeyDown={selectWithArrow}>
      <button type="button" role="tab" id={`${id}-internal-tab`} aria-controls={`${id}-internal-panel`}
        aria-selected={selected === "internal"} tabIndex={selected === "internal" ? 0 : -1}
        onClick={() => onAudienceChange?.("internal")}>Internal</button>
      <button type="button" role="tab" id={`${id}-customer-tab`} aria-controls={`${id}-customer-panel`}
        aria-selected={selected === "customer"} tabIndex={selected === "customer" ? 0 : -1}
        onClick={() => onAudienceChange?.("customer")}>Customer</button>
    </div> : null}
    {canReadInternal ? <section data-audience="internal" hidden={selected !== "internal"}
      id={`${id}-internal-panel`} role="tabpanel" aria-labelledby={bothAudiences ? `${id}-internal-tab` : undefined} aria-label={bothAudiences ? undefined : "Internal chat"}>
      {internalContent}
    </section> : null}
    {canReadCustomer ? <section data-audience="customer" hidden={selected !== "customer"}
      id={`${id}-customer-panel`} role="tabpanel" aria-labelledby={bothAudiences ? `${id}-customer-tab` : undefined} aria-label={bothAudiences ? undefined : "Customer chat"}>
      <WorkorderCustomerChat
        key={`${companyId}:${locationId}:${workorderId}`}
        repairScope
        companyId={companyId}
        locationId={locationId}
        workorderId={workorderId}
        document={customerDocument}
        canSend={canSendCustomer}
        onPrepareEstimate={onPrepareEstimate}
      />
    </section> : null}
  </div>;
}
