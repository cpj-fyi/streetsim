"use client";

import { useState } from "react";
import {
  clampRevealPosition,
  revealValueText,
} from "@/components/embedComparisonState";

interface EmbedIdentity {
  street: string;
  fromTo: string;
}

/**
 * Unadvertised, map-only comparison for iframe embeds. The native range input
 * owns pointer, touch, and keyboard behavior while the two plates remain
 * visually fixed beneath it.
 */
export function EmbedComparison({
  todaySvg,
  afterSvg,
  hasPlan,
  identity,
}: {
  todaySvg: string;
  afterSvg: string;
  hasPlan: boolean;
  identity: EmbedIdentity;
}) {
  const [reveal, setReveal] = useState(50);
  const mapLabel = `${identity.street}, ${identity.fromTo}`;

  if (!hasPlan) {
    return (
      <main className="h-dvh w-screen overflow-hidden bg-paper">
        <h1 className="sr-only">Street today: {mapLabel}</h1>
        <div
          className="stage h-full w-full"
          role="img"
          aria-label={`Street today: ${mapLabel}`}
          dangerouslySetInnerHTML={{ __html: todaySvg }}
        />
      </main>
    );
  }

  return (
    <main
      className="embed-comparison relative h-dvh w-screen overflow-hidden bg-paper"
      style={{ "--reveal": `${reveal}%` } as React.CSSProperties}
    >
      <h1 className="sr-only">Before and after map: {mapLabel}</h1>
      <p id="embed-comparison-help" className="sr-only">
        Drag or swipe the divider. Use the arrow keys when the divider is focused.
      </p>

      <div
        className="absolute inset-0"
        role="img"
        aria-label={`Before and after street map: ${mapLabel}`}
      >
        <div
          className="stage absolute inset-0"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: afterSvg }}
        />
        <div
          className="stage absolute inset-0 [clip-path:inset(0_calc(100%-var(--reveal))_0_0)]"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: todaySvg }}
        />
      </div>

      <input
        className="embed-comparison-range absolute inset-0 z-20 m-0 h-full w-full"
        type="range"
        min="0"
        max="100"
        step="1"
        value={reveal}
        aria-label="Before and after divider"
        aria-describedby="embed-comparison-help"
        aria-valuetext={revealValueText(reveal)}
        onChange={(event) => setReveal(clampRevealPosition(event.currentTarget.valueAsNumber))}
      />

      <div className="embed-comparison-divider" aria-hidden="true">
        <span className="embed-comparison-handle">‹&nbsp;›</span>
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-between p-3">
        <span className="eyebrow border border-rule bg-panel/90 px-2 py-1.5">Today</span>
        <span className="eyebrow border border-rule bg-panel/90 px-2 py-1.5">Your edit</span>
      </div>
    </main>
  );
}
