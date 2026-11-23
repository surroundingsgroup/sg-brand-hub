"use client";

// New deal or new prospect, right on My Surroundings. A deal lands in Deal
// Intake on the Monday Deals board with its contact; a prospect lands in
// Prospect Intake. Same rules as the Quick Add Deal form on the website, so
// nobody has to open a board. A photo of a business card or any screenshot
// with someone's details can fill the form in.

import { useRef, useState } from "react";
import { ArrowUpRight, Check, Loader2, Plus, ScanLine } from "lucide-react";
import { DEAL_SOURCES, DEAL_VERTICALS } from "@/lib/monday/deal-options";
import { cn } from "@/lib/utils";

type Mode = "deal" | "prospect";
type Done = { mode: Mode; name: string; url: string; contactWasOnFile: boolean; needsPhone: boolean; ownerName: string | null };
type Card = { name: string; title: string; company: string; email: string; phone: string; website: string };

const FIELD =
  "w-full rounded-lg border border-border bg-panel px-3 py-2 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-foreground/50";
const LABEL = "mb-1 block text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground";

// The board's own labels use a long dash; show them plainly, send them as they are.
const plain = (label: string) => label.replace(/\s+[—–]\s+/g, ": ");

const BLANK = { company: "", what: "", contactName: "", title: "", email: "", phone: "", source: "", vertical: "", note: "" };

// Shrink a photo in the browser before it is sent: phone photos are far larger
// than reading a card needs. Falls back to the file as it is.
async function toDataUrl(file: File): Promise<string> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("unreadable"));
      reader.readAsDataURL(file);
    });
  }
}

