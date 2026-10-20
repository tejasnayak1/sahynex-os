'use client';
import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import {
  CalendarDays,
  CircleCheck,
  MessageSquare,
  PartyPopper,
  Plus,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { toast } from '@/components/client/toast';
import { buttonClass, cn, textareaClass } from '@/components/ui';
import {
  celebrate,
  playSound,
  reducedMotion,
  setSoundEnabled,
  soundEnabled,
  subscribeSound,
} from '@/components/client/task-effects';
import { taskStatusAction } from './actions';

export type BoardTask = {
  id: string;
  title: string;
  sub: string;
  dueLabel: string;
  late: boolean;
  /** Owner first, then collaborators. */
  people: string[];
  comments: number;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  completedLabel: string | null;
  status: Status;
};
type Status = 'todo' | 'in_progress' | 'blocked' | 'in_review' | 'done';

const COLS: Status[] = ['todo', 'in_progress', 'blocked', 'in_review', 'done'];
const LABEL: Record<Status, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  blocked: 'Blocked',
  in_review: 'In review',
  done: 'Done',
};
/** Workflow order used to decide whether a move is "forward" (worth celebrating). */
const RANK: Record<Status, number> = { todo: 0, blocked: 0.5, in_progress: 1, in_review: 2, done: 3 };
const SHOWN_IN_DONE = 20;

type Drag = {
  id: string;
  from: Status;
  over: Status | null;
  x: number;
  y: number;
  offX: number;
  offY: number;
  w: number;
  pointer: boolean;
};

