export default function InboxLoading() {
  return (
    <div aria-label="Loading Inbox" className="animate-pulse" role="status">
      <div className="h-8 w-28 rounded-lg bg-[#e4e9e5]" />
      <div className="mt-2 h-4 w-80 max-w-full rounded bg-[#e8ece9]" />
      <div className="mt-7 grid h-[620px] grid-cols-[330px_1fr] overflow-hidden rounded-xl border border-[#e2e7e3] bg-white">
        <div className="space-y-3 border-r border-[#e2e7e3] p-4"><div className="h-9 rounded-lg bg-[#edf0ee]" />{Array.from({ length: 6 }, (_, index) => <div className="h-16 rounded-lg bg-[#f0f3f1]" key={index} />)}</div>
        <div className="bg-[#f6f8f6]" />
      </div>
    </div>
  );
}
