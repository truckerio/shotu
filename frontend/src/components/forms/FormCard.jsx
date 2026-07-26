import { useId } from "react";
import { joinClassNames } from "./form-utils.js";
import "./operational-form.css";

export function FormCard({ children, className = "", title, description = "" }) {
  const titleId = useId();

  return (
    <section className={joinClassNames("operational-form-card", className)} aria-labelledby={titleId}>
      <header className="operational-form-card-header">
        <h2 id={titleId}>{title}</h2>
        {description ? <p>{description}</p> : null}
      </header>
      <div className="operational-form-card-content">{children}</div>
    </section>
  );
}
