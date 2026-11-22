"use client";

// Interactive accountability chart — click a card to edit who they
// report to. Lives alongside the server page which does the data
// fetch; this component owns the UI + the optimistic reparent.
//
// Visual rules:
//   • CEO (top of chart) — amber-ringed, wider, brighter
//   • Any node with reports — "Lead" chip, stronger card treatment
//   • Leaf nodes — quieter card, same icon chip style as the tiles
//   • On hover, a small "Edit" pill appears top-right of each card
//   • Click → popover with a "Reports to" select + a "Top of chart"
//     option. Save → optimistic swap + POST → router.refresh().

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export type OrgNode = {
  email: string;
  name: string;
  title: string | null;
  department: string | null;
  avatar_url: string | null;
  is_am: boolean;
  client_count: number;
  manager_email: string | null;
};

export function OrgChart({ nodes }: { nodes: OrgNode[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [local, setLocal] = useState(nodes);

  // Build tree each render from `local` so optimistic reparents land
  // without a round trip.
  const { roots, allOptions } = useMemo(() => {
    const byEmail = new Map<
      string,
      OrgNode & { reports: (OrgNode & { reports: unknown[] })[] }
    >();
    for (const n of local) byEmail.set(n.email, { ...n, reports: [] });
    const rts: typeof byEmail extends Map<string, infer V> ? V[] : never[] = [];
    for (const n of local) {
      const self = byEmail.get(n.email)!;
      const mgr = n.manager_email?.toLowerCase();
      if (mgr && byEmail.has(mgr)) {
        byEmail.get(mgr)!.reports.push(self);
      } else {
        rts.push(self);
      }
    }
    function sortNode(node: (typeof rts)[number]) {
      node.reports.sort((a, b) =>
        (a as OrgNode).name.localeCompare((b as OrgNode).name)
      );
      for (const r of node.reports) sortNode(r as (typeof rts)[number]);
    }
    rts.sort((a, b) => {
      if (b.reports.length !== a.reports.length) {
        return b.reports.length - a.reports.length;
      }
      return a.name.localeCompare(b.name);
    });
    for (const r of rts) sortNode(r);

    const opts = [...local].sort((a, b) => a.name.localeCompare(b.name));
    return { roots: rts, allOptions: opts };
  }, [local]);

  async function reparent(email: string, managerEmail: string | null) {
    const prev = local;
    setLocal((cur) =>
      cur.map((n) => (n.email === email ? { ...n, manager_email: managerEmail } : n))
    );
    const res = await fetch("/api/my/org/manager", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, manager_email: managerEmail }),
    });
    if (!res.ok) {
      const { error } = (await res.json().catch(() => ({ error: "Save failed." }))) as {
        error?: string;
      };
      toast.error(error ?? "Couldn't update manager.");
      setLocal(prev);
      return;
    }
    toast.success("Reporting line updated.");
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex flex-col gap-10">
      {roots.map((r) => (
        <TreeNode
          key={r.email}
          node={r as unknown as RenderNode}
          depth={0}
          options={allOptions}
          onReparent={reparent}
        />
      ))}
    </div>
  );
}

type RenderNode = OrgNode & { reports: RenderNode[] };

