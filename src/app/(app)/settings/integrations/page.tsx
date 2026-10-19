import { ActionButton } from '@/components/client/auto-submit';
import { Badge, Panel, StatusBadge, Table, Td, Th } from '@/components/ui';
import { formatDateTime, relativeTime } from '@/lib/format';
import { requirePagePermission } from '@/server/auth/current';
import { listApiKeys, listIntegrations } from '@/server/services/admin';
import { clientOptions } from '@/server/services/clients';
import { revokeApiKeyAction } from '../actions';
import { IntegrationConfig, NewApiKey } from './forms';

export const metadata = { title: 'Integrations' };

export default async function IntegrationsPage() {
  const actor = await requirePagePermission('settings.integrations');
  const [items, keys, clients] = await Promise.all([
    listIntegrations(actor),
    listApiKeys(actor),
    clientOptions(actor),
  ]);
  return (
    <div className="space-y-5">
      <p className="max-w-[80ch] text-muted">
        Secrets (tokens, client secrets, SMTP passwords) are read from the server environment or your secret
        manager — never stored here or sent to the browser. A connection only shows “Healthy” after a
        successful test or sync.
      </p>
      {items.map((i) => {
        const c = i.connection;
        return (
          <Panel
            key={i.provider}
            title={i.label}
            actions={
              <span className="flex items-center gap-2">
                {c?.mode === 'demo' ? <Badge tone="demo">Demo mode</Badge> : null}
                {c?.mode === 'live' ? <Badge tone="ok">Live</Badge> : null}
                <StatusBadge status={!c || c.mode === 'disconnected' ? 'disconnected' : c.status} />
              </span>
            }
          >
            <p className="mb-3 text-ink-2">{i.description}</p>
            {c?.lastError ? (
              <p className="mb-3 rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-[13px]">
                {c.lastError}
              </p>
            ) : null}
            {c?.lastSuccessSyncAt || c?.lastHealthCheckAt ? (
              <p className="mb-3 text-[12.5px] text-muted">
                Last successful sync {c.lastSuccessSyncAt ? formatDateTime(c.lastSuccessSyncAt) : 'never'} ·
                last checked {c.lastHealthCheckAt ? relativeTime(c.lastHealthCheckAt) : 'never'}
              </p>
            ) : null}
            {i.missing.length ? (
              <p className="mb-3 text-[13px] text-warn">Missing for Live: {i.missing.join(', ')}</p>
            ) : null}
            {i.setupSteps.length ? (
              <details className="mb-3">
                <summary className="cursor-pointer text-[13px] font-medium text-accent">Setup steps</summary>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] text-ink-2">
                  {i.setupSteps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
              </details>
            ) : null}
            {i.provider !== 'website_forms' ? (
              <IntegrationConfig
                provider={i.provider}
                mode={c?.mode ?? 'disconnected'}
                config={c?.config ?? {}}
                supportsDemo={i.supportsDemo}
                fields={i.requiredConfig}
              />
            ) : null}
          </Panel>
        );
      })}
      <Panel title="API keys (website forms, landing pages, n8n / Make)">
        <NewApiKey clients={clients} />
        {keys.length ? (
          <Table className="mt-4">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Prefix</Th>
                <Th>Attributes leads to</Th>
                <Th>Last used</Th>
                <Th>Status</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <Td>{k.name}</Td>
                  <Td>
                    <code>{k.prefix}…</code>
                  </Td>
                  <Td>{k.clientName ?? 'Sahynex'}</Td>
                  <Td>{k.lastUsedAt ? relativeTime(k.lastUsedAt) : 'Never'}</Td>
                  <Td>{k.revokedAt ? <Badge>Revoked</Badge> : <Badge tone="ok">Active</Badge>}</Td>
                  <Td>
                    {!k.revokedAt ? (
                      <ActionButton
                        action={revokeApiKeyAction}
                        hidden={{ id: k.id }}
                        variant="ghost"
                        confirm={`Revoke “${k.name}”? Forms using it will stop sending leads immediately.`}
                      >
                        Revoke
                      </ActionButton>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : null}
      </Panel>
    </div>
  );
}
