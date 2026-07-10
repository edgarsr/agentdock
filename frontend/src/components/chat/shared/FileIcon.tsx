import React from 'react';
import { File } from 'lucide-react';
import { ACPBridge } from '../../../utils/bridge';

interface FileIconProps {
  fileName: string;
  filePath?: string;
  icon?: string;
  className?: string;
}

export function FileIcon({
  fileName,
  filePath,
  icon,
  className = 'h-3 w-3 flex-shrink-0 object-contain'
}: FileIconProps) {
  const [resolvedIcon, setResolvedIcon] = React.useState<string | null>(icon ?? null);
  const iconPath = filePath || fileName;

  React.useEffect(() => {
    let isMounted = true;
    const requestIcon = () => {
      setResolvedIcon(null);
      ACPBridge.requestFileIcon(iconPath).then((iconDataUri) => {
        if (isMounted) setResolvedIcon(iconDataUri);
      });
    };

    if (icon) setResolvedIcon(icon);
    else requestIcon();

    const unsubscribe = ACPBridge.onThemeChanged(() => {
      if (!isMounted) return;
      requestIcon();
    });
    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [icon, iconPath]);

  if (resolvedIcon) {
    return (
      <img src={resolvedIcon} alt='' aria-hidden='true' className={className} onError={() => setResolvedIcon(null)} />
    );
  }

  return <File className={`${className} text-foreground`} aria-hidden='true' />;
}
