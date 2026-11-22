"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDownAZ, Clock, History, Users, Briefcase, ArrowDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SORTS = [
  { value: "updated_desc", label: "Last updated", Icon: Clock },
  { value: "alpha_asc", label: "Alphabetical (A→Z)", Icon: ArrowDownAZ },
  { value: "created_asc", label: "Oldest first", Icon: History },
] as const;

const ENGAGEMENTS = [
  { value: "all", label: "All engagements", Icon: Users },
  { value: "prospect", label: "Prospect", Icon: Briefcase },
  { value: "retainer", label: "Retainer", Icon: Briefcase },
  { value: "project", label: "Non-Retainer", Icon: Briefcase },
  { value: "inactive", label: "Inactive", Icon: Briefcase },
] as const;

export function DashboardFilters() {
  const router = useRouter();
  const params = useSearchParams();
  const currentSort = params.get("sort") ?? "updated_desc";
  const currentEngagement = params.get("engagement") ?? "all";

  function setParam(key: string, value: string, defaultValue: string) {
    const next = new URLSearchParams(params);
    if (value === defaultValue) next.delete(key);
    else next.set(key, value);
    router.replace(`?${next.toString()}`);
  }

  const sortLabel = SORTS.find((s) => s.value === currentSort)?.label ?? "Last updated";
  const engagementLabel =
    ENGAGEMENTS.find((e) => e.value === currentEngagement)?.label ?? "All engagements";

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Briefcase className="h-3.5 w-3.5" />
            {engagementLabel}
            <ArrowDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {ENGAGEMENTS.map((e) => (
            <DropdownMenuItem
              key={e.value}
              onClick={() => setParam("engagement", e.value, "all")}
              className={cn(currentEngagement === e.value && "bg-secondary")}
            >
              <e.Icon className="h-3.5 w-3.5 opacity-60" />
              {e.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <ArrowDownAZ className="h-3.5 w-3.5" />
            {sortLabel}
            <ArrowDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {SORTS.map((s) => (
            <DropdownMenuItem
              key={s.value}
              onClick={() => setParam("sort", s.value, "updated_desc")}
              className={cn(currentSort === s.value && "bg-secondary")}
            >
              <s.Icon className="h-3.5 w-3.5 opacity-60" />
              {s.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
