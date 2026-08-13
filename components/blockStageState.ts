export type MapView = "today" | "after";
export type WorkspacePanel = "edit" | "outcomes" | null;

/**
 * Today is pinned to the exact edited plate the user chose to compare.
 * When the edited SVG changes, the new edit takes precedence again.
 */
export function resolveMapView(
  hasPlan: boolean,
  todayForSvg: string | null,
  afterSvg: string,
): MapView {
  return hasPlan && todayForSvg !== afterSvg ? "after" : "today";
}

/** A compact workspace can show only one modal sheet at a time. */
export function resolveWorkspacePanel(
  leftOpen: boolean,
  rightOpen: boolean,
): WorkspacePanel {
  if (leftOpen) return "edit";
  if (rightOpen) return "outcomes";
  return null;
}

/** Keep the URL's drawer contract in one atomic update. */
export function withDrawerState(
  params: URLSearchParams,
  state: { left: boolean; right: boolean },
): URLSearchParams {
  const next = new URLSearchParams(params.toString());
  if (state.left) next.delete("dl");
  else next.set("dl", "0");
  if (state.right) next.delete("dr");
  else next.set("dr", "0");
  return next;
}
