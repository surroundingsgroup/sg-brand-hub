// Shared by the meeting composer and the saved meeting page.

// The summary as a read-only list: one line per topic, the topic in bold.
export function SummaryList({ text }: { text: string }) {
  const lines = text
    .split("\n")
    .map((l) => l.trim().replace(/^[-•*]\s*/, ""))
    .filter(Boolean);
  if (!lines.length) return <p className="text-[13px] text-muted-foreground">Nothing to summarize.</p>;
  return (
    <ul className="space-y-2">
      {lines.map((l, i) => {
        const m = l.match(/^([^:]{2,40}):\s*(.+)$/);
        return (
          <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-foreground/90">
            <span className="mt-[0.55em] h-1 w-1 flex-shrink-0 rounded-full bg-foreground/50" />
            <span>
              {m ? (
                <>
                  <span className="font-semibold text-foreground">{m[1]}:</span> {m[2]}
                </>
              ) : (
                l
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

