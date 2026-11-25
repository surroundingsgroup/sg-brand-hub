// Our meeting action items onto each owner's To-dos (My Surroundings).
// Owners are matched to the team by name; an item with no owner (or someone
// not on the team) goes to whoever saved the meeting. Used when a meeting is
// saved, and again when it's edited (with only the new or reworded items).
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// "2026-11-25" -> "Nov 25"; anything else as written.
function dueLabel(due: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return due;
  return new Date(`${due}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export async function addActionItemsToTodos(brandId: string, items: unknown[], saverEmail: string | null): Promise<number> {
  const list = (items as { task?: unknown; owner?: unknown; due?: unknown }[]).filter((i) => typeof i?.task === "string" && i.task.trim());
  if (!list.length) return 0;
  const admin = createSupabaseAdminClient();
  const [{ data: brand }, { data: team }] = await Promise.all([
    admin.from("brands").select("business_name").eq("id", brandId).single(),
    admin.from("team_profiles").select("email, name"),
  ]);
  const client = (brand?.business_name as string | undefined) ?? "Client";
  const people = ((team ?? []) as { email: string; name: string | null }[]).filter((p) => p.email && p.name);
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, "").trim();
  const emailFor = (owner: unknown): string | null => {
    const o = typeof owner === "string" ? norm(owner) : "";
    if (!o) return saverEmail;
    const exact = people.find((p) => norm(p.name!) === o);
    const first = people.filter((p) => norm(p.name!).split(" ")[0] === o.split(" ")[0]);
    return (exact ?? (first.length === 1 ? first[0] : null))?.email ?? saverEmail;
  };

  const rows = list
    .map((i) => {
      const owner_email = emailFor(i.owner);
      const due = typeof i.due === "string" && i.due.trim() ? ` (${dueLabel(i.due.trim())})` : "";
      const text = `${client}: ${String(i.task).trim()}${due}`.slice(0, 300);
      return owner_email ? { owner_email: owner_email.toLowerCase(), text } : null;
    })
    .filter((r): r is { owner_email: string; text: string } => r !== null);
  if (!rows.length) return 0;

  // Saving the same meeting twice must not double anyone's list.
  const { data: open } = await admin
    .from("my_todos")
    .select("owner_email, text")
    .in("owner_email", [...new Set(rows.map((r) => r.owner_email))])
    .eq("done", false);
  const have = new Set(((open ?? []) as { owner_email: string; text: string }[]).map((t) => `${t.owner_email.toLowerCase()}|${t.text}`));
  const fresh = rows.filter((r) => !have.has(`${r.owner_email}|${r.text}`));
  if (!fresh.length) return 0;
  const { error } = await admin.from("my_todos").insert(fresh);
  if (error) throw new Error(error.message);
  return fresh.length;
}
