import { AttachmentItem } from '../shared/AttachmentItem';

interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  data?: string;
  path?: string;
  isInline?: boolean;
}

interface AttachmentBarProps {
  attachments: Attachment[];
  onRemove: (id: string) => void;
  onImageClick?: (src: string) => void;
}

export default function AttachmentBar({ attachments, onRemove, onImageClick }: AttachmentBarProps) {
  const visibleAttachments = attachments.filter(a => !a.isInline);
  if (visibleAttachments.length === 0) return null;

  return (
    <div className="flex items-center -mb-2 px-2 pt-2 pb-1 overflow-x-auto max-h-24 no-scrollbar">
      {visibleAttachments.map((att) => (
        <AttachmentItem key={att.id} att={att} onRemove={onRemove} onImageClick={onImageClick}/>
      ))}
    </div>
  );
}
