export default function Loading() {
  return (
    <div className="grid min-h-screen place-items-center bg-[#f6f7f9]" role="status">
      <div className="flex items-center gap-3 text-sm font-medium text-[#68736c]">
        <span className="size-2 animate-pulse rounded-full bg-[#246b4a]" />
        Loading Riink…
      </div>
    </div>
  );
}
