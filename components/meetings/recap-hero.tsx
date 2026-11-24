// The top of a meeting's output: a charcoal recap card with the summary as
// one line per topic, what it read alongside the notes, and where the next
// meeting should focus. Same language as the deal handoff page.

const AMBER = "#FFBD83";
const IVORY = "#F7F4F0";

export function RecapHero({
  summary,
  focus,
  sources,
  clientName,
}: {
  summary: string;
  focus: string;
  sources?: { subject: string; date: string }[];
  clientName: string;
}) {
  const lines = summary
    .split("\n")
    .map((l) => l.trim().replace(/^[-•*]\s*/, ""))
    .filter(Boolean);
  return (
    <section className="relative overflow-hidden rounded-2xl" style={{ background: "#0F0F0F", color: IVORY }}>
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-32 h-80 w-80 rounded-full opacity-20 blur-3xl" style={{ background: AMBER }} />
      <div className="relative px-6 pb-5 pt-6">
        <div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.2em]" style={{ color: AMBER }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: AMBER }} />
          Meeting recap · {clientName}
        </div>
        <ul className="mt-4 space-y-2.5">
          {lines.map((l, i) => {
            const m = l.match(/^([^:]{2,40}):\s*(.+)$/);
            return (
              <li key={i} className="flex gap-3 text-[13.5px] leading-relaxed" style={{ color: "rgba(247,244,240,0.82)" }}>
                <span className="mt-[0.6em] h-1 w-3 flex-shrink-0 rounded-full" style={{ background: "rgba(255,189,131,0.7)" }} />
                <span>
                  {m ? (
                    <>
                      <span className="font-semibold" style={{ color: IVORY }}>
                        {m[1]}
                      </span>{" "}
                      {m[2]}
                    </>
                  ) : (
                    l
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      {focus ? (
        <div className="relative border-t px-6 py-4" style={{ borderColor: "rgba(247,244,240,0.08)" }}>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: "rgba(247,244,240,0.45)" }}>
            Next meeting focus
          </div>
          <p className="mt-1 text-[13px] leading-relaxed" style={{ color: IVORY }}>
            {focus}
          </p>
        </div>
      ) : null}
      {sources?.length ? (
        <div className="relative flex flex-wrap items-center gap-1.5 border-t px-6 py-3" style={{ borderColor: "rgba(247,244,240,0.08)" }}>
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: "rgba(247,244,240,0.45)" }}>
            Read with
          </span>
          {sources.slice(0, 4).map((s) => (
            <span
              key={s.subject + s.date}
              className="max-w-[16rem] truncate rounded-full px-2.5 py-0.5 text-[11px]"
              style={{ background: "rgba(247,244,240,0.08)", color: "rgba(247,244,240,0.75)" }}
              title={`${s.subject} · ${new Date(s.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
            >
              {s.subject.replace(/^(re|fw|fwd):\s*/i, "")}
            </span>
          ))}
          {sources.length > 4 ? <span className="text-[11px]" style={{ color: "rgba(247,244,240,0.5)" }}>+{sources.length - 4} more emails</span> : null}
        </div>
      ) : null}
    </section>
  );
}
