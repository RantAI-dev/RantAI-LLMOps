"use client";

import { Pencil, Plus, RefreshCw, Send, Trash2, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAuth } from "@/modules/auth";
import { Answer } from "@/modules/duo/components/chat/answer";
import { answerText, applyEvent, assuranceOf, isLive, newTurn, turnFromStored, type LiveTurn, type Rec } from "@/modules/duo/components/chat/turn";
import { arr, ConfirmButton, fmtAgo, GwErrorState, Loading, Pill, rec, Segmented, Spinner, str } from "@/modules/duo/components/duo-ui";
import { gw, parseSse, useGw } from "@/modules/duo/lib/gw";
import { plural } from "@/modules/duo/components/knowledge/kb-api";

type Room = { room_id: string; name: string; conversation_id?: string; questions?: number; last_activity?: string; members?: number; users?: string[]; busy?: boolean; queued?: number };
type Item = { kind: "q"; id: string; who: string; text: string; ts?: string } | { kind: "a"; id: string; turn: LiveTurn } | { kind: "note"; id: string; text: string };
type Conn = "idle" | "connecting" | "open" | "closed" | "deleted";
type Mode = "auto" | "fast" | "slow";

const NAME_KEY = "duo.rooms.user";
const ERR_TEXT: Record<string, string> = {
  E_RATE_LIMITED: "You are sending messages too fast. Wait a moment.",
  E_QUEUE_FULL: "Three questions are already waiting. Ask again when one is answered.",
  E_TOO_LONG: "The message is too long.",
  E_ROOM_FULL: "This room is full (64 people).",
};

/** Stored room messages: a question is "[Name] text"; an answer carries its ChatReply. */
export function roomItems(messages: Rec[]): Item[] {
  const out: Item[] = [];
  messages.forEach((m, i) => {
    if (m.role === "user") {
      const c = str(m.content, "");
      const mm = c.match(/^\[([^\]]+)\] ([\s\S]*)$/);
      out.push({ kind: "q", id: `h${i}`, who: mm ? mm[1] : "", text: mm ? mm[2] : c, ts: str(m.created_at, "") });
    } else if (m.role === "assistant") out.push({ kind: "a", id: `h${i}`, turn: turnFromStored(m.reply ? { ...m, ...rec(m.reply), content: str(rec(rec(m.reply).message).content, str(m.content, "")) } : m) });
  });
  return out;
}

