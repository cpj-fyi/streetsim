import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { AddressSearch } from "@/components/AddressSearch";
import { examplePlanForKind, paramsFromPlan } from "@/lib/plan";

interface ManifestEntry {
  name: string;
  label: string;
  kind: string;
}

function readManifest(): ManifestEntry[] {
  try {
    const p = path.join(process.cwd(), "fixtures", "manifest.json");
    return JSON.parse(fs.readFileSync(p, "utf8")) as ManifestEntry[];
  } catch {
    return [];
  }
}

const KIND_NOTES: Record<string, string> = {
  "wide-oneway": "A wide one-way. The kind of block that invites speed.",
  "narrow-twoway": "A narrow two-way. Tight, trafficked, negotiable.",
  school: "A school block. Children cross here every morning.",
};

const KIND_EDITS: Record<string, string> = {
  "wide-oneway": "Heavy chicane, trees, paved plaza",
  "narrow-twoway": "Reduced parking, gateways, paved plaza",
  school: "Chicane, gateways, paved plaza",
};

export default function Home() {
  const fixtures = readManifest();
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <header className="border-b border-rule pb-6">
        <h1 className="eyebrow">streetSim · New York City</h1>
        <p className="serif mt-5 max-w-xl text-[22px] leading-8">
          Any New York City block, drawn from the city&rsquo;s own survey data.
          Redesign it as a shared street and see what changes, with cited
          numbers that concede as much as they claim.
        </p>
      </header>

      <div className="mt-10">
        <AddressSearch label="Find a block" />
      </div>

      <div className="mt-14">
        <div className="eyebrow text-ink-soft">Or start from a block we know</div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {fixtures.length === 0 && (
            <p className="text-sm text-ink-faint">
              No cached blocks yet. Run <code>npm run fixtures</code>.
            </p>
          )}
          {fixtures.map((f) => {
            const query = paramsFromPlan(examplePlanForKind(f.kind)).toString();
            return (
              <Link
                key={f.name}
                href={`/block/${f.name}?${query}`}
                className="group flex min-h-44 flex-col border border-rule bg-panel p-5 transition-colors hover:bg-paper"
              >
                <div className="text-[14px] font-semibold leading-[1.4] text-pretty">{f.label}</div>
                <div className="serif mt-2 text-[14px] italic leading-[1.45] text-ink-soft text-pretty">
                  {KIND_NOTES[f.kind] ?? ""}
                </div>
                <div className="mt-auto border-t border-hairline pt-3">
                  <div className="eyebrow text-ink-faint">Edited example</div>
                  <div className="mt-1.5 text-[12px] leading-[1.4] text-ink-soft">
                    {KIND_EDITS[f.kind] ?? KIND_EDITS.school}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      <footer className="mt-24 flex flex-wrap justify-between gap-x-6 gap-y-2 border-t border-rule pt-3">
        <span className="eyebrow text-ink-soft">
          Geometry NYC Planimetrics · Values PLUTO · Crashes NYPD · Limits DOT
        </span>
        <span className="eyebrow text-ink-soft">Every constant sourced in model.md</span>
      </footer>
    </main>
  );
}
