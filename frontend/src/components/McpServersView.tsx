import { useEffect, useRef, useState } from 'react';
import { Loader2, Network, PlugZap } from 'lucide-react';
import { McpServerConfig, McpStatusUpdate, McpTransport } from '../types/mcp';
import { ACPBridge } from '../utils/bridge';
import { parseLines, parsePairs } from '../utils/lines';
import { Button } from './ui/Button';
import { SectionEmptyState, SectionListRow, SectionRowButton, StatusLine } from './ui/SectionList';
import { SectionPage } from './ui/SectionPage';
import ConfirmationModal from './ConfirmationModal';
import { DropdownSelect } from './ui/DropdownSelect';
import { FormDialog } from './ui/FormDialog';

interface FormState {
  name: string;
  transport: McpTransport;
  command: string;
  args: string;
  env: string;
  url: string;
  headers: string;
}

const emptyForm = (): FormState => ({
  name: '', transport: 'http', command: '', args: '', env: '', url: '', headers: '',
});

function serverToForm(s: McpServerConfig): FormState {
  return {
    name: s.name, transport: s.transport,
    command: s.command ?? '',
    args: (s.args ?? []).join('\n'),
    env: (s.env ?? []).map(e => `${e.name}=${e.value}`).join('\n'),
    url: s.url ?? '',
    headers: (s.headers ?? []).map(h => `${h.name}: ${h.value}`).join('\n'),
  };
}

function formToServer(form: FormState, id: string): McpServerConfig {
  const base = { id, name: form.name.trim(), enabled: true, transport: form.transport };
  if (form.transport === 'stdio') {
    return { ...base, command: form.command.trim(), args: parseLines(form.args), env: parsePairs(form.env, '=') };
  }
  return { ...base, url: form.url.trim(), headers: parsePairs(form.headers, ':') };
}