function LiveRoom({ room, me, onDeleted, onRenamed }: { room: Room; me: string; onDeleted: () => void; onRenamed: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [conn, setConn] = useState<Conn>("idle");
  const [you, setYou] = useState<string>(me);
  const [users, setUsers] = useState<string[]>([]);
  const [queue, setQueue] = useState<{ busy: boolean; working_for: string | null; queued: number }>({ busy: false, working_for: null, queued: 0 });
  const [typers, setTypers] = useState<Record<string, number>>({});
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>("auto");
  const [limit, setLimit] = useState(8000);
  // `reconnect` re-opens the relay (after a drop, a resync, or the button); `backoff` only paces the retries and is
  // reset by a welcome without re-opening anything. `connGen` identifies the live connection, so a welcome that
  // finishes loading after a newer connection opened does not overwrite its transcript.
  const [reconnect, setReconnect] = useState(0);
  const backoff = useRef(0);
  const connGen = useRef(0);
  const sending = useRef(false);
  const session = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const lastTyping = useRef(0);
  const hydrating = useRef(false);
  const buffer = useRef<Rec[]>([]);

  const onContent = useCallback((f: Rec) => {
    const p = rec(f.payload);
    if (f.type === "user_message") {
      setItems((it) => (it.some((x) => x.id === `q${str(p.id, "")}`) ? it : [...it, { kind: "q", id: `q${str(p.id, "")}`, who: str(f.user, ""), text: str(p.content, ""), ts: str(p.ts, "") }]));
      return;
    }
    if (f.type === "assistant_event") {
      const id = `a${str(p.reply_to, "")}`;
      const ev = rec(p.event);
      setItems((it) => {
        const i = it.findIndex((x) => x.id === id);
        if (i < 0) return [...it, { kind: "a", id, turn: applyEvent(newTurn(), str(ev.event, ""), ev) }];
        const x = it[i];
        if (x.kind !== "a") return it;
        const next = [...it];
        next[i] = { ...x, turn: applyEvent(x.turn, str(ev.event, ""), ev) };
        return next;
      });
    }
  }, []);

  const onFrame = useCallback(
    async (f: Rec, gen: number) => {
      const p = rec(f.payload);
      switch (f.type) {
        case "welcome": {
          setYou(str(p.you, me));
          setUsers(arr<string>(p.users));
          setQueue({ busy: rec(p.assistant).busy === true, working_for: str(rec(p.assistant).working_for, "") || null, queued: Number(rec(p.assistant).queued ?? 0) });
          setLimit(Number(rec(p.limits).message_chars ?? 8000) || 8000);
          setConn("open");
          backoff.current = 0;
          hydrating.current = true;
          buffer.current = [];
          let hist: Item[] = [];
          try {
            const convId = str(rec(p.room).conversation_id, room.conversation_id ?? "");
            if (convId) {
              const c = rec(await gw(`/v1/conversations/${encodeURIComponent(convId)}`));
              hist = roomItems(arr<Rec>(c.messages).slice(0, Number(p.cursor ?? 0)));
            }
          } catch {
            hist = [{ kind: "note", id: "load", text: "The earlier messages could not be loaded." }];
          }
          if (gen !== connGen.current) return; // a newer connection took over while this one loaded
          for (const q of arr<Rec>(p.pending)) hist.push({ kind: "q", id: `q${str(q.id, "")}`, who: str(q.user, ""), text: str(q.content, ""), ts: str(q.ts, "") });
          setItems(hist);
          hydrating.current = false;
          const buf = buffer.current;
          buffer.current = [];
          buf.forEach(onContent);
          return;
        }
        case "presence":
          setUsers(arr<string>(p.users));
          if (f.user && f.user !== you) setItems((it) => [...it, { kind: "note", id: `p${Date.now()}${Math.random()}`, text: `${str(f.user)} ${p.joined ? "joined" : "left"}` }]);
          return;
        case "user_message":
        case "assistant_event":
          if (hydrating.current) buffer.current.push(f);
          else onContent(f);
          return;
        case "queue":
          setQueue({ busy: p.busy === true, working_for: str(p.working_for, "") || null, queued: Number(p.queued ?? 0) });
          return;
        case "typing":
          if (f.user && f.user !== you) setTypers((t) => ({ ...t, [str(f.user)]: Date.now() + 4500 }));
          return;
        case "room_renamed":
          onRenamed();
          setItems((it) => [...it, { kind: "note", id: `r${Date.now()}`, text: `Room renamed to “${str(p.name)}”` }]);
          return;
        case "room_deleted":
          setConn("deleted");
          onDeleted();
          return;
        case "error":
          toast.error(ERR_TEXT[str(p.code, "")] ?? str(p.message, "The room refused that"));
          return;
        case "resync":
          toast.info("The connection fell behind; reloading the transcript.");
          setReconnect((a) => a + 1);
          return;
        default:
          return; // heartbeat, pong
      }
    },
    [me, room.conversation_id, onContent, onDeleted, onRenamed, you]
  );
  const frameRef = useRef(onFrame);
  useEffect(() => {
    frameRef.current = onFrame;
  }, [onFrame]);

  // One relay per room, name and reconnect attempt. Reconnects after a drop with a growing delay.
  useEffect(() => {
    const ac = new AbortController();
    let retry: ReturnType<typeof setTimeout> | null = null;
    let ended = false;
    const gen = ++connGen.current;
    (async () => {
      setConn("connecting");
      try {
        const res = await fetch(`/api/duo/rooms/${encodeURIComponent(room.room_id)}/live?user=${encodeURIComponent(me)}`, { signal: ac.signal, headers: { accept: "text/event-stream" } });
        if (!res.ok || !res.body) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `The room could not be opened (${res.status})`);
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const { events, rest } = parseSse(buf);
          buf = rest;
          for (const e of events) {
            if (e.event === "relay") session.current = str(rec(e.data).session, "") || null;
            else if (e.event === "frame") void frameRef.current(rec(e.data), gen);
            else if (e.event === "closed") {
              const d = rec(e.data);
              if (d.code === 4004) {
                ended = true;
                setConn("deleted");
              }
            }
          }
        }
      } catch (err) {
        if (ac.signal.aborted) return;
        toast.error(err instanceof Error ? err.message : "The room connection failed");
      }
      if (ac.signal.aborted || ended) return;
      session.current = null;
      setConn("closed");
      const delay = Math.min(15_000, 1000 * 2 ** Math.min(4, backoff.current));
      backoff.current++;
      retry = setTimeout(() => setReconnect((a) => a + 1), delay);
    })();
    return () => {
      ac.abort();
      if (retry) clearTimeout(retry);
      session.current = null;
    };
  }, [room.room_id, me, reconnect]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [items]);
  useEffect(() => {
    const t = setInterval(() => setTypers((ty) => Object.fromEntries(Object.entries(ty).filter(([, until]) => until > Date.now()))), 1500);
    return () => clearInterval(t);
  }, []);

  async function post(frame: Rec) {
    if (!session.current) throw new Error("Not connected yet. Your message is kept.");
    const res = await fetch(`/api/duo/rooms/${encodeURIComponent(room.room_id)}/live`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session: session.current, frame }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error ?? `Not sent (${res.status})`);
    }
  }

  async function send() {
    const t = input.trim();
    if (!t || sending.current) return;
    if ([...t].length > limit) {
      toast.error(`Messages are limited to ${limit.toLocaleString()} characters.`);
      return;
    }
    // Cleared at once so a quick second Enter cannot send it twice; put back if it was not sent.
    sending.current = true;
    setInput("");
    try {
      await post({ type: "user_message", payload: { content: t, ...(mode !== "auto" ? { force_mode: mode } : {}) } });
    } catch (e) {
      setInput((cur) => cur || t);
      toast.error(e instanceof Error ? e.message : "Not sent");
    } finally {
      sending.current = false;
    }
  }

  const typing = Object.keys(typers);
  const online = conn === "open";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-3 py-2 text-xs">
        <Pill tone={online ? "good" : conn === "deleted" ? "bad" : "warn"}>
          {online ? "Connected" : conn === "connecting" ? "Connecting…" : conn === "deleted" ? "Deleted" : "Reconnecting…"}
        </Pill>
        <span className="text-ink-soft" title={users.join(", ")}>
          <Users className="mr-1 inline size-3.5" aria-hidden />
          {users.length} here{users.length ? `: ${users.slice(0, 4).join(", ")}${users.length > 4 ? "…" : ""}` : ""}
        </span>
        {queue.busy ? (
          <span className="text-ink-soft">
            <Spinner className="mr-1 inline size-3" /> Answering{queue.working_for ? ` ${queue.working_for}` : ""}
            {queue.queued ? ` · ${queue.queued} waiting` : ""}
          </span>
        ) : null}
        {you !== me ? <span className="text-ink-faint">You appear as “{you}”: “{me}” is taken.</span> : null}
        {conn === "closed" ? (
          <Button type="button" size="xs" variant="outline" className="ml-auto" onClick={() => setReconnect((a) => a + 1)}>
            <RefreshCw className="size-3" /> Reconnect
          </Button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
        {!items.length && online ? (
          <p className="text-center text-sm text-ink-soft">
            Nobody has asked anything yet. Ask a question below: everyone in “{room.name}” sees it, and the answer as it is written.
          </p>
        ) : null}
        {items.map((x) =>
          x.kind === "note" ? (
            <p key={x.id} className="text-center text-xs text-ink-faint">
              {x.text}
            </p>
          ) : x.kind === "q" ? (
            <div key={x.id} className={cn("flex", x.who === you ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap", x.who === you ? "rounded-br-md bg-primary-soft" : "rounded-bl-md bg-surface-2")}>
                <span className="block text-xs font-medium text-ink-soft">{x.who === you ? "You" : x.who || "Someone"}</span>
                {x.text}
              </div>
            </div>
          ) : (
            <div key={x.id} className="space-y-1">
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="font-medium text-primary">Assistant</span>
                {x.turn.reply ? <Pill tone={assuranceOf(rec(x.turn.reply).assurance).tone}>{assuranceOf(rec(x.turn.reply).assurance).label}</Pill> : null}
                {x.turn.escalated ? <Pill tone="slow">Thought longer</Pill> : null}
                {isLive(x.turn) ? <Spinner className="size-3" /> : null}
              </div>
              {x.turn.error ? <p className="text-sm text-danger">{x.turn.error}</p> : <Answer text={answerText(x.turn)} streaming={isLive(x.turn)} />}
            </div>
          )
        )}
        <div ref={endRef} />
      </div>
      <div className="border-t border-hairline p-3">
        <p className="mb-1 h-4 text-xs text-ink-faint" aria-live="polite">
          {typing.length === 1 ? `${typing[0]} is typing…` : typing.length === 2 ? `${typing[0]} and ${typing[1]} are typing…` : typing.length ? `${typing.length} people are typing…` : ""}
        </p>
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            disabled={conn === "deleted"}
            onChange={(e) => {
              setInput(e.target.value);
              if (online && e.target.value.trim() && Date.now() - lastTyping.current > 2000) {
                lastTyping.current = Date.now();
                void post({ type: "typing" }).catch(() => undefined);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={conn === "deleted" ? "This room was deleted" : online ? `Message “${room.name}”…` : "Connecting… you can type while you wait"}
            rows={2}
            className="max-h-40 min-h-11 flex-1 resize-none"
            aria-label="Message the room"
          />
          <Segmented<Mode>
            label="Who answers in the room"
            value={mode}
            onChange={setMode}
            options={[
              { id: "auto", label: "Auto" },
              { id: "fast", label: "Fast" },
              { id: "slow", label: "Careful" },
            ]}
          />
          <Button type="button" onClick={send} disabled={!online || !input.trim()} aria-label="Send to the room">
            <Send className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Rooms: shared chats where several people ask together and see the pair answer live. */
export function DuoRooms() {
  const { user } = useAuth();
  const rooms = useGw<Room[]>("/v1/rooms", { refreshMs: 15_000 });
  const [current, setCurrent] = useState<string | null>(null);
  const [name, setName] = useState("");
  // The name typed here, else the one kept in this browser, else the LLMOps account name, else Guest. Read through
  // useSyncExternalStore so the server render (no storage) and the first client render agree.
  const [typed, setTyped] = useState<string | null>(null);
  const saved = useSyncExternalStore(
    (cb) => {
      window.addEventListener("storage", cb);
      return () => window.removeEventListener("storage", cb);
    },
    () => {
      try {
        return window.localStorage.getItem(NAME_KEY);
      } catch {
        return null;
      }
    },
    () => null
  );
  const me = typed ?? saved ?? ((user?.name ?? "").replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 32) || "Guest");
  const setMe = (v: string) => setTyped(v);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameText, setRenameText] = useState("");

  const list = useMemo(() => (Array.isArray(rooms.data) ? rooms.data : arr<Room>(rec(rooms.data).rooms)), [rooms.data]);
  const room = list.find((r) => r.room_id === current) ?? null;

  async function create() {
    const n = name.trim().slice(0, 80);
    if (!n) return;
    setCreating(true);
    try {
      const r = rec(await gw("/v1/rooms", { body: { name: n } }));
      setName("");
      await rooms.reload();
      if (r.room_id) setCurrent(str(r.room_id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the room");
    } finally {
      setCreating(false);
    }
  }

  if (rooms.error) return <GwErrorState error={rooms.error} onRetry={() => rooms.reload(false)} what="rooms" />;

  return (
    <div className="flex h-full min-h-[32rem] gap-3">
      <aside className={cn("w-full shrink-0 space-y-3 rounded-lg border border-hairline bg-surface p-3 md:w-64", room && "hidden md:block")}>
        <form
          className="flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New room name" aria-label="New room name" className="h-8" maxLength={80} />
          <Button type="submit" size="sm" disabled={!name.trim() || creating} aria-label="Create room">
            {creating ? <Spinner className="size-3.5" /> : <Plus className="size-4" />}
          </Button>
        </form>
        <label className="block text-xs text-ink-soft">
          Your name in rooms
          <Input
            value={me}
            onChange={(e) => setMe(e.target.value.replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 32))}
            onBlur={() => {
              try {
                window.localStorage.setItem(NAME_KEY, me);
              } catch {
                /* private mode */
              }
            }}
            className="mt-1 h-8"
            aria-label="Your name in rooms"
          />
        </label>
        {!rooms.data ? (
          <Loading label="Loading rooms…" />
        ) : !list.length ? (
          <p className="text-xs text-ink-faint">No rooms yet. Create one and share its name with your team.</p>
        ) : (
          <ul className="space-y-0.5">
            {list.map((r) => (
              <li key={r.room_id}>
                <button
                  type="button"
                  onClick={() => setCurrent(r.room_id)}
                  className={cn("w-full rounded-md px-2 py-1.5 text-left hover:bg-surface-2", r.room_id === current && "bg-primary-soft")}
                >
                  <span className="flex items-center gap-1.5 text-sm">
                    <span className="truncate">{r.name}</span>
                    {r.busy ? <Spinner className="size-3" /> : null}
                  </span>
                  <span className="block text-xs text-ink-faint">
                    {r.members ? `${r.members} here · ` : ""}
                    {plural(r.questions ?? 0, "question")} · {fmtAgo(r.last_activity)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
      <section className={cn("min-w-0 flex-1 flex-col rounded-lg border border-hairline bg-surface", room ? "flex" : "hidden md:flex")}>
        {room ? (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-3 py-2">
              <Button type="button" size="xs" variant="ghost" className="md:hidden" onClick={() => setCurrent(null)}>
                ← Rooms
              </Button>
              {renaming ? (
                <form
                  className="flex gap-1"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setRenaming(false);
                    const t = renameText.trim().slice(0, 80);
                    if (!t || t === room.name) return;
                    try {
                      await gw(`/v1/rooms/${encodeURIComponent(room.room_id)}`, { method: "PATCH", body: { name: t } });
                      void rooms.reload();
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Could not rename");
                    }
                  }}
                >
                  <Input autoFocus value={renameText} onChange={(e) => setRenameText(e.target.value)} className="h-7" aria-label="Room name" maxLength={80} />
                </form>
              ) : (
                <h2 className="truncate text-sm font-semibold text-primary">{room.name}</h2>
              )}
              <div className="ml-auto flex items-center gap-1">
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  aria-label="Rename the room"
                  onClick={() => {
                    setRenameText(room.name);
                    setRenaming(true);
                  }}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <ConfirmButton
                  size="xs"
                  variant="ghost"
                  confirmLabel="Delete for everyone?"
                  title="Delete the room and its transcript for everyone"
                  onConfirm={async () => {
                    try {
                      await gw(`/v1/rooms/${encodeURIComponent(room.room_id)}`, { method: "DELETE" });
                      setCurrent(null);
                      void rooms.reload();
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Could not delete");
                    }
                  }}
                >
                  <Trash2 className="size-3.5" />
                </ConfirmButton>
              </div>
            </div>
            <div className="min-h-0 flex-1">
              <LiveRoom
                key={`${room.room_id}:${me}`}
                room={room}
                me={me || "Guest"}
                onDeleted={() => {
                  toast.info(`“${room.name}” was deleted`);
                  setCurrent(null);
                  void rooms.reload();
                }}
                onRenamed={() => void rooms.reload()}
              />
            </div>
          </>
        ) : (
          <EmptyState icon={Users} title="Pick a room" description="Everyone in a room sees each question and the answer as it is written. Questions are answered one at a time, in order." className="m-4 flex-1" />
        )}
      </section>
    </div>
  );
}
