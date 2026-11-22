"use server";
// Server actions exposed to the Projects tile so the AM can mutate
// Monday items without leaving the client profile. Each action:
//   • Logs an entry to brand_activity_log so the Activity tile picks it up
//   • Revalidates the client profile so the UI reflects the new status
//
// Caller supplies the Hub brand id (for revalidation + activity log) and
// the Monday item id + new label.

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { changeProjectStatus, changeProjectShootDate } from "@/lib/monday/projects-mutate";

export async function changeProjectStatusAction(input: {
  brandId: string;
  projectId: string;
  projectName: string;
  newLabel: string;
}) {
  try {
    await changeProjectStatus(input.projectId, input.newLabel);
  } catch (e) {
    return { ok: false as const, error: (e as Error).message };
  }

  const supabase = createSupabaseServerClient();
  await supabase.from("brand_activity_log").insert({
    brand_id: input.brandId,
    event_type: "edited",
    metadata: {
      source: "hub.projects_tile.status_change",
      project_id: input.projectId,
      project_name: input.projectName,
      new_status: input.newLabel,
    },
  });

  revalidatePath(`/client/${input.brandId}`);
  return { ok: true as const };
}

export async function changeProjectShootDateAction(input: {
  brandId: string;
  projectId: string;
  projectName: string;
  newDate: string;            // YYYY-MM-DD, or "" to clear
  newTime?: string;           // HH:mm, optional
}) {
  try {
    const time = input.newTime ? `${input.newTime}:00` : undefined;
    await changeProjectShootDate(
      input.projectId,
      input.newDate || null,
      time
    );
  } catch (e) {
    return { ok: false as const, error: (e as Error).message };
  }

  const supabase = createSupabaseServerClient();
  await supabase.from("brand_activity_log").insert({
    brand_id: input.brandId,
    event_type: "edited",
    metadata: {
      source: "hub.projects_tile.shoot_date_change",
      project_id: input.projectId,
      project_name: input.projectName,
      new_date: input.newDate || null,
      new_time: input.newTime || null,
    },
  });

  revalidatePath(`/client/${input.brandId}`);
  return { ok: true as const };
}
