export default function MailLoading() {
  return (
    <div className="-m-6 grid h-[calc(100dvh-60px)] grid-cols-[220px_1fr] overflow-hidden">
      <div className="hidden animate-pulse border-r bg-muted/30 md:block" />
      <div className="space-y-px">{Array.from({ length: 8 }, (_, index) => <div key={index} className="h-[92px] animate-pulse border-b bg-muted/40" />)}</div>
    </div>
  )
}
