import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, schema } from '@/db';
import { addContact, getClient, removeContact, updateClient, updateContact } from '@/server/services/clients';
import { makeClient, makeOrg, type TestOrg } from '../helpers/fixtures';

let org: TestOrg;
beforeAll(async () => {
  org = await makeOrg();
});

const client = async (id: string) =>
  (await db.select().from(schema.clients).where(eq(schema.clients.id, id)))[0];

describe('Client budgets', () => {
  it('starts as not set (null, never zero) and saves amounts with their period', async () => {
    const c = await makeClient(org);
    expect(c.marketingBudgetMinor).toBeNull();
    expect(c.brandingBudgetPeriod).toBeNull();

    await updateClient(org.actors.coo, c.id, {
      marketingBudgetMinor: '2,50,000',
      marketingBudgetPeriod: 'monthly',
      brandingBudgetMinor: '1200000.50',
      brandingBudgetPeriod: 'annual',
    });
    const after = await client(c.id);
    expect(after.marketingBudgetMinor).toBe(25_000_000); // ₹2,50,000 in paise
    expect(after.marketingBudgetPeriod).toBe('monthly');
    expect(after.brandingBudgetMinor).toBe(120_000_050);
    expect(after.brandingBudgetPeriod).toBe('annual');
    // Other fields untouched by a budget-only edit.
    expect(after.name).toBe(c.name);
  });

  it('refuses an amount without a period, and clearing the amount clears the period', async () => {
    const c = await makeClient(org);
    await expect(
      updateClient(org.actors.coo, c.id, { marketingBudgetMinor: '5000', marketingBudgetPeriod: '' }),
    ).rejects.toThrow(/monthly or annual/);
    await updateClient(org.actors.coo, c.id, {
      marketingBudgetMinor: '5000',
      marketingBudgetPeriod: 'annual',
    });
    await updateClient(org.actors.coo, c.id, { marketingBudgetMinor: '', marketingBudgetPeriod: 'annual' });
    const after = await client(c.id);
    expect(after.marketingBudgetMinor).toBeNull();
    expect(after.marketingBudgetPeriod).toBeNull();
  });

  it('rejects negative or non-numeric amounts', async () => {
    const c = await makeClient(org);
    await expect(
      updateClient(org.actors.coo, c.id, { brandingBudgetMinor: '-10', brandingBudgetPeriod: 'monthly' }),
    ).rejects.toThrow();
    await expect(
      updateClient(org.actors.coo, c.id, { brandingBudgetMinor: 'lots', brandingBudgetPeriod: 'monthly' }),
    ).rejects.toThrow();
  });
});

describe('Editing contacts', () => {
  it('updates a contact in place, keeps it on the same client and moves the primary flag', async () => {
    const c = await makeClient(org);
    const a = await addContact(org.actors.pm, c.id, { name: 'Asha', isPrimary: 'on' });
    const b = await addContact(org.actors.pm, c.id, { name: 'Ravi', email: 'ravi@example.edu' });

    const u = await updateContact(org.actors.pm, b.id, {
      name: 'Ravi Kumar',
      email: 'ravi.kumar@example.edu',
      designation: 'Principal',
      isPrimary: 'on',
      isApprover: 'on',
    });
    expect(u.id).toBe(b.id);
    expect(u.clientId).toBe(c.id);
    const d = await getClient(org.actors.pm, c.id);
    expect(d.contacts).toHaveLength(2);
    const ravi = d.contacts.find((x) => x.id === b.id)!;
    expect(ravi).toMatchObject({
      name: 'Ravi Kumar',
      designation: 'Principal',
      isPrimary: true,
      isApprover: true,
    });
    expect(d.contacts.find((x) => x.id === a.id)!.isPrimary).toBe(false);

    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, 'client.contact_updated'));
    expect(audits.some((x) => x.entityId === c.id)).toBe(true);
  });

  it('validates input and cannot reach another client’s contacts', async () => {
    const mine = await makeClient(org, undefined, org.users.pm.id);
    const theirs = await makeClient(org, undefined, org.users.ceo.id);
    const ct = await addContact(org.actors.coo, theirs.id, { name: 'Not yours' });
    const own = await addContact(org.actors.pm, mine.id, { name: 'Mine' });

    await expect(updateContact(org.actors.pm, own.id, { name: '' })).rejects.toThrow();
    await expect(updateContact(org.actors.pm, own.id, { name: 'Mine', email: 'nope' })).rejects.toThrow(
      /email/i,
    );
    // The PM is not assigned to the other client, so its contact does not exist for them.
    await expect(updateContact(org.actors.pm, ct.id, { name: 'Hijacked' })).rejects.toThrow(/not found/i);
    await expect(removeContact(org.actors.pm, ct.id)).rejects.toThrow(/not found/i);
    // Without clients.write nobody can edit.
    await expect(updateContact(org.actors.designer, own.id, { name: 'X' })).rejects.toThrow();
    const [still] = await db.select().from(schema.clientContacts).where(eq(schema.clientContacts.id, ct.id));
    expect(still.name).toBe('Not yours');
  });
});
