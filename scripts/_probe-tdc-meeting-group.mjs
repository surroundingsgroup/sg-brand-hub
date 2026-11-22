// Probe the Meeting Cadence group in detail — top items AND their subitems.
import { loadEnv } from "./_load-env.mjs";
loadEnv();
const token = process.env.MONDAY_API_TOKEN;
const boardId = 18410448641;

const res = await fetch("https://api.monday.com/v2", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2024-10" },
  body: JSON.stringify({
    query: `query { boards(ids: [${boardId}]) {
      groups(ids: ["group_mkzzaf3t"]) {
        title
        items_page(limit: 20) {
          items {
            id name
            subtasks: subitems {
              id name
              column_values { id text }
            }
            column_values { id text }
          }
        }
      }
    } }`,
  }),
});
const body = await res.json();
if (body.errors) { console.error(body.errors); process.exit(1); }
const group = body.data.boards[0].groups[0];
console.log(`Group: ${group.title}`);
for (const it of group.items_page.items) {
  console.log(`\n  PARENT: ${it.name}  (id=${it.id})`);
  for (const cv of it.column_values) {
    if (cv.text) console.log(`     ${cv.id.padEnd(28)} ${cv.text}`);
  }
  if (it.subtasks?.length) {
    console.log(`   ${it.subtasks.length} subitems:`);
    for (const s of it.subtasks.slice(0, 5)) {
      console.log(`      · ${s.name}`);
      for (const cv of s.column_values) {
        if (cv.text) console.log(`         ${cv.id.padEnd(28)} ${cv.text}`);
      }
    }
  }
}

// Also probe Invoicing group
console.log("\n\n────── INVOICING GROUP ──────");
const invRes = await fetch("https://api.monday.com/v2", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2024-10" },
  body: JSON.stringify({
    query: `query { boards(ids: [${boardId}]) {
      groups(ids: ["group_mm03tmg8"]) {
        title
        items_page(limit: 15) {
          items { id name column_values { id text } }
        }
      }
    } }`,
  }),
});
const inv = await invRes.json();
const invGroup = inv.data.boards[0].groups[0];
for (const it of invGroup.items_page.items) {
  console.log(`\n  ${it.name}`);
  for (const cv of it.column_values) {
    if (cv.text) console.log(`     ${cv.id.padEnd(28)} ${cv.text}`);
  }
}

// Also probe Allocation Setup
console.log("\n\n────── ALLOCATION SETUP GROUP ──────");
const allocRes = await fetch("https://api.monday.com/v2", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2024-10" },
  body: JSON.stringify({
    query: `query { boards(ids: [${boardId}]) {
      groups(ids: ["group_mkz0x7fv"]) {
        title
        items_page(limit: 15) {
          items {
            id name
            subtasks: subitems { id name column_values { id text } }
            column_values { id text }
          }
        }
      }
    } }`,
  }),
});
const alloc = await allocRes.json();
const allocGroup = alloc.data.boards[0].groups[0];
for (const it of allocGroup.items_page.items) {
  console.log(`\n  ${it.name}`);
  for (const cv of it.column_values) {
    if (cv.text) console.log(`     ${cv.id.padEnd(28)} ${cv.text}`);
  }
  for (const s of it.subtasks ?? []) {
    console.log(`     · ${s.name}`);
    for (const cv of s.column_values) {
      if (cv.text) console.log(`        ${cv.id.padEnd(28)} ${cv.text}`);
    }
  }
}

// Also probe Financial & Scope Watch
console.log("\n\n────── FINANCIAL & SCOPE WATCH GROUP ──────");
const fwRes = await fetch("https://api.monday.com/v2", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2024-10" },
  body: JSON.stringify({
    query: `query { boards(ids: [${boardId}]) {
      groups(ids: ["group_mkz0htxx"]) {
        title
        items_page(limit: 15) {
          items { id name column_values { id text } }
        }
      }
    } }`,
  }),
});
const fw = await fwRes.json();
const fwGroup = fw.data.boards[0].groups[0];
for (const it of fwGroup.items_page.items) {
  console.log(`\n  ${it.name}`);
  for (const cv of it.column_values) {
    if (cv.text) console.log(`     ${cv.id.padEnd(28)} ${cv.text}`);
  }
}
