'use client';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  Check,
  CheckCircle2,
  CircleAlert,
  Clapperboard,
  Copy,
  FileImage,
  Instagram,
  LayoutTemplate,
  Mail,
  MoreHorizontal,
  Plus,
  RefreshCw,
  ScanSearch,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import { ActionForm, FormField, SubmitButton } from '@/components/client/action-form';
import { toast } from '@/components/client/toast';
import { cn, inputClass, textareaClass } from '@/components/ui';
import type { Concept, CreativeReview } from '@/server/services/creative';
import { createDeliverableAction, evaluateBriefAction } from './actions';

type Opt = { id: string; name: string };
type Input = {
  projectId: string;
  format: string;
  title: string;
  channel: string;
  audience: string;
  objective: string;
  brief: string;
};

const MAIN_FORMATS: Array<{ key: string; label: string; icon: React.ReactNode }> = [
  { key: 'social_post', label: 'Social post', icon: <Instagram size={17} aria-hidden /> },
  { key: 'reel', label: 'Video', icon: <Clapperboard size={17} aria-hidden /> },
  { key: 'poster', label: 'Poster', icon: <FileImage size={17} aria-hidden /> },
  { key: 'landing_page', label: 'Landing page', icon: <LayoutTemplate size={17} aria-hidden /> },
  { key: 'newsletter', label: 'Email', icon: <Mail size={17} aria-hidden /> },
];
const CHANNELS = [
  'Instagram',
  'Facebook',
  'YouTube',
  'LinkedIn',
  'Google Ads',
  'Website',
  'WhatsApp',
  'Email',
  'Print',
];
const AUDIENCES = [
  'Prospective students (16–20)',
  'Parents of Class 12 students',
  'Working professionals',
  'Alumni',
  'Recruiters and companies',
];
const OBJECTIVES = [
  'Generate enquiries',
  'Drive applications',
  'Build awareness',
  'Event registrations',
  'Engagement',
];
const VARIATIONS: Array<[string, string]> = [
  ['short_caption', 'Short caption'],
  ['student_life', 'Student life focus'],
  ['placement_focus', 'Placement focused'],
  ['carousel', 'Carousel idea'],
  ['reel_script', 'Reel script'],
];
const BRIEF_LIMIT = 2000;

const Step = ({ n, title, sub, icon }: { n: number; title: string; sub: string; icon: React.ReactNode }) => (
  <div className="flex items-start gap-3.5">
    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
      {icon}
    </span>
    <div>
      <h2 className="text-[18px] font-semibold">
        {n}. {title}
      </h2>
      <p className="text-[14px] text-muted">{sub}</p>
    </div>
  </div>
);

/**
 * New deliverable with an AI Creative Studio beside it. The form on the left is the only thing that
 * creates anything; the studio only reads the brief and suggests. Text moves into the form only when
 * the person clicks an explicit button ("Use this content", "Use as title").
 */
