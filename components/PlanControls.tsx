"use client";

import { useId, useState } from "react";
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
import { NotesButton } from "@/components/NotesButton";

interface Props {
  /** The requested plan from the URL. Every interaction preserves this intent. */
  plan: InterventionPlan;
  /** The gate-normalized plan that the plate actually shows. */
  applied: InterventionPlan;
  gates: GateState[];
}

/** One-line definitions, folded behind the Definitions control. */
const DEFS = {
  parking:
    "Keep retains all legal spaces. Reduce retains about half in mid-block groups. Remove converts the curb lane to public space.",
  parklet: "Converts two parking spaces to a seating deck.",
  jog: "Offsets the travel path so drivers cannot hold a straight line.",
  medianIslands: "Adds raised center refuges that shorten the crossing.",
  gateways: "Adds raised, narrowed entries. One-way blocks use the entry end only.",
  streetTrees: "Adds tree pits in reclaimed curb space, clear of cycle tracks.",
  bikeLane: "Adds a raised cycle track in a fully reclaimed curb lane.",
  loadingZone: "Reserves a 12 m curb bay for deliveries.",
  sharedSurface:
    "Removes the curb only after gateways and a chicane create a protected, winding access route.",
  surface: "Sets the unit paving. Rectangular pavers and rounded cobbles use distinct patterns.",
} as const;

const PLAN_KEYS = [
  "rpl",
  "rpr",
  "gw",
  "jog",
  "isl",
  "trees",
  "pklt",
  "bike",
  "lz",
  "shared",
  "surf",
];

