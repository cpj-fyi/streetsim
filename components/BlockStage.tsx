"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

interface CartoucheData {
  street: string;
  fromTo: string;
  borough: string;
  postedMph: number;
  oneWay: boolean;
  school: { name: string; distanceFt: number } | null;
  /** Set when the roadway already carries a DOT pedestrian-plaza treatment. */
  plaza: { name: string | null } | null;
}

/**
 * The map is the page: a fixed stage that neither scrolls nor zooms, with
 * drawers floating over its flanks (out by default, hideable via handles,
 * state in the URL so a shared link reproduces the whole workspace), a
 * survey-plate cartouche carrying the block's identity, and flip tabs when
 * a plan exists. The stage insets itself so the plate is never hidden
 * under an open drawer.
 */
export function BlockStage({
  todaySvg,
  afterSvg,
  hasPlan,
  cartouche,
  ineligibleReason,
  left,
  right,
  initialLeftOpen,
  initialRightOpen,
}: {
  todaySvg: string;
  afterSvg: string;
  hasPlan: boolean;
  cartouche: CartoucheData;
  ineligibleReason: string | null;
  left: React.ReactNode;
  right: React.ReactNode;
  initialLeftOpen: boolean;
  initialRightOpen: boolean;
}) {
  const [view, setView] = useState<"today" | "after">(hasPlan ? "after" : "today");
  const [leftOpen, setLeftOpen] = useState(initialLeftOpen);
  const [rightOpen, setRightOpen] = useState(initialRightOpen);
  // Below this width the two drawers can't flank the map. They become
  // overlays and start closed, whatever the URL says (a shared link should
  // never open onto a map squeezed to nothing).
  const compact = useSyncExternalStore(subscribeCompact, getCompact, () => false);
  const router = useRouter();
  const sp = useSearchParams();

  useEffect(() => {
    if (compact) {
      // Intentional one-shot on breakpoint entry: overlay drawers must not
      // start (or stay) open over a compact stage.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLeftOpen(false);
      setRightOpen(false);
    }
  }, [compact]);

  const syncUrl = useCallback(
    (key: "dl" | "dr", open: boolean) => {
      const p = new URLSearchParams(sp.toString());
      if (open) p.delete(key);
      else p.set(key, "0");
      router.replace(`?${p.toString()}`, { scroll: false });
    },
    [router, sp],
  );

  const eligible = !ineligibleReason;
  const showLeft = eligible;
  const showRight = eligible;

  return (
    <div className="relative h-dvh overflow-hidden bg-paper">
      {/* Stage — insets track the drawers so the plate stays fully visible. */}
      <div
        className="absolute inset-0 flex items-center justify-center transition-[padding] duration-300"
        style={{
          paddingLeft: !compact && showLeft && leftOpen ? 348 : 28,
          paddingRight: !compact && showRight && rightOpen ? 432 : 28,
          paddingTop: 56,
          paddingBottom: 96,
        }}
      >
        <div
          className="stage h-full w-full"
          dangerouslySetInnerHTML={{ __html: view === "today" ? todaySvg : afterSvg }}
        />
      </div>

      {/* Flip tabs, top center. */}
      {eligible && hasPlan && (
        <div className="absolute left-1/2 top-4 flex -translate-x-1/2 border border-rule bg-panel">
          <button
            onClick={() => setView("after")}
            className={`eyebrow px-4 py-2 ${view === "after" ? "bg-ink text-paper" : "text-ink-soft hover:bg-paper"}`}
            aria-pressed={view === "after"}
          >
            Your edit
          </button>
          <button
            onClick={() => setView("today")}
            className={`eyebrow border-l border-hairline px-4 py-2 ${view === "today" ? "bg-ink text-paper" : "text-ink-soft hover:bg-paper"}`}
            aria-pressed={view === "today"}
          >
            Today
          </button>
        </div>
      )}
      {eligible && !hasPlan && (
        <div className="eyebrow absolute left-1/2 top-5 -translate-x-1/2 text-ink-faint">
          The street today. Toggle an intervention to redesign it.
        </div>
      )}

      {/* Cartouche — the drawing sheet's title block. Wraps rather than
          crushing when the window narrows. */}
      <div className="absolute bottom-6 left-1/2 flex max-w-[calc(100vw-24px)] -translate-x-1/2 flex-wrap items-baseline gap-x-5 gap-y-1.5 border border-rule bg-panel px-5 py-3">
        <Link href="/" className="eyebrow self-center text-ink-faint hover:text-ink">
          streetSim
        </Link>
        <span className="serif text-[22px] leading-none">{cartouche.street}</span>
        <span className="serif text-[13px] italic text-ink-soft">
          {cartouche.fromTo}, {cartouche.borough}
        </span>
        <span className="eyebrow text-ink-soft">
          {cartouche.postedMph} mph · {cartouche.oneWay ? "One-way" : "Two-way"}
        </span>
        {cartouche.school && (
          <span className="eyebrow text-[#B58A3A]">
            School zone · {Math.round(cartouche.school.distanceFt)} ft
          </span>
        )}
        {cartouche.plaza && (
          <span
            className="eyebrow text-ink-soft"
            title="This roadway carries a DOT pedestrian plaza treatment today."
          >
            DOT plaza{cartouche.plaza.name ? ` · ${cartouche.plaza.name}` : ""}
          </span>
        )}
      </div>

      {/* Ineligible: the street as it is, and the honest reason. */}
      {!eligible && (
        <p className="serif absolute bottom-24 left-1/2 max-w-xl -translate-x-1/2 border border-rule bg-panel px-6 py-4 text-[15px] italic leading-6 text-ink-soft">
          {ineligibleReason}
        </p>
      )}

      {/* Left drawer — location + the edit controls for the block. */}
      {showLeft && (
        <Drawer
          side="left"
          open={leftOpen}
          onToggle={() => {
            setLeftOpen(!leftOpen);
            syncUrl("dl", !leftOpen);
          }}
          width={320}
        >
          {left}
        </Drawer>
      )}

      {/* Right drawer — outcomes. */}
      {showRight && (
        <Drawer
          side="right"
          open={rightOpen}
          onToggle={() => {
            setRightOpen(!rightOpen);
            syncUrl("dr", !rightOpen);
          }}
          width={404}
        >
          {right}
        </Drawer>
      )}
    </div>
  );
}

