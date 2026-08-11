"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  ControlId,
  GateState,
  InterventionPlan,
  JogLevel,
  ParkingAction,
  SurfaceKind,
} from "@/lib/scene/types";
import { paramsFromPlan } from "@/lib/plan";
import { TODAY_PLAN } from "@/lib/scene/types";

interface Props {
  /** The requested plan (from the URL) — the base every interaction builds on. */
  plan: InterventionPlan;
  /** The gate-normalized plan — what the plate actually shows. Segmented rows
      display THIS as active, so a demoted request (heavy jog without a freed
      curb) highlights what's really drawn while the URL keeps the intent. */
  applied: InterventionPlan;
  gates: GateState[];
  schoolZone: boolean;
  /** true = three rulebook columns (under the maps); false = single stack (sidebar). */
  columns?: boolean;
}

/** One-line definitions, folded behind the Definitions toggle. Dry register, no dashes. */
const DEFS = {
  parking:
    "Sets the parking lane per curb. Reduce keeps about half the bays, mid-block and clear of corners. Remove converts the lane to sidewalk.",
  parklet: "Converts two parking spaces to a seating deck.",
  jog: "Offsets the travel lane so drivers cannot hold a straight line.",
  medianIslands: "Raised center refuges that shorten the crossing.",
  gateways: "Raised, narrowed entry that marks a slow street. One-way blocks gate the entry end only.",
  streetTrees: "New trees in the reclaimed curb lane.",
  bikeLane: "Raised track between sidewalk and roadway, set 0.3 m off the curb.",
  loadingZone: "Reserves a 12 m curb bay for deliveries.",
  sharedSurface: "One surface, no curbs. All modes at walking pace.",
  surface: "Roadway material. Pavers and cobbles lower speeds and raise per-vehicle noise.",
} as const;

/**
 * Gating is content, not friction: a nulled control goes grey and dead (it
 * should never feel possible) and says why in one line of editorial serif
 * when definitions are shown. The reason survives as a title tooltip always.
 */
