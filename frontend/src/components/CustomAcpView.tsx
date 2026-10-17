import { useEffect, useRef, useState } from 'react';
import { Bot, Loader2, PlugZap } from 'lucide-react';
import { CustomAcpConfig, CustomAcpStatusUpdate } from '../types/customAcp';
import { AgentOption } from '../types/chat';
import { ACPBridge } from '../utils/bridge';
import { parseLines, parsePairs } from '../utils/lines';
import ConfirmationModal from './ConfirmationModal';
import { Button } from './ui/Button';
import { FormDialog } from './ui/FormDialog';
import { SectionEmptyState, SectionListRow, SectionRowButton, StatusLine } from './ui/SectionList';
import { SectionPage } from './ui/SectionPage';

interface FormState {
  name: string;
  command: string;
  args: string;
  env: string;
  commands: string;
  cliCommand: string;
  cliArgs: string;
  cliResumeArg: string;
}

const emptyForm = (): FormState => ({
  name: '', command: '', args: '', env: '', commands: '', cliCommand: '', cliArgs: '', cliResumeArg: '',
});

function configToForm(config: CustomAcpConfig): FormState {
  return {
    name: config.name,
    command: config.command,
    args: config.args.join('\n'),
    env: config.env.map(variable => `${variable.name}=${variable.value}`).join('\n'),
    commands: (config.commands ?? []).map(command =>
      command.description ? `${command.name}=${command.description}` : command.name
    ).join('\n'),
    cliCommand: config.cliCommand ?? '',
    cliArgs: config.cliArgs.join('\n'),
    cliResumeArg: config.cliResumeArgs.find(argument => argument !== '{sessionId}') ?? '',
  };
}

