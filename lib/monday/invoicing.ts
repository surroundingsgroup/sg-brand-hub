// Invoices, as tracked on the Monday "Invoicing" board (18440709300).
//
// Every invoice is a row. The group it sits in is its state: Open (to be
// sent), Sent (awaiting payment), Unpaid / Overdue, Paid, and a separate
// group for travel and reimbursements. The invoices themselves are sent from
// QuickBooks; this board is where their state is kept for the team, so the
// numbers here are only as current as the board.
//
// Used by the Invoicing card on the client page and the all-clients
// invoicing page.

const API = "https://api.monday.com/v2";
export const INVOICING_BOARD = 18440709300;
export const INVOICING_BOARD_URL = `https://nauticalnetwork.monday.com/boards/${INVOICING_BOARD}`;

const COL = {
  billTo: "text_mm98apgb",
  memo: "long_text_mm989qvy",
  requested: "date_mm985w7w",
  amount: "numeric_mm98ppdr",
  type: "color_mm98cyw1",
  clientBoard: "link_mm98c53s",
  travelAmount: "numeric_mm983vas",
  travelStatus: "color_mm987ntd",
  billable: "color_mm98hag",
  // Added 2026-11-23 for QuickBooks: filled by hand today, by the sync once it exists.
  invoiceNumber: "text_mm9ckpnk",
  invoiceDate: "date_mm9chz53",
  dueDate: "date_mm9cbvzn",
  balance: "numeric_mm9cqxg5",
} as const;

export type InvoiceState = "open" | "sent" | "overdue" | "paid" | "travel";
export type InvoiceKind = "retainer" | "one-time" | "upsell" | null;

export type InvoiceRow = {
  id: string;
  name: string;
  state: InvoiceState;
  kind: InvoiceKind;
  billTo: string;
  memo: string;
  requested: string | null; // YYYY-MM-DD, the day the invoice was asked for
  invoiceNumber: string; // the QuickBooks invoice number, when it is on the row
  invoiceDate: string | null; // the date on the invoice
  dueDate: string | null;
  billed: string | null; // the date that decides its month: the invoice date, or the request date before there is one
  balance: number | null; // what is still owed, from QuickBooks; null when not filled in
  amount: number; // the invoice amount
  travelAmount: number;
  travelStatus: string | null;
  billableTravel: boolean;
  clientBoardId: string | null;
  url: string;
};

const stateOf = (group: string): InvoiceState =>
  /travel|reimburse/i.test(group) ? "travel" : /paid/i.test(group) && !/unpaid/i.test(group) ? "paid" : /unpaid|overdue/i.test(group) ? "overdue" : /sent|awaiting/i.test(group) ? "sent" : "open";

const kindOf = (label: string): InvoiceKind => (/upsell/i.test(label) ? "upsell" : /retainer/i.test(label) ? "retainer" : /one.?time/i.test(label) ? "one-time" : null);

type Item = { id: string; name: string; group: { title: string }; column_values: { id: string; text: string | null }[] };

export async function fetchInvoices(): Promise<{ ok: boolean; rows: InvoiceRow[] }> {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) return { ok: false, rows: [] };
  const call = async <T,>(query: string, variables: Record<string, unknown> = {}): Promise<T> => {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2025-04" },
      body: JSON.stringify({ query, variables }),
      next: { revalidate: 120 },
    });
    const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (json.errors?.length || !json.data) throw new Error(json.errors?.map((e) => e.message).join("; ") ?? `HTTP ${res.status}`);
    return json.data;
  };
  try {
    const rows: InvoiceRow[] = [];
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
    const fields = `cursor items{ id name group{ title } column_values(ids:${JSON.stringify(Object.values(COL))}){ id text } }`;
    let cursor: string | null = null;
    for (let guard = 0; guard < 20; guard++) {
      const page: { cursor: string | null; items: Item[] } = cursor
        ? (await call<{ next_items_page: { cursor: string | null; items: Item[] } }>(`query($c:String!){ next_items_page(limit:200, cursor:$c){ ${fields} } }`, { c: cursor })).next_items_page
        : (await call<{ boards: { items_page: { cursor: string | null; items: Item[] } }[] }>(`query{ boards(ids:[${INVOICING_BOARD}]){ items_page(limit:200){ ${fields} } } }`)).boards[0].items_page;
      for (const it of page.items) {
        const v = (id: string) => (it.column_values.find((c) => c.id === id)?.text ?? "").trim();
        const board = /boards\/(\d+)/.exec(v(COL.clientBoard));
        const requested = v(COL.requested).slice(0, 10) || null;
        const invoiceDate = v(COL.invoiceDate).slice(0, 10) || null;
        const dueDate = v(COL.dueDate).slice(0, 10) || null;
        const group = stateOf(it.group.title);
        rows.push({
          id: String(it.id),
          name: it.name.trim(),
          // A sent invoice past its due date is overdue, whether or not the row has been moved yet.
          state: group === "sent" && dueDate && dueDate < today ? "overdue" : group,
          kind: kindOf(v(COL.type)),
          billTo: v(COL.billTo),
          memo: v(COL.memo),
          requested,
          invoiceNumber: v(COL.invoiceNumber),
          invoiceDate,
          dueDate,
          billed: invoiceDate ?? requested,
          balance: v(COL.balance) === "" ? null : Number(v(COL.balance)) || 0,
          amount: Number(v(COL.amount)) || 0,
          travelAmount: Number(v(COL.travelAmount)) || 0,
          travelStatus: v(COL.travelStatus) || null,
          billableTravel: !/absorbed/i.test(v(COL.billable)),
          clientBoardId: board ? board[1] : null,
          url: `${INVOICING_BOARD_URL}/pulses/${it.id}`,
        });
      }
      cursor = page.cursor;
      if (!cursor) break;
    }
    return { ok: true, rows };
  } catch {
    return { ok: false, rows: [] };
  }
}

