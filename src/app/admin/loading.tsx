import { BrandMark } from "@/components/brand-mark";

export default function AdminLoading() {
  return (
    <main className="min-h-screen bg-[#f4f6f5]" aria-busy="true" aria-label="Loading administration">
      <header className="border-b border-[#dfe5e0] bg-white">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center px-5 sm:px-8">
          <BrandMark href="/admin" />
        </div>
      </header>
      <div className="mx-auto max-w-[1600px] animate-pulse px-5 py-10 sm:px-8">
        <div className="h-3 w-24 rounded bg-[#dfe5e0]" />
        <div className="mt-4 h-8 w-64 rounded bg-[#dfe5e0]" />
        <div className="mt-3 h-4 w-96 max-w-full rounded bg-[#e6ebe7]" />
        <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((item) => <div className="h-40 rounded-xl border border-[#e2e7e3] bg-white" key={item} />)}
        </div>
        {[0, 1, 2].map((item) => <div className="mt-6 h-72 rounded-xl border border-[#e2e7e3] bg-white" key={item} />)}
      </div>
    </main>
  );
}
