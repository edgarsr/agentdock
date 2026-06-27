import { useEffect, useRef, useState } from 'react';
import { Network, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { McpServerConfig, McpStatus, McpStatusUpdate, McpTransport } from '../types/mcp';
import { ACPBridge } from '../utils/bridge';
import { Button } from './ui/Button';
import { Checkbox } from './ui/Checkbox';
import { Tooltip } from './chat/shared/Tooltip';
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

function parseLines(raw: string): string[] {
  return raw.split('\n').map(s => s.trim()).filter(Boolean);
}

function parsePairs(raw: string, sep: string): { name: string; value: string }[] {
  return parseLines(raw).flatMap(line => {
    const idx = line.indexOf(sep);
    if (idx < 0) return [];
    return [{ name: line.slice(0, idx).trim(), value: line.slice(idx + sep.length).trim() }];
  });
}

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

interface StatusVisual {
  dotClass: string;
  pulse: boolean;
  defaultLabel: string;
}

// Lookup keyed by the McpStatus type: adding a status forces a new entry (exhaustive),
// so the indicator can never silently fall through to a default.
const STATUS_VISUALS: Record<McpStatus, StatusVisual> = {
  connected: { dotClass: 'bg-success', pulse: false, defaultLabel: 'Running' },
  loading: { dotClass: 'bg-warning', pulse: true, defaultLabel: 'Checking…' },
  error: { dotClass: 'bg-error', pulse: false, defaultLabel: 'Error' },
  disabled: { dotClass: 'bg-foreground-secondary', pulse: false, defaultLabel: 'Disabled' },
  unknown: { dotClass: 'bg-foreground-secondary', pulse: false, defaultLabel: 'Unknown' },
};

function McpStatusDot({ status, message }: { status: McpStatus; message?: string }) {
  const visual = STATUS_VISUALS[status];
  const label = message || visual.defaultLabel;
  return (
    <Tooltip variant="minimal" content={label}>
      <span
        role="img"
        aria-label={label}
        className={`inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full ${visual.dotClass}${visual.pulse ? ' animate-pulse' : ''}`}
      />
    </Tooltip>
  );
}

export function McpServersView() {
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [statusMap, setStatusMap] = useState<Record<string, McpStatusUpdate>>({});
  const statusSignaturesRef = useRef<Record<string, string>>({});
  const latestStatusRunRef = useRef(0);
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
      const runId = update.runId ?? 0;
      if (runId < latestStatusRunRef.current) return;
      latestStatusRunRef.current = runId;
      setStatusMap(prev => ({ ...prev, [update.id]: update }));
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

  const submitForm = () => {
    if (!form || !form.name.trim()) return;
    if (editingId) {
      save(servers.map(s => s.id === editingId ? { ...formToServer(form, editingId), enabled: s.enabled } : s));
    } else {
      save([...servers, formToServer(form, nextId())]);
    }
    setForm(null);
    setEditingId(null);
  };

  return (
    <div className="h-full flex flex-col bg-background text-foreground text-ide-small">
      <div className="flex items-center justify-end gap-2 px-2 min-h-12 border-b border-border flex-shrink-0">
        <Button
          onClick={() => ACPBridge.checkMcpStatus()}
          variant="secondary"
          leftIcon={<RefreshCw size={14} />}
          className="max-h-8"
        >
          Check Status
        </Button>
        <Button
          onClick={openAdd}
          variant="primary"
          leftIcon={<Plus size={14} />}
          className="max-h-8"
        >
          Add
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1200px] mx-auto w-full min-h-full flex flex-col">
        {servers.length === 0 && !form && (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-foreground-secondary p-4">
            <Network size={28} strokeWidth={1.5} />
            <span>No MCP servers configured</span>
            <p className="max-w-[400px] text-center">
              MCP servers provide access to external tools and resources for AI agents
            </p>
          </div>
        )}

        {servers.map(s => {
          const statusUpdate = statusMap[s.id];
          const status: McpStatus = statusUpdate?.status ?? 'unknown';
          const statusMessage = statusUpdate?.message;
          return (
          <div
            key={s.id}
            className="flex items-center gap-3 px-4 py-2.5 border-b border-border"
          >
            <Tooltip variant="minimal" content={s.enabled ? 'Enabled' : 'Disabled'}>
              <Checkbox
                checked={s.enabled}
                onCheckedChange={() => toggle(s.id)}
                onClick={e => { e.stopPropagation(); }}
              />
            </Tooltip>

            <McpStatusDot status={status} message={statusMessage} />

            <div className="flex-1 min-w-0">
              <div className="truncate">
                {s.name}
              </div>
              <div className="mt-1 text-xs text-foreground-secondary truncate">
                {s.transport}
              </div>
              {status === 'error' && statusMessage && (
                <div className="mt-1 text-xs text-error truncate" title={statusMessage}>
                  {statusMessage}
                </div>
              )}
            </div>

            <div className="flex items-center gap-1">
              <Tooltip variant="minimal" content="Edit">
                <button
                  type="button"
                  onClick={() => openEdit(s)}
                  className="rounded p-1 text-foreground-secondary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
                  aria-label={`Edit ${s.name}`}
                >
                  <Pencil size={13} />
                </button>
              </Tooltip>
              <Tooltip variant="minimal" content="Delete">
                <button
                  type="button"
                  onClick={() => setDeleteTarget(s)}
                  className="rounded p-1 text-foreground-secondary transition-colors hover:text-error focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
                  aria-label={`Delete ${s.name}`}
                >
                  <Trash2 size={13} />
                </button>
              </Tooltip>
            </div>
          </div>
          );
        })}

        </div>
      </div>

      <FormDialog
        isOpen={form !== null}
        title={editingId ? 'Edit MCP Server' : 'New MCP Server'}
        onClose={cancelForm}
        footer={(
          <>
            <Button onClick={submitForm} disabled={!form?.name.trim()} variant="primary">Save</Button>
            <Button onClick={cancelForm} variant="secondary">Cancel</Button>
          </>
        )}
      >
        {form ? (
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2">
              <span className="text-foreground-secondary">Name</span>
              <input
                data-autofocus="true"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2">
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
                <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2">
                  <span className="text-foreground-secondary">Command</span>
                  <input
                    value={form.command}
                    onChange={e => setForm({ ...form, command: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-foreground-secondary">Args</span>
                  <textarea
                    value={form.args}
                    onChange={e => setForm({ ...form, args: e.target.value })}
                    placeholder={'-y\n@modelcontextprotocol/server-fetch'}
                    rows={3}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-foreground-secondary">Environment</span>
                  <textarea
                    value={form.env}
                    onChange={e => setForm({ ...form, env: e.target.value })}
                    placeholder="API_KEY=your-key"
                    rows={3}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2">
                  <span className="text-foreground-secondary">URL</span>
                  <input
                    value={form.url}
                    onChange={e => setForm({ ...form, url: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-foreground-secondary">Headers</span>
                  <textarea
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
