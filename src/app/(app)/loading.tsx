export default function ProductLoading() {
  return (
    <div aria-label="Loading page" className="animate-pulse" role="status">
      <div className="h-8 w-40 rounded-lg bg-[#e5eae6]" />
      <div className="mt-3 h-4 w-80 max-w-full rounded bg-[#e8ece9]" />
      <div className="mt-8 h-[420px] rounded-xl border border-[#e2e7e3] bg-white" />
    </div>
  );
}
