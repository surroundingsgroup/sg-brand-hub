// Full-column dump for a working Video Assets item vs a failing one so we
// can diff what's different.

import { loadEnv } from "./_load-env.mjs";
loadEnv();

const IDS = process.env.IDS?.split(",") ?? [];
if (IDS.length < 2) throw new Error("Set IDS=id1,id2[,id3...]");

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
  `query($ids:[ID!]) {
    items(ids:$ids) {
      id
      name
      state
      created_at
      group { title id }
      subitems { id name }
      column_values {
        id
        column { title type }
        text
        value
      }
    }
  }`,
  { ids: IDS }
);

for (const item of data.items ?? []) {
  console.log(`\n╔════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ ${item.name}`);
  console.log(`║ id=${item.id}  state=${item.state}  group=${item.group?.title}  subs=${item.subitems?.length}`);
  console.log(`╚════════════════════════════════════════════════════════════════════╝`);
  const cols = (item.column_values ?? []).filter((c) => c.text || c.value);
  for (const c of cols) {
    const label = (c.column?.title ?? c.id).padEnd(28);
    const val = (c.text ?? c.value ?? "").toString().slice(0, 80);
    console.log(`  ${label}  ${val}`);
  }
}
