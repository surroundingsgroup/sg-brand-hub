// Confirm items_page_by_column_values filter works against the Client
// dropdown column with a real brand name — The Developer Collective.
import { loadEnv } from "./_load-env.mjs";
loadEnv();

const token = process.env.MONDAY_API_TOKEN;
const boardId = process.env.MONDAY_BOARD_ID_ALL_PROJECTS;

const brandName = "The Developer Collective";

const res = await fetch("https://api.monday.com/v2", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: token,
    "API-Version": "2024-10",
  },
  body: JSON.stringify({
    query: `query ProjectsForClient($boardId: ID!, $value: [String]!) {
      items_page_by_column_values(
        board_id: $boardId
        columns: [{ column_id: "dropdown", column_values: $value }]
        limit: 50
      ) {
        cursor
        items {
          id
          name
          group { id title }
          updated_at
          column_values(ids: ["status","status__1","date4","people","link_1","link8"]) {
            id
            text
            value
          }
        }
      }
    }`,
    variables: { boardId: String(boardId), value: [brandName] },
  }),
});
const data = await res.json();
if (data.errors) {
  console.error("errors:", data.errors);
  process.exit(1);
}
const items = data.data.items_page_by_column_values.items;
console.log(`${items.length} items for "${brandName}":\n`);
for (const it of items) {
  console.log(`[${it.group.title}] ${it.name}  (id=${it.id}, updated ${it.updated_at?.slice(0, 10)})`);
  for (const cv of it.column_values) {
    if (cv.text) console.log(`   ${cv.id.padEnd(14)} ${cv.text}`);
  }
}
