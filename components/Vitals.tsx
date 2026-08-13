"use client";

import { useState } from "react";
import type { Metrics } from "@/lib/metrics/compute";
import { NotesButton } from "@/components/NotesButton";

/**
 * Honest numbers, set like a print data page: serif hero numerals, ink rules,
 * tabular figures. Deltas keep semantic red/green — that is data encoding,
 * not decoration, and red is allowed. Crash history is fact (NYPD), not model.
 * Row notes (the italic teaching copy) collapse behind a footnote toggle so
 * the table can also read as pure figures.
 */
export function Vitals({
  metrics,
  schoolZone,
}: {
  metrics: Metrics;
  schoolZone: boolean;
}) {
  const m = metrics;
  const [showNotes, setShowNotes] = useState(false);
  return (
    <div className="vitals min-w-0">
      {/* Stacked stat tiles — this component now lives in a data column. */}
      <div className="grid gap-4">
        <Headline
          value={fmtInt(-m.headline.parkingSpacesRemoved)}
          label="parking spaces"
          tone={m.headline.parkingSpacesRemoved > 0 ? "danger" : "neutral"}
        />
        <Headline
          value={`+${fmtInt(m.headline.reclaimedSqFt)} sq ft`}
          label="public space reclaimed"
          tone={m.headline.reclaimedSqFt > 0 ? "ok" : "neutral"}
        />
        <Headline
          value={`+${fmtUsd(m.headline.upliftUsd.total)}`}
          label={
            m.headline.upliftUsd.total > 0
              ? `est. ${m.headline.upliftUsd.pct}% across ${m.headline.upliftUsd.lots} fronting lots`
              : `across ${m.headline.upliftUsd.lots} fronting lots, est.`
          }
          tone={m.headline.upliftUsd.total > 0 ? "ok" : "neutral"}
          note={showNotes ? m.headline.upliftUsd.note : undefined}
        />
      </div>

      <div className="mt-6 border border-rule bg-panel">
        <div className="flex min-h-12 items-center justify-between gap-3 border-b border-hairline bg-paper px-3 py-2">
          <h2 className="eyebrow">Block vitals · Before → After</h2>
          <NotesButton pressed={showNotes} onPressedChange={setShowNotes} />
        </div>
        <table className="w-full text-[13px]">
          <caption className="sr-only">
            Block vitals before and after the selected changes
          </caption>
          <tbody>
            <Row
              label="Design speed"
              before={`${fmt1(m.vitals.designSpeedMph.before)} mph`}
              after={`${fmt1(m.vitals.designSpeedMph.after)} mph`}
              good={m.vitals.designSpeedMph.after <= m.vitals.designSpeedMph.before}
            />
            <Row
              label="Street noise"
              before={`${fmt1(m.vitals.noiseDba.before)} dBA`}
              after={`${fmt1(m.vitals.noiseDba.after)} dBA`}
              good={m.vitals.noiseDba.after <= m.vitals.noiseDba.before}
            />
            <DeltaRow
              label={`Summer air, ${m.vitals.summerAirTempF.designDayF} °F day`}
              delta={m.vitals.summerAirTempF.deltaF}
              decimals={1}
              unit=" °F"
              caption={showNotes ? m.vitals.summerAirTempF.note : undefined}
              goodWhenNegative
            />
            <Row
              label="Fatality risk if struck"
              before={`${fmt1(m.vitals.fatalityRiskPct.before)}%`}
              after={`${fmt1(m.vitals.fatalityRiskPct.after)}%`}
              good={m.vitals.fatalityRiskPct.after <= m.vitals.fatalityRiskPct.before}
              caption={showNotes && schoolZone ? m.vitals.fatalityRiskPct.schoolCaption ?? undefined : undefined}
            />
            <Row
              label="Accessibility"
              before={`${fmtInt(m.vitals.accessibility.before)} / 100`}
              after={`${fmtInt(m.vitals.accessibility.after)} / 100`}
              good={m.vitals.accessibility.after >= m.vitals.accessibility.before}
              caption={showNotes ? m.vitals.accessibility.note : undefined}
            />
            <DeltaRow
              label="Emergency traversal"
              delta={m.vitals.emergencySeconds.delta}
              unit="s"
              caption={showNotes ? m.vitals.emergencySeconds.note : undefined}
              goodWhenNegative
            />
            <DeltaRow
              label="Delivery stops"
              delta={m.vitals.deliveryStops.delta}
              unit=""
              caption={showNotes ? m.vitals.deliveryStops.note : undefined}
              goodWhenNegative={false}
            />
            <DeltaRow
              label="City maintenance"
              delta={m.vitals.maintenanceUsdPerYear.delta}
              unit=" $/yr"
              goodWhenNegative
            />
            {m.retail.commercialFrontLots > 0 && (
              <>
                <tr className={showNotes ? "" : "border-b border-hairline"}>
                  <td className={`px-4 pt-3 text-ink-soft ${showNotes ? "pb-1" : "pb-3"}`}>
                    Foot traffic &amp; retail
                  </td>
                  <td className={`px-2 pt-3 text-right tabular-nums whitespace-nowrap text-ink-soft ${showNotes ? "pb-1" : "pb-3"}`}>
                    {m.retail.commercialFrontLots} lots
                  </td>
                  <td className="w-8 text-center text-ink-faint">→</td>
                  <td className={`px-4 pt-3 text-left tabular-nums whitespace-nowrap font-medium ${showNotes ? "pb-1" : "pb-3"}`}>
                    {m.retail.comparablesPctRange ? (
                      <span className="text-ok">
                        +{m.retail.comparablesPctRange[0]} to{" "}
                        {m.retail.comparablesPctRange[1]}% sales
                      </span>
                    ) : (
                      <span className="text-ink-soft">no change proposed</span>
                    )}
                  </td>
                </tr>
                {showNotes && <CaptionRow caption={m.retail.note} />}
              </>
            )}
          </tbody>
        </table>
      </div>

      <p className="serif mt-5 max-w-3xl text-[15px] italic leading-6 text-ink-soft">
        <span className="not-italic font-semibold text-ink">
          {fmtInt(m.crash.injuries)} injuries, {fmtInt(m.crash.fatalities)}{" "}
          {m.crash.fatalities === 1 ? "death" : "deaths"} on this block since{" "}
          {m.crash.sinceYear}
        </span>{" "}
        (NYPD collision data).
        {m.crash.projectedReductionPct.high > 0 && (
          <>
            {" "}
            Comparable calming projects reduced injury crashes by{" "}
            {m.crash.projectedReductionPct.low} to {m.crash.projectedReductionPct.high}%.
          </>
        )}
      </p>
    </div>
  );
}

