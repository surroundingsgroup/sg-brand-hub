// Add a deal to the Monday "Deals - new" board's Deal Intake group, with its
// contact on the Contacts board. Same boards, columns and rules as the Quick
// Add Deal form on the website (sg-website lib/deal-intake.ts); this copy
// lets a signed-in team member add a deal from My Surroundings without
// opening Monday.

const API = "https://api.monday.com/v2";
const API_VERSION = "2025-04";

export const DEALS_BOARD = 9889817939;
const CONTACTS_BOARD = 9889822568;
const DEAL_INTAKE_GROUP = "group_mm91n945";
const ACTIVE_CONTACTS_GROUP = "topics";

// Deals board columns
const DEAL_BRAND = "color_mkv5zej5";
const DEAL_SOURCE = "color_mkv53nze";
const DEAL_STAGE = "status";
const DEAL_CREATED_DATE = "date_mkv5ztgm";
const DEAL_PRIMARY_CONTACT = "board_relation_mkv5f97s";
const DEAL_VERTICAL = "color_mm96y6a6";
const DEAL_COMPANY = "text_mm969c83";
const DEAL_BD = "person";
const DEAL_CREATED_BY = "multiple_person_mm911kap";
const DEAL_NEEDS_PHONE = "boolean_mm98jm1w"; // ticked when the contact has no phone on file
// Contacts board columns
const C_COMPANY = "text_mkv57sgh";
const C_EMAIL = "email_mkv5w7sz";
const C_PHONE = "phone_mkv5x1gz";
const C_LASTTOUCH = "date4";
const C_VERTICAL = "color_mm96z7xr";
const C_TITLE = "text_mm974719"; // the contact's job title

// "Prospects - new" board: someone worth reaching out to, lighter than a deal.
export const PROSPECTS_BOARD = 9889827523;
const PROSPECT_INTAKE_GROUP = "group_mm96tfym";
const P_FULLNAME = "text_mkzsremz";
const P_COMPANY = "text_mkzsastj";
const P_EMAIL = "email_mkzsmnxs";
const P_PHONE = "phone_mkzs6a83";
const P_VERTICAL = "color_mm96w31q";
const P_SOURCE = "color_mkzst6h8";
const P_DEALNAME = "text_mkzv5sa3";
const P_STATUS = "color_mm5f8ptv";
const P_BD = "person";
const P_IDENTIFIER = "multiple_person_mm5ejpb2"; // doubles as "who added it"
const P_LASTTOUCH = "date4";
const P_TITLE = "text_mm97np35";

export { DEAL_BRANDS, DEAL_SOURCES, DEAL_VERTICALS } from "./deal-options";

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) throw new Error("Monday is not configured");
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token, "API-Version": API_VERSION },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  if (!json.data) throw new Error(`Monday returned HTTP ${res.status}`);
  return json.data;
}

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

/** "(813) 555-0100" -> what Monday's phone column takes. Null when it is not a usable number. */
export function phoneValue(raw: string): { phone: string; countryShortName: string } | null {
  const digits = raw.replace(/[^\d+]/g, "");
  const n = digits.startsWith("+") ? digits : digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith("1") ? `+${digits}` : "";
  return /^\+\d{10,15}$/.test(n) ? { phone: n, countryShortName: n.startsWith("+1") ? "US" : "" } : null;
}

/** The contact with exactly this email, and whether a phone is on file for them. */
async function findContactByEmail(email: string): Promise<{ id: string; hasPhone: boolean } | null> {
  const data = await gql<{ boards: { items_page: { items: { id: string; column_values: { id: string; text: string | null }[] }[] } }[] }>(
    `query($b:[ID!]!,$p:ItemsQuery){ boards(ids:$b){ items_page(limit:12, query_params:$p){ items{ id column_values(ids:["${C_EMAIL}","${C_PHONE}"]){ id text } } } } }`,
    { b: [String(CONTACTS_BOARD)], p: { rules: [{ column_id: C_EMAIL, compare_value: [email], operator: "contains_text" }] } }
  );
  const lc = email.toLowerCase();
  for (const it of data.boards?.[0]?.items_page?.items ?? []) {
    const val = (id: string) => (it.column_values.find((c) => c.id === id)?.text ?? "").trim();
    if (val(C_EMAIL).toLowerCase() === lc) return { id: String(it.id), hasPhone: !!val(C_PHONE) };
  }
  return null;
}

