// Pull a few real client boards and dump their sections + columns so
// we can decide which parts could become Hub widgets.
import { loadEnv } from "./_load-env.mjs";
loadEnv();

const token = process.env.MONDAY_API_TOKEN;
const allProjectsBoardId = process.env.MONDAY_BOARD_ID_ALL_PROJECTS;

// 1. Find client-board IDs from recent All Projects items.
const idsQuery = await fetch("https://api.monday.com/v2", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: token,
    "API-Version": "2024-10",
  },
  body: JSON.stringify({
    query: `query { boards(ids: [${allProjectsBoardId}]) {
      items_page(limit: 50) {
        items {
          id name
          column_values(ids: ["text_mm4g409w","dropdown"]) { id text }
        }
      }
    } }`,
  }),
});
const idsData = await idsQuery.json();
const items = idsData.data.boards[0].items_page.items;

const byClient = new Map();
for (const it of items) {
  const client = it.column_values.find((c) => c.id === "dropdown")?.text;
  const cbId = it.column_values.find((c) => c.id === "text_mm4g409w")?.text;
  if (!client || !cbId || !/^\d+$/.test(cbId.trim())) continue;
  if (!byClient.has(client)) byClient.set(client, cbId.trim());
}
console.log(`Found ${byClient.size} client-board mappings:`);
for (const [c, id] of byClient) console.log(`  ${id.padEnd(14)}  ${c}`);

// 2. Probe one representative board's schema.
const sample = byClient.get("Amara Bay") ?? byClient.get("Lantower Bayside") ?? [...byClient.values()][0];
console.log(`\n────── Probing client board ${sample} ──────`);
const schema = await fetch("https://api.monday.com/v2", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2024-10" },
  body: JSON.stringify({
    query: `query { boards(ids: [${sample}]) {
      name
      columns { id title type }
      groups { id title }
      items_count
    } }`,
  }),
});
const schemaBody = await schema.json();
const b = schemaBody.data.boards[0];
console.log(`Board: ${b.name}  (${b.items_count} items)`);
console.log("\nGroups:");
for (const g of b.groups) console.log(`  ${g.id.padEnd(30)}  ${g.title}`);
console.log("\nColumns:");
for (const c of b.columns) console.log(`  ${c.id.padEnd(28)} ${c.type.padEnd(14)}  ${c.title}`);

// 3. Pull a handful of items so we see what's actually tracked.
const itemsRes = await fetch("https://api.monday.com/v2", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2024-10" },
  body: JSON.stringify({
    query: `query { boards(ids: [${sample}]) {
      items_page(limit: 8) {
        items {
          id name
          group { title }
          column_values { id text type value }
        }
      }
    } }`,
  }),
});
const itemsBody = await itemsRes.json();
const sampleItems = itemsBody.data.boards[0].items_page.items;
console.log(`\n${sampleItems.length} sample items:`);
for (const it of sampleItems) {
  console.log(`\n  [${it.group.title}] ${it.name}`);
  for (const cv of it.column_values) {
    if (cv.text && cv.text.length < 120) console.log(`     ${cv.id.padEnd(26)} ${cv.text}`);
  }
}
