import { useEffect, useState } from 'react';
import { FileText, Plus, Trash2 } from 'lucide-react';
import { ACPBridge } from '../utils/bridge';
import { SystemInstruction } from '../types/systemInstructions';

interface FormState {
  name: string;
  content: string;
}

const inputClass = 'bg-input border border-border rounded-ide px-2 py-1 text-foreground font-mono focus:outline-none focus:border-primary';
const labelClass = 'flex flex-col gap-1';
const labelTextClass = 'text-foreground/50 font-sans';

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
    <div className="h-full flex flex-col bg-background text-foreground text-ide-small">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2 text-foreground/80">
          <FileText size={14} />
          <span className="font-medium">System Instructions</span>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-1 px-2 py-1 rounded-ide text-foreground/60 hover:text-foreground hover:bg-background-secondary transition-colors"
        >
          <Plus size={14} />
          <span>Add</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {instructions.length === 0 && !form && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-foreground/30">
            <FileText size={28} strokeWidth={1.5} />
            <span>No system instructions configured</span>
          </div>
        )}

        {instructions.map((instruction) => (
          <div
            key={instruction.id}
            onClick={() => openEdit(instruction)}
            className={`flex items-start gap-3 px-4 py-2.5 border-b border-border cursor-pointer hover:bg-background-secondary transition-colors ${editingId === instruction.id ? 'bg-background-secondary' : ''}`}
          >
            <button
              role="switch"
              aria-checked={instruction.enabled}
              onClick={(event) => {
                event.stopPropagation();
                toggle(instruction.id);
              }}
              className={`relative mt-0.5 inline-flex h-4 w-7 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${instruction.enabled ? 'bg-primary' : 'bg-border'}`}
            >
              <span className={`pointer-events-none inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${instruction.enabled ? 'translate-x-3' : 'translate-x-0'}`} />
            </button>

            <div className="flex-1 min-w-0">
              <div className={`truncate ${instruction.enabled ? 'text-foreground' : 'text-foreground/40'}`}>
                {instruction.name}
              </div>
              <div className="mt-1 line-clamp-2 text-xs text-foreground/45 whitespace-pre-wrap break-words">
                {instruction.content}
              </div>
            </div>

            <button
              onClick={(event) => {
                event.stopPropagation();
                remove(instruction.id);
              }}
              className="p-1 rounded text-foreground/30 hover:text-error transition-colors"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}

        {form && (
          <div className="border-b border-border bg-background-secondary px-4 py-3 flex flex-col gap-3">
            <span className="text-foreground/60 font-medium">{editingId ? 'Edit instruction' : 'New instruction'}</span>

            <label className={labelClass}>
              <span className={labelTextClass}>Name</span>
              <input
                autoFocus
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="Name"
                className={inputClass}
              />
            </label>

            <label className={labelClass}>
              <span className={labelTextClass}>Instruction</span>
              <textarea
                value={form.content}
                onChange={(event) => setForm({ ...form, content: event.target.value })}
                placeholder="Instruction"
                rows={8}
                className={`${inputClass} resize-none`}
              />
            </label>

            <div className="flex gap-2">
              <button
                onClick={submitForm}
                disabled={!form.name.trim() || !form.content.trim()}
                className="px-3 py-1 rounded-ide bg-primary text-primary-foreground border border-primary-border hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                Save
              </button>
              <button
                onClick={cancelForm}
                className="px-3 py-1 rounded-ide bg-secondary text-secondary-foreground border border-secondary-border hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
