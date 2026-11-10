import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { ACPBridge } from '../utils/bridge';
import { SystemInstruction } from '../types/systemInstructions';
import { Button } from './ui/Button';
import { SectionEmptyState, SectionListRow } from './ui/SectionList';
import { SectionPage } from './ui/SectionPage';
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
    <div className="flex min-h-0 flex-col bg-background text-foreground text-ide-small">
      <SectionPage onAdd={openAdd}>
        {instructions.length === 0 && (
          <SectionEmptyState icon={FileText} title="No system instructions configured">
            Enabled instructions are added before your message in the first prompt of each new session.
          </SectionEmptyState>
        )}

        {instructions.map((instruction) => (
          <SectionListRow
            key={instruction.id}
            name={instruction.name}
            description={instruction.content}
            enabled={instruction.enabled}
            onToggle={() => toggle(instruction.id)}
            onEdit={() => openEdit(instruction)}
            onDelete={() => setDeleteTarget(instruction)}
          />
        ))}
      </SectionPage>

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
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2 section-medium:grid-cols-1 section-medium:gap-1">
              <span className="text-foreground-secondary">Name <span className="text-error" aria-hidden="true">*</span></span>
              <input
                name="system-instruction-label"
                data-autofocus="true"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                required
                aria-required="true"
              />
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-foreground-secondary">Instruction <span className="text-error" aria-hidden="true">*</span></span>
              <textarea
                name="system-instruction-content"
                value={form.content}
                onChange={(event) => setForm({ ...form, content: event.target.value })}
                rows={8}
                required
                aria-required="true"
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
