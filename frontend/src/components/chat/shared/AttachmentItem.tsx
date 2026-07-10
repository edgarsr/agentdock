import { openFile } from '../../../utils/openFile';
import { FileIcon } from './FileIcon';

interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  data?: string;
  path?: string;
}

interface AttachmentItemProps {
  att: Attachment;
  onRemove?: (id: string) => void;
  onImageClick?: (src: string) => void;
}

export function AttachmentItem({ att, onRemove, onImageClick }: AttachmentItemProps) {
  const isImage = att.mimeType.startsWith('image/') && att.data;
  const isClickable = isImage || !!att.path;

  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isImage && onImageClick) {
      onImageClick(`data:${att.mimeType};base64,${att.data}`);
    } else if (att.path) {
      openFile(att.path);
    }
  };

  return (
    <div className={`group relative min-h-[22px] inline-flex min-w-0 max-w-[200px] flex-shrink-0 items-center 
      gap-1.5 rounded-[6px] border border-[var(--ide-Button-startBorderColor)] bg-background px-2 py-1 mb-1 mx-0.5 transition-all 
      focus-within:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]`}
    >
      <button type="button" onClick={onClick}
        className={`flex min-w-0 items-center gap-1.5 overflow-hidden rounded-sm text-left outline-none
          transition-colors focus-visible:text-foreground ${isClickable ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <div className="flex-shrink-0 w-3 h-3 flex items-center justify-center overflow-hidden">
          {isImage ? (
            <img src={`data:${att.mimeType};base64,${att.data}`} className="w-full h-full object-cover rounded-[1px]"/>
          ) : (
            <FileIcon fileName={att.name} filePath={att.path} className='h-3 w-3 flex-shrink-0 object-contain' />
          )}
        </div>

        <span className="text-xs font-medium text-foreground truncate relative top-[1px]">{att.name}</span>
      </button>

      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(att.id);
          }}
          className="ml-0.5 rounded-[4px] p-0.5 text-foreground transition-all hover:bg-background-secondary focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
          title="Remove"
          aria-label={`Remove attachment ${att.name}`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      )}
    </div>
  );
}

