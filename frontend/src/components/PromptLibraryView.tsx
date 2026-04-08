import { useEffect, useState } from 'react';
import { Bookmark, Pencil, Plus, Trash2 } from 'lucide-react';
import { ACPBridge } from '../utils/bridge';
import { PromptLibraryItem } from '../types/promptLibrary';
import { Button } from './ui/Button';
import { Tooltip } from './chat/shared/Tooltip';
import ConfirmationModal from './ConfirmationModal';
import { FormDialog } from './ui/FormDialog';

interface FormState {
  name: string;
  prompt: string;
}

function emptyForm(): FormState {
  return { name: '', prompt: '' };
}

function nextId(): string {
  return `saved-prompt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function formToPrompt(form: FormState, id: string): PromptLibraryItem {
  return {
    id,
    name: form.name.trim(),
    prompt: form.prompt.trim(),
  };
}

function promptToForm(prompt: PromptLibraryItem): FormState {
  return {
    name: prompt.name,
    prompt: prompt.prompt,
  };
}

export function PromptLibraryView() {
  const [prompts, setPrompts] = useState<PromptLibraryItem[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PromptLibraryItem | null>(null);

  useEffect(() => {
    const cleanup = ACPBridge.onPromptLibrary((e) => setPrompts(e.detail.items));
    ACPBridge.loadPromptLibrary();
    return cleanup;
  }, []);

  const save = (updated: PromptLibraryItem[]) => {
    setPrompts(updated);
    ACPBridge.savePromptLibrary(updated);
  };

  const openAdd = () => {
    setForm(emptyForm());
    setEditingId(null);
  };

  const openEdit = (prompt: PromptLibraryItem) => {
    setForm(promptToForm(prompt));
    setEditingId(prompt.id);
  };

  const cancelForm = () => {
    setForm(null);
    setEditingId(null);
  };

  const submitForm = () => {
    if (!form) return;
    if (!form.name.trim() || !form.prompt.trim()) return;

    if (editingId) {
      save(prompts.map((prompt) => (
        prompt.id === editingId
          ? formToPrompt(form, editingId)
          : prompt
      )));
    } else {
      save([...prompts, formToPrompt(form, nextId())]);
    }

    cancelForm();
  };

  const remove = (id: string) => {
    save(prompts.filter((prompt) => prompt.id !== id));
    if (editingId === id) {
      cancelForm();
    }
  };

  return (
    <div className="h-full flex flex-col bg-background text-foreground text-ide-small">
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
        {prompts.length === 0 && !form && (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-foreground-secondary">
            <Bookmark size={28} strokeWidth={1.5} />
            <span>Prompt library is empty</span>
            <p className="max-w-[400px] text-center mt-2">
              Saved prompts can be used to quickly prefill chat input.
            </p>
          </div>
        )}

        {prompts.map((prompt) => (
          <div
            key={prompt.id}
            className="flex items-start gap-3 px-4 py-2.5 border-b border-border"
          >

            <div className="flex-1 min-w-0">
              <div className="truncate text-foreground">{prompt.name}</div>
              <div className="mt-1 text-xs text-foreground-secondary truncate">
                {prompt.prompt}
              </div>
            </div>

            <div className="flex items-center gap-1">
              <Tooltip variant="minimal" content="Edit">
                <button
                  type="button"
                  onClick={() => openEdit(prompt)}
                  className="rounded p-1 text-foreground-secondary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
                  aria-label={`Edit ${prompt.name}`}
                >
                  <Pencil size={13} />
                </button>
              </Tooltip>
              <Tooltip variant="minimal" content="Delete">
                <button
                  type="button"
                  onClick={() => setDeleteTarget(prompt)}
                  className="rounded p-1 text-foreground-secondary transition-colors hover:text-error focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
                  aria-label={`Delete ${prompt.name}`}
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
        title={editingId ? 'Edit Prompt' : 'New Prompt'}
        onClose={cancelForm}
        footer={(
          <>
            <Button
              onClick={submitForm}
              disabled={!form?.name.trim() || !form?.prompt.trim()}
              variant="primary"
            >
              Save
            </Button>
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
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                className="w-full rounded-[4px] px-2 py-1"
              />
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-foreground-secondary">Prompt</span>
              <textarea
                value={form.prompt}
                onChange={(event) => setForm({ ...form, prompt: event.target.value })}
                rows={8}
                className="w-full min-h-[120px] h-auto resize-none rounded-[4px] px-2 py-1"
              />
            </div>
          </div>
        ) : null}
      </FormDialog>

      <ConfirmationModal
        isOpen={deleteTarget !== null}
        title="Delete Prompt"
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