export function KanbanBoard({ tasks }: { tasks: BoardTask[] }) {
  // Local status while a save is in flight. Each override remembers the server status it was made
  // against, so it stops applying as soon as fresh server data arrives (the server is the truth).
  const [overrides, setOverrides] = useState<Record<string, { to: Status; base: Status }>>({});
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<Drag | null>(null);
  const [settled, setSettled] = useState<string | null>(null);
  const [blockFor, setBlockFor] = useState<{ id: string; from: Status } | null>(null);
  const sound = useSyncExternalStore(subscribeSound, soundEnabled, () => false);
  const [announce, setAnnounce] = useState('');
  const [notice, setNotice] = useState<{ id: number; to: Status; title: string } | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const dragRef = useRef<Drag | null>(null);
  const moved = useRef(false);
  const helpId = useId();

  const statusOf = useCallback(
    (t: BoardTask) => {
      const o = overrides[t.id];
      return o && o.base === t.status ? o.to : t.status;
    },
    [overrides],
  );

  const commit = useCallback(
    async (id: string, from: Status, to: Status, note?: string) => {
      if (from === to || pending.has(id)) return;
      if (to === 'blocked' && !note) {
        setBlockFor({ id, from });
        return;
      }
      const title = tasks.find((t) => t.id === id)?.title ?? 'Task';
      setPending((p) => new Set(p).add(id));
      const base = tasks.find((t) => t.id === id)?.status ?? from;
      setOverrides((o) => ({ ...o, [id]: { to, base } }));
      setAnnounce(`Saving: ${title} to ${LABEL[to]}`);
      const fd = new FormData();
      fd.set('id', id);
      fd.set('status', to);
      if (note) fd.set('note', note);
      let ok = false;
      let message = 'Could not save the change.';
      try {
        const res = await taskStatusAction(null, fd);
        ok = !!res?.ok;
        message = (ok ? res?.message : res?.error) ?? message;
      } catch {
        message = 'Network problem — the task was not moved.';
      }
      setPending((p) => {
        const n = new Set(p);
        n.delete(id);
        return n;
      });
      if (!ok) {
        // Put the card back exactly where it was.
        setOverrides((o) => {
          const n = { ...o };
          delete n[id];
          return n;
        });
        toast(message.split('\n')[0], 'bad');
        setAnnounce(`Not moved: ${message}`);
        return;
      }
      const n = { id: Date.now(), to, title };
      setNotice(n);
      setTimeout(() => setNotice((cur) => (cur?.id === n.id ? null : cur)), 4500);
      setAnnounce(`${title} moved to ${LABEL[to]}`);
      setSettled(id);
      setTimeout(() => setSettled((s) => (s === id ? null : s)), 320);
      if (RANK[to] > RANK[from] && to !== 'blocked') {
        requestAnimationFrame(() => {
          // Burst from the card if it is on screen, otherwise from the column it landed in.
          const el = cardRefs.current.get(id);
          const r = el?.getBoundingClientRect();
          const visible = !!r && r.top >= 0 && r.bottom <= window.innerHeight;
          const anchor = visible ? el! : document.querySelector(`[data-col="${to}"] header`);
          celebrate(anchor, to === 'done' ? 'confetti' : 'sparkle');
          if (to === 'done') celebrate(noticeRef.current, 'confetti');
        });
        playSound(to === 'done' ? 'done' : 'move');
      }
    },
    [pending, tasks],
  );

  /* ---------------- pointer (mouse, pen, touch) dragging ---------------- */

  const colAt = (x: number, y: number): Status | null => {
    for (const el of document.elementsFromPoint(x, y)) {
      const c = (el as HTMLElement).dataset?.col;
      if (c) return c as Status;
    }
    return null;
  };

  useEffect(() => {
    if (!drag?.pointer) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const next = { ...d, x: e.clientX, y: e.clientY, over: colAt(e.clientX, e.clientY) };
      dragRef.current = next;
      setDrag(next);
    };
    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!d) return;
      const to = colAt(e.clientX, e.clientY);
      if (to && to !== d.from) void commit(d.id, d.from, to);
    };
    const onCancel = () => {
      dragRef.current = null;
      setDrag(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
    };
  }, [drag?.pointer, commit]);

  const onPointerDown = (e: React.PointerEvent<HTMLElement>, t: BoardTask, from: Status) => {
    if (e.button !== 0 || pending.has(t.id)) return;
    if ((e.target as HTMLElement).closest('select,button,textarea,input,summary')) return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const sx = e.clientX;
    const sy = e.clientY;
    moved.current = false;
    // Start dragging only after a small movement, so taps and clicks still open the task.
    const threshold = e.pointerType === 'touch' ? 10 : 5;
    const onMove = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < threshold) return;
      cleanup();
      moved.current = true;
      const d: Drag = {
        id: t.id,
        from,
        over: from,
        x: ev.clientX,
        y: ev.clientY,
        offX: sx - r.left,
        offY: sy - r.top,
        w: r.width,
        pointer: true,
      };
      dragRef.current = d;
      setDrag(d);
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', cleanup);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', cleanup);
  };

  /* ------------------------- keyboard moving ------------------------- */

  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>, t: BoardTask, from: Status) => {
    if (e.target !== e.currentTarget) return; // let links and selects behave normally
    const d = dragRef.current;
    if (!d || d.id !== t.id) {
      if (e.key === ' ' || e.key === 'Enter') {
        if (e.key === 'Enter') return; // Enter keeps its usual meaning (open via the title link)
        e.preventDefault();
        const nd: Drag = { id: t.id, from, over: from, x: 0, y: 0, offX: 0, offY: 0, w: 0, pointer: false };
        dragRef.current = nd;
        setDrag(nd);
        setAnnounce(
          `Picked up ${t.title}. Use left and right arrows to choose a column, Space to drop, Escape to cancel.`,
        );
      }
      return;
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const i = COLS.indexOf(d.over ?? from);
      const j = Math.max(0, Math.min(COLS.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)));
      const nd = { ...d, over: COLS[j] };
      dragRef.current = nd;
      setDrag(nd);
      setAnnounce(LABEL[COLS[j]]);
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      dragRef.current = null;
      setDrag(null);
      if (d.over && d.over !== from) void commit(t.id, from, d.over);
      else setAnnounce('Dropped in the same column. Nothing changed.');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      dragRef.current = null;
      setDrag(null);
      setAnnounce('Move cancelled.');
    }
  };

  const dragged = drag ? tasks.find((t) => t.id === drag.id) : null;

  return (
    <div className="relative">
      <p id={helpId} className="sr-only">
        Drag cards between columns, or focus a card and press Space, then the arrow keys, then Space to drop.
      </p>
      <p className="sr-only" aria-live="assertive">
        {announce}
      </p>

      {/* Move confirmation (top right) */}
      <div className="pointer-events-none absolute -top-[132px] right-0 z-40 flex justify-end">
        {notice ? (
          <div
            ref={noticeRef}
            role="status"
            className="sx-settle pointer-events-auto flex w-[330px] items-start gap-3 rounded-xl border border-line-strong bg-surface px-4 py-3 shadow-[0_18px_40px_rgb(0_0_0/0.45)]"
          >
            <PartyPopper size={30} className="shrink-0 text-warn" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">Task moved to {LABEL[notice.to]}!</p>
              <p className="truncate text-[13px] text-muted">{notice.title}</p>
            </div>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setNotice(null)}
              className="text-muted hover:text-ink"
            >
              <X size={16} />
            </button>
          </div>
        ) : null}
      </div>

      <div className="-mx-3 overflow-x-auto px-3 pb-24 sm:-mx-7 sm:px-7">
        <div className="grid min-w-[1180px] grid-cols-5 gap-4">
          {COLS.map((c) => {
            const all = tasks.filter((t) => statusOf(t) === c);
            const items = c === 'done' ? all.slice(0, SHOWN_IN_DONE) : all;
            const target = !!drag && drag.over === c && drag.over !== drag.from;
            return (
              <section
                key={c}
                data-col={c}
                aria-label={LABEL[c]}
                className={cn(
                  'flex min-h-[520px] flex-col rounded-2xl border bg-surface/70 transition-[border-color,box-shadow] duration-150',
                  target ? 'border-accent/70 shadow-[0_0_0_3px_var(--accent-soft)]' : 'border-line',
                )}
              >
                <header className="flex items-center gap-2.5 px-4 pt-4 pb-3">
                  <span aria-hidden className={cn('h-3.5 w-3.5 rounded-full', DOT[c])} />
                  <h2 className="text-[17px] font-semibold">{LABEL[c]}</h2>
                  <span className="ml-auto text-[14px] text-muted tabular">{all.length}</span>
                  <Link
                    href="/tasks/new"
                    aria-label={`New task`}
                    className="grid h-8 w-8 place-items-center rounded-lg text-accent hover:bg-accent-soft"
                  >
                    <Plus size={18} aria-hidden />
                  </Link>
                </header>
                <ul className="flex flex-1 flex-col gap-3 px-3 pb-3">
                  {target ? (
                    <li
                      aria-hidden
                      className="relative grid h-[150px] shrink-0 place-items-center rounded-xl border-2 border-dashed border-accent/70 bg-accent-soft/40 text-center text-[14.5px] font-medium text-accent"
                    >
                      <span>
                        Drop here to move to
                        <br />
                        {LABEL[c]}
                      </span>
                      <Sparkles size={16} className="absolute top-4 left-4 text-warn" />
                      <Sparkles size={12} className="absolute right-5 bottom-5 text-warn" />
                    </li>
                  ) : null}
                  {items.map((t) => {
                    const isDragging = drag?.id === t.id;
                    const saving = pending.has(t.id);
                    const st = statusOf(t);
                    return (
                      <li
                        key={t.id}
                        ref={(el) => {
                          if (el) cardRefs.current.set(t.id, el);
                          else cardRefs.current.delete(t.id);
                        }}
                        tabIndex={0}
                        aria-describedby={helpId}
                        aria-busy={saving || undefined}
                        onPointerDown={(e) => onPointerDown(e, t, st)}
                        onKeyDown={(e) => onKeyDown(e, t, st)}
                        onClickCapture={(e) => {
                          // A drag that ends on the title link must not also open the task.
                          if (moved.current) {
                            e.preventDefault();
                            e.stopPropagation();
                            moved.current = false;
                          }
                        }}
                        className={cn(
                          'group relative cursor-grab touch-pan-y rounded-xl border border-l-4 border-line bg-surface p-4 transition-[opacity,transform,box-shadow] duration-150 select-none hover:border-line-strong active:cursor-grabbing',
                          EDGE[st],
                          isDragging && drag?.pointer && 'opacity-30',
                          isDragging && !drag?.pointer && 'ring-2 ring-accent',
                          saving && 'opacity-70',
                          settled === t.id && 'sx-settle',
                        )}
                      >
                        <CardBody t={t} status={st} />
                        {saving ? (
                          <span
                            aria-hidden
                            className="absolute top-3 right-3 h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent"
                          />
                        ) : null}
                      </li>
                    );
                  })}
                  {!items.length && !target ? (
                    <li className="grid flex-1 place-items-center rounded-xl border border-dashed border-line px-2 py-8 text-[13.5px] text-faint">
                      Nothing here
                    </li>
                  ) : null}
                  {c === 'done' && all.length > SHOWN_IN_DONE ? (
                    <li className="px-1 text-[12.5px] text-faint">Showing the latest {SHOWN_IN_DONE}</li>
                  ) : null}
                </ul>
              </section>
            );
          })}
        </div>
      </div>

      {/* The card following the pointer */}
      {drag?.pointer && dragged ? (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[80] rounded-xl border-2 border-accent bg-[linear-gradient(160deg,#1c3a5c,#14263f)] p-4 text-white shadow-[0_24px_60px_rgb(0_0_0/0.55),0_0_0_6px_rgb(63_193_201/0.12)]"
          style={{
            width: drag.w,
            left: 0,
            top: 0,
            transform: `translate(${drag.x - drag.offX}px, ${drag.y - drag.offY}px) rotate(${reducedMotion() ? 0 : 4}deg) scale(1.03)`,
          }}
        >
          <CardBody t={dragged} status={drag.from} floating />
          <Sparkles size={20} className="absolute -top-3 -left-3 text-warn" />
          <Sparkles size={14} className="absolute top-1/2 -right-3 text-warn" />
          <Sparkles size={16} className="absolute -bottom-3 left-1/3 text-[#fde68a]" />
        </div>
      ) : null}

      {/* Sound preference */}
      <div className="fixed bottom-5 left-5 z-30 flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 shadow-[0_12px_32px_rgb(0_0_0/0.4)] lg:left-[272px]">
        {sound ? (
          <Volume2 size={22} className="text-ink" aria-hidden />
        ) : (
          <VolumeX size={22} className="text-muted" aria-hidden />
        )}
        <div className="leading-tight">
          <p className={cn('text-[14.5px] font-medium', sound ? 'text-accent' : 'text-ink')}>
            Sound {sound ? 'on' : 'off'}
          </p>
          <p className="text-[12.5px] text-muted">
            {sound ? 'You’ll hear a sound when tasks move.' : 'Turn on to hear a sound when tasks move.'}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={sound}
          aria-label={sound ? 'Sound on' : 'Sound off'}
          onClick={() => {
            const next = !sound;
            setSoundEnabled(next);
            if (next) playSound('move');
          }}
          className={cn(
            'relative ml-2 h-7 w-12 rounded-full transition-colors',
            sound ? 'bg-accent' : 'bg-line-strong',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-[left]',
              sound ? 'left-6' : 'left-1',
            )}
          />
        </button>
      </div>

      <BlockerDialog
        open={!!blockFor}
        title={blockFor ? (tasks.find((t) => t.id === blockFor.id)?.title ?? '') : ''}
        onCancel={() => {
          setBlockFor(null);
          setAnnounce('Not moved.');
        }}
        onSubmit={(note) => {
          const b = blockFor;
          setBlockFor(null);
          if (b) void commit(b.id, b.from, 'blocked', note);
        }}
      />
    </div>
  );
}

