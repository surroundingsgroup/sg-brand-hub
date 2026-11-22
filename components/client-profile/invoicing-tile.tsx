// Invoicing tile — surfaces this client's invoice state from the
// client-board INVOICING group. Each item is one invoice with a
// status (Sent/Paid/Overdue/…) and a free-text open balance line.
//
// Keeps accounting visibility at a glance without opening the
// Invoicing board — overdue or outstanding invoices get an amber
// callout so an AM knows to nudge.

import { Receipt } from "lucide-react";
import { Tile, TileEmpty } from "./tile";
import { findGroup, type ClientBoardData } from "@/lib/monday/client-board";

const STATUS_COL = "color_mm03nf9"; // Invoicing status column (Sent/Paid/Overdue/...)

function statusChipClass(status: string | null): string {
  const s = (status ?? "").toLowerCase();
  if (s.includes("paid")) return "bg-emerald-100 text-emerald-800";
  if (s.includes("overdue") || s.includes("past due")) return "bg-red-100 text-red-800";
  if (s.includes("sent")) return "bg-accent-soft text-accent-foreground";
  if (!s) return "bg-secondary text-muted-foreground";
  return "bg-secondary text-foreground/80";
}

function parseOpenBalance(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/open balance:?\s*\$?([\d,.]+)/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (isNaN(n)) return null;
  return `$${n.toLocaleString()}`;
}

export function InvoicingTile({ data }: { data: ClientBoardData }) {
  if (!data.found) {
    return (
      <Tile label="Invoicing" icon={<Receipt className="h-3.5 w-3.5" />}>
        <TileEmpty>No client board linked yet.</TileEmpty>
      </Tile>
    );
  }

  const invoices = findGroup(data, /invoicing/i).filter(
    // Skip the TEMPLATE placeholder row every board ships with.
    (i) => !/don'?t\s*touch|accounting\s*only|placeholder/i.test(i.name)
  );

  return (
    <Tile
      label="Invoicing"
      icon={<Receipt className="h-3.5 w-3.5" />}
      href={data.boardId
        ? `https://nauticalnetwork.monday.com/boards/${data.boardId}`
        : undefined}
      hrefLabel="Client board"
      hrefExternal
    >
      {invoices.length === 0 ? (
        <TileEmpty>No invoices logged yet.</TileEmpty>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border bg-secondary/20">
          {invoices.slice(0, 6).map((inv) => {
            const status = inv.columns[STATUS_COL]?.text ?? null;
            const balance = parseOpenBalance(
              inv.columns.long_text_mkz0ady4?.text ?? undefined
            );
            return (
              <li
                key={inv.id}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <a
                  href={inv.mondayUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 truncate text-sm text-foreground hover:text-accent-foreground"
                >
                  {inv.name}
                </a>
                <div className="flex items-center gap-2">
                  {balance ? (
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {balance}
                    </span>
                  ) : null}
                  {status ? (
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${statusChipClass(status)}`}
                    >
                      {status}
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Tile>
  );
}

// Helpers for the Needs-you bar — exported so the summary bar can
// surface overdue invoices as a top-level flag without re-parsing.
export function overdueInvoiceCount(data: ClientBoardData): number {
  if (!data.found) return 0;
  return findGroup(data, /invoicing/i).filter((i) => {
    const s = (i.columns[STATUS_COL]?.text ?? "").toLowerCase();
    return s.includes("overdue") || s.includes("past due");
  }).length;
}
