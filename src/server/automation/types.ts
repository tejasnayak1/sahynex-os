import type { DB } from '@/db';
import type { schema } from '@/db';
import type { OrgSettings } from '@/lib/org-settings';
import type { SystemActor } from '../actor';

export type AutomationRow = typeof schema.automations.$inferSelect;
export type ExecutionRow = typeof schema.automationExecutions.$inferSelect;

export type WorkflowContext = {
  orgId: string;
  timezone: string;
  automation: AutomationRow;
  execution: ExecutionRow;
  /** Merged default + stored configuration. */
  config: Record<string, unknown>;
  settings: OrgSettings;
  payload: Record<string, unknown>;
  actor: SystemActor;
  db: DB;
  now: Date;
  log: (message: string, data?: unknown, level?: 'info' | 'warn' | 'error') => void;
};

export type WorkflowResult = {
  /** 'skipped' = ran correctly but there was nothing to do / a precondition was not met. */
  status: 'succeeded' | 'skipped';
  summary: string;
  data?: Record<string, unknown>;
};

export type WorkflowDefinition = {
  key: string;
  name: string;
  description: string;
  trigger: { type: 'event'; events: string[] } | { type: 'schedule'; cron: string };
  conditions: string[];
  actions: string[];
  defaultConfig: Record<string, unknown>;
  /** Human-editable config fields shown in the Automation Centre. */
  configFields?: Array<{ key: string; label: string; type: 'number' | 'text' | 'boolean'; help?: string }>;
  requiresIntegration?: string;
  maxAttempts?: number;
  timeoutSeconds?: number;
  handler: (ctx: WorkflowContext) => Promise<WorkflowResult>;
};

/** Throw for failures that are worth retrying (network, rate limits, upstream 5xx). */
export class TransientError extends Error {
  constructor(
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'TransientError';
  }
}

/** Throw for failures that will not succeed on retry (bad config, invalid data). Goes straight to dead-letter. */
export class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentError';
  }
}