const DOT: Record<Status, string> = {
  todo: 'bg-[#8b9bb0]',
  in_progress: 'bg-[#4f8cff]',
  blocked: 'bg-bad',
  in_review: 'bg-[#f0c04a]',
  done: 'bg-ok',
};
const EDGE: Record<Status, string> = {
  todo: 'border-l-[#6b7ff0]',
  in_progress: 'border-l-[#4f8cff]',
  blocked: 'border-l-bad',
  in_review: 'border-l-[#f0c04a]',
  done: 'border-l-ok',
};
const PRIORITY: Record<BoardTask['priority'], string> = {
  urgent: 'bg-bad-soft text-bad',
  high: 'bg-bad-soft text-bad',
  medium: 'bg-warn-soft text-warn',
  low: 'bg-ok-soft text-ok',
};
const FACES = [
  'bg-[#f3d6c4] text-[#7a4426]',
  'bg-[#cfe0f7] text-[#28518a]',
  'bg-[#d8f0e3] text-[#1f6b47]',
  'bg-[#e8dcf7] text-[#5b3a8c]',
];

function CardBody({ t, status, floating }: { t: BoardTask; status: Status; floating?: boolean }) {
  const done = status === 'done';
  return (
    <>
      <div className="flex items-start gap-2">
        {done ? <CircleCheck size={20} className="mt-0.5 shrink-0 text-ok" aria-hidden /> : null}
        {floating ? (
          <p className="text-[15.5px] leading-snug font-semibold">{t.title}</p>
        ) : (
          <Link
            href={`/tasks/${t.id}`}
            draggable={false}
            className="pr-4 text-[15.5px] leading-snug font-semibold text-ink hover:underline"
          >
            {t.title}
          </Link>
        )}
      </div>
      <p
        className={cn(
          'mt-1 truncate text-[13.5px]',
          floating ? 'text-white/70' : 'text-muted',
          done && 'pl-7',
        )}
      >
        {t.sub}
      </p>
      <div className="mt-3 flex items-center justify-between gap-2 text-[13px]">
        {done ? (
          <span className="flex items-center gap-1.5 text-muted">
            <CircleCheck size={14} aria-hidden /> {t.completedLabel ?? 'Completed'}
          </span>
        ) : (
          <span
            className={cn(
              'flex items-center gap-1.5',
              t.late ? 'font-medium text-bad' : floating ? 'text-white/80' : 'text-ink-2',
            )}
          >
            <CalendarDays size={15} aria-hidden /> {t.dueLabel}
          </span>
        )}
        <span
          className={cn(
            'rounded-md px-2 py-0.5 text-[12.5px] font-medium capitalize',
            status === 'blocked' && !done ? 'bg-bad-soft text-bad' : PRIORITY[t.priority],
          )}
        >
          {status === 'blocked' && !done ? 'Blocked' : t.priority}
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="flex -space-x-2">
          {t.people.slice(0, 3).map((p, i) => (
            <span
              key={`${p}${i}`}
              title={p}
              className={cn(
                'grid h-8 w-8 place-items-center rounded-full text-[11.5px] font-semibold ring-2 ring-surface',
                FACES[i % FACES.length],
              )}
            >
              {p
                .replace(/\(.*\)/, '')
                .trim()
                .split(/\s+/)
                .map((x) => x[0])
                .slice(0, 2)
                .join('')
                .toUpperCase()}
            </span>
          ))}
          {!t.people.length ? <span className="text-[12.5px] text-faint">Unassigned</span> : null}
        </span>
        <span
          className={cn('flex items-center gap-1.5 text-[13px]', floating ? 'text-white/80' : 'text-muted')}
        >
          <MessageSquare size={15} aria-hidden /> {t.comments}
          <span className="sr-only">comments</span>
        </span>
      </div>
    </>
  );
}

/** Blocking a task needs a note (the server enforces this too). */
function BlockerDialog({
  open,
  title,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  title: string;
  onCancel: () => void;
  onSubmit: (note: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [note, setNote] = useState('');
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setNote('');
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      className="m-auto w-[calc(100vw-32px)] max-w-md rounded-lg border border-line bg-surface p-0 text-ink shadow-[0_20px_60px_rgb(10_20_30/0.25)]"
    >
      <form
        className="space-y-3 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (note.trim()) onSubmit(note.trim());
        }}
      >
        <h2 id={titleId} className="text-[16px] font-semibold">
          What’s blocking this?
        </h2>
        <p className="text-[13px] text-muted">“{title}” moves to Blocked once you describe the blocker.</p>
        <textarea
          required
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className={textareaClass}
          aria-label="Blocker note"
        />
        <div className="flex gap-2">
          <button type="submit" className={buttonClass('primary')} disabled={!note.trim()}>
            Mark blocked
          </button>
          <button type="button" className={buttonClass('ghost')} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}
