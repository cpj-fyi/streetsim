"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Hit {
  label: string;
  lon: number;
  lat: number;
}

/**
 * NYC GeoSearch autocomplete. Degrades honestly: if the geocoder is
 * unreachable, say so — never pretend to search.
 */
export function AddressSearch() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "down">("idle");
  const [busy, setBusy] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const query = q.trim();
    timer.current = setTimeout(async () => {
      if (query.length < 3) {
        setHits([]);
        setStatus("idle");
        return;
      }
      setStatus("loading");
      try {
        const r = await fetch(
          `https://geosearch.planninglabs.nyc/v2/autocomplete?text=${encodeURIComponent(q)}&size=5`,
        );
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as {
          features?: Array<{ properties?: { label?: string }; geometry?: { coordinates?: [number, number] } }>;
        };
        setHits(
          (j.features ?? [])
            .filter((f) => f.properties?.label && f.geometry?.coordinates)
            .map((f) => ({
              label: f.properties!.label!,
              lon: f.geometry!.coordinates![0],
              lat: f.geometry!.coordinates![1],
            })),
        );
        setStatus("idle");
      } catch {
        setHits([]);
        setStatus("down");
      }
    }, query.length < 3 ? 0 : 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  async function choose(h: Hit) {
    setBusy(h.label);
    try {
      const r = await fetch(`/api/block?lon=${h.lon}&lat=${h.lat}`);
      if (!r.ok) throw new Error(await r.text());
      const j = (await r.json()) as { name: string };
      router.push(`/block/${j.name}`);
    } catch {
      setBusy(null);
      setStatus("down");
    }
  }

  return (
    <div className="relative max-w-xl">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Type an NYC address, e.g. 372 Fifth Avenue, Brooklyn"
        className="w-full border border-rule bg-panel px-4 py-3 text-[15px] outline-none placeholder:text-ink-faint focus:bg-paper"
      />
      {status === "down" && (
        <p className="mt-2 text-[13px] text-danger">
          The NYC geocoder is not answering right now. The sample blocks below
          still work.
        </p>
      )}
      {busy && (
        <p className="mt-2 text-[13px] text-ink-soft">
          Fetching city data for {busy}. First visit to a block takes a few
          seconds.
        </p>
      )}
      {hits.length > 0 && !busy && (
        <ul className="absolute z-10 mt-[-1px] w-full border border-rule bg-panel">
          {hits.map((h) => (
            <li key={h.label}>
              <button
                onClick={() => choose(h)}
                className="w-full border-b border-hairline px-4 py-2.5 text-left text-[14px] last:border-0 hover:bg-paper"
              >
                {h.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
