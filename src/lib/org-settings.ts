import { z } from 'zod';

/**
 * Configurable business rules. Stored in organisations.settings (JSON) and editable in
 * Settings → Organisation. Defaults are deliberately conservative; nothing client-specific is hard-coded.
 */
export const orgSettingsSchema = z.object({
  leads: z
    .object({
      assignment: z.enum(['round_robin', 'manual']).default('round_robin'),
      firstContactSlaHours: z.number().min(1).max(168).default(4),
      escalationAfterHours: z.number().min(1).max(336).default(24),
      followUpTaskDueHours: z.number().min(1).max(168).default(4),
      qualifyThreshold: z.number().min(0).max(100).default(60),
      /** Weights applied to boolean qualification answers. Sum is capped at 100. */
      scoreWeights: z.record(z.string(), z.number()).default({
        budget_confirmed: 25,
        decision_maker: 20,
        clear_need: 25,
        timeline_within_90_days: 20,
        reachable: 10,
      }),
    })
    .prefault({}),
  sales: z
    .object({
      staleDealDays: z.number().min(1).max(120).default(14),
      proposalFollowUpDays: z.array(z.number().min(1).max(60)).default([3, 7]),
      proposalEscalateDays: z.number().min(1).max(120).default(14),
      discountApprovalAbovePct: z.number().min(0).max(100).default(10),
      stageProbability: z.record(z.string(), z.number().min(0).max(100)).default({
        new_prospect: 10,
        qualified: 20,
        discovery_completed: 35,
        proposal_preparation: 45,
        proposal_sent: 60,
        negotiation: 75,
        won: 100,
        lost: 0,
      }),
    })
    .prefault({}),
  delivery: z
    .object({
      taskReminderHoursBefore: z.number().min(1).max(168).default(24),
      overdueEscalationHours: z.number().min(1).max(336).default(24),
      approvalReminderHours: z.number().min(1).max(336).default(48),
      maxApprovalReminders: z.number().min(0).max(10).default(3),
    })
    .prefault({}),
  campaigns: z
    .object({
      evaluationDays: z.number().min(1).max(90).default(7),
      staleAfterHours: z.number().min(1).max(240).default(36),
    })
    .prefault({}),
  reports: z
    .object({
      digestRecipientRoles: z.array(z.string()).default(['ceo', 'coo']),
    })
    .prefault({}),
});

export type OrgSettings = z.infer<typeof orgSettingsSchema>;

export function parseOrgSettings(raw: unknown): OrgSettings {
  const parsed = orgSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : orgSettingsSchema.parse({});
}
