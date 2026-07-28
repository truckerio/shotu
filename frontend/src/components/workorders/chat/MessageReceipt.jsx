import { Check } from "@untitledui/icons";
import { receiptDisplayStatus } from "../../../lib/chat-receipts.js";
import "./chat.css";

const RECEIPT_LABEL = Object.freeze({
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
});

export function MessageReceipt({ receipt }) {
  const status = receiptDisplayStatus(receipt);
  const label = RECEIPT_LABEL[status];
  const checkCount = status === "sent" ? 1 : 2;

  return (
    <span
      className={`message-receipt is-${status}`}
      aria-label={label}
      title={label}
      role="img"
    >
      {Array.from({ length: checkCount }, (_, index) => (
        <Check aria-hidden="true" key={index} />
      ))}
    </span>
  );
}
