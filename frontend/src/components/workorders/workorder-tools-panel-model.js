export function getVisibleWorkorderToolViews(views, activeView) {
  return views.filter((view) => (
    view?.id
    && view?.label
    && (view.id !== "completion" || view.id === activeView)
  ));
}

export function getNextWorkorderToolView(viewIds, currentId, key) {
  const currentIndex = viewIds.indexOf(currentId);
  if (!viewIds.length || currentIndex < 0) return null;
  if (key === "Home") return viewIds[0];
  if (key === "End") return viewIds.at(-1);
  if (key === "ArrowRight" || key === "ArrowDown") return viewIds[(currentIndex + 1) % viewIds.length];
  if (key === "ArrowLeft" || key === "ArrowUp") return viewIds[(currentIndex - 1 + viewIds.length) % viewIds.length];
  return null;
}