export function NewDeliverableStudio({
  projects,
  team,
  templates,
  projectId,
  me,
}: {
  projects: Array<{ id: string; name: string; ref: string }>;
  team: Opt[];
  templates: Record<string, { label: string; brief: string }>;
  projectId?: string;
  me: string;
}) {
  const [project, setProject] = useState(projectId ?? '');
  const [format, setFormat] = useState('social_post');
  const [title, setTitle] = useState('');
  const [channels, setChannels] = useState<string[]>(['Instagram']);
  const [addingChannel, setAddingChannel] = useState(false);
  const [audience, setAudience] = useState(AUDIENCES[0]);
  const [customAudience, setCustomAudience] = useState('');
  const [objective, setObjective] = useState(OBJECTIVES[0]);
  const [brief, setBrief] = useState('');
  const briefRef = useRef<HTMLTextAreaElement>(null);
  const studio = useRef<{ run: (v?: string) => void } | null>(null);
  const audienceValue = audience === '__custom' ? customAudience : audience;
  const ownerName = team.find((t) => t.id === me)?.name ?? '';

  const flash = () => {
    const el = briefRef.current;
    if (!el) return;
    el.classList.remove('sx-settle');
    void el.offsetWidth;
    el.classList.add('sx-settle');
  };

  return (
    <div className="grid items-start gap-6 2xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.2fr)]">
      {/* Left: the deliverable itself */}
      <section aria-labelledby="brief-h" className="rounded-2xl border border-line bg-surface">
        <div className="border-b border-line px-6 py-5" id="brief-h">
          <Step
            n={1}
            title="Enter your brief"
            sub="Fill in the basic details about your deliverable."
            icon={<ScanSearch size={22} />}
          />
        </div>
        <ActionForm action={createDeliverableAction} className="grid gap-5 p-6 sm:grid-cols-2">
          <FormField label="Project" name="projectId" required className="sm:col-span-2">
            <select
              id="projectId"
              name="projectId"
              required
              value={project}
              onChange={(e) => setProject(e.target.value)}
              className={cn(inputClass, 'h-11')}
            >
              <option value="">Choose a project…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </FormField>

          <fieldset className="sm:col-span-2">
            <legend className="mb-1.5 text-[13px] font-medium text-ink-2">
              Format <span className="text-bad">*</span>
            </legend>
            <input type="hidden" name="format" value={format} />
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Format">
              {MAIN_FORMATS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  role="radio"
                  aria-checked={format === f.key}
                  onClick={() => setFormat(f.key)}
                  className={cn(
                    'inline-flex h-11 items-center gap-2 rounded-xl border px-3.5 text-[14px] transition-colors',
                    format === f.key
                      ? 'border-accent bg-accent-soft font-medium text-ink'
                      : 'border-line text-ink-2 hover:border-line-strong',
                  )}
                >
                  {f.icon} {f.label}
                </button>
              ))}
              <label className="relative">
                <span className="sr-only">Other format</span>
                <select
                  value={MAIN_FORMATS.some((f) => f.key === format) ? '' : format}
                  onChange={(e) => e.target.value && setFormat(e.target.value)}
                  className={cn(
                    'h-11 appearance-none rounded-xl border bg-surface pr-8 pl-3.5 text-[14px]',
                    MAIN_FORMATS.some((f) => f.key === format)
                      ? 'border-line text-ink-2'
                      : 'border-accent bg-accent-soft text-ink',
                  )}
                >
                  <option value="">Other…</option>
                  {Object.entries(templates)
                    .filter(([k]) => !MAIN_FORMATS.some((f) => f.key === k))
                    .map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                </select>
                <MoreHorizontal
                  size={15}
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-muted"
                />
              </label>
            </div>
          </fieldset>

          <FormField label="Title" name="title" required className="sm:col-span-2">
            <input
              id="title"
              name="title"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Promote BCA admissions"
              className={cn(inputClass, 'h-11')}
            />
          </FormField>

          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-2" id="channels-label">
              Channel(s)
            </span>
            <input type="hidden" name="channel" value={channels.join(', ')} />
            <div className="flex min-h-11 flex-wrap items-center gap-2" aria-labelledby="channels-label">
              {channels.map((c) => (
                <span
                  key={c}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface-2 pr-1.5 pl-2.5 text-[13.5px]"
                >
                  {c === 'Instagram' ? <Instagram size={14} className="text-[#e1306c]" aria-hidden /> : null}
                  {c}
                  <button
                    type="button"
                    aria-label={`Remove ${c}`}
                    onClick={() => setChannels((cs) => cs.filter((x) => x !== c))}
                    className="rounded p-0.5 text-muted hover:text-ink"
                  >
                    <X size={13} />
                  </button>
                </span>
              ))}
              {addingChannel ? (
                <select
                  autoFocus
                  aria-label="Add a channel"
                  defaultValue=""
                  onBlur={() => setAddingChannel(false)}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v && !channels.includes(v)) setChannels((cs) => [...cs, v]);
                    setAddingChannel(false);
                  }}
                  className={cn(inputClass, 'h-9 w-40')}
                >
                  <option value="">Choose…</option>
                  {CHANNELS.filter((c) => !channels.includes(c)).map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              ) : (
                <button
                  type="button"
                  onClick={() => setAddingChannel(true)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[13.5px] text-ink-2 hover:border-line-strong"
                >
                  <Plus size={14} aria-hidden /> Add channel
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="audience-pick" className="text-[13px] font-medium text-ink-2">
              Audience
            </label>
            <input type="hidden" name="audience" value={audienceValue} />
            <select
              id="audience-pick"
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              className={cn(inputClass, 'h-11')}
            >
              {AUDIENCES.map((a) => (
                <option key={a}>{a}</option>
              ))}
              <option value="__custom">Someone else…</option>
            </select>
            {audience === '__custom' ? (
              <input
                aria-label="Describe the audience"
                value={customAudience}
                onChange={(e) => setCustomAudience(e.target.value)}
                placeholder="Describe the audience"
                className={cn(inputClass, 'h-10')}
              />
            ) : null}
          </div>

          <FormField label="Creative owner" name="ownerId">
            <div className="relative">
              <span
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-2.5 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent"
              >
                {ownerName
                  .split(' ')
                  .map((p) => p[0])
                  .slice(0, 2)
                  .join('')}
              </span>
              <select id="ownerId" name="ownerId" defaultValue={me} className={cn(inputClass, 'h-11 pl-11')}>
                {team.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          </FormField>
          <FormField label="Due for review" name="dueAt">
            <input id="dueAt" name="dueAt" type="datetime-local" className={cn(inputClass, 'h-11')} />
          </FormField>
          <FormField label="Planned publish" name="publishAt">
            <input id="publishAt" name="publishAt" type="datetime-local" className={cn(inputClass, 'h-11')} />
          </FormField>
          <FormField label="Priority" name="priority">
            <select id="priority" name="priority" defaultValue="medium" className={cn(inputClass, 'h-11')}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </FormField>
          <FormField label="Campaign objective" name="objective" className="sm:col-span-2">
            <select
              id="objective"
              name="objective"
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              className={cn(inputClass, 'h-11')}
            >
              {OBJECTIVES.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </FormField>
          <div className="sm:col-span-2">
            <FormField label="Brief" name="brief" required>
              <textarea
                ref={briefRef}
                id="brief"
                name="brief"
                required
                maxLength={BRIEF_LIMIT}
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder={templates[format]?.brief ?? 'What should this piece say, to whom, and why now?'}
                className={cn(textareaClass, 'min-h-36 leading-relaxed')}
              />
            </FormField>
            <div className="mt-1 flex items-center justify-between text-[12.5px] text-muted">
              <button
                type="button"
                onClick={() => setBrief(templates[format]?.brief ?? '')}
                className="hover:text-accent hover:underline"
              >
                Start from the {templates[format]?.label.toLowerCase() ?? 'format'} template
              </button>
              <span className="tabular">
                {brief.length}/{BRIEF_LIMIT}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <button
              type="button"
              onClick={() => studio.current?.run()}
              className="inline-flex h-12 items-center gap-2 rounded-xl border-2 border-accent px-5 text-[15px] font-medium text-accent hover:bg-accent-soft"
            >
              <Wand2 size={18} aria-hidden /> Generate AI suggestions
            </button>
            <button
              type="button"
              onClick={() => {
                if (!window.confirm('Clear the title, channels and brief?')) return;
                setTitle('');
                setChannels([]);
                setBrief('');
              }}
              className="inline-flex h-12 items-center rounded-xl border border-line px-5 text-[15px] text-ink-2 hover:border-line-strong"
            >
              Clear all
            </button>
            <SubmitButton className="ml-auto h-12 rounded-xl px-6 text-[15px]" pendingText="Creating…">
              Create deliverable
            </SubmitButton>
          </div>
          <p className="-mt-2 text-[12.5px] text-muted sm:col-span-2">
            Creates a draft. Submitting to the client and publishing stay separate steps.
          </p>
        </ActionForm>
      </section>

      <CreativeStudio
        apiRef={studio}
        input={{
          projectId: project,
          format,
          title,
          channel: channels.join(', '),
          audience: audienceValue,
          objective,
          brief,
        }}
        onUse={(c) => {
          setTitle(c.hook || title);
          const block = [
            `Creative direction: ${c.name}`,
            `Core message: ${c.coreMessage}`,
            `Hook: ${c.hook}`,
            c.caption ? `Caption: ${c.caption}` : '',
            `CTA: ${c.cta}`,
            c.hashtags.length ? `Hashtags: ${c.hashtags.join(' ')}` : '',
            `Visual direction: ${c.visualDirection}`,
          ]
            .filter(Boolean)
            .join('\n');
          setBrief((b) => `${b.trimEnd()}\n\n${block}`.trimStart().slice(0, BRIEF_LIMIT));
          flash();
          toast('Concept added to your brief — review it, then create the deliverable');
        }}
        onUseTitle={(t) => {
          setTitle(t);
          toast('Title updated');
        }}
      />
    </div>
  );
}

function CreativeStudio({
  apiRef,
  input,
  onUse,
  onUseTitle,
}: {
  apiRef: React.RefObject<{ run: (v?: string) => void } | null>;
  input: Input;
  onUse: (c: Concept) => void;
  onUseTitle: (t: string) => void;
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const [review, setReview] = useState<CreativeReview | null>(null);
  const [demo, setDemo] = useState(false);
  const [selected, setSelected] = useState(0);
  const [details, setDetails] = useState(false);
  const [variation, setVariation] = useState<string | null>(null);
  const busy = useRef(false);
  const ready = !!input.projectId && input.brief.trim().length > 10;

  const run = async (v?: string) => {
    if (busy.current) return;
    if (!ready) {
      toast('Choose a project and write a brief first', 'bad');
      return;
    }
    busy.current = true;
    setState('loading');
    setError('');
    setVariation(v ?? null);
    try {
      const res = await evaluateBriefAction({ ...input, variation: v ?? '' });
      if (!res.ok) {
        setError(res.error);
        setState(review ? 'done' : 'error');
        toast(res.error, 'bad');
        return;
      }
      setDemo(res.demo);
      setReview(res.review);
      setSelected(0);
      setState('done');
    } catch {
      setError('Couldn’t reach the server. Check your connection and try again, or continue manually.');
      setState(review ? 'done' : 'error');
    } finally {
      busy.current = false;
    }
  };
  useEffect(() => {
    apiRef.current = { run };
  });

  const concept = review?.concepts[selected] ?? null;
  const setConcept = (next: Concept) =>
    setReview((r) => (r ? { ...r, concepts: r.concepts.map((x, i) => (i === selected ? next : x)) } : r));

  return (
    <div className="min-w-0 space-y-5" aria-busy={state === 'loading'}>
      {/* Banner */}
      <section className="relative overflow-hidden rounded-2xl border border-line bg-[radial-gradient(120%_140%_at_100%_0%,#173a5a_0%,#0f2133_45%,#0d1a26_100%)] px-6 py-5">
        <Sparkles size={22} aria-hidden className="absolute top-5 right-[30%] text-[#9fd8ff] opacity-80" />
        <Sparkles size={14} aria-hidden className="absolute right-[24%] bottom-6 text-[#fde68a]" />
        <Sparkles size={16} aria-hidden className="absolute top-4 right-[10%] text-white/80" />
        <div className="relative flex flex-wrap items-center gap-4">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[#0b2130] text-accent ring-1 ring-accent/30">
            <Sparkles size={28} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <span className="inline-block rounded-md bg-[#5b5bd6] px-2 py-0.5 text-[11.5px] font-semibold tracking-wide text-white">
              BETA
            </span>
            <h2 className="mt-1 text-[24px] font-semibold text-white">AI Creative Studio</h2>
            <p className="text-[14.5px] text-[#b6c6d4]">
              Reviews your brief and suggests stronger creative directions. You decide what to use.
            </p>
          </div>
          <button
            type="button"
            onClick={() => run(variation ?? undefined)}
            disabled={state === 'loading'}
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-accent/60 px-4 text-[14.5px] font-medium text-accent hover:bg-accent-soft disabled:opacity-60"
          >
            <RefreshCw size={16} className={state === 'loading' ? 'animate-spin' : undefined} aria-hidden />{' '}
            {review ? 'Regenerate' : 'Analyse brief'}
          </button>
        </div>
      </section>

      {state === 'error' ? (
        <div role="alert" className="rounded-xl border border-bad/30 bg-bad-soft px-4 py-3 text-[14px]">
          {error} You can still fill in the form and create the deliverable yourself.
        </div>
      ) : null}
      {state === 'done' && error ? (
        <p role="alert" className="text-[13.5px] text-bad">
          {error}
        </p>
      ) : null}

      {!review ? (
        <section className="rounded-2xl border border-dashed border-line-strong bg-surface p-8 text-center">
          {state === 'loading' ? (
            <div className="mx-auto max-w-md space-y-3" aria-hidden>
              <div className="h-5 animate-pulse rounded bg-surface-2" />
              <div className="h-24 animate-pulse rounded-xl bg-surface-2" />
              <div className="h-40 animate-pulse rounded-xl bg-surface-2" />
            </div>
          ) : (
            <>
              <Sparkles size={30} className="mx-auto text-accent" aria-hidden />
              <p className="mt-3 text-[16px] font-medium">Your brief analysis and concepts appear here</p>
              <p className="mx-auto mt-1 max-w-md text-[14px] text-muted">
                Fill in the brief, then press <b>Generate AI suggestions</b>. You get a score, what to improve
                and three creative directions you can edit.
              </p>
            </>
          )}
        </section>
      ) : (
        <div className={cn('space-y-5', state === 'loading' && 'opacity-60')}>
          {/* Brief analysis */}
          <section className="rounded-2xl border border-line bg-surface p-5">
            <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_170px]">
              <div className="flex gap-4">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
                  <BadgeCheck size={22} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[17px] font-semibold">Brief analysis</h3>
                    <span className="rounded-full bg-demo-soft px-2 py-0.5 text-[11.5px] font-medium text-demo">
                      {demo ? 'Sample · written by rules' : 'AI suggestion'}
                    </span>
                  </div>
                  <ul className="mt-2 space-y-2">
                    {(review.checklist.length
                      ? review.checklist
                      : review.gaps.map((g) => ({ ok: false, text: g }))
                    ).map((c, i) => (
                      <li key={i} className="flex gap-2.5 text-[14.5px] leading-snug">
                        {c.ok ? (
                          <CheckCircle2 size={19} className="mt-px shrink-0 text-ok" aria-label="Working" />
                        ) : (
                          <CircleAlert size={19} className="mt-px shrink-0 text-warn" aria-label="Improve" />
                        )}
                        {c.text}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="flex flex-col items-center justify-center border-line md:border-l md:pl-5">
                <p className="text-[13.5px] text-muted">Overall score</p>
                <ScoreRing score={review.score} />
                <button
                  type="button"
                  onClick={() => setDetails((d) => !d)}
                  aria-expanded={details}
                  className="inline-flex items-center gap-1 text-[13.5px] font-medium text-accent hover:underline"
                >
                  {details ? 'Hide details' : 'View details'}{' '}
                  <ArrowRight
                    size={14}
                    className={cn('transition-transform', details && 'rotate-90')}
                    aria-hidden
                  />
                </button>
              </div>
            </div>
            {details ? (
              <dl className="mt-4 grid gap-3 border-t border-line pt-4 md:grid-cols-2">
                {(
                  [
                    ['Audience fit', review.audienceFit],
                    ['Format & platform fit', review.formatFit],
                    ['Supports the objective?', review.objectiveFit],
                    ['Recommended direction', review.recommendedDirection],
                  ] as const
                )
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <div key={k} className="rounded-xl bg-surface-2/70 px-4 py-3">
                      <dt className="text-[12.5px] font-medium text-muted">{k}</dt>
                      <dd className="mt-1 text-[14px] leading-snug">{v}</dd>
                    </div>
                  ))}
                {review.opportunities.length ? (
                  <div className="rounded-xl bg-surface-2/70 px-4 py-3 md:col-span-2">
                    <dt className="text-[12.5px] font-medium text-muted">Opportunities to stand out</dt>
                    <dd>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-[14px]">
                        {review.opportunities.map((o, i) => (
                          <li key={i}>{o}</li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
          </section>

          {/* Concepts */}
          {review.concepts.length && concept ? (
            <section className="rounded-2xl border border-line bg-surface">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
                <Step
                  n={2}
                  title="AI suggested concepts"
                  sub="Choose a direction or mix and match. All content is editable."
                  icon={<Sparkles size={20} />}
                />
                <div className="flex gap-1.5" role="tablist" aria-label="Concepts">
                  {review.concepts.map((c, i) => (
                    <button
                      key={i}
                      type="button"
                      role="tab"
                      aria-selected={selected === i}
                      onClick={() => setSelected(i)}
                      className={cn(
                        'h-10 rounded-xl border px-4 text-[14px] font-medium transition-colors',
                        selected === i
                          ? 'border-accent bg-accent text-accent-ink'
                          : 'border-line text-ink-2 hover:border-line-strong',
                      )}
                    >
                      Concept {i + 1}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)]">
                <LayoutPreview concept={concept} />
                <div className="min-w-0 space-y-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[16px] font-semibold">
                      Concept {selected + 1} <span className="font-normal text-muted">· {concept.name}</span>
                    </p>
                    {selected === 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-lg border border-ok/30 bg-ok-soft px-2 py-1 text-[12.5px] font-medium text-ok">
                        <CheckCircle2 size={14} aria-hidden /> Recommended
                      </span>
                    ) : null}
                  </div>
                  <p className="text-[13.5px] text-muted">{concept.rationale}</p>
                  <EditRow
                    label="Headline / Hook"
                    value={concept.hook}
                    onChange={(v) => setConcept({ ...concept, hook: v })}
                    action={
                      <button
                        type="button"
                        onClick={() => onUseTitle(concept.hook)}
                        className="text-[12.5px] text-accent hover:underline"
                      >
                        Use as title
                      </button>
                    }
                  />
                  <EditRow
                    label="Caption"
                    multiline
                    value={concept.caption || concept.coreMessage}
                    onChange={(v) => setConcept({ ...concept, caption: v })}
                  />
                  <EditRow
                    label="Call to action"
                    value={concept.cta}
                    onChange={(v) => setConcept({ ...concept, cta: v })}
                  />
                  {concept.hashtags.length ? (
                    <div>
                      <p className="mb-1.5 text-[13px] text-muted">Hashtags</p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {concept.hashtags.map((h) => (
                          <span
                            key={h}
                            className="rounded-lg bg-accent-soft px-2.5 py-1 text-[13px] text-accent"
                          >
                            {h}
                          </span>
                        ))}
                        <CopyBtn text={concept.hashtags.join(' ')} label="Copy hashtags" />
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="mx-5 mb-5 rounded-xl border border-line bg-surface-2/60 p-4">
                <p className="mb-2 flex items-center gap-2 text-[15px] font-semibold">
                  <FileImage size={18} className="text-accent" aria-hidden /> Visual direction
                </p>
                <ul className="list-disc space-y-1 pl-5 text-[14px] text-ink-2">
                  <li>{concept.visualDirection}</li>
                  {review.copy.visualNotes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
                {review.copy.structure.length ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-[13.5px] font-medium text-accent">
                      Suggested structure ({review.copy.structure.length} steps)
                    </summary>
                    <ol className="mt-2 list-decimal space-y-1 pl-5 text-[14px]">
                      {review.copy.structure.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ol>
                  </details>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-4">
                <span className="mr-1 flex items-center gap-1.5 text-[14px] font-medium">
                  <RefreshCw size={15} className="text-muted" aria-hidden /> Other variations
                </span>
                {VARIATIONS.map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    disabled={state === 'loading'}
                    onClick={() => run(k)}
                    aria-pressed={variation === k}
                    className={cn(
                      'h-9 rounded-lg border px-3 text-[13px] transition-colors disabled:opacity-60',
                      variation === k
                        ? 'border-accent text-accent'
                        : 'border-line text-ink-2 hover:border-line-strong',
                    )}
                  >
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={state === 'loading'}
                  onClick={() => run()}
                  className="ml-auto inline-flex h-10 items-center gap-2 rounded-xl border border-accent/60 px-4 text-[14px] font-medium text-accent hover:bg-accent-soft disabled:opacity-60"
                >
                  <RefreshCw size={15} aria-hidden /> Regenerate all
                </button>
              </div>
              <div className="flex justify-end px-5 pb-5">
                <button
                  type="button"
                  onClick={() => onUse(concept)}
                  className="inline-flex h-12 items-center gap-2 rounded-xl bg-accent px-6 text-[15px] font-semibold text-accent-ink hover:brightness-110"
                >
                  <Check size={18} aria-hidden /> Use this content
                </button>
              </div>
            </section>
          ) : (
            <section className="rounded-2xl border border-line bg-surface p-5 text-[14px] text-muted">
              {demo
                ? 'Concepts need the AI assistant connected (sample mode only checks your brief).'
                : 'No concepts came back this time — try Regenerate.'}
            </section>
          )}
          <p className="text-[12.5px] text-faint">
            AI suggestions can be wrong. The studio is told never to invent placements, rankings or statistics
            and marks anything to confirm in [brackets]. Nothing is created until you press Create
            deliverable.
          </p>
        </div>
      )}
    </div>
  );
}

function ScoreRing({ score }: { score: number | null }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const pct = score == null ? 0 : score / 10;
  return (
    <div
      className="my-2 flex items-center gap-2"
      role="img"
      aria-label={score == null ? 'No score in sample mode' : `Score ${score} out of 10`}
    >
      <svg width="84" height="84" viewBox="0 0 84 84" aria-hidden>
        <circle cx="42" cy="42" r={r} fill="none" stroke="var(--line)" strokeWidth="7" />
        {score != null ? (
          <circle
            cx="42"
            cy="42"
            r={r}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={`${c * pct} ${c}`}
            transform="rotate(-90 42 42)"
          />
        ) : null}
      </svg>
      <span className="text-[22px] font-semibold whitespace-nowrap tabular">
        {score == null ? '—' : score.toFixed(1)}
        <span className="text-[14px] font-normal text-muted"> / 10</span>
      </span>
    </div>
  );
}

function EditRow({
  label,
  value,
  onChange,
  multiline,
  action,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[13px] text-muted">{label}</span>
        {action}
      </div>
      <div className="flex items-start gap-2">
        {multiline ? (
          <textarea
            aria-label={label}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={4}
            className={cn(textareaClass, 'min-h-24 flex-1 text-[14px] leading-relaxed')}
          />
        ) : (
          <input
            aria-label={label}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={cn(inputClass, 'h-11 flex-1 text-[14.5px]')}
          />
        )}
        <CopyBtn text={value} label={`Copy ${label.toLowerCase()}`} />
      </div>
    </div>
  );
}

function CopyBtn({ text, label }: { text: string; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          toast('Copied');
        } catch {
          toast('Couldn’t copy — select the text and copy it manually', 'bad');
        }
      }}
      className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-line text-muted hover:border-line-strong hover:text-ink"
    >
      <Copy size={15} />
    </button>
  );
}

/** A typographic layout preview built from the concept's own words — not a generated image. */
function LayoutPreview({ concept }: { concept: Concept }) {
  const words = concept.hook.split(' ');
  const cut = Math.max(1, Math.ceil(words.length * 0.55));
  return (
    <figure className="relative flex aspect-[4/5] flex-col overflow-hidden rounded-2xl bg-[linear-gradient(160deg,#eef3f6_0%,#dfe9ef_55%,#c9dbe5_100%)] p-6 text-[#10293a] shadow-[0_12px_32px_rgb(0_0_0/0.35)]">
      <div aria-hidden className="absolute -right-16 -bottom-16 h-64 w-64 rounded-full bg-[#2f7f9a]/20" />
      <div aria-hidden className="absolute top-10 -right-6 h-32 w-32 rounded-full bg-[#f3b23a]/25" />
      <p className="relative text-[10.5px] font-semibold tracking-[0.18em] text-[#2f5b70] uppercase">
        Layout preview
      </p>
      <p className="relative mt-4 text-[clamp(26px,3.2vw,40px)] leading-[1.02] font-extrabold tracking-[-0.02em]">
        {words.slice(0, cut).join(' ')} <span className="text-[#1f8a9f]">{words.slice(cut).join(' ')}</span>
      </p>
      {concept.highlights.length ? (
        <ul className="relative mt-5 space-y-1.5 text-[13.5px] font-medium">
          {concept.highlights.map((h) => (
            <li key={h} className="flex items-center gap-2">
              <CheckCircle2 size={15} className="text-[#1f8a9f]" aria-hidden /> {h}
            </li>
          ))}
        </ul>
      ) : null}
      <span className="relative mt-auto inline-flex w-fit items-center gap-1.5 rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-[#10293a] shadow">
        {concept.cta || 'Learn more'} <ArrowRight size={14} aria-hidden />
      </span>
      <figcaption className="sr-only">Layout preview for {concept.name}</figcaption>
    </figure>
  );
}
