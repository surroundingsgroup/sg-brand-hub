// Find All Projects items where sub-items DID spawn, so we can see what
// they look like structurally and figure out what the automation is
// supposed to do. If nothing has sub-items, we know the automation
// itself is broken/absent.
//
// Usage: node scripts/_find-working-subitems.mjs

import { loadEnv } from "./_load-env.mjs";
loadEnv();

const BOARD_ID = process.env.MONDAY_BOARD_ID_ALL_PROJECTS;
if (!BOARD_ID) throw new Error("MONDAY_BOARD_ID_ALL_PROJECTS not set");

async function monday(query, variables) {
  const res = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: process.env.MONDAY_API_TOKEN,
      "API-Version": "2024-10",
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors));
  return body.data;
}

// Walk the board via items_page cursors. Stop after we've inspected N items.
const MAX_ITEMS = 200;
let cursor = null;
let inspected = 0;
const withSubitems = [];
const projectTypeCounts = {};

do {
  const q = cursor
    ? `query { next_items_page(cursor:"${cursor}",limit:50) { cursor items { id name state group{title} subitems { id name } column_values(ids:["status__1"]) { text } } } }`
    : `query { boards(ids:${BOARD_ID}) { items_page(limit:50) { cursor items { id name state group{title} subitems { id name } column_values(ids:["status__1"]) { text } } } } }`;
  const data = await monday(q);
  const page = cursor ? data.next_items_page : data.boards[0].items_page;
  const items = page?.items ?? [];
  for (const it of items) {
    inspected++;
    const projType = it.column_values?.[0]?.text ?? "(none)";
    projectTypeCounts[projType] = (projectTypeCounts[projType] ?? 0) + 1;
    if ((it.subitems?.length ?? 0) > 0) {
      withSubitems.push({
        id: it.id,
        name: it.name,
        state: it.state,
        group: it.group?.title,
        projectType: projType,
        subitemCount: it.subitems.length,
        subitemNames: it.subitems.map((s) => s.name),
      });
    }
  }
  cursor = page?.cursor;
  if (inspected >= MAX_ITEMS) break;
} while (cursor);

console.log(`Inspected ${inspected} items total.\n`);

console.log(`── Project Type distribution ──`);
Object.entries(projectTypeCounts)
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) => console.log(`  ${v.toString().padStart(4)}  ${k}`));

console.log(`\n── Items WITH sub-items: ${withSubitems.length} ──`);
for (const it of withSubitems.slice(0, 15)) {
  console.log(
    `  [${it.state}] ${it.name}  (group: ${it.group}, type: ${it.projectType})  → ${it.subitemCount} subs`
  );
  it.subitemNames.forEach((n) => console.log(`      • ${n}`));
}

// Focus in: Video Assets items that DID vs DID NOT get sub-items
const videoAssets = [];
cursor = null;
inspected = 0;
do {
  const q = cursor
    ? `query { next_items_page(cursor:"${cursor}",limit:50) { cursor items { id name state group{title} subitems { id name } column_values(ids:["status__1"]) { text } } } }`
    : `query { boards(ids:${BOARD_ID}) { items_page(limit:50,query_params:{rules:[{column_id:"status__1",compare_value:[104]}]}) { cursor items { id name state group{title} subitems { id name } column_values(ids:["status__1"]) { text } } } } }`;
  const data = await monday(q);
  const page = cursor ? data.next_items_page : data.boards[0].items_page;
  const items = page?.items ?? [];
  for (const it of items) {
    if (it.column_values?.[0]?.text === "Video Assets") {
      videoAssets.push({
        id: it.id,
        name: it.name,
        state: it.state,
        group: it.group?.title,
        subitemCount: it.subitems?.length ?? 0,
      });
      inspected++;
    }
  }
  cursor = page?.cursor;
  if (inspected >= 60) break;
} while (cursor);

console.log(`\n── Video Assets items: ${videoAssets.length} inspected ──`);
const withSubs = videoAssets.filter((v) => v.subitemCount > 0);
const withoutSubs = videoAssets.filter((v) => v.subitemCount === 0);
console.log(`  With sub-items:    ${withSubs.length}`);
console.log(`  Without sub-items: ${withoutSubs.length}`);

console.log(`\n── Sample Video Assets items WITH sub-items ──`);
for (const it of withSubs.slice(0, 10)) {
  console.log(`  [${it.state}] ${it.name}  (group: ${it.group})  → ${it.subitemCount} subs`);
}
console.log(`\n── Sample Video Assets items WITHOUT sub-items ──`);
for (const it of withoutSubs.slice(0, 10)) {
  console.log(`  [${it.state}] ${it.name}  (group: ${it.group})`);
}
