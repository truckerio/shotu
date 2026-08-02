import { interfaceText } from "../../i18n/index.js";

const ACTIONS = Object.freeze([
  { id: "photo", kind: "photo", label: "Take photo" },
  {
    id: "ask-office",
    kind: "prompt",
    label: "Ask office",
    prompt: "I need help from the office with: ",
  },
  {
    id: "report-problem",
    kind: "prompt",
    label: "Report another problem",
    prompt: "I found another problem: ",
  },
]);

export const MECHANIC_HELP_ACTIONS = ACTIONS;

export function localizedMechanicHelpActions(locale) {
  const labelKeys = {
    photo: "help.takePhoto",
    "ask-office": "help.askOffice",
    "report-problem": "help.reportProblem",
  };
  return ACTIONS.map((action) => ({
    ...action,
    label: interfaceText(locale, labelKeys[action.id]),
  }));
}
