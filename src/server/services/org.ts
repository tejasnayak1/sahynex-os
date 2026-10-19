import { eq } from 'drizzle-orm';
import { schema, type DBOrTx } from '@/db';
import { parseOrgSettings, type OrgSettings } from '@/lib/org-settings';

export async function getOrg(tx: DBOrTx, orgId: string) {
  const [org] = await tx.select().from(schema.organisations).where(eq(schema.organisations.id, orgId));
  if (!org) throw new Error(`Organisation ${orgId} not found`);
  return { ...org, parsedSettings: parseOrgSettings(org.settings) as OrgSettings };
}