function nextId(): string {
  return `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function statusSignature(s: McpServerConfig): string {
  return JSON.stringify({
    enabled: s.enabled,
    transport: s.transport,
    command: s.command ?? '',
    args: s.args ?? [],
    env: s.env ?? [],
    url: s.url ?? '',
    headers: s.headers ?? [],
  });
}

function buildStatusSignatures(servers: McpServerConfig[]): Record<string, string> {
  return Object.fromEntries(servers.map(s => [s.id, statusSignature(s)]));
}

function retainStatuses(
  previous: Record<string, McpStatusUpdate>,
  previousSignatures: Record<string, string>,
  nextSignatures: Record<string, string>
): Record<string, McpStatusUpdate> {
  return Object.fromEntries(
    Object.entries(previous).filter(([id]) => previousSignatures[id] === nextSignatures[id])
  );
}

export function McpServersView() {
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [statusMap, setStatusMap] = useState<Record<string, McpStatusUpdate>>({});
  const statusSignaturesRef = useRef<Record<string, string>>({});
  const [form, setForm] = useState<FormState | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<McpServerConfig | null>(null);

  useEffect(() => {
    const cleanupServers = ACPBridge.onMcpServers(e => {
      const nextServers = e.detail.servers;
      const nextSignatures = buildStatusSignatures(nextServers);
      setStatusMap(prev => retainStatuses(prev, statusSignaturesRef.current, nextSignatures));
      statusSignaturesRef.current = nextSignatures;
      setServers(nextServers);
    });
    const cleanupStatus = ACPBridge.onMcpStatus(e => {
      const update = e.detail.update;
      setStatusMap(prev => {
        const current = prev[update.id];
        const runId = update.runId ?? 0;
        const currentRunId = current?.runId ?? 0;
        // A run's result is accepted only while that run is still loading (not finished or cancelled).
        if (current && (runId < currentRunId || (runId === currentRunId && current.status !== 'loading'))) return prev;
        return { ...prev, [update.id]: update };
      });
    });
    ACPBridge.loadMcpServers();
    return () => { cleanupServers(); cleanupStatus(); };
  }, []);

  const save = (updated: McpServerConfig[]) => {
    const nextSignatures = buildStatusSignatures(updated);
    setStatusMap(prev => retainStatuses(prev, statusSignaturesRef.current, nextSignatures));
    statusSignaturesRef.current = nextSignatures;
    setServers(updated);
    ACPBridge.saveMcpServers(updated);
  };

  const toggle = (id: string) =>
    save(servers.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s));

  const remove = (id: string) => {
    save(servers.filter(s => s.id !== id));
    if (editingId === id) { setForm(null); setEditingId(null); }
  };

  const openAdd = () => { setForm(emptyForm()); setEditingId(null); };

  const openEdit = (s: McpServerConfig) => { setForm(serverToForm(s)); setEditingId(s.id); };

  const cancelForm = () => { setForm(null); setEditingId(null); };

  const canSubmit = form !== null
    && form.name.trim().length > 0
    && (form.transport === 'stdio' ? form.command.trim().length > 0 : form.url.trim().length > 0);

  const submitForm = () => {
    if (!form || !canSubmit) return;
    if (editingId) {
      save(servers.map(s => s.id === editingId ? { ...formToServer(form, editingId), enabled: s.enabled } : s));
    } else {
      save([...servers, formToServer(form, nextId())]);
    }
    setForm(null);
    setEditingId(null);
  };

  return (
    <div className="flex min-h-0 flex-col bg-background text-foreground text-ide-small">
      <SectionPage onAdd={openAdd}>
        {servers.length === 0 && (
          <SectionEmptyState icon={Network} title="No MCP servers configured">
            MCP servers provide access to external tools and resources for AI agents.
          </SectionEmptyState>
        )}

        {servers.map(s => {
          const statusUpdate = statusMap[s.id];
          const status = statusUpdate?.status ?? 'unknown';
          return (
            <SectionListRow
              key={s.id}
              name={s.name}
              description={(
                <StatusLine text={s.transport.toUpperCase()} status={status === 'unknown' ? undefined : status} />
              )}
              error={status === 'error' ? statusUpdate?.message : undefined}
              enabled={s.enabled}
              onToggle={() => toggle(s.id)}
              actions={(
                <SectionRowButton
                  label={status === 'loading' ? 'Cancel check' : 'Test connection'}
                  aria-label={status === 'loading' ? `Cancel check for ${s.name}` : `Test connection for ${s.name}`}
                  onClick={() => {
                    if (status !== 'loading') {
                      ACPBridge.checkMcpStatus(s.id);
                      return;
                    }
                    setStatusMap(prev => ({ ...prev, [s.id]: { ...prev[s.id], status: 'unknown', message: undefined } }));
                    ACPBridge.cancelMcpStatus(s.id);
                  }}
                >
                  {status === 'loading' ? <Loader2 size={13} className="animate-spin" /> : <PlugZap size={13} />}
                </SectionRowButton>
              )}
              onEdit={() => openEdit(s)}
              onDelete={() => setDeleteTarget(s)}
            />
          );
        })}
      </SectionPage>

      <FormDialog
        isOpen={form !== null}
        title={editingId ? 'Edit MCP Server' : 'New MCP Server'}
        onClose={cancelForm}
        footer={(
          <>
            <Button onClick={submitForm} disabled={!canSubmit} variant="primary">Save</Button>
            <Button onClick={cancelForm} variant="secondary">Cancel</Button>
          </>
        )}
      >
        {form ? (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2 section-medium:grid-cols-1 section-medium:gap-1">
              <span className="text-foreground-secondary">Name <span className="text-error" aria-hidden="true">*</span></span>
              <input
                name="mcp-server-label"
                data-autofocus="true"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                required
                aria-required="true"
              />
            </div>

            <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2 section-medium:grid-cols-1 section-medium:gap-1">
              <span className="text-foreground-secondary">Transport</span>
              <DropdownSelect
                value={form.transport}
                options={[
                  { value: 'http', label: 'http' },
                  { value: 'sse', label: 'sse' },
                  { value: 'stdio', label: 'stdio' },
                ]}
                onChange={(transport) => setForm({ ...form, transport: transport as McpTransport })}
                className="w-full min-w-0"
                buttonClassName="w-full"
              />
            </div>

            {form.transport === 'stdio' ? (
              <>
                <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2 section-medium:grid-cols-1 section-medium:gap-1">
                  <span className="text-foreground-secondary">Command <span className="text-error" aria-hidden="true">*</span></span>
                  <input
                    name="mcp-server-command"
                    value={form.command}
                    onChange={e => setForm({ ...form, command: e.target.value })}
                    required
                    aria-required="true"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-foreground-secondary">Args</span>
                  <textarea
                    name="mcp-server-args"
                    value={form.args}
                    onChange={e => setForm({ ...form, args: e.target.value })}
                    placeholder={'-y\n@modelcontextprotocol/server-fetch'}
                    rows={3}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-foreground-secondary">Environment</span>
                  <textarea
                    name="mcp-server-env"
                    value={form.env}
                    onChange={e => setForm({ ...form, env: e.target.value })}
                    placeholder="API_KEY=your-key"
                    rows={3}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2 section-medium:grid-cols-1 section-medium:gap-1">
                  <span className="text-foreground-secondary">URL <span className="text-error" aria-hidden="true">*</span></span>
                  <input
                    name="mcp-server-url"
                    value={form.url}
                    onChange={e => setForm({ ...form, url: e.target.value })}
                    required
                    aria-required="true"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-foreground-secondary">Headers</span>
                  <textarea
                    name="mcp-server-headers"
                    value={form.headers}
                    onChange={e => setForm({ ...form, headers: e.target.value })}
                    placeholder="Authorization: Bearer token"
                    rows={3}
                  />
                </div>
              </>
            )}
          </div>
        ) : null}
      </FormDialog>

      <ConfirmationModal
        isOpen={deleteTarget !== null}
        title="Delete MCP configuration"
        message={deleteTarget ? `Do you want to delete "${deleteTarget.name}"?` : ''}
        confirmLabel="Yes"
        cancelLabel="No"
        onConfirm={() => {
          if (!deleteTarget) return;
          remove(deleteTarget.id);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
