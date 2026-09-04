// Look at a Monday All Projects item: its columns + sub-items + activity log
// so we can see if the sub-item automation actually fired.
//
// Usage: MONDAY_ITEM_ID=12980460027 node scripts/_check-monday-item.mjs

import { loadEnv } from "./_load-env.mjs";
loadEnv();

const itemId = process.env.MONDAY_ITEM_ID;
if (!itemId) throw new Error("Set MONDAY_ITEM_ID=<numeric monday item id>");

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

const data = await monday(
  `query($ids: [ID!]) {
     items(ids: $ids) {
       id
       name
       created_at
       creator { name }
       group { title }
       column_values { id column { title } text value }
       subitems { id name column_values { id column { title } text } }
     }
   }`,
  { ids: [itemId] }
);

const item = data.items?.[0];
if (!item) {
  console.log(`Item ${itemId} not found.`);
  process.exit(0);
}

console.log(`── ${item.name} (${item.id}) ──`);
console.log(`  Created:  ${item.created_at}`);
console.log(`  Group:    ${item.group?.title}`);
console.log(`  Creator:  ${item.creator?.name}`);
console.log(`\n  Columns:`);
for (const c of item.column_values ?? []) {
  if (c.text || c.value) {
    console.log(`    ${c.column?.title ?? c.id}:  ${(c.text ?? c.value ?? "").slice(0, 80)}`);
  }
}

console.log(`\n  Sub-items: ${item.subitems?.length ?? 0}`);
for (const s of item.subitems ?? []) {
  console.log(`    ${s.id}  ${s.name}`);
}
