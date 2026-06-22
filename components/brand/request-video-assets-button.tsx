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
import { requestVideoAssetsProject } from "@/app/(internal)/brand/[id]/actions";

/**
 * "Request new video assets" button — shown only on already-approved brands.
 * Creates a fresh All Projects parent item on Monday with Project Type =
 * Video Assets, which fires the user's existing automation for sub-items.
 *
 * Wrapped in a confirmation dialog because each click is non-idempotent —
 * back-to-back clicks would create back-to-back Monday items.
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

  function handleConfirm() {
    setOpen(false);
    startTransition(async () => {
      toast.loading("Creating Monday Video Assets project…", {
        id: "request-video-assets",
      });
      const res = await requestVideoAssetsProject(brandId);
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
    });
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} disabled={isPending}>
        <Video className="h-4 w-4" />
        {isPending ? "Requesting…" : "Request video assets"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request new video assets for {brandName}?</DialogTitle>
            <DialogDescription>
              This creates a new parent item on Monday&apos;s All Projects board with
              Project Type set to Video Assets. Your Monday automation then spawns
              the sub-items.
              <br />
              <br />
              Use this for an already-approved brand that needs a new round of
              video assets (Q2 push, refresh, repeat shoot, etc.). Each click
              creates a separate Monday project — don&apos;t double-click.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={isPending}>
              Create video assets project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