function formToConfig(form: FormState, id: string): CustomAcpConfig {
  const cliResumeArg = form.cliResumeArg.trim();
  return {
    id,
    enabled: true,
    name: form.name.trim(),
    command: form.command.trim(),
    args: parseLines(form.args),
    env: parsePairs(form.env, '='),
    commands: parseLines(form.commands).flatMap((line) => {
      const index = line.indexOf('=');
      const name = (index > 0 ? line.slice(0, index) : line).trim().replace(/^\//, '');
      const description = index > 0 ? line.slice(index + 1).trim() : '';
      return name ? [{ name, description }] : [];
    }),
    cliCommand: form.cliCommand.trim() || undefined,
    cliArgs: parseLines(form.cliArgs),
    cliResumeArgs: cliResumeArg ? [cliResumeArg, '{sessionId}'] : [],
  };
}

function nextId(): string {
  return `custom-acp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function CustomAcpView() {
  const [configs, setConfigs] = useState<CustomAcpConfig[]>([]);
  const configsRef = useRef<CustomAcpConfig[]>([]);
  const [statuses, setStatuses] = useState<Record<string, CustomAcpStatusUpdate>>({});
  const [availableAgents, setAvailableAgents] = useState<AgentOption[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomAcpConfig | null>(null);

  const updateConfigs = (next: CustomAcpConfig[]) => {
    const previous = configsRef.current;
    const unchanged = new Set(next.filter(config =>
      JSON.stringify(previous.find(item => item.id === config.id)) === JSON.stringify(config)
    ).map(config => config.id));
    setStatuses(current => Object.fromEntries(Object.entries(current).filter(([id]) => unchanged.has(id))));
    configsRef.current = next;
    setConfigs(next);
  };

  useEffect(() => {
    const cleanup = ACPBridge.onCustomAcpConfigs(event => {
      updateConfigs(Array.isArray(event.detail.configs) ? event.detail.configs : []);
    });
    const cleanupStatus = ACPBridge.onCustomAcpStatus(event => {
      const update = event.detail.update;
      setStatuses(current => current[update.id]?.requestId === update.requestId
        ? { ...current, [update.id]: update }
        : current);
    });
    const cleanupAdapters = ACPBridge.onAdapters(event => setAvailableAgents(event.detail.adapters));
    ACPBridge.loadCustomAcpConfigs();
    ACPBridge.requestAdapters();
    return () => { cleanup(); cleanupStatus(); cleanupAdapters(); };
  }, []);

  const save = (next: CustomAcpConfig[]) => {
    updateConfigs(next);
    ACPBridge.saveCustomAcpConfigs(next);
  };

  const closeForm = () => {
    setForm(null);
    setEditingId(null);
  };

  const submitForm = () => {
    if (!form?.name.trim() || !form.command.trim()) return;
    if (editingId) {
      save(configs.map(config => config.id === editingId ? { ...formToConfig(form, editingId), enabled: config.enabled } : config));
    } else {
      save([...configs, formToConfig(form, nextId())]);
    }
    closeForm();
  };

  return (
    <div className="flex min-h-0 flex-col bg-background text-foreground text-ide-small">
      <SectionPage onAdd={() => { setEditingId(null); setForm(emptyForm()); }}>
        {configs.length === 0 ? (
          <SectionEmptyState icon={Bot} title="No custom ACP agents configured">
            Add an ACP agent configuration to use the agent in chats and manage it under Agents. Some plugin features may be unavailable if the agent does not support the corresponding ACP methods.
          </SectionEmptyState>
        ) : null}

        {configs.map(config => {
          const test = statuses[config.id];
          const adapter = config.enabled ? availableAgents.find(agent => agent.id === config.id) : undefined;
          const status = test?.status ?? (adapter?.initializing ? 'loading'
            : adapter?.initializationError ? 'error' : adapter?.ready ? 'connected' : undefined);
          return (
            <SectionListRow
              key={config.id}
              name={config.name}
              description={(
                <StatusLine
                  text={config.command}
                  status={status}
                  // Without a test the status is that of the adapter's initialization.
                  label={test ? undefined : status === 'loading' ? 'Initializing…' : status === 'connected' ? 'Ready' : undefined}
                />
              )}
              error={status === 'error' ? (test ? test.message : adapter?.initializationError) : undefined}
              enabled={config.enabled}
              onToggle={() => save(configs.map(item => item.id === config.id ? { ...item, enabled: !item.enabled } : item))}
              actions={(
                <SectionRowButton
                  label={test?.status === 'loading' ? 'Cancel check' : 'Test connection'}
                  aria-label={test?.status === 'loading' ? `Cancel check for ${config.name}` : `Test connection for ${config.name}`}
                  onClick={() => {
                    if (test?.status === 'loading') {
                      setStatuses(current => {
                        const next = { ...current };
                        delete next[config.id];
                        return next;
                      });
                      ACPBridge.cancelCustomAcpConnectionTest(config.id);
                      return;
                    }
                    const requestId = crypto.randomUUID();
                    setStatuses(current => ({ ...current, [config.id]: { id: config.id, requestId, status: 'loading' } }));
                    ACPBridge.testCustomAcpConnection(config.id, requestId);
                  }}
                >
                  {test?.status === 'loading' ? <Loader2 size={13} className="animate-spin" /> : <PlugZap size={13} />}
                </SectionRowButton>
              )}
              onEdit={() => { setEditingId(config.id); setForm(configToForm(config)); }}
              onDelete={() => setDeleteTarget(config)}
            />
          );
        })}
      </SectionPage>

      <FormDialog
        isOpen={form !== null}
        title={editingId ? 'Edit Custom ACP Agent Configuration' : 'New Custom ACP Agent Configuration'}
        onClose={closeForm}
        footer={(
          <>
            <Button onClick={submitForm} disabled={!form?.name.trim() || !form?.command.trim()} variant="primary">
              Save
            </Button>
            <Button onClick={closeForm} variant="secondary">Cancel</Button>
          </>
        )}
      >
        {form ? (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-[132px_minmax(0,1fr)] items-center gap-2 section-medium:grid-cols-1 section-medium:gap-1">
              <span className="text-foreground-secondary">Name <span className="text-error" aria-hidden="true">*</span></span>
              <input
                data-autofocus="true"
                value={form.name}
                onChange={event => setForm({ ...form, name: event.target.value })}
                placeholder="e.g. OpenCode"
                required
                aria-required="true"
              />
            </div>
            <div className="grid grid-cols-[132px_minmax(0,1fr)] items-center gap-2 section-medium:grid-cols-1 section-medium:gap-1">
              <span className="text-foreground-secondary">Executable <span className="text-error" aria-hidden="true">*</span></span>
              <input
                value={form.command}
                onChange={event => setForm({ ...form, command: event.target.value })}
                placeholder="e.g. opencode"
                required
                aria-required="true"
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-foreground-secondary">Arguments</span>
              <textarea
                value={form.args}
                onChange={event => setForm({ ...form, args: event.target.value })}
                placeholder={'One argument per line, e.g.:\nacp'}
                rows={3}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-foreground-secondary">Environment</span>
              <textarea
                value={form.env}
                onChange={event => setForm({ ...form, env: event.target.value })}
                placeholder={'One KEY=value per line, e.g.:\nAPI_KEY=your-key'}
                rows={3}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-foreground-secondary">Commands</span>
              <textarea
                value={form.commands}
                onChange={event => setForm({ ...form, commands: event.target.value })}
                placeholder={'One command per line as name=description, e.g.:\ncompact=Summarize the conversation'}
                rows={3}
              />
            </div>
            <div className="grid grid-cols-[132px_minmax(0,1fr)] items-center gap-2 section-medium:grid-cols-1 section-medium:gap-1">
              <span className="text-foreground-secondary">CLI executable</span>
              <input
                value={form.cliCommand}
                onChange={event => setForm({ ...form, cliCommand: event.target.value })}
                placeholder="e.g. opencode"
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-foreground-secondary">CLI arguments</span>
              <textarea
                value={form.cliArgs}
                onChange={event => setForm({ ...form, cliArgs: event.target.value })}
                placeholder={'One argument per line, e.g.:\n--cli'}
                rows={3}
              />
            </div>
            <div className="grid grid-cols-[132px_minmax(0,1fr)] items-center gap-2 section-medium:grid-cols-1 section-medium:gap-1">
              <span className="text-foreground-secondary">CLI resume argument</span>
              <input
                value={form.cliResumeArg}
                onChange={event => setForm({ ...form, cliResumeArg: event.target.value })}
                placeholder="e.g. --session"
              />
            </div>
          </div>
        ) : null}
      </FormDialog>

      <ConfirmationModal
        isOpen={deleteTarget !== null}
        title="Delete Custom ACP Agent Configuration"
        message={deleteTarget ? `Do you want to delete "${deleteTarget.name}"?` : ''}
        confirmLabel="Yes"
        cancelLabel="No"
        onConfirm={() => {
          if (!deleteTarget) return;
          save(configs.filter(config => config.id !== deleteTarget.id));
          if (editingId === deleteTarget.id) closeForm();
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
