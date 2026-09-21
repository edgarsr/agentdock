import { useEffect, useState } from 'react';
import { Bot, Pencil, Plus, Trash2 } from 'lucide-react';
import { CustomAcpConfig } from '../types/customAcp';
import { ACPBridge } from '../utils/bridge';
import ConfirmationModal from './ConfirmationModal';
import { Tooltip } from './chat/shared/Tooltip';
import { Button } from './ui/Button';
import { FormDialog } from './ui/FormDialog';
import { SectionTitle } from './ui/SectionTitle';

interface FormState {
  name: string;
  command: string;
  args: string;
  env: string;
  cliCommand: string;
  cliArgs: string;
  cliResumeArg: string;
}

const emptyForm = (): FormState => ({
  name: '', command: '', args: '', env: '', cliCommand: '', cliArgs: '', cliResumeArg: '',
});

function parseLines(value: string): string[] {
  return value.split('\n').map(line => line.trim()).filter(Boolean);
}

function parseEnvironment(value: string) {
  return parseLines(value).flatMap(line => {
    const separator = line.indexOf('=');
    if (separator <= 0) return [];
    return [{ name: line.slice(0, separator).trim(), value: line.slice(separator + 1) }];
  });
}

function configToForm(config: CustomAcpConfig): FormState {
  return {
    name: config.name,
    command: config.command,
    args: config.args.join('\n'),
    env: config.env.map(variable => `${variable.name}=${variable.value}`).join('\n'),
    cliCommand: config.cliCommand ?? '',
    cliArgs: config.cliArgs.join('\n'),
    cliResumeArg: config.cliResumeArgs.find(argument => argument !== '{sessionId}') ?? '',
  };
}

function formToConfig(form: FormState, id: string): CustomAcpConfig {
  const cliResumeArg = form.cliResumeArg.trim();
  return {
    id,
    name: form.name.trim(),
    command: form.command.trim(),
    args: parseLines(form.args),
    env: parseEnvironment(form.env),
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
  const [form, setForm] = useState<FormState | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomAcpConfig | null>(null);

  useEffect(() => {
    const cleanup = ACPBridge.onCustomAcpConfigs(event => {
      setConfigs(Array.isArray(event.detail.configs) ? event.detail.configs : []);
    });
    ACPBridge.loadCustomAcpConfigs();
    return cleanup;
  }, []);

  const save = (next: CustomAcpConfig[]) => {
    setConfigs(next);
    ACPBridge.saveCustomAcpConfigs(next);
  };

  const closeForm = () => {
    setForm(null);
    setEditingId(null);
  };

  const submitForm = () => {
    if (!form?.name.trim() || !form.command.trim()) return;
    if (editingId) {
      save(configs.map(config => config.id === editingId ? formToConfig(form, editingId) : config));
    } else {
      save([...configs, formToConfig(form, nextId())]);
    }
    closeForm();
  };

  return (
    <div className="h-full overflow-hidden bg-background text-foreground text-ide-small">
      <div className="h-full w-full overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-app-content flex-col">
          <SectionTitle actions={(
            <Button
              onClick={() => { setEditingId(null); setForm(emptyForm()); }}
              variant="primary"
              leftIcon={<Plus size={14} />}
              className="max-h-8"
            >
              Add
            </Button>
          )}>
            Custom ACP agents
          </SectionTitle>

          {configs.length === 0 && !form ? (
            <div className="mt-12 flex flex-1 flex-col items-center gap-2 text-foreground-secondary">
              <Bot size={28} strokeWidth={1.5} />
              <span>No custom ACP agents configured</span>
              <p className="max-w-[520px] text-center">
                Add a custom ACP configuration to use it as a service provider. Some plugin features may be unavailable if the ACP adapter does not support the corresponding ACP methods.
              </p>
            </div>
          ) : null}

          {configs.map(config => (
            <div key={config.id} className="flex items-start gap-3 border-b border-border px-4 py-2.5 last:border-b-0">
              <div className="min-w-0 flex-1">
                <div className="truncate">{config.name}</div>
                <div className="mt-1 truncate font-mono text-xs text-foreground-secondary" title={config.command}>
                  {config.command}
                </div>
              </div>
              <div className="mt-1 flex shrink-0 items-center gap-2">
                <Tooltip variant="minimal" content="Edit">
                  <button
                    type="button"
                    onClick={() => { setEditingId(config.id); setForm(configToForm(config)); }}
                    className="rounded p-1 text-foreground-secondary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
                    aria-label={`Edit ${config.name}`}
                  >
                    <Pencil size={13} />
                  </button>
                </Tooltip>
                <Tooltip variant="minimal" content="Delete">
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(config)}
                    className="rounded p-1 text-foreground-secondary transition-colors hover:text-error focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
                    aria-label={`Delete ${config.name}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </Tooltip>
              </div>
            </div>
          ))}
        </div>
      </div>

      <FormDialog
        isOpen={form !== null}
        title={editingId ? 'Edit Custom ACP agent configuration' : 'New Custom ACP agent configuration'}
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
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-[132px_minmax(0,1fr)] items-center gap-2">
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
            <div className="grid grid-cols-[132px_minmax(0,1fr)] items-center gap-2">
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
            <div className="grid grid-cols-[132px_minmax(0,1fr)] items-center gap-2">
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
            <div className="grid grid-cols-[132px_minmax(0,1fr)] items-center gap-2">
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
        title="Delete Custom ACP agent configuration"
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