// Who a signed-in team member is on Monday. Some people sign in here with one
// company address and sit on Monday under another (same name before the @), so
// an exact match is tried first and then a same-name match, but only when
// exactly one person on Monday has that name. The list is compared here; the
// address is never sent to Monday.
let people: { at: number; list: { id: string; name: string; email: string }[] } | null = null;

export async function findMondayPerson(email: string): Promise<{ id: string; name: string } | null> {
  const want = email.trim().toLowerCase();
  if (!want.includes("@")) return null;
  if (!people || Date.now() - people.at > 5 * 60 * 1000) {
    const data = await gql<{ users: { id: string; name: string; email: string | null; enabled: boolean }[] }>(
      `query { users(limit: 500, kind: non_guests){ id name email enabled } }`,
      {}
    );
    people = {
      at: Date.now(),
      list: (data.users ?? []).filter((u) => u.enabled && u.email).map((u) => ({ id: String(u.id), name: u.name, email: (u.email as string).trim().toLowerCase() })),
    };
  }
  const exact = people.list.find((u) => u.email === want);
  if (exact) return { id: exact.id, name: exact.name };
  const local = want.split("@")[0];
  const sameName = people.list.filter((u) => u.email.split("@")[0] === local);
  return sameName.length === 1 ? { id: sameName[0].id, name: sameName[0].name } : null;
}

// The note, as the item's first update. A failure here never loses the item.
async function postNote(itemId: string, note: string | undefined): Promise<void> {
  const text = (note ?? "").trim();
  if (!text) return;
  const body = text.slice(0, 5000).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r\n|\r|\n/g, "<br>");
  await gql(`mutation($i:ID!,$t:String!){ create_update(item_id:$i, body:$t){ id } }`, { i: itemId, t: body }).catch(() => null);
}

export type NewProspect = {
  company: string;
  vertical: string;
  name?: string;
  title?: string;
  email?: string;
  phone?: string;
  source?: string | null;
  what?: string; // what it could be for, kept as the prospect's deal name
  note?: string;
  ownerMondayId: string | null;
};

/** Add a prospect to Prospect Intake. Only the company and vertical are needed. */
export async function addProspect(p: NewProspect): Promise<{ prospectId: string; prospectUrl: string }> {
  const cols: Record<string, unknown> = {
    [P_COMPANY]: p.company,
    [P_VERTICAL]: { label: p.vertical },
    [P_STATUS]: { label: "New Prospect" },
    [P_LASTTOUCH]: { date: today() },
  };
  if (p.name?.trim()) cols[P_FULLNAME] = p.name.trim().slice(0, 160);
  if (p.title?.trim()) cols[P_TITLE] = p.title.trim().slice(0, 160);
  if (p.email?.trim()) cols[P_EMAIL] = { email: p.email.trim(), text: p.email.trim() };
  const phone = phoneValue(p.phone ?? "");
  if (phone) cols[P_PHONE] = phone;
  if (p.source) cols[P_SOURCE] = { label: p.source };
  if (p.what?.trim()) cols[P_DEALNAME] = `${p.company} | ${p.what.trim()}`.slice(0, 255);
  if (p.ownerMondayId && /^\d+$/.test(p.ownerMondayId)) {
    const me = { personsAndTeams: [{ id: Number(p.ownerMondayId), kind: "person" }] };
    cols[P_BD] = me;
    cols[P_IDENTIFIER] = me;
  }
  const made = await gql<{ create_item: { id: string } }>(
    `mutation($b:ID!,$g:String!,$n:String!,$c:JSON!){ create_item(board_id:$b, group_id:$g, item_name:$n, column_values:$c, create_labels_if_missing:false){ id } }`,
    { b: String(PROSPECTS_BOARD), g: PROSPECT_INTAKE_GROUP, n: p.company.slice(0, 255), c: JSON.stringify(cols) }
  );
  const prospectId = String(made.create_item.id);
  await postNote(prospectId, p.note);
  return { prospectId, prospectUrl: `https://nauticalnetwork.monday.com/boards/${PROSPECTS_BOARD}/pulses/${prospectId}` };
}

