import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import Home from "@/app/page";

describe("homepage", () => {
  it("contains only the introduction and address search", () => {
    const html = renderToStaticMarkup(createElement(Home));

    expect(html).toContain(
      "Redesign the shape of any block in NYC, and see what those changes will do to safety, accessibility, and value.",
    );
    expect(html).toContain("Find a block");
    expect(html).toContain('type="search"');
    expect(html).not.toContain("streetSim");
    expect(html).not.toContain("Edited example");
    expect(html).not.toContain("<a ");
  });
});
