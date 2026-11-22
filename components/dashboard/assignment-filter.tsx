"use client";
// "Mine / All" assignment toggle for the Hub dashboard. Mirrors the Brief
// Tool pattern — AMs land on their own book by default but can flip to
// see everyone's clients in one click. URL-driven so the state survives
// a reload and is shareable.

import { useRouter, useSearchParams } from "next/navigation";
import { User, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AssignmentFilter() {
  const router = useRouter();
  const params = useSearchParams();
  const scope = params.get("scope") === "all" ? "all" : "mine";

  function set(next: "mine" | "all") {
    const q = new URLSearchParams(params);
    if (next === "mine") q.delete("scope");
    else q.set("scope", "all");
    router.replace(`?${q.toString()}`);
  }

  return (
    <div className="inline-flex rounded-md border border-border bg-panel p-0.5">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => set("mine")}
        className={cn(
          "h-7 gap-1.5 rounded-sm text-xs",
          scope === "mine" && "bg-secondary text-foreground"
        )}
      >
        <User className="h-3.5 w-3.5" />
        Mine
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => set("all")}
        className={cn(
          "h-7 gap-1.5 rounded-sm text-xs",
          scope === "all" && "bg-secondary text-foreground"
        )}
      >
        <Users className="h-3.5 w-3.5" />
        All
      </Button>
    </div>
  );
}
