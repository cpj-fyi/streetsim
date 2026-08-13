import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { BlockScene } from "@/lib/scene/types";
import { TODAY_PLAN } from "@/lib/scene/types";
import { loadFixture } from "@/lib/scene/load";
import { woonerfEligibility } from "@/lib/scene/eligibility";
import { loadSceneById } from "@/lib/data/resolveById";
import { gate } from "@/lib/transforms/gate";
import { applyPlan } from "@/lib/transforms/apply";
import { computeMetrics } from "@/lib/metrics/compute";
import { renderScene } from "@/lib/render/render";
import { planFromParams } from "@/lib/plan";
import { AddressSearch } from "@/components/AddressSearch";
import { BlockStage } from "@/components/BlockStage";
import { PlanControls } from "@/components/PlanControls";
import { Vitals } from "@/components/Vitals";

/** The stage crops building context to a street band — the fade was already
    apologizing for the deep parcels; now they're simply out of frame. */
const CONTEXT_HALF_DEPTH_M = 35;

// Cache-miss resolution refetches 13 city layers (up to ~11 s cold).
export const maxDuration = 60;

/** One scene resolution per request, shared by generateMetadata and the page. */
const getScene = cache(async (name: string): Promise<BlockScene | null> => {
  try {
    return loadFixture(name);
  } catch {
    try {
      return await loadSceneById(decodeURIComponent(name));
    } catch {
      return null;
    }
  }
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ name: string }>;
}): Promise<Metadata> {
  const { name } = await params;
  const scene = await getScene(name);
  if (!scene) return { title: "Block not found" };
  const seg = scene.segment;
  const street = titleCase(seg.street);
  const description = `${street}, ${titleCase(seg.fromStreet)} to ${titleCase(seg.toStreet)}, ${seg.borough}. Redesign this block as a shared street and see honest, cited before and after numbers.`;
  return {
    title: street,
    description,
    openGraph: { title: `${street} · streetSim`, description },
  };
}

export default async function BlockPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { name } = await params;
  const sp = await searchParams;

  const scene = await getScene(name);
  if (!scene) notFound();

  const eligibility = woonerfEligibility(scene);
  const requested = planFromParams(sp);
  const gates = gate(scene, requested);
  // A survey oddity (e.g. a one-curb parse) must degrade to "here's the
  // street" — never a dead page. The reason is honest, not decorative.
  let after = scene;
  let metrics = null;
  let geometryError: string | null = null;
  if (eligibility.eligible) {
    try {
      after = applyPlan(scene, requested);
      metrics = computeMetrics(scene, after);
    } catch (e) {
      geometryError =
        "The surveyed geometry of this block has a shape the redesign engine cannot process. Showing the street as it is. (" +
        (e as Error).message +
        ")";
    }
  }
  const hasPlan =
    !geometryError && JSON.stringify(gates.normalized) !== JSON.stringify(TODAY_PLAN);

  const stageBounds = {
    minX: scene.bounds.minX,
    maxX: scene.bounds.maxX,
    minY: Math.max(scene.bounds.minY, -CONTEXT_HALF_DEPTH_M),
    maxY: Math.min(scene.bounds.maxY, CONTEXT_HALF_DEPTH_M),
  };
  const todaySvg = renderScene(scene, { idPrefix: "t", bounds: stageBounds });
  const afterSvg = renderScene(after, { idPrefix: "a", bounds: stageBounds });

  const seg = scene.segment;
  const s = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]);
  const street = titleCase(seg.street);
  const fromTo = `${titleCase(seg.fromStreet)} to ${titleCase(seg.toStreet)}`;
  const currentLocation = `${street}, ${fromTo}, ${seg.borough}`;

  return (
    <BlockStage
      todaySvg={todaySvg}
      afterSvg={afterSvg}
      hasPlan={hasPlan}
      ineligibleReason={eligibility.reason ?? geometryError}
      initialLeftOpen={s("dl") !== "0"}
      initialRightOpen={s("dr") !== "0"}
      identity={{
        street,
        fromTo: `${fromTo}, ${seg.borough}`,
        postedMph: scene.postedLimitMph,
        oneWay: scene.oneWay,
      }}
      left={
        <div className="flex flex-col gap-6">
          <section className="border-b border-hairline pb-6">
            <AddressSearch
              key={scene.segment.segmentId}
              label="Location"
              initialValue={currentLocation}
            />
          </section>
          <PlanControls
            plan={requested}
            applied={gates.normalized}
            gates={gates.states}
          />
        </div>
      }
      right={hasPlan && metrics ? <Vitals metrics={metrics} schoolZone={scene.schoolZone} /> : null}
    />
  );
}

function titleCase(str: string): string {
  return str
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
