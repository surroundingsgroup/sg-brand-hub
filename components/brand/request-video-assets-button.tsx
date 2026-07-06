"use client";
import { useState, useTransition } from "react";
import { Video } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { requestVideoAssetsProject } from "@/app/(internal)/brand/[id]/actions";

/**
 * "Request new video assets" button — shown only on already-approved brands.
 * Opens a form dialog where the AM can optionally add:
 *   • A brief — goal, deliverables, deadlines, general context
 *   • Style & references — style direction, example links, aesthetic notes
 * Both are optional. Whatever's filled gets prepended to the intro update
 * that lands on the new All Projects parent item on Monday.
 *
 * Wrapped as a form (not a plain confirm) because each click is
 * non-idempotent — back-to-back clicks would create back-to-back Monday
 * items, and the editor needs the AM's direction up front.
 */
export function RequestVideoAssetsButton({
  brandId,
  brandName,
}: {
  brandId: string;
  brandName: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState("");
  const [styleNotes, setStyleNotes] = useState("");

  function handleOpenChange(next: boolean) {
    if (isPending) return; // don't let user close mid-submit
    setOpen(next);
    if (!next) {
      // Reset the form when the dialog closes so the next open is fresh.
      setBrief("");
      setStyleNotes("");
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(async () => {
      toast.loading("Creating Monday Video Assets project…", {
        id: "request-video-assets",
      });
      const res = await requestVideoAssetsProject(brandId, {
        brief: brief.trim() || undefined,
        styleNotes: styleNotes.trim() || undefined,
      });
      if (!res.ok) {
        toast.error(`Couldn't request video assets: ${res.error}`, {
          id: "request-video-assets",
        });
        return;
      }
      toast.success(`Created "${res.itemName}" on Monday.`, {
        id: "request-video-assets",
        duration: 10000,
        action: {
          label: "Open Monday item",
          onClick: () => window.open(res.mondayItemUrl, "_blank"),
        },
      });
      setOpen(false);
      setBrief("");
      setStyleNotes("");
    });
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} disabled={isPending}>
        <Video className="h-4 w-4" />
        {isPending ? "Requesting…" : "Request video assets"}
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Request new video assets for {brandName}</DialogTitle>
            <DialogDescription>
              Add a brief and any style references so the editor knows what
              direction to take. Both are optional — leave blank if you just
              need a repeat of the usual scope.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="video-assets-brief">Brief</Label>
              <Textarea
                id="video-assets-brief"
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder="Goal, deliverables, deadlines, key context…"
                rows={4}
                disabled={isPending}
              />
              <p className="text-xs text-muted-foreground">
                e.g. &quot;3× 60s reels for a summer promo. Need drafts by
                Aug 15, final by Aug 22.&quot;
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="video-assets-style">Style &amp; references</Label>
              <Textarea
                id="video-assets-style"
                value={styleNotes}
                onChange={(e) => setStyleNotes(e.target.value)}
                placeholder="Style direction, aesthetic notes, example links (IG/YT URLs)…"
                rows={4}
                disabled={isPending}
              />
              <p className="text-xs text-muted-foreground">
                Drop links to reference posts / videos — the editor can open
                them straight from the Monday update.
              </p>
            </div>

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Creating…" : "Create video assets project"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