function TreeNode({
  node,
  depth,
  options,
  onReparent,
}: {
  node: RenderNode;
  depth: number;
  options: OrgNode[];
  onReparent: (email: string, managerEmail: string | null) => void;
}) {
  const hasReports = node.reports.length > 0;
  return (
    <div className="flex flex-col items-center">
      <PersonCard node={node} depth={depth} options={options} onReparent={onReparent} />
      {hasReports ? (
        <>
          {/* Connector down + split */}
          <div className="relative h-7 w-px bg-gradient-to-b from-border/0 via-border to-border/60" />
          <div className="relative w-full">
            <div className="absolute left-1/2 top-0 h-px w-[calc(100%-5rem)] -translate-x-1/2 bg-border/70" />
            <div className="flex flex-wrap items-start justify-center gap-6 pt-6">
              {node.reports.map((r) => (
                <div key={r.email} className="flex flex-col items-center">
                  <div className="h-5 w-px bg-border/70" />
                  <TreeNode
                    node={r}
                    depth={depth + 1}
                    options={options}
                    onReparent={onReparent}
                  />
                </div>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function PersonCard({
  node,
  depth,
  options,
  onReparent,
}: {
  node: RenderNode;
  depth: number;
  options: OrgNode[];
  onReparent: (email: string, managerEmail: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draftMgr, setDraftMgr] = useState<string>(node.manager_email ?? "__top__");
  const [saving, setSaving] = useState(false);
  const hasReports = node.reports.length > 0;
  const isCeo = depth === 0 && hasReports;

  // Visual tiers.
  const base =
    "relative flex flex-col gap-2 rounded-2xl p-4 transition-all duration-200";
  const tier = isCeo
    ? "w-72 bg-gradient-to-br from-accent-soft via-panel to-panel ring-2 ring-accent/60 shadow-[0_2px_4px_rgba(16,10,0,0.06),0_16px_32px_-12px_rgba(16,10,0,0.18)]"
    : hasReports
      ? "w-60 bg-panel ring-1 ring-border/70 shadow-[0_1px_2px_rgba(16,10,0,0.05),0_10px_24px_-14px_rgba(16,10,0,0.14)]"
      : "w-52 bg-panel/80 ring-1 ring-border/50 shadow-[0_1px_2px_rgba(16,10,0,0.04)]";

  async function save() {
    setSaving(true);
    const mgr = draftMgr === "__top__" ? null : draftMgr;
    await onReparent(node.email, mgr);
    setSaving(false);
    setOpen(false);
  }

  return (
    <div className={`group/node ${base} ${tier}`}>
      {/* Edit affordance — appears on hover */}
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (o) setDraftMgr(node.manager_email ?? "__top__");
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-background/80 px-1.5 py-0.5 text-[10px] text-muted-foreground opacity-0 ring-1 ring-border/50 backdrop-blur transition-opacity hover:text-foreground group-hover/node:opacity-100 data-[state=open]:opacity-100"
            title="Edit reporting line"
          >
            <Pencil className="h-3 w-3" />
            Edit
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-4">
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Reports to
          </div>
          <div className="mt-2">
            <Select value={draftMgr} onValueChange={setDraftMgr}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__top__">Top of chart (no manager)</SelectItem>
                {options
                  .filter((o) => o.email !== node.email)
                  .map((o) => (
                    <SelectItem key={o.email} value={o.email}>
                      {o.name}
                      {o.title ? ` · ${o.title}` : ""}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">
              Changes update everyone&apos;s view.
            </span>
            <Button type="button" size="sm" onClick={save} disabled={saving}>
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 rotate-[-90deg]" />
              )}
              Save
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <div className="flex items-start gap-3">
        <Avatar name={node.name} url={node.avatar_url} depth={depth} hasReports={hasReports} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13.5px] font-semibold text-foreground">
              {node.name}
            </span>
            {isCeo ? (
              <span className="rounded-full bg-amber-200/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-900">
                CEO
              </span>
            ) : hasReports ? (
              <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-foreground/70">
                Lead
              </span>
            ) : null}
          </div>
          {node.title ? (
            <div className="truncate text-[11px] text-muted-foreground">
              {node.title}
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 text-[10.5px] text-muted-foreground">
        {node.department ? <span>{node.department}</span> : <span />}
        {node.client_count > 0 ? (
          <Link
            href={`/dashboard?scope=all&q=${encodeURIComponent(node.name)}`}
            className="underline underline-offset-4 hover:text-foreground"
          >
            {node.client_count} client{node.client_count === 1 ? "" : "s"}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function Avatar({
  name,
  url,
  depth,
  hasReports,
}: {
  name: string;
  url: string | null;
  depth: number;
  hasReports: boolean;
}) {
  const size = depth === 0 ? "h-12 w-12" : hasReports ? "h-10 w-10" : "h-9 w-9";
  const text = depth === 0 ? "text-[14px]" : "text-[12px]";
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s.charAt(0).toUpperCase())
    .join("");
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={name}
        className={`${size} flex-shrink-0 rounded-full object-cover ring-1 ring-border`}
      />
    );
  }
  return (
    <div
      className={`${size} flex flex-shrink-0 items-center justify-center rounded-full bg-accent-soft ${text} font-semibold text-accent-foreground ring-1 ring-accent/30`}
    >
      {initials || "?"}
    </div>
  );
}