const squash = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");

/** This client's invoices: tied by the client board first, by the "Bill To" name second. */
export function invoicesFor(rows: InvoiceRow[], brand: { business_name: string; monday_board_id?: string | number | null }): InvoiceRow[] {
  const boardId = brand.monday_board_id ? String(brand.monday_board_id) : null;
  const name = squash(brand.business_name);
  return rows.filter((r) => (boardId && r.clientBoardId === boardId) || (!!r.billTo && squash(r.billTo) === name));
}

export type InvoiceSummary = {
  // The retainer invoice for the month asked about: its row, or null when none is logged.
  retainerThisMonth: InvoiceRow | null;
  openBalance: number; // everything not yet paid: to be sent, sent, overdue (billable travel included)
  overdue: number;
  overdueCount: number;
  toSend: InvoiceRow[];
  awaiting: InvoiceRow[];
  overdueRows: InvoiceRow[];
  oneTimeOpen: InvoiceRow[];
  travelOpen: InvoiceRow[];
  paidCount: number;
};

/** What a row is worth on the client's bill. Travel only when it is billed to the client. */
export const rowTotal = (r: InvoiceRow) => (r.state === "travel" ? (r.billableTravel ? r.travelAmount : 0) : r.amount + (r.billableTravel ? r.travelAmount : 0));

/** What is still owed on a row: the open balance from QuickBooks when it is filled in, the full amount otherwise. */
export const rowOwed = (r: InvoiceRow) => (r.state !== "travel" && r.balance != null ? r.balance : rowTotal(r));

const travelDone = (r: InvoiceRow) => /reimbursed|closed|invoiced to client/i.test(r.travelStatus ?? "");

export function summarizeInvoices(rows: InvoiceRow[], period: { year: number; month: number }): InvoiceSummary {
  const ym = `${period.year}-${String(period.month).padStart(2, "0")}`;
  const unpaid = rows.filter((r) => r.state === "open" || r.state === "sent" || r.state === "overdue");
  const overdueRows = rows.filter((r) => r.state === "overdue");
  const travelOpen = rows.filter((r) => r.state === "travel" && !travelDone(r));
  return {
    retainerThisMonth: rows.find((r) => r.kind === "retainer" && r.state !== "travel" && (r.billed ?? "").startsWith(ym)) ?? null,
    openBalance: unpaid.reduce((n, r) => n + rowOwed(r), 0),
    overdue: overdueRows.reduce((n, r) => n + rowOwed(r), 0),
    overdueCount: overdueRows.length,
    toSend: rows.filter((r) => r.state === "open"),
    awaiting: rows.filter((r) => r.state === "sent"),
    overdueRows,
    oneTimeOpen: unpaid.filter((r) => r.kind === "one-time" || r.kind === "upsell"),
    travelOpen,
    paidCount: rows.filter((r) => r.state === "paid").length,
  };
}

export const STATE_LABEL: Record<InvoiceState, string> = { open: "To be sent", sent: "Sent", overdue: "Overdue", paid: "Paid", travel: "Travel" };
