"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  resolveMapView,
  resolveWorkspacePanel,
  withDrawerState,
  type WorkspacePanel,
} from "@/components/blockStageState";

interface BlockIdentity {
  street: string;
  fromTo: string;
  postedMph: number;
  oneWay: boolean;
}

/**
 * Desktop keeps the flank drawers. Compact viewports become a different
 * workspace: a horizontally inspectable map, stable top and bottom chrome,
 * and one modal sheet for Edit or Outcomes.
 */
export function BlockStage({
  todaySvg,
  afterSvg,
  hasPlan,
  identity,
  ineligibleReason,
  left,
  right,
  initialLeftOpen,
  initialRightOpen,
}: {
  todaySvg: string;
  afterSvg: string;
  hasPlan: boolean;
  identity: BlockIdentity;
  ineligibleReason: string | null;
  left: React.ReactNode;
  right: React.ReactNode;
  initialLeftOpen: boolean;
  initialRightOpen: boolean;
}) {
  const [todayForSvg, setTodayForSvg] = useState<string | null>(null);
  const view = resolveMapView(hasPlan, todayForSvg, afterSvg);
  const [leftOpen, setLeftOpen] = useState(initialLeftOpen);
  const [rightOpen, setRightOpen] = useState(initialRightOpen);
  const compact = useCompactStage();
  const router = useRouter();
  const sp = useSearchParams();
  const mobileMapRef = useRef<HTMLDivElement>(null);
  const mobileEditTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileOutcomesTriggerRef = useRef<HTMLButtonElement>(null);
  const pendingMobileFocusRef = useRef<Exclude<WorkspacePanel, null> | null>(null);

  useEffect(() => {
    if (!compact) return;
    // Compact pages open on the map. Panels remain available in stable bottom
    // chrome instead of arriving as two competing overlays.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLeftOpen(false);
    setRightOpen(false);
  }, [compact]);

  useEffect(() => {
    if (!compact) return;
    const map = mobileMapRef.current;
    if (!map) return;
    const frame = window.requestAnimationFrame(() => {
      map.scrollLeft = Math.max(0, (map.scrollWidth - map.clientWidth) / 2);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [compact, view, todaySvg, afterSvg]);

  const updateDrawers = useCallback(
    (state: { left: boolean; right: boolean }) => {
      setLeftOpen(state.left);
      setRightOpen(state.right);
      const params = withDrawerState(new URLSearchParams(sp.toString()), state);
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, sp],
  );

  const eligible = !ineligibleReason;
  const showLeft = eligible;
  const showRight = eligible && hasPlan;
  const mobilePanel = resolveWorkspacePanel(leftOpen, rightOpen);

  const openMobilePanel = (panel: Exclude<WorkspacePanel, null>) => {
    updateDrawers({ left: panel === "edit", right: panel === "outcomes" });
  };

  const closeMobilePanel = (panel: Exclude<WorkspacePanel, null>) => {
    pendingMobileFocusRef.current = panel;
    updateDrawers({ left: false, right: false });
  };

  useEffect(() => {
    const panel = pendingMobileFocusRef.current;
    if (mobilePanel !== null || panel === null) return;
    if (sp.get("dl") !== "0" || sp.get("dr") !== "0") return;
    const frame = window.requestAnimationFrame(() => {
      const trigger =
        panel === "edit" ? mobileEditTriggerRef.current : mobileOutcomesTriggerRef.current;
      trigger?.focus();
      pendingMobileFocusRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mobilePanel, sp]);

  const mapLabel = `${view === "today" ? "Street today" : "Your edit"}: ${identity.street}, ${identity.fromTo}. Posted speed ${identity.postedMph} mph. ${identity.oneWay ? "One-way." : "Two-way."}`;
  const activeSvg = view === "today" ? todaySvg : afterSvg;

  return (
    <main
      className="relative h-dvh overflow-hidden bg-paper"
      aria-label={`Street redesign workspace for ${identity.street}`}
    >
      <h1 className="sr-only">{identity.street} redesign workspace</h1>

      {compact ? (
        <>
          <div className="absolute inset-0" inert={mobilePanel !== null}>
            <header className="absolute inset-x-0 top-0 z-10 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-end justify-between gap-3 border-b border-hairline bg-paper/95 px-4 pb-2 pt-[env(safe-area-inset-top)] backdrop-blur-sm">
              <Link href="/" className="eyebrow min-h-11 shrink-0 content-center text-ink-faint hover:text-ink">
                streetSim
              </Link>
              {eligible && hasPlan ? (
                <MapViewControl
                  compact
                  view={view}
                  onAfter={() => setTodayForSvg(null)}
                  onToday={() => setTodayForSvg(afterSvg)}
                />
              ) : (
                <span className="eyebrow min-h-11 content-center text-ink-faint">Today</span>
              )}
            </header>

            <div
              ref={mobileMapRef}
              className="mobile-map-scroll absolute inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] top-[calc(3.5rem+env(safe-area-inset-top))] overflow-x-auto overflow-y-hidden overscroll-x-contain"
              role="region"
              aria-label="Street map. Scroll horizontally to inspect the block."
              tabIndex={0}
            >
              <div
                className="stage stage-mobile h-full min-w-full px-4"
                role="img"
                aria-label={mapLabel}
                dangerouslySetInnerHTML={{ __html: activeSvg }}
              />
            </div>

            {!eligible && (
              <p className="serif absolute inset-x-4 bottom-24 border border-rule bg-panel px-4 py-3 text-[15px] italic leading-6 text-ink-soft">
                {ineligibleReason}
              </p>
            )}

            {eligible && (
              <nav
                className="absolute inset-x-0 bottom-0 z-10 flex min-h-[calc(4rem+env(safe-area-inset-bottom))] border-t border-rule bg-panel pb-[env(safe-area-inset-bottom)]"
                aria-label="Workspace panels"
              >
                <button
                  ref={mobileEditTriggerRef}
                  type="button"
                  onClick={() => openMobilePanel("edit")}
                  aria-haspopup="dialog"
                  aria-expanded={mobilePanel === "edit"}
                  className="eyebrow min-h-16 flex-1 border-r border-hairline text-ink motion-safe:transition-colors motion-safe:duration-150 active:bg-ink active:text-paper"
                >
                  Edit
                </button>
                {showRight && (
                  <button
                    ref={mobileOutcomesTriggerRef}
                    type="button"
                    onClick={() => openMobilePanel("outcomes")}
                    aria-haspopup="dialog"
                    aria-expanded={mobilePanel === "outcomes"}
                    className="eyebrow min-h-16 flex-1 text-ink motion-safe:transition-colors motion-safe:duration-150 active:bg-ink active:text-paper"
                  >
                    Outcomes
                  </button>
                )}
              </nav>
            )}
          </div>

          {mobilePanel && (
            <MobileSheet
              panel={mobilePanel}
              street={identity.street}
              showOutcomes={showRight}
              onSelect={openMobilePanel}
              onClose={() => closeMobilePanel(mobilePanel)}
            >
              {mobilePanel === "edit" ? left : right}
            </MobileSheet>
          )}
        </>
      ) : (
        <>
          <div
            className="absolute inset-0 flex items-center justify-center motion-safe:transition-[padding] motion-safe:duration-300"
            style={{
              paddingLeft: showLeft && leftOpen ? 372 : 28,
              paddingRight: showRight && rightOpen ? 432 : 28,
              paddingTop: 56,
              paddingBottom: 28,
            }}
          >
            <div
              className="stage h-full w-full"
              role="img"
              aria-label={mapLabel}
              dangerouslySetInnerHTML={{ __html: activeSvg }}
            />
          </div>

          {eligible && hasPlan && (
            <div className="absolute left-1/2 top-4 -translate-x-1/2">
              <MapViewControl
                view={view}
                onAfter={() => setTodayForSvg(null)}
                onToday={() => setTodayForSvg(afterSvg)}
              />
            </div>
          )}
          {eligible && !hasPlan && (
            <p className="eyebrow absolute left-1/2 top-5 w-[min(34rem,calc(100vw-7rem))] -translate-x-1/2 text-center leading-[1.35] text-ink-faint text-balance">
              Today. Open Edit to redesign this block.
            </p>
          )}
          {!eligible && (
            <p className="serif absolute bottom-24 left-1/2 max-w-xl -translate-x-1/2 border border-rule bg-panel px-6 py-4 text-[15px] italic leading-6 text-ink-soft">
              {ineligibleReason}
            </p>
          )}

          <Link href="/" className="eyebrow absolute left-4 top-5 text-ink-faint hover:text-ink">
            streetSim
          </Link>

          {showLeft && (
            <Drawer
              side="left"
              label="Edit"
              open={leftOpen}
              onToggle={() => updateDrawers({ left: !leftOpen, right: rightOpen })}
              width={344}
            >
              {left}
            </Drawer>
          )}
          {showRight && (
            <Drawer
              side="right"
              label="Outcomes"
              open={rightOpen}
              onToggle={() => updateDrawers({ left: leftOpen, right: !rightOpen })}
              width={404}
            >
              {right}
            </Drawer>
          )}
        </>
      )}
    </main>
  );
}

function MapViewControl({
  view,
  onAfter,
  onToday,
  compact = false,
}: {
  view: "today" | "after";
  onAfter: () => void;
  onToday: () => void;
  compact?: boolean;
}) {
  return (
    <div className="flex border border-rule bg-panel" role="group" aria-label="Map view">
      <button
        type="button"
        onClick={onAfter}
        className={`eyebrow ${compact ? "min-h-11 px-3" : "px-4 py-2"} ${view === "after" ? "bg-ink text-paper" : "text-ink-soft hover:bg-paper"}`}
        aria-pressed={view === "after"}
      >
        {compact ? "Edit" : "Your edit"}
      </button>
      <button
        type="button"
        onClick={onToday}
        className={`eyebrow border-l border-hairline ${compact ? "min-h-11 px-3" : "px-4 py-2"} ${view === "today" ? "bg-ink text-paper" : "text-ink-soft hover:bg-paper"}`}
        aria-pressed={view === "today"}
      >
        Today
      </button>
    </div>
  );
}

const COMPACT_QUERY = "(max-width: 1149px)";
function useCompactStage(): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(COMPACT_QUERY);
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return compact;
}

function MobileSheet({
  panel,
  street,
  showOutcomes,
  onSelect,
  onClose,
  children,
}: {
  panel: Exclude<WorkspacePanel, null>;
  street: string;
  showOutcomes: boolean;
  onSelect: (panel: Exclude<WorkspacePanel, null>) => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = "mobile-workspace-sheet-title";

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      sheetRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter((element) => !element.hasAttribute("inert"));
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      ref={sheetRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      className="absolute inset-0 z-30 flex flex-col bg-panel pt-[env(safe-area-inset-top)]"
    >
      <div className="sticky top-0 z-10 border-b border-rule bg-panel">
        <div className="flex min-h-14 items-center justify-between gap-3 px-4">
          <h2 id={titleId} className="eyebrow min-w-0 truncate">
            {panel === "edit" ? "Edit" : "Outcomes"} · {street}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="min-h-11 min-w-11 border border-rule px-3 text-[13px] font-medium active:bg-ink active:text-paper"
          >
            Close
          </button>
        </div>
        {showOutcomes && (
          <div className="mx-4 mb-3 flex border border-rule" role="group" aria-label="Workspace panel">
            <button
              type="button"
              onClick={() => onSelect("edit")}
              aria-pressed={panel === "edit"}
              className={`eyebrow min-h-11 flex-1 ${panel === "edit" ? "bg-ink text-paper" : "text-ink-soft"}`}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => onSelect("outcomes")}
              aria-pressed={panel === "outcomes"}
              className={`eyebrow min-h-11 flex-1 border-l border-rule ${panel === "outcomes" ? "bg-ink text-paper" : "text-ink-soft"}`}
            >
              Outcomes
            </button>
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        {children}
      </div>
    </div>
  );
}

function Drawer({
  side,
  label,
  open,
  onToggle,
  width,
  children,
}: {
  side: "left" | "right";
  label: "Edit" | "Outcomes";
  open: boolean;
  onToggle: () => void;
  width: number;
  children: React.ReactNode;
}) {
  const closedShift = side === "left" ? "-100%" : "100%";
  const panelId = `${side}-drawer`;
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const toggle = () => {
    const willOpen = !open;
    onToggle();
    if (willOpen) {
      window.requestAnimationFrame(() => {
        panelRef.current
          ?.querySelector<HTMLElement>(
            "input:not(:disabled), button:not(:disabled), a[href]",
          )
          ?.focus();
      });
    }
  };

  return (
    <div
      className={`absolute bottom-0 top-0 z-10 motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out ${side === "left" ? "left-0" : "right-0"}`}
      style={{
        width: `min(${width}px, calc(100vw - 44px))`,
        transform: open ? "translateX(0)" : `translateX(${closedShift})`,
      }}
    >
      <div
        ref={panelRef}
        id={panelId}
        role="complementary"
        aria-label={label}
        aria-hidden={!open}
        inert={!open}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          onToggle();
          triggerRef.current?.focus();
        }}
        className={`h-full overflow-y-auto border-rule bg-panel/95 p-5 backdrop-blur-sm ${side === "left" ? "border-r" : "border-l"}`}
      >
        {children}
      </div>
      <button
        ref={triggerRef}
        onClick={toggle}
        aria-label={`${open ? "Hide" : "Show"} ${label} drawer`}
        aria-expanded={open}
        aria-controls={panelId}
        className={`absolute top-1/2 flex w-9 -translate-y-1/2 flex-col items-center justify-center rounded-full bg-ink/10 text-ink-soft backdrop-blur-sm motion-safe:transition-colors motion-safe:duration-150 hover:bg-ink/20 hover:text-ink ${
          label === "Outcomes" ? "h-36 gap-3" : "h-24 gap-2"
        } ${
          side === "left" ? "left-[calc(100%+8px)]" : "right-[calc(100%+8px)]"
        }`}
      >
        <span aria-hidden="true" className="text-[12px] leading-none">
          {side === "left" ? (open ? "‹" : "›") : open ? "›" : "‹"}
        </span>
        <span className="eyebrow [writing-mode:vertical-rl] rotate-180">{label}</span>
      </button>
    </div>
  );
}
