import { useEffect, useState } from 'react';
import { FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import { ACPBridge } from '../utils/bridge';
import { SystemInstruction } from '../types/systemInstructions';
import { Button } from './ui/Button';
import { Checkbox } from './ui/Checkbox';
import { Tooltip } from './chat/shared/Tooltip';
import ConfirmationModal from './ConfirmationModal';
import { FormDialog } from './ui/FormDialog';

interface FormState {
  name: string;
  content: string;
}

function emptyForm(): FormState {
  return { name: '', content: '' };
}

function nextId(): string {
  return `system-instruction-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function formToInstruction(form: FormState, id: string, enabled: boolean): SystemInstruction {
  return {
    id,
    name: form.name.trim(),
    content: form.content.trim(),
    enabled,
  };
}

function instructionToForm(instruction: SystemInstruction): FormState {
  return {
    name: instruction.name,
    content: instruction.content,
  };
}

export function SystemInstructionsView() {
  const [instructions, setInstructions] = useState<SystemInstruction[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SystemInstruction | null>(null);

  useEffect(() => {
    const cleanup = ACPBridge.onSystemInstructions((e) => setInstructions(e.detail.instructions));
    ACPBridge.loadSystemInstructions();
    return cleanup;
  }, []);

  const save = (updated: SystemInstruction[]) => {
    setInstructions(updated);
    ACPBridge.saveSystemInstructions(updated);
  };

  const openAdd = () => {
    setForm(emptyForm());
    setEditingId(null);
  };

  const openEdit = (instruction: SystemInstruction) => {
    setForm(instructionToForm(instruction));
    setEditingId(instruction.id);
  };

  const cancelForm = () => {
    setForm(null);
    setEditingId(null);
  };

  const submitForm = () => {
    if (!form) return;
    const name = form.name.trim();
    const content = form.content.trim();
    if (!name || !content) return;

    if (editingId) {
      save(instructions.map((instruction) => (
        instruction.id === editingId
          ? formToInstruction(form, editingId, instruction.enabled)
          : instruction
      )));
    } else {
      save([...instructions, formToInstruction(form, nextId(), true)]);
    }

    cancelForm();
  };

  const toggle = (id: string) => {
    save(instructions.map((instruction) => (
      instruction.id === id
        ? { ...instruction, enabled: !instruction.enabled }
        : instruction
    )));
  };

  const remove = (id: string) => {
    save(instructions.filter((instruction) => instruction.id !== id));
    if (editingId === id) {
      cancelForm();
    }
  };

  return (
    <div className="h-full flex flex-col text-ide-small">
      <div className="flex items-center justify-end px-2 min-h-12 border-b border-border flex-shrink-0">
        <Button
          onClick={openAdd}
          variant="primary"
          leftIcon={<Plus size={14} />}
          className="max-h-8"
        >
          <span>Add</span>
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1200px] mx-auto w-full min-h-full flex flex-col">
        {instructions.length === 0 && !form && (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-foreground-secondary">
            <FileText size={28} strokeWidth={1.5} />
            <span>No system instructions configured</span>
            <p className="max-w-[400px] text-center mt-2">
              Enabled instructions are sent to the AI agent at the start of a conversation as system instructions.
            </p>
          </div>
        )}

        {instructions.map((instruction) => (
          <div
            key={instruction.id}
            className="flex items-center gap-3 px-4 py-2.5 border-b border-border"
          >
            <Tooltip variant="minimal" content={instruction.enabled ? 'Enabled' : 'Disabled'}>
              <Checkbox
                checked={instruction.enabled}
                onCheckedChange={() => toggle(instruction.id)}
                onClick={(event) => {
                  event.stopPropagation();
                }}
                className="mt-0.5"
              />
            </Tooltip>

            <div className="flex-1 min-w-0">
              <div className="truncate">
                {instruction.name}
              </div>
              <div className="mt-1 text-xs text-foreground-secondary truncate">
                {instruction.content}
              </div>
            </div>

            <div className="flex items-center gap-1">
              <Tooltip variant="minimal" content="Edit">
                <button
                  type="button"
                  onClick={() => openEdit(instruction)}
                  className="rounded p-1 text-foreground-secondary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
                  aria-label={`Edit ${instruction.name}`}
                >
                  <Pencil size={13} />
                </button>
              </Tooltip>
              <Tooltip variant="minimal" content="Delete">
                <button
                  type="button"
                  onClick={() => setDeleteTarget(instruction)}
                  className="rounded p-1 text-foreground-secondary transition-colors hover:text-error focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
                  aria-label={`Delete ${instruction.name}`}
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
        title={editingId ? 'Edit Instruction' : 'New Instruction'}
        onClose={cancelForm}
        footer={(
          <>
            <Button
              onClick={submitForm}
              disabled={!form?.name.trim() || !form?.content.trim()}
              variant="primary"
            >
              Save
            </Button>
            <Button onClick={cancelForm} variant="secondary">
              Cancel
            </Button>
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
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                className="w-full rounded-[4px] px-2 py-1"
              />
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-foreground-secondary">Instruction</span>
              <textarea
                value={form.content}
                onChange={(event) => setForm({ ...form, content: event.target.value })}
                rows={8}
                className="w-full min-h-[120px] h-auto resize-none rounded-[4px] px-2 py-1"
              />
            </div>
          </div>
        ) : null}
      </FormDialog>

      <ConfirmationModal
        isOpen={deleteTarget !== null}
        title="Delete Instruction"
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
