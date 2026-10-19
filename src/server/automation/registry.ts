import type { WorkflowDefinition } from './types';
import { leadNew, leadOverdue, leadQualification } from './workflows/crm';
import { approvalReminders, approvalsWorkflow, taskReminders } from './workflows/delivery';
import { campaignAlerts, campaignRefresh, pageMonitoring } from './workflows/marketing';
import { outboundWebhook } from './workflows/outbound';
import { clientReports, dailyReport, reportDelivery } from './workflows/reporting';
import { projectFromHandover, proposalFollowUp, salesPipeline } from './workflows/sales';

/**
 * Automation inventory. Each definition is seeded into the `automations` table per organisation
 * (enable/disable, owner, schedule and config live there); the handler code lives here.
 */
export const WORKFLOWS: WorkflowDefinition[] = [
  leadNew,
  leadOverdue,
  leadQualification,
  salesPipeline,
  proposalFollowUp,
  projectFromHandover,
  taskReminders,
  approvalsWorkflow,
  approvalReminders,
  campaignRefresh,
  campaignAlerts,
  pageMonitoring,
  dailyReport,
  clientReports,
  reportDelivery,
  outboundWebhook,
];

const byKey = new Map(WORKFLOWS.map((w) => [w.key, w]));
export const getWorkflow = (key: string) => byKey.get(key);
