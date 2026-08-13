import { describe, expect, it } from "vitest";
import {
  resolveMapView,
  resolveWorkspacePanel,
  withDrawerState,
} from "@/components/blockStageState";

describe("resolveMapView", () => {
  it("shows today when there is no plan", () => {
    expect(resolveMapView(false, null, "edit-a")).toBe("today");
  });

  it("shows an existing edit by default", () => {
    expect(resolveMapView(true, null, "edit-a")).toBe("after");
  });

  it("shows today after the user selects it", () => {
    expect(resolveMapView(true, "edit-a", "edit-a")).toBe("today");
  });

  it("returns to the edit when a selection changes the plate", () => {
    expect(resolveMapView(true, "edit-a", "edit-b")).toBe("after");
  });
});

describe("resolveWorkspacePanel", () => {
  it("keeps compact panels mutually exclusive", () => {
    expect(resolveWorkspacePanel(true, false)).toBe("edit");
    expect(resolveWorkspacePanel(false, true)).toBe("outcomes");
    expect(resolveWorkspacePanel(false, false)).toBeNull();
  });

  it("gives Edit precedence if stale state says both are open", () => {
    expect(resolveWorkspacePanel(true, true)).toBe("edit");
  });
});

describe("withDrawerState", () => {
  it("updates both drawer params atomically", () => {
    const source = new URLSearchParams("jog=medium&dr=0");
    expect(withDrawerState(source, { left: false, right: true }).toString()).toBe(
      "jog=medium&dl=0",
    );
    expect(source.toString()).toBe("jog=medium&dr=0");
  });

  it("records a closed compact workspace", () => {
    expect(withDrawerState(new URLSearchParams("jog=medium"), { left: false, right: false }).toString()).toBe(
      "jog=medium&dl=0&dr=0",
    );
  });
});