export function PlanControls({ plan, applied, gates, columns = true }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [showDefs, setShowDefs] = useState(false);
  const g = (id: ControlId): GateState | undefined =>
    gates.find((s) => s.control === id);

  const PLAN_KEYS = ["rpl", "rpr", "gw", "jog", "isl", "trees", "pklt", "bike", "lz", "shared", "surf"];

  function push(next: InterventionPlan) {
    // Preserve non-plan params (drawer state etc.) — the URL is the whole
    // shareable workspace, not just the plan.
    const p = new URLSearchParams(sp.toString());
    for (const k of PLAN_KEYS) p.delete(k);
    for (const [k, v] of paramsFromPlan(next)) p.set(k, v);
    router.replace(`?${p.toString()}`, { scroll: false });
  }

  const set = <K extends keyof InterventionPlan>(k: K, v: InterventionPlan[K]) =>
    push({ ...plan, [k]: v });

  const dirty = JSON.stringify(plan) !== JSON.stringify(TODAY_PLAN);

  return (
    <div className="text-[13px]">
      <div className="flex items-center justify-between">
        <button
          onClick={() => push(TODAY_PLAN)}
          disabled={!dirty}
          className={`eyebrow border border-rule px-2.5 py-1.5 ${
            dirty
              ? "text-ink hover:bg-panel"
              : "cursor-default border-hairline text-ink-faint"
          }`}
        >
          Reset
        </button>
        <button
          onClick={() => setShowDefs((v) => !v)}
          className="eyebrow cursor-pointer text-ink-faint transition-colors hover:text-ink"
          aria-pressed={showDefs}
        >
          {showDefs ? "Hide definitions" : "Definitions"}
        </button>
      </div>

      {/* Under the plates, the three sections read as columns of a rulebook;
          in a sidebar they stack. */}
      <div className={`mt-6 grid items-start gap-x-8 gap-y-6 ${columns ? "md:grid-cols-3" : ""}`}>
      <Section label="Parking">
        <SegmentedRow<ParkingAction>
          label="Parking, left curb"
          def={DEFS.parking}
          showDefs={showDefs}
          value={applied.parking.left}
          options={["keep", "reduce", "remove"]}
          state={g("parking.left")}
          optionState={(o) =>
            o !== "keep" && g("parking.left")?.status !== "enabled" ? g("parking.left") : undefined
          }
          onChange={(v) => set("parking", { ...plan.parking, left: v })}
        />
        <SegmentedRow<ParkingAction>
          label="Parking, right curb"
          def={DEFS.parking}
          showDefs={showDefs}
          value={applied.parking.right}
          options={["keep", "reduce", "remove"]}
          state={g("parking.right")}
          optionState={(o) =>
            o !== "keep" && g("parking.right")?.status !== "enabled" ? g("parking.right") : undefined
          }
          onChange={(v) => set("parking", { ...plan.parking, right: v })}
        />
        <ToggleRow
          label="Parklet (two spaces)"
          def={DEFS.parklet}
          showDefs={showDefs}
          checked={applied.parklet}
          state={g("parklet")}
          onChange={(v) => set("parklet", v)}
        />
        <ToggleRow
          label="Loading zone"
          def={DEFS.loadingZone}
          showDefs={showDefs}
          checked={applied.loadingZone}
          state={g("loadingZone")}
          onChange={(v) => set("loadingZone", v)}
        />
      </Section>

      <Section label="Geometry">
        <SegmentedRow<JogLevel>
          label="Chicane (jog)"
          def={DEFS.jog}
          showDefs={showDefs}
          value={applied.jog}
          options={["none", "light", "medium", "heavy"]}
          state={g("jog")}
          optionState={(o) =>
            o === "heavy" && g("jog")?.status === "disabled" ? g("jog") : undefined
          }
          onChange={(v) => set("jog", v)}
        />
        <ToggleRow
          label="Median islands"
          def={DEFS.medianIslands}
          showDefs={showDefs}
          checked={applied.medianIslands}
          state={g("medianIslands")}
          onChange={(v) => set("medianIslands", v)}
        />
        <ToggleRow
          label="Gateways at both ends"
          def={DEFS.gateways}
          showDefs={showDefs}
          checked={applied.gateways}
          state={g("gateways")}
          onChange={(v) => set("gateways", v)}
        />
      </Section>

      <Section label="Green & shared">
        <ToggleRow
          label="Street trees"
          def={DEFS.streetTrees}
          showDefs={showDefs}
          checked={applied.streetTrees}
          state={g("streetTrees")}
          onChange={(v) => set("streetTrees", v)}
        />
        <SegmentedRow<"none" | "left" | "right">
          label="Bike lane"
          def={DEFS.bikeLane}
          showDefs={showDefs}
          value={applied.bikeLane}
          options={["none", "left", "right"]}
          state={g(plan.bikeLane === "left" ? "bikeLane.left" : "bikeLane.right")}
          optionState={(o) =>
            o === "none" ? undefined : g(o === "left" ? "bikeLane.left" : "bikeLane.right")
          }
          onChange={(v) => set("bikeLane", v)}
        />
        <ToggleRow
          label="Shared surface"
          def={DEFS.sharedSurface}
          showDefs={showDefs}
          checked={applied.sharedSurface}
          state={g("sharedSurface")}
          onChange={(v) => set("sharedSurface", v)}
        />
        <SegmentedRow<SurfaceKind>
          label="Surface"
          def={DEFS.surface}
          showDefs={showDefs}
          value={applied.surface}
          options={["asphalt", "pavers", "cobbles"]}
          state={g("surface")}
          onChange={(v) => set("surface", v)}
        />
      </Section>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-rule pt-3">
      <div className="eyebrow mb-3 text-ink-soft">{label}</div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function nulled(state?: GateState): boolean {
  return (
    state?.status === "disabled" ||
    state?.status === "preset" ||
    state?.status === "absorbed"
  );
}

function Definition({ def, show }: { def: string; show: boolean }) {
  if (!show) return null;
  return (
    <p className="serif mt-1 text-[13px] italic leading-[1.35] text-ink-faint">{def}</p>
  );
}

function Reason({ state, show }: { state?: GateState; show: boolean }) {
  if (!show || !state || state.status === "enabled" || !state.reason) return null;
  return (
    <p className="serif mt-1.5 text-[13px] italic leading-[1.35] text-ink-soft">
      {state.reason}
    </p>
  );
}

function ToggleRow({
  label,
  def,
  showDefs,
  checked,
  state,
  onChange,
}: {
  label: string;
  def: string;
  showDefs: boolean;
  checked: boolean;
  state?: GateState;
  onChange: (v: boolean) => void;
}) {
  const dead = nulled(state);
  const absorbed = state?.status === "absorbed";
  return (
    <div title={state?.reason ?? def}>
      <label
        className={`flex items-center justify-between gap-3 ${
          dead ? "cursor-not-allowed text-ink-faint opacity-60" : "cursor-pointer"
        }`}
      >
        <span className={absorbed ? "line-through decoration-ink-faint" : ""}>
          {label}
          {state?.status === "preset" && (
            <span className="eyebrow ml-2 text-ink-faint">Built</span>
          )}
        </span>
        <input
          type="checkbox"
          checked={
            state?.status === "preset"
              ? true
              : state?.status === "disabled"
                ? false
                : checked
          }
          disabled={dead}
          onChange={(e) => onChange(e.target.checked)}
          className={`h-4 w-4 accent-ink ${dead ? "cursor-not-allowed opacity-50" : ""}`}
        />
      </label>
      <Definition def={def} show={showDefs} />
      <Reason state={state} show={showDefs} />
    </div>
  );
}

function SegmentedRow<T extends string>({
  label,
  def,
  showDefs,
  value,
  options,
  state,
  optionState,
  onChange,
}: {
  label: string;
  def: string;
  showDefs: boolean;
  value: T;
  options: T[];
  state?: GateState;
  optionState?: (o: T) => GateState | undefined;
  onChange: (v: T) => void;
}) {
  const rowDead = nulled(state) && !optionState;
  return (
    <div title={state?.reason ?? def}>
      <div className={`mb-1.5 ${rowDead ? "text-ink-faint" : ""}`}>{label}</div>
      <div className={`flex border ${rowDead ? "border-hairline" : "border-rule"}`}>
        {options.map((o, i) => {
          const os = optionState?.(o);
          const dead = rowDead || nulled(os);
          const active = value === o;
          return (
            <button
              key={o}
              disabled={dead}
              title={os?.reason ?? undefined}
              onClick={() => onChange(o)}
              className={`eyebrow flex-1 px-1 py-2 transition-colors ${i > 0 ? "border-l border-hairline" : ""} ${
                active && !dead
                  ? "bg-ink text-paper"
                  : dead
                    ? "cursor-not-allowed text-ink-faint opacity-50"
                    : "text-ink-soft hover:bg-paper"
              }`}
            >
              {o}
              {os?.status === "preset" ? " ✓" : ""}
            </button>
          );
        })}
      </div>
      <Definition def={def} show={showDefs} />
      <Reason state={state} show={showDefs} />
    </div>
  );
}