function Headline({
  value,
  label,
  tone,
  note,
}: {
  value: string;
  label: string;
  tone: "ok" | "danger" | "neutral";
  note?: string;
}) {
  const color =
    tone === "ok" ? "text-ok" : tone === "danger" ? "text-danger" : "text-ink";
  return (
    <div className="border border-rule bg-panel px-4 pb-3 pt-4">
      <div className={`serif text-[30px] leading-none tabular-nums ${color}`}>{value}</div>
      <div className="eyebrow mt-2.5 text-ink-soft">{label}</div>
      {note && (
        <p className="serif mt-2 text-[13px] italic leading-[1.35] text-ink-faint">{note}</p>
      )}
    </div>
  );
}

/** Caption spans the full table width under its numbers — a footnote line,
    not a squeezed label cell (matters in the narrow data column). */
function CaptionRow({ caption }: { caption?: string }) {
  if (!caption) return null;
  return (
    <tr className="border-b border-hairline">
      <td colSpan={4} className="px-4 pb-3 pt-0">
        <div className="serif text-[13px] italic leading-[1.35] text-ink-faint">
          {caption}
        </div>
      </td>
    </tr>
  );
}

function Row({
  label,
  before,
  after,
  good,
  caption,
}: {
  label: string;
  before: string;
  after: string;
  good: boolean;
  caption?: string;
}) {
  const changed = before !== after;
  return (
    <>
      <tr className={caption ? "" : "border-b border-hairline"}>
        <td className={`px-4 pt-3 text-ink-soft ${caption ? "pb-1" : "pb-3"}`}>{label}</td>
        <td className={`px-2 pt-3 text-right tabular-nums whitespace-nowrap ${caption ? "pb-1" : "pb-3"}`}>{before}</td>
        <td className="w-8 text-center text-ink-faint">→</td>
        <td
          className={`px-4 pt-3 text-left tabular-nums whitespace-nowrap font-medium ${caption ? "pb-1" : "pb-3"} ${
            !changed ? "text-ink-soft" : good ? "text-ok" : "text-danger"
          }`}
        >
          {after}
          {changed && (
            <span className="sr-only">, {good ? "improvement" : "tradeoff"}</span>
          )}
        </td>
      </tr>
      <CaptionRow caption={caption} />
    </>
  );
}

function DeltaRow({
  label,
  delta,
  unit,
  caption,
  goodWhenNegative,
  decimals = 0,
}: {
  label: string;
  delta: number;
  unit: string;
  caption?: string;
  goodWhenNegative: boolean;
  decimals?: number;
}) {
  const good = goodWhenNegative ? delta <= 0 : delta >= 0;
  const sign = delta > 0 ? "+" : "";
  return (
    <>
      <tr className={caption ? "" : "border-b border-hairline"}>
        <td className={`px-4 pt-3 text-ink-soft ${caption ? "pb-1" : "pb-3"}`}>{label}</td>
        <td />
        <td className="w-8 text-center text-ink-faint">Δ</td>
        <td
          className={`px-4 pt-3 text-left tabular-nums whitespace-nowrap font-medium ${caption ? "pb-1" : "pb-3"} ${
            delta === 0 ? "text-ink-soft" : good ? "text-ok" : "text-danger"
          }`}
        >
          {sign}
          {decimals > 0 ? fmt1(delta) : fmtNum(delta)}
          {unit}
          {delta !== 0 && (
            <span className="sr-only">, {good ? "improvement" : "tradeoff"}</span>
          )}
        </td>
      </tr>
      <CaptionRow caption={caption} />
    </>
  );
}

const fmtInt = (v: number) => {
  const r = Math.round(v);
  return (Object.is(r, -0) ? 0 : r).toLocaleString("en-US");
};
const fmt1 = (v: number) =>
  (Math.round(v * 10) / 10).toLocaleString("en-US", { maximumFractionDigits: 1 });
const fmtNum = (v: number) => Math.round(v).toLocaleString("en-US");
const fmtUsd = (v: number) =>
  v >= 1_000_000
    ? `$${(v / 1_000_000).toFixed(1)}M`
    : v >= 1_000
      ? `$${Math.round(v / 1_000)}K`
      : `$${Math.round(v)}`;