export function PlanControls({ plan, applied, gates }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [showDefs, setShowDefs] = useState(false);
  const g = (id: ControlId): GateState | undefined =>
    gates.find((state) => state.control === id);

  function push(next: InterventionPlan) {
    const params = new URLSearchParams(sp.toString());
    for (const key of PLAN_KEYS) params.delete(key);
    for (const [key, value] of paramsFromPlan(next)) params.set(key, value);
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  const set = <K extends keyof InterventionPlan>(key: K, value: InterventionPlan[K]) =>
    push({ ...plan, [key]: value });
  const dirty = JSON.stringify(plan) !== JSON.stringify(TODAY_PLAN);

  return (
    <div className="border border-rule bg-panel text-[13px]">
      <div className="flex min-h-12 items-center justify-between gap-3 bg-paper px-3 py-2">
        <div className="flex items-center gap-2.5">
          <h2 className="eyebrow text-ink">Edit plan</h2>
          <span className={`eyebrow ${dirty ? "text-ink-soft" : "text-ink-faint"}`}>
            {dirty ? "Edited" : "Today"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <NotesButton pressed={showDefs} onPressedChange={setShowDefs} />
          <button
            type="button"
            onClick={() => push(TODAY_PLAN)}
            disabled={!dirty}
            className={`min-h-9 shrink-0 border px-2.5 text-[11px] font-semibold transition-colors ${
              dirty
                ? "border-rule bg-panel text-ink hover:bg-paper active:bg-hairline"
                : "cursor-not-allowed border-hairline text-ink-faint opacity-60"
            }`}
          >
            Reset
          </button>
        </div>
      </div>

      <div>
        <Section label="Curb use">
          <SegmentedRow<ParkingAction>
            label="Left curb parking"
            def={DEFS.parking}
            showDefs={showDefs}
            value={applied.parking.left}
            options={["keep", "reduce", "remove"]}
            state={g("parking.left")}
            optionState={(option) =>
              option !== "keep" && g("parking.left")?.status !== "enabled"
                ? g("parking.left")
                : undefined
            }
            onChange={(value) => set("parking", { ...plan.parking, left: value })}
          />
          <SegmentedRow<ParkingAction>
            label="Right curb parking"
            def={DEFS.parking}
            showDefs={showDefs}
            value={applied.parking.right}
            options={["keep", "reduce", "remove"]}
            state={g("parking.right")}
            optionState={(option) =>
              option !== "keep" && g("parking.right")?.status !== "enabled"
                ? g("parking.right")
                : undefined
            }
            onChange={(value) => set("parking", { ...plan.parking, right: value })}
          />
          <ToggleRow
            label="Add a parklet"
            def={DEFS.parklet}
            showDefs={showDefs}
            checked={applied.parklet}
            state={g("parklet")}
            onChange={(value) => set("parklet", value)}
          />
          <ToggleRow
            label="Add a loading zone"
            def={DEFS.loadingZone}
            showDefs={showDefs}
            checked={applied.loadingZone}
            state={g("loadingZone")}
            onChange={(value) => set("loadingZone", value)}
          />
        </Section>

        <Section label="Street geometry">
          <SegmentedRow<JogLevel>
            label="Chicane"
            def={DEFS.jog}
            showDefs={showDefs}
            value={applied.jog}
            options={["none", "light", "medium", "heavy"]}
            state={g("jog")}
            optionState={(option) =>
              option === "heavy" ? g("jog.heavy") : undefined
            }
            onChange={(value) => set("jog", value)}
          />
          <ToggleRow
            label="Add median islands"
            def={DEFS.medianIslands}
            showDefs={showDefs}
            checked={applied.medianIslands}
            state={g("medianIslands")}
            onChange={(value) => set("medianIslands", value)}
          />
          <ToggleRow
            label="Add entry gateways"
            def={DEFS.gateways}
            showDefs={showDefs}
            checked={applied.gateways}
            state={g("gateways")}
            onChange={(value) => set("gateways", value)}
          />
        </Section>

        <Section label="Public realm">
          <ToggleRow
            label="Add street trees"
            def={DEFS.streetTrees}
            showDefs={showDefs}
            checked={applied.streetTrees}
            state={g("streetTrees")}
            onChange={(value) => set("streetTrees", value)}
          />
          <SegmentedRow<"none" | "left" | "right">
            label="Cycle track"
            def={DEFS.bikeLane}
            showDefs={showDefs}
            value={applied.bikeLane}
            options={["none", "left", "right"]}
            state={g(plan.bikeLane === "left" ? "bikeLane.left" : "bikeLane.right")}
            optionState={(option) =>
              option === "none"
                ? undefined
                : g(option === "left" ? "bikeLane.left" : "bikeLane.right")
            }
            onChange={(value) => set("bikeLane", value)}
          />
          <ToggleRow
            label="Create a shared plaza"
            def={DEFS.sharedSurface}
            showDefs={showDefs}
            checked={applied.sharedSurface}
            state={g("sharedSurface")}
            onChange={(value) => set("sharedSurface", value)}
          />
          <SegmentedRow<SurfaceKind>
            label="Paving"
            def={DEFS.surface}
            showDefs={showDefs}
            value={applied.surface}
            options={["asphalt", "pavers", "cobbles"]}
            state={g("surface")}
            onChange={(value) => set("surface", value)}
          />
        </Section>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="border-t border-rule">
      <h3 id={id} className="eyebrow bg-paper px-3 py-2 text-ink-soft">
        {label}
      </h3>
      <div className="divide-y divide-hairline px-3">{children}</div>
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

function statusLabel(state?: GateState): string | null {
  if (state?.status === "preset") return "Built today";
  if (state?.status === "absorbed") return "Included";
  return null;
}

function Guidance({
  def,
  state,
  show,
  id,
}: {
  def: string;
  state?: GateState;
  show: boolean;
  id: string;
}) {
  const reason = state?.status !== "enabled" ? state?.reason : null;
  if (!show && !reason) return null;
  return (
    <div id={id} className={show ? "mt-2 space-y-1.5" : "sr-only"}>
      {show && <p className="serif text-[13px] italic leading-[1.4] text-ink-faint">{def}</p>}
      {reason && (
        <p className="serif text-[13px] italic leading-[1.4] text-ink-soft">{reason}</p>
      )}
    </div>
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
  onChange: (value: boolean) => void;
}) {
  const inputId = useId();
  const guidanceId = `${inputId}-guidance`;
  const dead = nulled(state);
  const shownChecked = state?.status === "preset" ? true : state?.status === "disabled" ? false : checked;
  const badge = statusLabel(state);
  const hasGuidance = showDefs || Boolean(state?.reason);

  return (
    <div className="py-3" title={state?.reason ?? def}>
      <label
        htmlFor={inputId}
        className={`flex min-h-11 items-center justify-between gap-4 ${
          dead ? "cursor-not-allowed text-ink-faint" : "cursor-pointer text-ink"
        }`}
      >
        <span className="leading-[1.35]">
          {label}
          {badge && (
            <span aria-hidden="true" className="eyebrow ms-2 text-ink-faint">
              {badge}
            </span>
          )}
        </span>
        <input
          id={inputId}
          type="checkbox"
          checked={shownChecked}
          disabled={dead}
          aria-describedby={hasGuidance ? guidanceId : undefined}
          onChange={(event) => onChange(event.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className={`relative h-5 w-9 shrink-0 border peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink ${
            dead
              ? shownChecked
                ? "border-hairline bg-ink/20 opacity-60"
                : "border-hairline bg-paper opacity-60"
              : shownChecked
                ? "border-ink bg-ink"
                : "border-rule bg-paper"
          }`}
        >
          <span
            className={`absolute start-[2px] top-[2px] size-3.5 transition-transform ${
              shownChecked ? "translate-x-4 bg-paper" : "bg-ink-faint"
            }`}
          />
        </span>
      </label>
      <Guidance def={def} state={state} show={showDefs} id={guidanceId} />
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
  optionState?: (option: T) => GateState | undefined;
  onChange: (value: T) => void;
}) {
  const labelId = useId();
  const guidanceId = `${labelId}-guidance`;
  const rowDead = nulled(state) && !optionState;
  const optionReasonState = options
    .map((option) => optionState?.(option))
    .find((optionGate) => optionGate?.reason);
  const guidanceState = state?.reason ? state : optionReasonState;
  const hasGuidance = showDefs || Boolean(guidanceState?.reason);

  return (
    <div className="py-3" title={state?.reason ?? def}>
      <div id={labelId} className={`mb-2 leading-[1.35] ${rowDead ? "text-ink-faint" : "text-ink"}`}>
        {label}
        {statusLabel(state) && (
          <span aria-hidden="true" className="eyebrow ms-2 text-ink-faint">
            {statusLabel(state)}
          </span>
        )}
      </div>
      <div
        role="group"
        aria-labelledby={labelId}
        aria-describedby={hasGuidance ? guidanceId : undefined}
        className={`grid border ${rowDead ? "border-hairline" : "border-rule"}`}
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((option, index) => {
          const optionGate = optionState?.(option);
          const dead = rowDead || nulled(optionGate);
          const active = value === option;
          return (
            <button
              key={option}
              type="button"
              disabled={dead}
              aria-pressed={active}
              title={optionGate?.reason ?? undefined}
              onClick={() => onChange(option)}
              className={`eyebrow min-h-10 px-1.5 transition-colors ${
                index > 0 ? "border-s border-hairline" : ""
              } ${
                active && !dead
                  ? "bg-ink text-paper"
                  : dead
                    ? "cursor-not-allowed bg-paper text-ink-faint opacity-55"
                    : "bg-panel text-ink-soft hover:bg-paper hover:text-ink"
              }`}
            >
              {option}
              {optionGate?.status === "preset" ? " ✓" : ""}
            </button>
          );
        })}
      </div>
      <Guidance def={def} state={guidanceState} show={showDefs} id={guidanceId} />
    </div>
  );
}