export function NewDealWidget() {
  const [mode, setMode] = useState<Mode>("deal");
  const [f, setF] = useState(BLANK);
  const [noteOpen, setNoteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const deal = mode === "deal";
  const set = (k: keyof typeof BLANK) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((cur) => ({ ...cur, [k]: e.target.value }));

  // Read one or two images (two sides of a card) and fill in what they show.
  async function scan(files: File[]) {
    const images = files.filter((x) => x.type.startsWith("image/")).slice(0, 2);
    if (!images.length || scanning) return;
    setScanning(true);
    setScanNote(null);
    setError(null);
    try {
      const urls = await Promise.all(images.map(toDataUrl));
      const res = await fetch("/api/my/deal/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ images: urls }) });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; card?: Card } | null;
      if (!res.ok || !json?.ok || !json.card) {
        setScanNote({ ok: false, text: json?.error ?? "That image could not be read. Type the details in instead." });
        return;
      }
      const c = json.card;
      const found = [c.name, c.company, c.email, c.phone, c.title].filter(Boolean).length;
      if (!found) {
        setScanNote({ ok: false, text: "No contact details could be found in that image." });
        return;
      }
      // Only what the image actually showed; anything already typed stays if the image had nothing for it.
      setF((cur) => ({
        ...cur,
        company: c.company || cur.company,
        contactName: c.name || cur.contactName,
        title: c.title || cur.title,
        email: c.email || cur.email,
        phone: c.phone || cur.phone,
      }));
      setScanNote({ ok: true, text: "Filled in from the image. Check it before you add." });
    } catch {
      setScanNote({ ok: false, text: "Could not reach the server. Check your connection and try again." });
    } finally {
      setScanning(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/my/deal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...f, mode }) });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; url?: string; contactWasOnFile?: boolean; needsPhone?: boolean; ownerName?: string | null }
        | null;
      if (!res.ok || !json?.ok || !json.url) {
        setError(json?.error ?? "That did not go through. Try again.");
        return;
      }
      setDone({
        mode,
        name: deal && f.what.trim() ? `${f.company.trim()} | ${f.what.trim()}` : f.company.trim(),
        url: json.url,
        contactWasOnFile: !!json.contactWasOnFile,
        needsPhone: !!json.needsPhone,
        ownerName: json.ownerName ?? null,
      });
      setF(BLANK);
      setNoteOpen(false);
      setScanNote(null);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    const where = done.mode === "deal" ? "In Deal Intake on Monday" : "In Prospect Intake on Monday";
    return (
      <div className="flex h-full min-h-[220px] flex-col items-start justify-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          <Check className="h-4 w-4" />
        </span>
        <div>
          <div className="text-[15px] font-semibold leading-snug text-foreground">{done.name}</div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
            {done.ownerName ? `${where}, with ${done.ownerName} as BD/AM. ` : `${where}. It has no BD/AM yet, so set one on the board. `}
            {done.mode === "deal" ? (done.contactWasOnFile ? "The contact was already on file, so it is linked to them." : "The contact was added too.") : ""}
            {done.needsPhone ? " There is no phone number for this contact yet." : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={done.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg bg-foreground px-3 py-1.5 text-[12px] font-medium text-background transition-opacity hover:opacity-90"
          >
            Open in Monday
            <ArrowUpRight className="h-3 w-3" />
          </a>
          <button
            type="button"
            onClick={() => setDone(null)}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-panel px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-secondary"
          >
            <Plus className="h-3 w-3" />
            Add another
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      // A screenshot on the clipboard can be pasted anywhere in the form.
      onPaste={(e) => {
        const files = Array.from(e.clipboardData?.files ?? []).filter((x) => x.type.startsWith("image/"));
        if (files.length) {
          e.preventDefault();
          void scan(files);
        }
      }}
      className="grid grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2">
        <div role="tablist" aria-label="What to add" className="inline-flex rounded-lg border border-border bg-secondary/60 p-0.5">
          {(["deal", "prospect"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => {
                setMode(m);
                setError(null);
              }}
              className={cn(
                "rounded-md px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors",
                mode === m ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {m === "deal" ? "New deal" : "New prospect"}
            </button>
          ))}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          data-scan-input
          onChange={(e) => void scan(Array.from(e.target.files ?? []))}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={scanning}
          title="A photo of a business card, or any screenshot with their details. You can also paste a screenshot here."
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-panel px-3 py-1.5 text-[12.5px] font-semibold text-foreground transition-colors hover:bg-secondary disabled:opacity-60"
        >
          {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanLine className="h-3.5 w-3.5" />}
          {scanning ? "Reading" : "Scan card or screenshot"}
        </button>
      </div>

      {scanNote ? (
        <p className={cn("text-[12px] leading-relaxed sm:col-span-2", scanNote.ok ? "text-emerald-700" : "text-red-700")}>{scanNote.text}</p>
      ) : null}

      <label className="block">
        <span className={LABEL}>Company</span>
        <input className={FIELD} value={f.company} onChange={set("company")} required maxLength={160} placeholder="Who is it" autoComplete="off" />
      </label>
      <label className="block">
        <span className={LABEL}>What it is for</span>
        <input className={FIELD} value={f.what} onChange={set("what")} maxLength={120} placeholder="Brand film, retainer, event" autoComplete="off" />
      </label>
      <label className="block">
        <span className={LABEL}>Contact</span>
        <input
          className={FIELD}
          value={f.contactName}
          onChange={set("contactName")}
          required={deal}
          maxLength={120}
          placeholder={deal ? "Full name" : "Full name, if you have it"}
          autoComplete="off"
        />
      </label>
      <label className="block">
        <span className={LABEL}>Title</span>
        <input className={FIELD} value={f.title} onChange={set("title")} maxLength={120} placeholder="Their role" autoComplete="off" />
      </label>
      <label className="block">
        <span className={LABEL}>Email</span>
        <input
          className={FIELD}
          type="email"
          value={f.email}
          onChange={set("email")}
          required={deal}
          maxLength={160}
          placeholder={deal ? "name@company.com" : "If you have it"}
          autoComplete="off"
        />
      </label>
      <label className="block">
        <span className={LABEL}>Phone</span>
        <input
          className={FIELD}
          type="tel"
          value={f.phone}
          onChange={set("phone")}
          maxLength={40}
          placeholder={deal ? "Needed for a new contact" : "If you have it"}
          autoComplete="off"
        />
      </label>
      <label className="block">
        <span className={LABEL}>Where it came from</span>
        <select className={FIELD} value={f.source} onChange={set("source")} required={deal}>
          <option value="" disabled={deal}>
            {deal ? "Choose" : "Not sure yet"}
          </option>
          {DEAL_SOURCES.map((s) => (
            <option key={s} value={s}>
              {plain(s)}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className={LABEL}>Vertical</span>
        <select className={FIELD} value={f.vertical} onChange={set("vertical")} required>
          <option value="" disabled>
            Choose
          </option>
          {DEAL_VERTICALS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>

      {noteOpen ? (
        <label className="block sm:col-span-2">
          <span className={LABEL}>Note</span>
          <textarea className={`${FIELD} resize-y`} rows={2} value={f.note} onChange={set("note")} maxLength={5000} placeholder="Anything the team should know" />
        </label>
      ) : null}

      {error ? <p className="text-[12px] leading-relaxed text-red-700 sm:col-span-2">{error}</p> : null}

      <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2">
        {noteOpen ? (
          <span />
        ) : (
          <button type="button" onClick={() => setNoteOpen(true)} className="text-[12px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline">
            Add a note
          </button>
        )}
        <button
          type="submit"
          disabled={busy || scanning}
          className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-[12.5px] font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          {busy ? "Adding" : deal ? "Add deal" : "Add prospect"}
        </button>
      </div>
    </form>
  );
}
