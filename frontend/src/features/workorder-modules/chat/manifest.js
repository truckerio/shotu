import { MessageChatCircle } from "@untitledui/icons";

export const chatModuleManifest = Object.freeze({
  id: "chat",
  icon: MessageChatCircle,
  policyKey: "chat",
  label: "Chat",
  owner: "workorder-modules/chat",
  routeBySurface: Object.freeze({ detail: "chat" }),
  orderBySurface: Object.freeze({ detail: 25 }),
  compactPlacement: Object.freeze({ admin: "primary", mechanic: "primary", office: "primary", surveillance: "primary" }),
});
