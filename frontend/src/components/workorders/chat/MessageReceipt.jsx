import { Check } from "@untitledui/icons";
import { interfaceText } from "../../../i18n/index.js";
import { receiptDisplayStatus } from "../../../lib/chat-receipts.js";
import "./chat.css";

const RECEIPT_KEY = Object.freeze({
  sent: "chat.receipt.sent",
  delivered: "chat.receipt.delivered",
  read: "chat.receipt.read",
});

export function MessageReceipt({ receipt, locale = "en" }) {
  const status = receiptDisplayStatus(receipt);
  const label = interfaceText(locale, RECEIPT_KEY[status]);
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
