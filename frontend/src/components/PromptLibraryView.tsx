import { useEffect, useState } from 'react';
import { Bookmark } from 'lucide-react';
import { ACPBridge } from '../utils/bridge';
import { PromptLibraryItem } from '../types/promptLibrary';
import type { ChatAttachment } from '../types/chat';
import { Button } from './ui/Button';
import { SectionEmptyState, SectionListRow } from './ui/SectionList';
import { SectionPage } from './ui/SectionPage';
import ConfirmationModal from './ConfirmationModal';
import { FormDialog } from './ui/FormDialog';
import { PromptLibraryEditor } from './PromptLibraryEditor';
import { ImageOverlayModal } from './chat/shared/ImageOverlayModal';

interface FormState {
  name: string;
  prompt: string;
  attachments: ChatAttachment[];
}

function emptyForm(): FormState {
  return { name: '', prompt: '', attachments: [] };
}

function truncatePreview(text: string): string {
  return text.length > 100 ? `${text.slice(0, 100).trimEnd()}…` : text;
}

function nextId(): string {
  return `saved-prompt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function formToPrompt(form: FormState, id: string): PromptLibraryItem {
  return {
    id,
    name: form.name.trim(),
    prompt: form.prompt.trim(),
    attachments: form.attachments,
  };
}

function promptToForm(prompt: PromptLibraryItem): FormState {
  return {
    name: prompt.name,
    prompt: prompt.prompt,
    attachments: prompt.attachments ?? [],
  };
}

function hasPromptContent(form: FormState): boolean {
  return Boolean(form.prompt.trim() || form.attachments.length);
}

export function PromptLibraryView() {
  const [prompts, setPrompts] = useState<PromptLibraryItem[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PromptLibraryItem | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

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
    setPreviewImage(null);
  };

  const submitForm = () => {
    if (!form) return;
    if (!form.name.trim() || !hasPromptContent(form)) return;

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
    <div className="flex min-h-0 flex-col bg-background text-foreground text-ide-small">
      <SectionPage onAdd={openAdd}>
        {prompts.length === 0 && (
          <SectionEmptyState icon={Bookmark} title="No saved prompts">
            Saved prompts can be used to quickly prefill chat input.
          </SectionEmptyState>
        )}

        {prompts.map((prompt) => (
          <SectionListRow
            key={prompt.id}
            name={prompt.name}
            description={truncatePreview(prompt.prompt.replace(/\[image-[a-z0-9-]+]/g, '[image]').replace(/\[code-ref-[a-z0-9-]+]/g, '[file]').replace(/\[quote-[a-z0-9-]+]/g, '[quote]')) || prompt.attachments?.[0]?.name}
            onEdit={() => openEdit(prompt)}
            onDelete={() => setDeleteTarget(prompt)}
          />
        ))}
      </SectionPage>

      <FormDialog
        isOpen={form !== null}
        title={editingId ? 'Edit Prompt' : 'New Prompt'}
        onClose={cancelForm}
        footer={(
          <>
            <Button
              onClick={submitForm}
              disabled={!form || !form.name.trim() || !hasPromptContent(form)}
              variant="primary"
            >
              Save
            </Button>
            <Button onClick={cancelForm} variant="secondary">Cancel</Button>
          </>
        )}
      >
        {form ? (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2 section-medium:grid-cols-1 section-medium:gap-1">
              <span className="text-foreground-secondary">Name <span className="text-error" aria-hidden="true">*</span></span>
              <input
                data-autofocus="true"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                required
                aria-required="true"
              />
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-foreground-secondary">Prompt <span className="text-error" aria-hidden="true">*</span></span>
              <PromptLibraryEditor
                value={form.prompt}
                attachments={form.attachments}
                onChange={(value) => setForm((current) => current ? { ...current, prompt: value } : current)}
                onAttachmentsChange={(attachments) => setForm((current) => current ? { ...current, attachments } : current)}
                onImageClick={setPreviewImage}
              />
            </div>
          </div>
        ) : null}
      </FormDialog>

      <ImageOverlayModal src={previewImage} onClose={() => setPreviewImage(null)} />

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
