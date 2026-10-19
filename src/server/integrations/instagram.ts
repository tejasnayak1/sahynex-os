/**
 * Instagram (professional account) via the official Instagram Graph API on graph.facebook.com:
 *   GET /{version}/{ig-user-id}?fields=username,followers_count,media_count
 *   GET /{version}/{ig-user-id}/media?fields=id,caption,timestamp,like_count,comments_count,permalink,media_type
 *
 * Only stable account and media fields are used (not the insights metrics Meta keeps renaming).
 * A daily snapshot is stored so the Home page can show real day-over-day change.
 *
 * Status: implemented to the public documentation; NOT exercised against a live account from the
 * build environment. Demo mode returns clearly labelled sample data.
 */
import { createHash } from 'node:crypto';
import { PermanentError } from '../automation/types';
import { apiFetch } from './http';

const env = (k: string) => process.env[k]?.trim() || '';

export type IgMedia = {
  id: string;
  caption: string | null;
  timestamp: string;
  likes: number | null;
  comments: number | null;
  permalink: string | null;
  type: string | null;
};
export type IgSnapshot = {
  username: string | null;
  followers: number | null;
  mediaCount: number | null;
  recentMedia: IgMedia[];
};

export const instagramAdapter = {
  requiredEnv: ['INSTAGRAM_ACCESS_TOKEN', 'META_GRAPH_VERSION'],
  requiredConfig: [
    {
      key: 'igUserId',
      label: 'Instagram account ID',
      help: 'The Instagram professional account ID (numeric) linked to your Facebook Page — from Meta Business Suite or the Graph API Explorer (me/accounts → instagram_business_account).',
    },
  ],
  setupSteps: [
    'Make sure the Instagram account is a Professional (Business or Creator) account linked to a Facebook Page.',
    'In your Meta app, add Instagram Graph API permissions instagram_basic and pages_show_list, and generate a long-lived Page access token.',
    'Set INSTAGRAM_ACCESS_TOKEN (and META_GRAPH_VERSION) in the server environment.',
    'Enter the Instagram account ID below, choose Live and press Test connection. Snapshots are taken once a day when Home is opened.',
  ],
  checkConfig(conn: { config: Record<string, string> }) {
    const missing = this.requiredEnv.filter((k) => !env(k));
    if (!conn.config.igUserId) missing.push('igUserId');
    return { ok: missing.length === 0, missing };
  },
  base(conn: { config: Record<string, string> }) {
    const id = conn.config.igUserId ?? '';
    if (!/^\d{5,25}$/.test(id)) throw new PermanentError('Instagram account ID must be numeric.');
    return `https://graph.facebook.com/${env('META_GRAPH_VERSION')}/${id}`;
  },
  async fetchSnapshot(conn: { config: Record<string, string> }): Promise<IgSnapshot> {
    const token = encodeURIComponent(env('INSTAGRAM_ACCESS_TOKEN'));
    const [acct, media] = await Promise.all([
      apiFetch(`${this.base(conn)}?fields=username,followers_count,media_count&access_token=${token}`, {
        timeoutMs: 15_000,
      }) as Promise<{ username?: string; followers_count?: number; media_count?: number }>,
      apiFetch(
        `${this.base(conn)}/media?fields=id,caption,timestamp,like_count,comments_count,permalink,media_type&limit=12&access_token=${token}`,
        { timeoutMs: 15_000 },
      ) as Promise<{
        data?: Array<{
          id: string;
          caption?: string;
          timestamp: string;
          like_count?: number;
          comments_count?: number;
          permalink?: string;
          media_type?: string;
        }>;
      }>,
    ]);
    return {
      username: acct.username ?? null,
      followers: acct.followers_count ?? null,
      mediaCount: acct.media_count ?? null,
      recentMedia: (media.data ?? []).map((m) => ({
        id: m.id,
        caption: m.caption ? m.caption.slice(0, 200) : null,
        timestamp: m.timestamp,
        likes: m.like_count ?? null,
        comments: m.comments_count ?? null,
        permalink: m.permalink ?? null,
        type: m.media_type ?? null,
      })),
    };
  },
  async healthCheck(conn: { config: Record<string, string> }) {
    const s = await this.fetchSnapshot(conn);
    return {
      ok: true,
      message: `Connected to @${s.username ?? 'unknown'} (${s.followers ?? '?'} followers).`,
    };
  },
};

/** Deterministic sample snapshot for Demo mode (always stored with isDemo = true). */
export function demoSnapshot(date: string): IgSnapshot {
  const seed = (k: string) =>
    parseInt(createHash('sha256').update(`${date}:${k}`).digest('hex').slice(0, 6), 16);
  const dayIndex = Math.floor(Date.parse(date) / 86_400_000);
  const followers = 12_400 + (dayIndex % 365) * 9 + (seed('f') % 25);
  const captions = [
    'Campus tour reel — Demo Institute admissions open',
    'Student testimonial: placements 2026',
    'Behind the scenes: brand film shoot',
    'Open day this Saturday — register now',
  ];
  return {
    username: 'demo.institute',
    followers,
    mediaCount: 640 + (dayIndex % 365),
    recentMedia: captions.map((c, i) => ({
      id: `demo-${date}-${i}`,
      caption: `DEMO · ${c}`,
      timestamp: new Date(Date.parse(date) - i * 86_400_000 + 11 * 3_600_000).toISOString(),
      likes: 180 + (seed(`l${i}`) % 900),
      comments: 6 + (seed(`c${i}`) % 60),
      permalink: null,
      type: i % 2 ? 'IMAGE' : 'VIDEO',
    })),
  };
}
