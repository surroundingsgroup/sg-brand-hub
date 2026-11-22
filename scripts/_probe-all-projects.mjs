// Probe the Monday "All Projects" board to pull its full column schema
// so I can wire the Hub Projects tile to the right column IDs.
import { loadEnv } from "./_load-env.mjs";
loadEnv();

const token = process.env.MONDAY_API_TOKEN;
const boardId = process.env.MONDAY_BOARD_ID_ALL_PROJECTS;
console.log(`board: ${boardId}`);

const res = await fetch("https://api.monday.com/v2", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: token,
    "API-Version": "2024-10",
  },
  body: JSON.stringify({
    query: `query {
      boards(ids: [${boardId}]) {
        name
        columns { id title type settings_str }
        groups { id title }
      }
    }`,
  }),
});
const data = await res.json();
const board = data.data.boards[0];
console.log("\nBoard:", board.name);
console.log("\nColumns:");
for (const c of board.columns) {
  console.log(`  ${c.id.padEnd(30)}  ${c.type.padEnd(14)}  ${c.title}`);
}
console.log("\nGroups:");
for (const g of board.groups) {
  console.log(`  ${g.id.padEnd(30)}  ${g.title}`);
}
