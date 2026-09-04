// One-off: force Monday's "when Project Type changes to Video Assets"
// automation to fire on an already-created All Projects item that has the
// value set but never triggered the automation (because it was set inside
// create_item rather than as a subsequent column change).
//
// Strategy: null the column, wait a moment, then set it back to Video Assets.
// Monday sees this as two column changes and fires the "changed to X" trigger.
//
// Usage:  MONDAY_ITEM_ID=12980460027 node scripts/_wiggle-project-type.mjs
//
// Safety: if the item already has sub-items, script bails so you don't
//         accidentally re-fire and spawn duplicates.

import { loadEnv } from "./_load-env.mjs";
loadEnv();

const MONDAY_TOKEN = process.env.MONDAY_API_TOKEN;
const BOARD_ID = process.env.MONDAY_BOARD_ID_ALL_PROJECTS;
const PROJECT_TYPE_COL = "status__1";
const VIDEO_ASSETS_INDEX = 104;

const itemId = process.env.MONDAY_ITEM_ID;
if (!itemId) throw new Error("Set MONDAY_ITEM_ID=<numeric monday item id>");
if (!BOARD_ID) throw new Error("MONDAY_BOARD_ID_ALL_PROJECTS not set in env");
if (!MONDAY_TOKEN) throw new Error("MONDAY_API_TOKEN not set in env");

async function monday(query, variables) {
  const res = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: MONDAY_TOKEN,
      "API-Version": "2024-10",
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors));
  return body.data;
}

// Preflight: inspect the item first
const pre = await monday(
  `query($ids:[ID!]) { items(ids:$ids) { id name subitems { id name } column_values(ids:["status__1"]) { text } } }`,
  { ids: [itemId] }
);
const item = pre.items?.[0];
if (!item) throw new Error(`Item ${itemId} not found`);
const currentType = item.column_values?.[0]?.text ?? "(none)";
const subCount = item.subitems?.length ?? 0;
console.log(`Item:      ${item.name} (${itemId})`);
console.log(`Current Project Type:  ${currentType}`);
console.log(`Existing sub-items:    ${subCount}`);

if (subCount > 0) {
  console.log(`\n✗ Bailing — item already has ${subCount} sub-items. Won't re-fire the automation.`);
  process.exit(0);
}

// Step 1: null the Project Type column
console.log(`\n[1/2] Clearing Project Type…`);
await monday(
  `mutation($board:ID!,$item:ID!,$col:String!,$val:JSON!) {
     change_column_value(board_id:$board,item_id:$item,column_id:$col,value:$val) { id }
   }`,
  { board: BOARD_ID, item: itemId, col: PROJECT_TYPE_COL, val: JSON.stringify({}) }
);

// Small pause so Monday persists the null before we set the new value —
// otherwise it could dedupe the two changes and treat them as a no-op.
await new Promise((r) => setTimeout(r, 1500));

// Step 2: set Project Type back to Video Assets
console.log(`[2/2] Setting Project Type back to Video Assets (index ${VIDEO_ASSETS_INDEX})…`);
await monday(
  `mutation($board:ID!,$item:ID!,$col:String!,$val:JSON!) {
     change_column_value(board_id:$board,item_id:$item,column_id:$col,value:$val) { id }
   }`,
  { board: BOARD_ID, item: itemId, col: PROJECT_TYPE_COL, val: JSON.stringify({ index: VIDEO_ASSETS_INDEX }) }
);

// Give Monday a few seconds to run the automation, then re-check for sub-items
console.log(`\nWaiting 5s for automation to spawn sub-items…`);
await new Promise((r) => setTimeout(r, 5000));

const post = await monday(
  `query($ids:[ID!]) { items(ids:$ids) { subitems { id name } } }`,
  { ids: [itemId] }
);
const newSubs = post.items?.[0]?.subitems ?? [];
console.log(`\nResult: ${newSubs.length} sub-items on ${itemId}`);
for (const s of newSubs) console.log(`  ${s.id}  ${s.name}`);

if (newSubs.length === 0) {
  console.log(`\n⚠ No sub-items appeared. Possible causes:`);
  console.log(`   • The Monday automation isn't set up (check Automations on board ${BOARD_ID})`);
  console.log(`   • The automation requires a specific group (this item may not be in the right group)`);
  console.log(`   • The automation is paused`);
}
