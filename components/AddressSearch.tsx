"use client";

import { useEffect, useId, useRef, useState } from "react";
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
export function AddressSearch({
  label = "Find a block",
  initialValue = "",
}: {
  label?: string;
  initialValue?: string;
}) {
  const [q, setQ] = useState(initialValue);
  const [hasEdited, setHasEdited] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);
  const [status, setStatus] = useState<
    "idle" | "loading" | "geocoder-down" | "block-down"
  >("idle");
  const [busy, setBusy] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [announcement, setAnnouncement] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputId = useId();
  const listboxId = `${inputId}-suggestions`;
  const errorId = `${inputId}-error`;
  const router = useRouter();

  useEffect(() => {
    if (!hasEdited) return;
    if (timer.current) clearTimeout(timer.current);
    const controller = new AbortController();
    const query = q.trim();
    timer.current = setTimeout(async () => {
      if (query.length < 3) {
        setHits([]);
        setStatus("idle");
        setAnnouncement("");
        return;
      }
      setStatus("loading");
      setAnnouncement("Searching NYC addresses.");
      try {
        const r = await fetch(
          `https://geosearch.planninglabs.nyc/v2/autocomplete?text=${encodeURIComponent(query)}&size=5`,
          { signal: controller.signal },
        );
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as {
          features?: Array<{ properties?: { label?: string }; geometry?: { coordinates?: [number, number] } }>;
        };
        const nextHits = (j.features ?? [])
          .filter((f) => f.properties?.label && f.geometry?.coordinates)
          .map((f) => ({
            label: f.properties!.label!,
            lon: f.geometry!.coordinates![0],
            lat: f.geometry!.coordinates![1],
          }));
        setHits(nextHits);
        setStatus("idle");
        setAnnouncement(
          nextHits.length === 0
            ? `No addresses found for ${query}.`
            : `${nextHits.length} address${nextHits.length === 1 ? "" : "es"} found.`,
        );
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        setHits([]);
        setStatus("geocoder-down");
        setAnnouncement("Unable to search NYC addresses. Check your connection and try again.");
      }
    }, query.length < 3 ? 0 : 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      controller.abort();
    };
  }, [hasEdited, q]);

  async function choose(h: Hit) {
    setBusy(h.label);
    setAnnouncement(`Loading city data for ${h.label}.`);
    try {
      const r = await fetch(`/api/block?lon=${h.lon}&lat=${h.lat}`);
      if (!r.ok) throw new Error(await r.text());
      const j = (await r.json()) as { name: string };
      router.push(`/block/${j.name}`);
    } catch {
      setBusy(null);
      setStatus("block-down");
      setAnnouncement("Unable to load city data for this block. Try again.");
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setHits([]);
      setActiveIndex(-1);
      return;
    }
    if (hits.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % hits.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (i <= 0 ? hits.length - 1 : i - 1));
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      void choose(hits[activeIndex]);
    }
  }

  const error =
    status === "geocoder-down"
      ? "Unable to search NYC addresses. Check your connection and try again."
      : status === "block-down"
        ? "Unable to load city data for this block. Try again."
        : null;

  return (
    <div className="relative max-w-xl">
      <label htmlFor={inputId} className="eyebrow mb-3 block text-ink-soft">
        {label}
      </label>
      <input
        id={inputId}
        type="search"
        value={q}
        onChange={(event) => {
          setQ(event.target.value);
          setHasEdited(true);
          setActiveIndex(-1);
        }}
        onKeyDown={onKeyDown}
        placeholder="372 Fifth Ave, Brooklyn"
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={hits.length > 0 && !busy}
        aria-controls={listboxId}
        aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
        aria-busy={status === "loading" || Boolean(busy)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="w-full border border-rule bg-panel px-4 py-3 text-base placeholder:text-ink-faint focus:bg-paper"
      />
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {error && (
        <p id={errorId} className="mt-2 text-[13px] leading-5 text-danger">
          {error}
        </p>
      )}
      {busy && (
        <p className="mt-2 text-[13px] text-ink-soft">
          Fetching city data for {busy}. First visit to a block takes a few
          seconds.
        </p>
      )}
      {hits.length > 0 && !busy && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Address suggestions"
          className="absolute z-20 mt-[-1px] w-full border border-rule bg-panel"
        >
          {hits.map((h, index) => (
            <li key={h.label} role="presentation">
              <button
                id={`${listboxId}-${index}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={activeIndex === index}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => void choose(h)}
                className={`w-full border-b border-hairline px-4 py-3 text-start text-[14px] last:border-0 ${
                  activeIndex === index ? "bg-paper" : "hover:bg-paper"
                }`}
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
