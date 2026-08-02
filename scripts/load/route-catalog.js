export const ENDPOINT_BUDGETS = Object.freeze({
  "GET /api/me": 300,
  "GET operations summary": 750,
  "GET operations first page": 750,
  "GET operations deep page": 850,
  "GET operations active filter": 750,
  "GET operations review filter": 750,
  "GET operations attention filter": 750,
  "GET operations unit search": 1000,
  "GET locations": 750,
  "GET office dashboard": 1200,
  "GET mechanic dashboard": 1200,
  "GET surveillance dashboard": 1200,
});

export const READ_ROUTES = Object.freeze({
  admin: [
    { label: "GET /api/me", path: "/api/me" },
    { label: "GET operations summary", path: "/api/admin/operations/summary" },
    {
      label: "GET operations first page",
      path: "/api/admin/operations/workorders?page=1&pageSize=25&sortBy=lastActivityAt&sortDirection=desc",
    },
    {
      label: "GET operations deep page",
      path: "/api/admin/operations/workorders?page=20&pageSize=25&sortBy=createdAt&sortDirection=desc",
    },
    {
      label: "GET operations active filter",
      path: "/api/admin/operations/workorders?category=active&page=1&pageSize=25",
    },
    {
      label: "GET operations review filter",
      path: "/api/admin/operations/workorders?category=ready_review&page=1&pageSize=25",
    },
    {
      label: "GET operations attention filter",
      path: "/api/admin/operations/workorders?category=needs_attention&page=1&pageSize=25",
    },
    {
      label: "GET operations unit search",
      path: "/api/admin/operations/workorders?search=CH-&page=1&pageSize=25",
    },
    { label: "GET locations", path: "/api/admin/locations" },
  ],
  office: [
    { label: "GET /api/me", path: "/api/me" },
    { label: "GET office dashboard", path: "/api/office/dashboard" },
  ],
  mechanic: [
    { label: "GET /api/me", path: "/api/me" },
    { label: "GET mechanic dashboard", path: "/api/mechanic/dashboard" },
  ],
  surveillance: [
    { label: "GET /api/me", path: "/api/me" },
    { label: "GET surveillance dashboard", path: "/api/surveillance/dashboard" },
  ],
});

export function endpointBudgets(scale = 1) {
  return Object.fromEntries(
    Object.entries(ENDPOINT_BUDGETS).map(([label, budget]) => [label, budget * scale]),
  );
}
