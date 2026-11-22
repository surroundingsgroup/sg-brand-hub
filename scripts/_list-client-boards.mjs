// List workspaces + boards so I can locate the per-client boards.
import { loadEnv } from "./_load-env.mjs";
loadEnv();
const token = process.env.MONDAY_API_TOKEN;

const res = await fetch("https://api.monday.com/v2", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2024-10" },
  body: JSON.stringify({
    query: `query { workspaces { id name } }`,
  }),
});
const w = await res.json();
console.log("Workspaces:");
for (const ws of w.data.workspaces) console.log(`  ${ws.id.padEnd(14)} ${ws.name}`);

// Also list all boards (first page, by name)
const b = await fetch("https://api.monday.com/v2", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: token, "API-Version": "2024-10" },
  body: JSON.stringify({
    query: `query { boards(limit: 200, order_by: used_at) { id name workspace { id name } board_kind } }`,
  }),
});
const bb = await b.json();
console.log(`\n${bb.data.boards.length} boards:`);
for (const brd of bb.data.boards) {
  if (/content|calendar|client|brand|collective|amara|lantower|maritimo/i.test(brd.name)) {
    console.log(`  ${String(brd.id).padEnd(14)} [${brd.workspace?.name ?? "?"}]  ${brd.name}`);
  }
}
