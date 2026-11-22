// Monday All Projects tile for the client profile — pulls every project
// for this client from the "All Projects" board and buckets them into:
//
//   • Upcoming — items with a future Shoot Date that aren't marked done
//   • In flight — everything that's active but doesn't have a scheduled
//                 shoot date yet (Project Assigned, Working on it, etc.)
//   • Recently completed — up to 5, for context
//
// Clicking a project opens the Monday item in a new tab. Rows also
// surface the Dropbox folder and brief link inline when present, so an
// AM can jump straight to assets or the brief without opening Monday
// first.

import { Clapperboard, ExternalLink, FolderOpen, FileText } from "lucide-react";
import { Tile, TileEmpty } from "./tile";
import { bucketProjects, type HubProject, type ProjectsForClient } from "@/lib/monday/projects";
import { ProjectStatusPicker } from "./project-status-picker";
import { ProjectDateEditor } from "./project-date-editor";


function ProjectRow({
  p,
  brandId,
  statusLabels,
}: {
  p: HubProject;
  brandId: string;
  statusLabels: string[];
}) {
  return (
    <li className="flex items-start justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-secondary/60">
      <div className="min-w-0 flex-1">
        <a
          href={p.mondayUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block truncate text-sm font-medium text-foreground hover:text-accent-foreground"
        >
          {p.name}
        </a>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {p.projectType ? <span>{p.projectType}</span> : null}
          <span className="inline-flex items-center gap-1">
            <span aria-hidden>·</span>
            <ProjectDateEditor
              brandId={brandId}
              projectId={p.id}
              projectName={p.name}
              currentIso={p.shootDateIso}
            />
          </span>
          {p.am ? <span>· {p.am}</span> : null}
          {p.briefUrl ? (
            <a
              href={p.briefUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-foreground/70 hover:text-foreground"
            >
              <FileText className="h-3 w-3" />
              Brief
            </a>
          ) : null}
          {p.dropboxUrl ? (
            <a
              href={p.dropboxUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-foreground/70 hover:text-foreground"
            >
              <FolderOpen className="h-3 w-3" />
              Files
            </a>
          ) : null}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <ProjectStatusPicker
          brandId={brandId}
          projectId={p.id}
          projectName={p.name}
          currentStatus={p.status}
          labels={statusLabels}
        />
        <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
      </div>
    </li>
  );
}

function ProjectSection({
  label,
  items,
  brandId,
  statusLabels,
}: {
  label: string;
  items: HubProject[];
  brandId: string;
  statusLabels: string[];
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
        <span className="ml-1.5 text-foreground/60">{items.length}</span>
      </div>
      <ul className="divide-y divide-border rounded-md border border-border bg-secondary/20">
        {items.map((p) => (
          <ProjectRow key={p.id} p={p} brandId={brandId} statusLabels={statusLabels} />
        ))}
      </ul>
    </div>
  );
}

export function ProjectsTile({
  data,
  brandId,
  statusLabels,
}: {
  data: ProjectsForClient;
  brandId: string;
  statusLabels: string[];
}) {
  const { projects, ok } = data;
  const { upcoming, inFlight, recent } = bucketProjects(projects);
  const total = projects.length;

  const boardUrl = `https://nauticalnetwork.monday.com/boards/${process.env.MONDAY_BOARD_ID_ALL_PROJECTS ?? ""}`;

  return (
    <Tile
      label="Projects"
      icon={<Clapperboard className="h-3.5 w-3.5" />}
      href={boardUrl}
      hrefLabel={total > 0 ? `Open All Projects` : "Monday"}
      hrefExternal
      spans={2}
    >
      {total === 0 ? (
        <TileEmpty>
          {ok
            ? "No projects on the All Projects board for this client yet."
            : "Couldn't reach Monday — refresh in a sec."}
        </TileEmpty>
      ) : (
        <div className="flex flex-col gap-4">
          <ProjectSection
            label="Upcoming"
            items={upcoming.slice(0, 5)}
            brandId={brandId}
            statusLabels={statusLabels}
          />
          <ProjectSection
            label="In progress"
            items={inFlight.slice(0, 5)}
            brandId={brandId}
            statusLabels={statusLabels}
          />
          {recent.length > 0 ? (
            <details className="group/recent">
              <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground">
                View {recent.length} recently completed →
              </summary>
              <div className="mt-2">
                <ul className="divide-y divide-border rounded-md border border-border bg-secondary/20">
                  {recent.map((p) => (
                    <ProjectRow key={p.id} p={p} brandId={brandId} statusLabels={statusLabels} />
                  ))}
                </ul>
              </div>
            </details>
          ) : null}
          <div className="text-xs text-muted-foreground">
            {total} total project{total === 1 ? "" : "s"} on the All Projects board.
          </div>
        </div>
      )}
    </Tile>
  );
}
