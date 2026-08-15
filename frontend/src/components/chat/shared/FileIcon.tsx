import { useEffect, useState } from 'react';
import { File, FileAudio, FileText, FileVideo } from 'lucide-react';
import { ACPBridge } from '../../../utils/bridge';

interface FileIconProps {
  filePath?: string;
  mimeType?: string;
  className?: string;
}

function FallbackIcon({ mimeType, className }: { mimeType?: string; className: string }) {
  if (mimeType?.startsWith('audio/')) return <FileAudio className={className} />;
  if (mimeType?.startsWith('video/')) return <FileVideo className={className} />;
  if (mimeType === 'application/pdf') return <FileText className={className} />;
  return <File className={className} />;
}

/**
 * Shows the icon the IDE resolves for a file. Falls back to a Lucide icon while the
 * icon is loading, when the path is unknown, or when the IDE has nothing to offer.
 */
export function FileIcon({ filePath, mimeType, className = "h-[14px] w-[14px] flex-shrink-0" }: FileIconProps) {
  const [icon, setIcon] = useState<string | null>(null);

  useEffect(() => {
    if (!filePath) return;
    let active = true;
    const load = () => {
      ACPBridge.requestFileIcon(filePath).then(result => {
        if (active) setIcon(result);
      });
    };
    load();
    const unsubscribe = ACPBridge.onThemeChanged(load);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [filePath]);

  if (!icon) return <FallbackIcon mimeType={mimeType} className={className} />;

  return (
    <img
      src={icon}
      alt=""
      aria-hidden="true"
      className={`${className} object-contain`}
      onError={() => setIcon(null)}
    />
  );
}
