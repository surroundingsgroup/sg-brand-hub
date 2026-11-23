// Submit a case study from My Surroundings. It lands on the Monday "Shout Outs
// & Showcases" board as a "Portfolio/Showcase Piece", which is where the team
// has been putting case studies (there is no separate case study board).

const API = "https://api.monday.com/v2";
const BOARD = 18203645701; // Shout Outs & Showcases
const GROUP = "topics"; // New Shout Outs & Showcases
const COL_SUBMITTED_BY = "short_texte8a7rqce";
const COL_CLIENT = "text_mkwsy2cy";
const COL_WIN_TYPE = "color_mkwsqxjp";
const COL_SUBMITTED_ON = "date4";
const COL_LINKS = "link_mkws9ngn";
const COL_STORY = "long_text_mkwsw4c7"; // Story Telling/Details
const COL_WHY = "long_text_mkwss4vc"; // Significance or Why It Is Important

export type CaseStudy = { client: string; title: string; story: string; why: string; link: string; submittedBy: string };

export async function submitCaseStudy(c: CaseStudy): Promise<{ id: string; url: string }> {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) throw new Error("Monday is not configured");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const cols: Record<string, unknown> = {
    [COL_SUBMITTED_BY]: c.submittedBy,
    [COL_CLIENT]: c.client,
    [COL_WIN_TYPE]: { label: "Portfolio/Showcase Piece" },
    [COL_SUBMITTED_ON]: { date: today },
    [COL_STORY]: { text: c.story },
  };
  if (c.why) cols[COL_WHY] = { text: c.why };
  if (c.link) cols[COL_LINKS] = { url: c.link, text: "The work" };

  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2025-04" },
    body: JSON.stringify({
      query: `mutation($b:ID!,$g:String!,$n:String!,$c:JSON!){ create_item(board_id:$b, group_id:$g, item_name:$n, column_values:$c, create_labels_if_missing:false){ id } }`,
      variables: { b: String(BOARD), g: GROUP, n: `Case study | ${c.client} | ${c.title}`.slice(0, 255), c: JSON.stringify(cols) },
    }),
    cache: "no-store",
  });
  const json = (await res.json()) as { data?: { create_item?: { id: string } }; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  const id = json.data?.create_item?.id;
  if (!id) throw new Error("Monday did not save it.");
  return { id: String(id), url: `https://nauticalnetwork.monday.com/boards/${BOARD}/pulses/${id}` };
}
