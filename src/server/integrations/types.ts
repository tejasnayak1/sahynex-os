import type { schema } from '@/db';

export type Connection = typeof schema.integrationConnections.$inferSelect;
export type Provider = Connection['provider'];

/** One day of platform-native metrics for one campaign, normalised to minor currency units. */
export type NormalizedDailyMetric = {
  externalCampaignId: string;
  campaignName: string;
  date: string; // YYYY-MM-DD in the ad account's timezone
  spendMinor: number;
  impressions: number;
  reach: number | null;
  clicks: number;
  platformLeads: number | null;
  landingPageViews: number | null;
};

export type ConfigCheck = { ok: boolean; missing: string[] };
export type HealthResult = { ok: boolean; message: string };

export interface AdsAdapter {
  provider: Provider;
  label: string;
  /** Secrets this adapter reads from the environment (never stored in the database). */
  requiredEnv: string[];
  /** Non-secret configuration stored on the connection (account IDs, etc.). */
  requiredConfig: Array<{ key: string; label: string; help: string }>;
  setupSteps: string[];
  checkConfig(conn: Connection): ConfigCheck;
  healthCheck(conn: Connection): Promise<HealthResult>;
  fetchDailyMetrics(conn: Connection, from: string, to: string): Promise<NormalizedDailyMetric[]>;
}
