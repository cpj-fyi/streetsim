import fs from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { BlockScene } from "@/lib/scene/types";
import { TODAY_PLAN } from "@/lib/scene/types";
import { loadFixture } from "@/lib/scene/load";
import { woonerfEligibility } from "@/lib/scene/eligibility";
import { getCachedScene } from "@/lib/cache";
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

export default async function BlockPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { name } = await params;
  const sp = await searchParams;

  let scene: BlockScene | null = null;
  try {
    scene = loadFixture(name);
  } catch {
    scene = await getCachedScene(decodeURIComponent(name));
  }
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

  return (
    <BlockStage
      todaySvg={todaySvg}
      afterSvg={afterSvg}
      hasPlan={hasPlan}
      ineligibleReason={eligibility.reason ?? geometryError}
      initialLeftOpen={s("dl") !== "0"}
      initialRightOpen={s("dr") !== "0"}
      cartouche={{
        street: titleCase(seg.street),
        fromTo: `${titleCase(seg.fromStreet)} to ${titleCase(seg.toStreet)}`,
        borough: seg.borough,
        postedMph: scene.postedLimitMph,
        oneWay: scene.oneWay,
        school: scene.school
          ? { name: scene.school.name, distanceFt: scene.school.distanceFt }
          : null,
        plaza: scene.existingPedestrianized
          ? { name: scene.existingPedestrianized.name }
          : null,
      }}
      left={
        <div className="flex flex-col gap-6">
          <section>
            <div className="eyebrow mb-3 text-ink-soft">Location</div>
            <AddressSearch />
            <FixtureLinks current={name} />
          </section>
          <PlanControls
            plan={requested}
            applied={gates.normalized}
            gates={gates.states}
            schoolZone={scene.schoolZone}
            columns={false}
          />
        </div>
      }
      right={metrics ? <Vitals metrics={metrics} schoolZone={scene.schoolZone} /> : null}
    />
  );
}

function FixtureLinks({ current }: { current: string }) {
  let fixtures: Array<{ name: string; label: string }> = [];
  try {
    fixtures = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "fixtures", "manifest.json"), "utf8"),
    ) as Array<{ name: string; label: string }>;
  } catch {
    return null;
  }
  return (
    <div className="mt-3 flex flex-col gap-1.5">
      {fixtures.map((f) => (
        <Link
          key={f.name}
          href={`/block/${f.name}`}
          className={`text-[13px] ${f.name === current ? "font-semibold text-ink" : "text-ink-soft hover:text-ink"}`}
        >
          {f.label}
        </Link>
      ))}
    </div>
  );
}

function titleCase(str: string): string {
  return str
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
