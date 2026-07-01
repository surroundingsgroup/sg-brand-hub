"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import { Trash2, UploadCloud, FileText, GripVertical, Download } from "lucide-react";
import { toast } from "sonner";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { insertLogoRow } from "@/app/(internal)/brand/[id]/actions";
import type { BrandLogo } from "@/types/brand";

type Props = {
  brandId: string;
  initial: BrandLogo[];
  onDelete: (brandId: string, logoId: string, filePath: string) => Promise<void>;
  onReorder: (brandId: string, orderedIds: string[]) => Promise<void>;
};

function logoCount(logos: BrandLogo[]) {
  return logos.filter((l) => l.logo_type !== "reference").length;
}

function isImage(name: string) {
  return /\.(png|jpe?g|svg|webp|gif)$/i.test(name);
}

export function LogosEditor({ brandId, initial, onDelete, onReorder }: Props) {
  const router = useRouter();
  const [logos, setLogos] = useState<BrandLogo[]>(initial);
  const [uploading, setUploading] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // Sync when the parent re-fetches (e.g. after router.refresh()). Without
  // this, useState only reads `initial` on mount and later server updates
  // would be invisible in the UI — the exact "logos disappeared after tab
  // switch" bug we were seeing.
  useEffect(() => {
    setLogos(initial);
  }, [initial]);

  const onDrop = async (files: File[]) => {
    setUploading(true);
    const supabase = createSupabaseBrowserClient();
    const created: BrandLogo[] = [];
    let anyFailed = false;
    for (const file of files) {
      // Path lives under the brand id so the RLS check `split_part(name, '/', 1)`
      // still matches on the intake bucket policy.
      const path = `${brandId}/${Date.now()}-${file.name.replace(/\s+/g, "-")}`;
      const { error: upErr } = await supabase.storage.from("brand-logos").upload(path, file);
      if (upErr) {
        anyFailed = true;
        toast.error(`Upload failed for ${file.name}: ${upErr.message}`, { duration: 10000 });
        continue;
      }
      const { data: pub } = supabase.storage.from("brand-logos").getPublicUrl(path);
      // DB insert now goes through a server action so the row is written under
      // the authenticated user's session cookie — bypasses the browser-client
      // RLS ambiguity that was letting inserts silently fail before.
      const res = await insertLogoRow({
        brandId,
        filePath: path,
        publicUrl: pub.publicUrl,
        fileName: file.name,
      });
      if (!res.ok) {
        anyFailed = true;
        toast.error(`Couldn't save ${file.name}: ${res.error}`, { duration: 10000 });
        continue;
      }
      created.push(res.logo as BrandLogo);
    }
    setLogos((prev) => [...prev, ...created]);
    setUploading(false);
    if (created.length > 0) {
      toast.success(
        created.length === 1
          ? `Uploaded ${created[0].file_name}`
          : `Uploaded ${created.length} logos`
      );
      // Re-fetch server data so the approval checklist ticks off "image
      // logo uploaded" without needing a manual page reload.
      router.refresh();
    }
    if (anyFailed && created.length === 0) {
      // Explicit "nothing landed" signal so the user doesn't retry blindly.
      toast.error(
        "No logos were saved. Check your connection and try again — if this keeps happening, let Billy know.",
        { duration: 12000 }
      );
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "image/*": [".png", ".jpg", ".jpeg", ".webp", ".gif"],
      "image/svg+xml": [".svg"],
      "application/postscript": [".eps", ".ai"],
    },
  });

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = logos.findIndex((l) => l.id === active.id);
    const newIndex = logos.findIndex((l) => l.id === over.id);
    const next = arrayMove(logos, oldIndex, newIndex);
    setLogos(next);
    void onReorder(
      brandId,
      next.map((l) => l.id)
    );
  }

  async function handleDelete(id: string, filePath: string) {
    setLogos((prev) => prev.filter((l) => l.id !== id));
    await onDelete(brandId, id, filePath);
  }

  const downloadableCount = logoCount(logos);

  return (
    <div className="space-y-5">
      {downloadableCount > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/40 px-4 py-2.5 text-sm">
          <span className="text-muted-foreground">
            {downloadableCount} logo file{downloadableCount === 1 ? "" : "s"}
          </span>
          <Button variant="outline" size="sm" asChild>
            <a href={`/api/brands/${brandId}/logos.zip`}>
              <Download className="h-3.5 w-3.5" />
              Download all as zip
            </a>
          </Button>
        </div>
      )}
      <div
        {...getRootProps()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border bg-secondary/50 px-6 py-10 text-center transition-colors hover:bg-secondary ${
          isDragActive ? "border-accent bg-accent-soft" : ""
        }`}
      >
        <input {...getInputProps()} />
        <UploadCloud className="h-6 w-6 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">
          {uploading ? "Uploading…" : "Drop logos here or click to browse"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">PNG, SVG, EPS, AI — multiple files OK</p>
      </div>

      {logos.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={logos.map((l) => l.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {logos.map((logo) => (
                <LogoRow key={logo.id} logo={logo} onDelete={handleDelete} brandId={brandId} setLogos={setLogos} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

function LogoRow({
  logo,
  onDelete,
  brandId,
  setLogos,
}: {
  logo: BrandLogo;
  onDelete: (id: string, filePath: string) => Promise<void>;
  brandId: string;
  setLogos: React.Dispatch<React.SetStateAction<BrandLogo[]>>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: logo.id });
  const [logoType, setLogoType] = useState(logo.logo_type ?? "");
  const [colorway, setColorway] = useState(logo.colorway ?? "");
  const [, startTransition] = useTransition();

  function persistMeta(patch: { logo_type?: string; colorway?: string }) {
    startTransition(async () => {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.from("brand_logos").update(patch).eq("id", logo.id);
      if (error) toast.error(`Save failed: ${error.message}`);
      else setLogos((prev) => prev.map((l) => (l.id === logo.id ? { ...l, ...patch } : l)));
    });
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="flex items-center gap-3 rounded-xl border border-border bg-panel p-3"
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-secondary">
        {isImage(logo.file_name) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo.public_url} alt={logo.file_name} className="h-full w-full object-contain" />
        ) : (
          <FileText className="h-5 w-5 text-muted-foreground" />
        )}
      </div>
      <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_1fr]">
        <div className="flex flex-col gap-1">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">File</Label>
          <span className="truncate text-sm">{logo.file_name}</span>
        </div>
        <Input
          value={logoType}
          onChange={(e) => setLogoType(e.target.value)}
          onBlur={() => persistMeta({ logo_type: logoType })}
          placeholder="Type (full, icon, wordmark)"
          className="h-8 text-xs"
        />
        <Input
          value={colorway}
          onChange={(e) => setColorway(e.target.value)}
          onBlur={() => persistMeta({ colorway: colorway })}
          placeholder="Colorway (cream, evergreen…)"
          className="h-8 text-xs"
        />
      </div>
      <Button variant="ghost" size="icon" asChild aria-label="Download logo">
        <a
          href={`${logo.public_url}?download=${encodeURIComponent(logo.file_name)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Download className="h-4 w-4 text-muted-foreground" />
        </a>
      </Button>
      <Button variant="ghost" size="icon" onClick={() => onDelete(logo.id, logo.file_path)} aria-label="Delete logo">
        <Trash2 className="h-4 w-4 text-muted-foreground" />
      </Button>
    </div>
  );
}
