import { AddressSearch } from "@/components/AddressSearch";

export default function Home() {
  return (
    <main className="flex min-h-dvh w-full flex-1 items-center px-5 py-12 sm:px-8 sm:py-16">
      <section className="mx-auto w-full max-w-3xl" aria-labelledby="home-introduction">
        <h1
          id="home-introduction"
          className="serif max-w-[24ch] text-balance text-[clamp(2.25rem,6vw,4.75rem)] font-normal leading-[1.03] tracking-[-0.035em]"
        >
          Redesign the shape of any block in NYC, and see what those changes
          will do to safety, accessibility, and value.
        </h1>
        <div className="mt-10 max-w-xl sm:mt-12">
          <AddressSearch label="Find a block" />
        </div>
      </section>
    </main>
  );
}