export type NewDeal = {
  name: string; // the deal's name on the board
  company: string;
  brand: string;
  source: string;
  vertical: string;
  contact: { name: string; email: string; phone: string; title?: string };
  note?: string; // posted on the deal as its first update
  ownerMondayId: string | null; // the team member adding it: BD/AM and Created By
};

export type NewDealResult = { dealId: string; dealUrl: string; contactId: string; contactWasOnFile: boolean; needsPhone: boolean };

export async function addDeal(d: NewDeal): Promise<NewDealResult> {
  // The contact: reuse the one with this email, or add it (the Contacts board
  // needs both an email and a phone on every new contact).
  const phone = phoneValue(d.contact.phone);
  const onFile = await findContactByEmail(d.contact.email);
  let contactId: string;
  let needsPhone = false;
  if (onFile) {
    contactId = onFile.id;
    // Touch the date; fill the phone only when the contact has none.
    const touch: Record<string, unknown> = { [C_LASTTOUCH]: { date: today() } };
    if (!onFile.hasPhone && phone) touch[C_PHONE] = phone;
    needsPhone = !onFile.hasPhone && !phone;
    await gql(`mutation($i:ID!,$b:ID!,$c:JSON!){ change_multiple_column_values(item_id:$i, board_id:$b, column_values:$c){ id } }`, {
      i: contactId,
      b: String(CONTACTS_BOARD),
      c: JSON.stringify(touch),
    });
  } else {
    if (!phone) throw new Error("Add a phone number: it is needed for a contact who is not on file yet.");
    const cols: Record<string, unknown> = {
      [C_COMPANY]: d.company,
      [C_EMAIL]: { email: d.contact.email, text: d.contact.email },
      [C_PHONE]: phone,
      [C_LASTTOUCH]: { date: today() },
      [C_VERTICAL]: { label: d.vertical },
    };
    if (d.contact.title?.trim()) cols[C_TITLE] = d.contact.title.trim().slice(0, 160);
    const made = await gql<{ create_item: { id: string } }>(
      `mutation($b:ID!,$g:String!,$n:String!,$c:JSON!){ create_item(board_id:$b, group_id:$g, item_name:$n, column_values:$c, create_labels_if_missing:false){ id } }`,
      { b: String(CONTACTS_BOARD), g: ACTIVE_CONTACTS_GROUP, n: d.contact.name.slice(0, 255), c: JSON.stringify(cols) }
    );
    contactId = String(made.create_item.id);
  }

  const cols: Record<string, unknown> = {
    [DEAL_BRAND]: { label: d.brand },
    [DEAL_SOURCE]: { label: d.source },
    [DEAL_STAGE]: { label: "Discovery Set" },
    [DEAL_CREATED_DATE]: { date: today() },
    [DEAL_PRIMARY_CONTACT]: { item_ids: [parseInt(contactId, 10)] },
    [DEAL_VERTICAL]: { label: d.vertical },
    [DEAL_COMPANY]: d.company,
  };
  if (needsPhone) cols[DEAL_NEEDS_PHONE] = { checked: "true" };
  if (d.ownerMondayId && /^\d+$/.test(d.ownerMondayId)) {
    const me = { personsAndTeams: [{ id: Number(d.ownerMondayId), kind: "person" }] };
    cols[DEAL_BD] = me;
    cols[DEAL_CREATED_BY] = me;
  }
  const deal = await gql<{ create_item: { id: string } }>(
    `mutation($b:ID!,$g:String!,$n:String!,$c:JSON!){ create_item(board_id:$b, group_id:$g, item_name:$n, column_values:$c, create_labels_if_missing:false){ id } }`,
    { b: String(DEALS_BOARD), g: DEAL_INTAKE_GROUP, n: d.name.slice(0, 255), c: JSON.stringify(cols) }
  );
  const dealId = String(deal.create_item.id);

  await postNote(dealId, d.note);
  return {
    dealId,
    dealUrl: `https://nauticalnetwork.monday.com/boards/${DEALS_BOARD}/pulses/${dealId}`,
    contactId,
    contactWasOnFile: !!onFile,
    needsPhone,
  };
}
