interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  data?: string;
}

interface AttachmentItemProps {
  att: Attachment;
  onRemove?: (id: string) => void;
  onImageClick?: (src: string) => void;
  flushLeft?: boolean;
}

export function AttachmentItem({ att, onRemove, onImageClick, flushLeft = false }: AttachmentItemProps) {
  const isImage = att.mimeType.startsWith('image/') && att.data;

  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isImage && onImageClick) {
      onImageClick(`data:${att.mimeType};base64,${att.data}`);
    }
  };

  return (
    <div
      className={`group relative inline-flex min-w-0 max-w-[200px] flex-shrink-0 items-center gap-1.5
      rounded-[4px] border border-border bg-background px-2 py-1 transition-all
      focus-within:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)] ${flushLeft ? 'ml-0 mr-1' : 'mx-1'}`}
      title={att.name}
    >
      <button
        type="button"
        onClick={onClick}
        className={`flex min-w-0 items-center gap-1.5 overflow-hidden rounded-sm text-left outline-none
          transition-colors focus-visible:text-foreground ${isImage ? 'cursor-pointer' : 'cursor-default'}`}
        aria-label={isImage ? `Open image attachment ${att.name}` : `Attachment ${att.name}`}
      >
        <div className="flex-shrink-0 w-3 h-3 flex items-center justify-center overflow-hidden">
          {isImage ? (
            <img src={`data:${att.mimeType};base64,${att.data}`} alt=""
                 className="w-full h-full object-cover rounded-[1px]"/>
          ) : (
            <FileIcon mimeType={att.mimeType}/>
          )}
        </div>

        <span className="text-xs font-medium text-foreground truncate">{att.name}</span>
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

function FileIcon({mimeType}: { mimeType: string }) {
  if (mimeType.startsWith('audio/')) {
    return <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                className="text-accent">
      <path d="M9 18V5l12-2v13"></path>
      <circle cx="6" cy="18" r="3"></circle>
      <circle cx="18" cy="16" r="3"></circle>
    </svg>;
  }
  if (mimeType.startsWith('video/')) {
    return <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                className="text-accent">
      <polygon points="23 7 16 12 23 17 23 7"></polygon>
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
    </svg>;
  }
  if (mimeType === 'application/pdf') {
    return <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                className="text-error">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <polyline points="14 2 14 8 20 8"></polyline>
      <line x1="16" y1="13" x2="8" y2="13"></line>
      <line x1="16" y1="17" x2="8" y2="17"></line>
      <polyline points="10 9 9 9 8 9"></polyline>
    </svg>;
  }
  return <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              className="text-foreground">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
    <polyline points="14 2 14 8 20 8"></polyline>
  </svg>;
}
