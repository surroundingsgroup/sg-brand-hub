"use client";

// Google Chat inside My Surroundings. Your conversations on the left (the
// pinned team space first), the open one on the right with a box to reply.
// Everything goes through your own Google Chat, so what you send here shows up
// there and the other way round. You can start a chat with anyone in the
// organization, one person or a group, and attach files by picking, dragging
// or pasting them. Opening a conversation here marks it read. Message text
// comes from other people and is only ever shown as text.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, Loader2, Paperclip, Pin, Plus, Search, Send, X } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { ChatConversation, ChatMessage, ChatPerson } from "@/lib/chat/client";
import { cn } from "@/lib/utils";

const LIST_EVERY = 60_000;
const THREAD_EVERY = 12_000;
const MAX_FILE = 50 * 1024 * 1024; // the same caps the server applies
const MAX_FILES = 5;

const size = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

function listTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return sameDay(d, new Date()) ? clock(iso) : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return "Today";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}

const initials = (name: string) =>
  name
    .split(/[\s,]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";

function Avatar({ name, small }: { name: string; small?: boolean }) {
  return (
    <span
      className={cn(
        "flex flex-shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent-foreground",
        small ? "h-6 w-6 text-[9.5px]" : "h-8 w-8 text-[11px]"
      )}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

// Web addresses in a message become links; everything else stays plain text.
function Linked({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"']+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
            {p}
          </a>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

export function ChatWidget({ initial }: { initial: ChatConversation[] }) {
  const [list, setList] = useState(initial);
  const [limit, setLimit] = useState(14);
  const [filter, setFilter] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState<null | "uploading" | "sending">(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // New chat
  const [picking, setPicking] = useState(false);
  const [people, setPeople] = useState<ChatPerson[] | null>(null);
  const [who, setWho] = useState("");
  const [picked, setPicked] = useState<ChatPerson[]>([]);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const activeRef = useRef<string | null>(null);
  activeRef.current = active;
  const limitRef = useRef(limit);
  limitRef.current = limit;

  const current = list.find((c) => c.id === active) ?? null;

  const refreshList = useCallback(async (n: number) => {
    const json = (await fetch(`/api/my/chat?limit=${n}`).then((r) => r.json()).catch(() => null)) as { ok?: boolean; conversations?: ChatConversation[] } | null;
    if (json?.ok && json.conversations) {
      const fresh = json.conversations;
      // A chat just started may not be in Google's list yet: keep it in view.
      setList((cur) => {
        const open = cur.find((c) => c.id === activeRef.current);
        const merged = fresh.map((c) => (c.id === activeRef.current ? { ...c, unread: false } : c));
        return open && !merged.some((c) => c.id === open.id) ? [...merged.filter((c) => c.pinned), open, ...merged.filter((c) => !c.pinned)] : merged;
      });
    }
  }, []);

  // Keep the list fresh while the page is in view.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refreshList(limitRef.current);
    }, LIST_EVERY);
    return () => clearInterval(id);
  }, [refreshList]);

  const load = useCallback(async (space: string, quiet: boolean) => {
    if (!quiet) setLoading(true);
    const json = (await fetch(`/api/my/chat?space=${encodeURIComponent(space)}&read=1`).then((r) => r.json()).catch(() => null)) as
      | { ok?: boolean; messages?: ChatMessage[] }
      | null;
    if (activeRef.current !== space) return; // moved on while it loaded
    if (json?.ok && json.messages) {
      const next = json.messages;
      setMessages((cur) => (cur.length === next.length && cur[cur.length - 1]?.id === next[next.length - 1]?.id ? cur : next));
      if (!quiet) setError(null);
    } else if (!quiet) {
      setError("This conversation could not be loaded. Try again, or open it in Google Chat.");
    }
    if (!quiet) setLoading(false);
  }, []);

  // Open a conversation: load it, then keep it fresh while it is on screen.
  useEffect(() => {
    if (!active) return;
    setMessages([]);
    setError(null);
    setFiles([]);
    void load(active, false);
    setList((cur) => cur.map((c) => (c.id === active ? { ...c, unread: false } : c)));
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load(active, true);
    }, THREAD_EVERY);
    return () => clearInterval(id);
  }, [active, load]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [messages]);

  function attach(incoming: File[]) {
    if (!incoming.length) return;
    const tooBig = incoming.find((f) => f.size > MAX_FILE);
    if (tooBig) {
      setError(`"${tooBig.name}" is ${size(tooBig.size)}. The most this card can send is 50 MB, so share a link to it instead.`);
      return;
    }
    setError(null);
    setFiles((cur) => {
      const next = [...cur, ...incoming];
      if (next.length > MAX_FILES) setError(`Up to ${MAX_FILES} files per message.`);
      return next.slice(0, MAX_FILES);
    });
  }

  async function send() {
    const value = text.trim();
    if ((!value && !files.length) || !active || sending) return;
    setError(null);
    try {
      // Files go to our storage first, then the message hands them to Google.
      const uploads: { path: string; name: string; type: string }[] = [];
      if (files.length) {
        setSending("uploading");
        const supabase = createSupabaseBrowserClient();
        for (const f of files) {
          const slot = (await fetch("/api/my/chat/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: f.name, size: f.size }),
          })
            .then((r) => r.json())
            .catch(() => null)) as { ok?: boolean; bucket?: string; path?: string; token?: string; error?: string } | null;
          if (!slot?.ok || !slot.bucket || !slot.path || !slot.token) throw new Error(slot?.error === "too_large" ? `"${f.name}" is over 50 MB.` : `"${f.name}" could not be uploaded.`);
          const up = await supabase.storage.from(slot.bucket).uploadToSignedUrl(slot.path, slot.token, f, { contentType: f.type || "application/octet-stream" });
          if (up.error) throw new Error(`"${f.name}" could not be uploaded.`);
          uploads.push({ path: slot.path, name: f.name, type: f.type });
        }
      }
      setSending("sending");
      const json = (await fetch("/api/my/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ space: active, text: value, uploads }) })
        .then((r) => r.json())
        .catch(() => null)) as { ok?: boolean; message?: ChatMessage } | null;
      if (!json?.ok || !json.message) throw new Error(files.length ? "That did not send. Your message and files are still here." : "That did not send. Your message is still in the box.");
      setMessages((cur) => [...cur, json.message as ChatMessage]);
      setText("");
      setFiles([]);
      if (fileRef.current) fileRef.current.value = "";
      setList((cur) => cur.map((c) => (c.id === active ? { ...c, lastActive: new Date().toISOString() } : c)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(null);
    }
  }

  // Who a chat can be started with, fetched the first time the picker opens.
  useEffect(() => {
    if (!picking || people) return;
    fetch("/api/my/chat?people=1")
      .then((r) => r.json())
      .then((j: { people?: ChatPerson[] }) => setPeople(j.people ?? []))
      .catch(() => setPeople([]));
  }, [picking, people]);

  // Start (or reopen) a chat with the people picked.
  async function start() {
    if (!picked.length || starting) return;
    setStarting(true);
    setStartError(null);
    const json = (await fetch("/api/my/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ start: picked }) })
      .then((r) => r.json())
      .catch(() => null)) as { ok?: boolean; conversation?: ChatConversation; error?: string } | null;
    setStarting(false);
    if (json?.ok && json.conversation) {
      const c = json.conversation;
      setList((cur) => (cur.some((x) => x.id === c.id) ? cur : [...cur.filter((x) => x.pinned), c, ...cur.filter((x) => !x.pinned)]));
      setActive(c.id);
      setPicking(false);
      setPicked([]);
      setWho("");
    } else {
      setStartError(
        json?.error === "needs_permission"
          ? picked.length === 1
            ? `You have not messaged ${picked[0].name.split(" ")[0]} before, and starting a brand-new chat is not switched on yet. Message them once in Google Chat and the conversation will show here.`
            : "Starting a new group chat is not switched on yet. Start it in Google Chat and it will show here."
          : "That chat could not be opened. Try again, or start it in Google Chat."
      );
    }
  }

  const q = who.trim().toLowerCase();
  const matches = useMemo(
    () =>
      (people ?? [])
        .filter((p) => !picked.some((x) => x.email === p.email))
        .filter((p) => !q || p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q))
        .slice(0, 30),
    [people, picked, q]
  );
  const f = filter.trim().toLowerCase();
  const shownList = f ? list.filter((c) => c.title.toLowerCase().includes(f)) : list;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[280px_minmax(0,1fr)]">
      {/* Conversations */}
      <div className={cn("min-w-0", active ? "hidden md:block" : "")}>
        <div className="mb-2 flex items-center gap-2">
          <label className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search chats"
              className="w-full rounded-lg border border-border bg-panel py-1.5 pl-8 pr-2.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-foreground/50"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              setPicking((v) => !v);
              setStartError(null);
            }}
            aria-expanded={picking}
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-[12.5px] font-semibold text-background transition-opacity hover:opacity-90"
          >
            {picking ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {picking ? "Close" : "New chat"}
          </button>
        </div>

        {picking ? (
          <div className="mb-2 rounded-xl border border-border/60 p-2.5">
            {picked.length ? (
              <div className="mb-1.5 flex flex-wrap gap-1">
                {picked.map((p) => (
                  <span key={p.email} className="inline-flex items-center gap-1 rounded-full bg-secondary py-0.5 pl-2 pr-1 text-[12px] text-foreground">
                    {p.name}
                    <button type="button" onClick={() => setPicked((cur) => cur.filter((x) => x.email !== p.email))} aria-label={`Remove ${p.name}`} className="rounded-full p-0.5 text-muted-foreground hover:text-foreground">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <input
              autoFocus
              value={who}
              onChange={(e) => setWho(e.target.value)}
              placeholder={picked.length ? "Add someone else" : "Who do you want to message?"}
              className="w-full rounded-lg border border-border bg-panel px-2.5 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-foreground/50"
            />
            <ul className="mt-1.5 max-h-44 overflow-y-auto" data-chat-people>
              {people === null ? (
                <li className="flex items-center gap-2 px-1 py-1.5 text-[12px] text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Finding people
                </li>
              ) : matches.length === 0 ? (
                <li className="px-1 py-1.5 text-[12px] text-muted-foreground">Nobody by that name.</li>
              ) : (
                matches.map((p) => (
                  <li key={p.email}>
                    <button
                      type="button"
                      onClick={() => {
                        setPicked((cur) => [...cur, p]);
                        setWho("");
                        setStartError(null);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left text-[13px] text-foreground transition-colors hover:bg-secondary/60"
                    >
                      <Avatar name={p.name} small />
                      <span className="truncate">{p.name}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
            {startError ? <p className="mt-1.5 px-1 text-[12px] leading-relaxed text-red-700">{startError}</p> : null}
            <button
              type="button"
              onClick={() => void start()}
              disabled={!picked.length || starting}
              className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-[12.5px] font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {picked.length > 1 ? `Start group chat (${picked.length})` : "Start chat"}
            </button>
          </div>
        ) : null}

        <ul className="max-h-[460px] space-y-0.5 overflow-y-auto pr-1" data-chat-list>
          {shownList.length === 0 ? <li className="py-2 text-[12.5px] text-muted-foreground">{f ? "No chat by that name here." : "No conversations yet."}</li> : null}
          {shownList.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setActive(c.id)}
                className={cn("flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors", c.id === active ? "bg-secondary" : "hover:bg-secondary/60")}
              >
                <Avatar name={c.title} />
                <span className="min-w-0 flex-1">
                  <span className={cn("flex items-center gap-1.5 text-[13px] text-foreground", c.unread ? "font-bold" : "font-medium")}>
                    {c.pinned ? <Pin className="h-3 w-3 flex-shrink-0 text-muted-foreground" aria-label="Pinned" /> : null}
                    <span className="truncate">{c.title}</span>
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {c.pinned ? "Pinned" : c.kind === "dm" ? "Direct message" : c.kind === "group" ? "Group chat" : "Space"}
                    {c.lastActive ? `, ${listTime(c.lastActive)}` : ""}
                  </span>
                </span>
                {c.unread ? <span className="h-2 w-2 flex-shrink-0 rounded-full bg-accent" aria-label="Unread" /> : null}
              </button>
            </li>
          ))}
          {!f && list.length >= limit && limit < 60 ? (
            <li>
              <button
                type="button"
                onClick={() => {
                  const more = Math.min(60, limit + 20);
                  setLimit(more);
                  void refreshList(more);
                }}
                className="w-full rounded-lg px-2 py-2 text-left text-[12px] text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
              >
                Show older chats
              </button>
            </li>
          ) : null}
        </ul>
      </div>

      {/* The open conversation */}
      <div
        className={cn("relative min-w-0 flex-col rounded-xl border border-border/60", active ? "flex" : "hidden md:flex")}
        onDragOver={(e) => {
          if (!current || !Array.from(e.dataTransfer?.types ?? []).includes("Files")) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setDragging(false);
        }}
        onDrop={(e) => {
          if (!current) return;
          e.preventDefault();
          setDragging(false);
          attach(Array.from(e.dataTransfer?.files ?? []));
        }}
      >
        {dragging ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-foreground/40 bg-panel/90 text-[13px] font-semibold text-foreground">
            Drop to attach
          </div>
        ) : null}
        {!current ? (
          <div className="flex h-[500px] items-center justify-center px-6 text-center text-[12.5px] text-muted-foreground">Pick a conversation to read it and reply here, or start a new chat.</div>
        ) : (
          <>
            <div className="flex items-center gap-2.5 border-b border-border/60 px-3 py-2.5">
              <button type="button" onClick={() => setActive(null)} aria-label="Back to conversations" className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground md:hidden">
                <ArrowLeft className="h-4 w-4" />
              </button>
              <Avatar name={current.title} small />
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold text-foreground" data-chat-title>
                {current.title}
              </span>
              {current.url ? (
                <a href={current.url} target="_blank" rel="noopener noreferrer" className="inline-flex flex-shrink-0 items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground">
                  Open in Google Chat
                  <ArrowUpRight className="h-3 w-3" />
                </a>
              ) : null}
            </div>

            <div className="h-[380px] space-y-1.5 overflow-y-auto px-3 py-3" data-chat-thread>
              {loading ? (
                <div className="flex h-full items-center justify-center text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : messages.length === 0 && !error ? (
                <p className="pt-6 text-center text-[12.5px] text-muted-foreground">No messages yet. Say hello.</p>
              ) : (
                messages.map((m, i) => {
                  const prev = messages[i - 1];
                  const next = messages[i + 1];
                  const newDay = !prev || !sameDay(new Date(prev.time), new Date(m.time));
                  const showName = !m.mine && current.kind !== "dm" && (newDay || prev?.sender !== m.sender || prev?.mine);
                  // The time sits under the last message of a run from the same person.
                  const endOfRun = !next || next.mine !== m.mine || next.sender !== m.sender || !sameDay(new Date(next.time), new Date(m.time));
                  const pictures = (m.files ?? []).filter((x) => x.image);
                  const others = (m.files ?? []).filter((x) => !x.image);
                  return (
                    <div key={m.id}>
                      {newDay ? (
                        <div className="my-2 flex items-center gap-3 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                          <span className="h-px flex-1 bg-border/70" />
                          {dayLabel(m.time)}
                          <span className="h-px flex-1 bg-border/70" />
                        </div>
                      ) : null}
                      <div className={cn("flex flex-col", m.mine ? "items-end" : "items-start")}>
                        {showName ? <span className="mb-0.5 mt-1 px-1 text-[10.5px] font-semibold text-muted-foreground">{m.sender}</span> : null}
                        {pictures.map((x, n) => (
                          <a key={n} href={x.url ?? "#"} target="_blank" rel="noopener noreferrer" className="mb-1 block max-w-[70%] overflow-hidden rounded-xl border border-border/60">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={`/api/my/chat?media=${encodeURIComponent(x.image as string)}&type=${encodeURIComponent(x.type ?? "")}`}
                              alt={x.name}
                              loading="lazy"
                              className="max-h-56 w-auto object-contain"
                            />
                          </a>
                        ))}
                        {m.text || others.length || (m.attachments && !(m.files ?? []).length) ? (
                          <div
                            className={cn(
                              "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-[13px] leading-snug",
                              m.mine ? "bg-foreground text-background" : "bg-secondary text-foreground"
                            )}
                          >
                            {m.text ? <Linked text={m.text} /> : null}
                            {others.map((x, n) => (
                              <span key={n} className="flex items-center gap-1 text-[12px]">
                                <Paperclip className="h-3 w-3 flex-shrink-0" />
                                {x.url ? (
                                  <a href={x.url} target="_blank" rel="noopener noreferrer" className="truncate underline underline-offset-2">
                                    {x.name}
                                  </a>
                                ) : (
                                  <span className="truncate">{x.name}</span>
                                )}
                              </span>
                            ))}
                            {m.attachments && !(m.files ?? []).length ? (
                              <span className="flex items-center gap-1 text-[11.5px] opacity-80">
                                <Paperclip className="h-3 w-3" />
                                {m.attachments === 1 ? "An attachment, open in Google Chat to see it" : `${m.attachments} attachments, open in Google Chat to see them`}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                        {endOfRun && m.time ? <span className="mt-0.5 px-1 text-[10px] text-muted-foreground">{clock(m.time)}</span> : null}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={bottom} />
            </div>

            {error ? <p className="px-3 pb-1 text-[12px] leading-relaxed text-red-700">{error}</p> : null}
            {files.length ? (
              <div className="mx-2.5 mb-1 flex flex-wrap gap-1.5" data-chat-files>
                {files.map((x, n) => (
                  <span key={`${x.name}-${n}`} className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-secondary px-2 py-1 text-[12px] text-foreground">
                    <Paperclip className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                    <span className="max-w-[180px] truncate">{x.name}</span>
                    <span className="flex-shrink-0 text-muted-foreground">{size(x.size)}</span>
                    <button type="button" onClick={() => setFiles((cur) => cur.filter((_, k) => k !== n))} aria-label={`Remove ${x.name}`} className="flex-shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
              className="flex items-end gap-2 border-t border-border/60 p-2.5"
            >
              <input
                ref={fileRef}
                type="file"
                multiple
                className="hidden"
                data-chat-file
                onChange={(e) => {
                  attach(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                aria-label="Attach files"
                title="Attach files (or drag them in, or paste a screenshot). Up to 5 files, 50 MB each."
                className="inline-flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-lg border border-border bg-panel text-foreground transition-colors hover:bg-secondary"
              >
                <Paperclip className="h-4 w-4" />
              </button>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                // A screenshot on the clipboard pastes in as an attachment.
                onPaste={(e) => {
                  const pasted = Array.from(e.clipboardData?.files ?? []);
                  if (pasted.length) {
                    e.preventDefault();
                    attach(pasted);
                  }
                }}
                rows={1}
                maxLength={4000}
                placeholder={`Message ${current.title}`}
                className="max-h-28 min-h-[38px] w-full resize-none rounded-lg border border-border bg-panel px-3 py-2 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-foreground/50"
              />
              <button
                type="submit"
                disabled={!!sending || (!text.trim() && !files.length)}
                aria-label="Send"
                className="inline-flex h-[38px] flex-shrink-0 items-center justify-center gap-1.5 rounded-lg bg-foreground px-3 text-[12.5px] font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {sending === "uploading" ? "Uploading" : null}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
