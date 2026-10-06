import { useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api.js";
import "./customer-document-reports.css";

const money = (value, currency) => value == null ? "—" : new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(Number(value));
const label = (value) => String(value || "unknown").replaceAll("_", " ");

export function CustomerDocumentReports({ companyId, locationId }) {
  const [state, setState] = useState("loading"); const [report, setReport] = useState(null); const [error, setError] = useState("");
  useEffect(() => { if (!companyId || !locationId) { setState("blocked"); return; } let live = true; setState("loading"); setError(""); const params = new URLSearchParams({ companyId, locationId }); api(`/api/customer-documents/reports?${params}`).then((result) => { if (live) { setReport(result); setState("ready"); } }).catch((reason) => { if (live) { setError(reason.message || "Customer-document reporting could not be loaded."); setState("error"); } }); return () => { live = false; }; }, [companyId, locationId]);
  const grouped = useMemo(() => report?.documents || [], [report]);
  return <section className="customer-document-reports" aria-busy={state === "loading"}><header><p className="customer-document-kicker">Support</p><h2>Customer documents</h2><p>Issued document activity and customer links for this location. Amounts are grouped by currency.</p></header>{error ? <p role="alert">{error}</p> : null}{state === "blocked" ? <p>Select a company and location to view reporting.</p> : null}{state === "ready" ? <><div className="customer-document-report-grid">{grouped.length ? grouped.map((group) => <article key={`${group.documentType}-${group.state}-${group.currency}`}><span>{label(group.documentType)} · {label(group.state)}</span><strong>{group.count}</strong><b>{money(group.totalAmount, group.currency)}</b></article>) : <p>No issued customer documents in this period.</p>}</div><section className="customer-document-grant-support"><h3>Links needing attention</h3>{report.grants?.length ? <ul>{report.grants.map((grant) => <li key={grant.id}><span><b>{grant.documentNumber}</b> · {label(grant.state)} · ending {String(grant.tokenHint || "—")}</span><small>{grant.revokedAt ? `Revoked ${new Date(grant.revokedAt).toLocaleString()}` : `Expires ${new Date(grant.expiresAt).toLocaleString()}`}</small></li>)}</ul> : <p>No revoked, expired, or expiring customer links.</p>}</section></> : null}</section>;
}
