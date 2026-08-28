import { ChevronRight } from "@untitledui/icons";
import "./context-breadcrumbs.css";

export function ContextBreadcrumbs({ items = [], current, ariaLabel = "Breadcrumb" }) {
  return (
    <nav className="context-breadcrumbs" aria-label={ariaLabel}>
      <ol>
        {items.map((item) => (
          <li key={`${item.label}:${item.href}`}>
            <a href={item.href} onClick={item.onClick}>{item.label}</a>
            <ChevronRight aria-hidden="true" focusable="false" />
          </li>
        ))}
        <li><span aria-current="page">{current}</span></li>
      </ol>
    </nav>
  );
}
