// Probe The Developer Collective's dedicated client board (18410448641)
// to see the groups, columns, and a sample of items — this is what Billy
// wants to decide which pieces become Hub widgets.
import { loadEnv } from "./_load-env.mjs";
loadEnv();
const token = process.env.MONDAY_API_TOKEN;
const boardId = 18410448641;

const schema = await fetch("https://api.monday.com/v2", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2024-10" },
  body: JSON.stringify({
    query: `query { boards(ids: [${boardId}]) {
      name items_count
      columns { id title type }
      groups { id title }
    } }`,
  }),
});
const schemaBody = await schema.json();
const b = schemaBody.data.boards[0];
console.log(`Board: ${b.name}  (${b.items_count} items)`);
console.log("\nGroups:");
for (const g of b.groups) console.log(`  ${g.id.padEnd(30)} ${g.title}`);
console.log("\nColumns:");
for (const c of b.columns) console.log(`  ${c.id.padEnd(28)} ${c.type.padEnd(14)} ${c.title}`);

// Items per group, a few samples each
console.log("\n── Sample items (12) ──");
const items = await fetch("https://api.monday.com/v2", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2024-10" },
  body: JSON.stringify({
    query: `query { boards(ids: [${boardId}]) {
      items_page(limit: 12) {
        items {
          id name
          group { title }
          column_values { id text type }
        }
      }
    } }`,
  }),
});
const sampleItems = (await items.json()).data.boards[0].items_page.items;
for (const it of sampleItems) {
  console.log(`\n  [${it.group.title}] ${it.name}`);
  for (const cv of it.column_values) {
    if (cv.text && cv.text.length < 120) console.log(`     ${cv.id.padEnd(28)} ${cv.text}`);
  }
}

// Group counts
console.log("\n── Group item counts ──");
for (const g of b.groups) {
  const r = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2024-10" },
    body: JSON.stringify({
      query: `query { boards(ids: [${boardId}]) {
        groups(ids: ["${g.id}"]) {
          items_page(limit: 1) { cursor items { id } }
        }
      } }`,
    }),
  });
  const res = await r.json();
  const gr = res.data.boards[0].groups[0];
  console.log(`  ${g.title.padEnd(30)} ${gr?.items_page?.items?.length ?? 0} on first page`);
}
