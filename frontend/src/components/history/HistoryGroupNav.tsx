import { useState } from 'react';
import { ChevronRight, EllipsisVertical, Pencil, Trash2 } from 'lucide-react';
import { Tooltip } from '../chat/shared/Tooltip';
import { PopupMenu, popupMenuActions } from '../ui/PopupMenu';
import { TabTitleInput } from '../tabbar/TabTitleInput';
import { RowAction, rowButtonClassName, rowFocusClassName, sidebarRowClassName } from '../tabbar/rows';
import type { NavigationAction } from '../tabbar/NavigationActions';

export interface HistoryGroupNavProps {
  groups: string[];
  /** The listed group; `''` the ungrouped conversations, `null` all. */
  selected: string | null;
  expanded: boolean;
  onToggleExpanded: () => void;
  /** Opens the history listing the group. */
  onSelect: (group: string | null) => void;
  onRename: (group: string, newName: string) => void;
  /** Ungroups the group's conversations. */
  onDelete: (group: string) => void;
}

/** Indents the group rows to the section label. */
const groupRowButtonClassName = `${rowButtonClassName} pl-[calc(0.5rem_+_14px_+_0.5rem)]`;

/**
 * "Chat History" row of the section popup sidebar with the history groups and "Ungrouped" below it, expanded by its
 * chevron as the agents under "New Chat"; each group's row menu renames or deletes it.
 */
export function HistoryGroupNav({
  section,
  active,
  groups,
  selected,
  expanded,
  onToggleExpanded,
  onSelect,
  onRename,
  onDelete,
}: HistoryGroupNavProps & { section: NavigationAction; active: boolean }) {
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null);
  const toggleLabel = expanded ? 'Hide groups' : 'Show groups';
  const rowClassName = (group: string | null) => `group ${sidebarRowClassName(active && selected === group)} mb-0.5 h-8`;

  return (
    <div className="flex flex-col">
      <div className={rowClassName(null)}>
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={`${rowButtonClassName} pr-4`}
          aria-current={active && selected === null ? 'page' : undefined}
        >
          <span className="flex shrink-0">{section.icon}</span>
          <span className="truncate">{section.label}</span>
        </button>
        <Tooltip variant="minimal" placement="bottom" content={toggleLabel} className="flex">
          <button
            type="button"
            onClick={onToggleExpanded}
            className={`flex w-7 shrink-0 items-center justify-center text-foreground-secondary hover:text-foreground
              ${rowFocusClassName}`}
            aria-expanded={expanded}
            aria-label={toggleLabel}
          >
            <ChevronRight
              size={14}
              aria-hidden="true"
              className={`transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
            />
          </button>
        </Tooltip>
      </div>
      <div
        {...(!expanded ? { inert: '' } : {})}
        className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div className="min-h-0 overflow-hidden">
          {groups.map((group) => (
            <div key={group} className={rowClassName(group)}>
              {renamingGroup === group ? (
                <div className="flex min-w-0 flex-1 items-center pl-[calc(0.5rem_+_14px_+_0.5rem)] pr-2">
                  <TabTitleInput
                    initialTitle={group}
                    ariaLabel="Group name"
                    onCommit={(name) => onRename(group, name)}
                    onClose={() => setRenamingGroup(null)}
                    className="-ml-1 rounded-[3px] bg-background px-1 text-foreground"
                  />
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => onSelect(group)}
                    className={groupRowButtonClassName}
                    aria-current={active && selected === group ? 'page' : undefined}
                  >
                    <span className="truncate">{group}</span>
                  </button>
                  <PopupMenu
                    renderTrigger={(trigger) => (
                      <RowAction label={`More actions for ${group}`} tooltip="More actions" menu={false} trigger={trigger}>
                        <EllipsisVertical size={14} aria-hidden="true" />
                      </RowAction>
                    )}
                  >
                    {popupMenuActions([
                      { label: 'Rename', icon: <Pencil size={12} aria-hidden="true" />, onClick: () => setRenamingGroup(group) },
                      { label: 'Delete', icon: <Trash2 size={12} aria-hidden="true" />, onClick: () => onDelete(group) },
                    ], true)}
                  </PopupMenu>
                </>
              )}
            </div>
          ))}
          <div className={rowClassName('')}>
            <button
              type="button"
              onClick={() => onSelect('')}
              className={groupRowButtonClassName}
              aria-current={active && selected === '' ? 'page' : undefined}
            >
              <span className="truncate">Ungrouped</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