const COMPACT_QUERY = "(max-width: 1149px)";
function subscribeCompact(cb: () => void): () => void {
  const mq = window.matchMedia(COMPACT_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
function getCompact(): boolean {
  return window.matchMedia(COMPACT_QUERY).matches;
}

function Drawer({
  side,
  open,
  onToggle,
  width,
  children,
}: {
  side: "left" | "right";
  open: boolean;
  onToggle: () => void;
  width: number;
  children: React.ReactNode;
}) {
  // Percentage shift (not px) so a viewport-capped drawer still parks fully
  // offscreen with its handle peeking in.
  const closedShift = side === "left" ? "-100%" : "100%";
  return (
    <div
      className={`absolute bottom-0 top-0 z-10 transition-transform duration-300 ${side === "left" ? "left-0" : "right-0"}`}
      style={{
        width: `min(${width}px, calc(100vw - 44px))`,
        transform: open ? "translateX(0)" : `translateX(${closedShift})`,
      }}
    >
      <div
        className={`h-full overflow-y-auto border-rule bg-panel/95 p-5 backdrop-blur-sm ${side === "left" ? "border-r" : "border-l"}`}
      >
        {children}
      </div>
      {/* Handle: a quiet pill floating just off the panel — no border,
          translucent grey, the one rounded thing on the page (it's a control
          on a map, not part of the sheet). */}
      <button
        onClick={onToggle}
        aria-label={`${open ? "Hide" : "Show"} ${side} drawer`}
        className={`absolute top-1/2 flex h-12 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-ink/10 text-[12px] text-ink-soft backdrop-blur-sm transition-colors hover:bg-ink/20 hover:text-ink ${
          side === "left" ? "left-[calc(100%+10px)]" : "right-[calc(100%+10px)]"
        }`}
      >
        {side === "left" ? (open ? "‹" : "›") : open ? "›" : "‹"}
      </button>
    </div>
  );
}
