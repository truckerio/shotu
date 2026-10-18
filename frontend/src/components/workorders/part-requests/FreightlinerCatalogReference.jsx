import { useState } from "react";
import { interfaceText } from "../../../i18n/index.js";
import {
  FREIGHTLINER_CATALOG_URL,
  validFreightlinerVin,
} from "./freightliner-catalog-model.js";
import "./freightliner-catalog-reference.css";

export function FreightlinerCatalogReference({ asset, locale = "en" }) {
  const [copyState, setCopyState] = useState("");
  const t = (key) => interfaceText(locale, key);
  const vin = String(asset?.vin || "").trim();
  const canCopyVin = validFreightlinerVin(vin);

  async function copyVin() {
    if (!canCopyVin) return;
    try {
      if (!globalThis.navigator?.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await globalThis.navigator.clipboard.writeText(vin);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return <aside className="freightliner-catalog-reference" aria-label={t("parts.freightliner.title")}>
    <div className="freightliner-catalog-reference-heading">
      <strong>{t("parts.freightliner.title")}</strong>
      <span>{t("parts.freightliner.externalHelp")}</span>
    </div>
    <dl className="freightliner-catalog-reference-context">
      {asset.unitNo ? <div><dt>{t("parts.freightliner.unit")}</dt><dd>{asset.unitNo}</dd></div> : null}
      {asset.model ? <div><dt>{t("parts.freightliner.model")}</dt><dd>{asset.model}</dd></div> : null}
      <div><dt>{t("parts.freightliner.vin")}</dt><dd>{vin || t("parts.freightliner.vinMissing")}</dd></div>
    </dl>
    <div className="freightliner-catalog-reference-actions">
      <a className="button secondary" href={FREIGHTLINER_CATALOG_URL} target="_blank" rel="noopener noreferrer">{t("parts.freightliner.openCatalog")}</a>
      <button className="button secondary" type="button" onClick={copyVin} disabled={!canCopyVin}>{t("parts.freightliner.copyVin")}</button>
    </div>
    {!canCopyVin ? <p className="freightliner-catalog-reference-note">{t(vin ? "parts.freightliner.vinInvalid" : "parts.freightliner.vinUnavailable")}</p> : null}
    {copyState ? <p className="freightliner-catalog-reference-note" role={copyState === "failed" ? "alert" : "status"}>
      {t(copyState === "failed" ? "parts.freightliner.copyFailed" : "parts.freightliner.copied")}
    </p> : null}
  </aside>;
}
