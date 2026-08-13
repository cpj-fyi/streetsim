import { describe, expect, it } from "vitest";
import {
  clampRevealPosition,
  revealValueText,
} from "@/components/embedComparisonState";

describe("embed comparison state", () => {
  it("keeps the reveal position inside the comparison", () => {
    expect(clampRevealPosition(-5)).toBe(0);
    expect(clampRevealPosition(42.6)).toBe(43);
    expect(clampRevealPosition(105)).toBe(100);
    expect(clampRevealPosition(Number.NaN)).toBe(50);
  });

  it("announces the visible proportions and the two endpoints", () => {
    expect(revealValueText(0)).toBe("Your edit");
    expect(revealValueText(50)).toBe("Street today 50%. Your edit 50%.");
    expect(revealValueText(100)).toBe("Street today");
  });
});
