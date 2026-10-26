import { useEffect, useMemo, useState } from 'react';
import type { HistorySessionMeta, SectionType } from '../../types/chat';
import { ACPBridge } from '../../utils/bridge';
import type { HistoryGroupNavProps } from './HistoryGroupNav';
import { existingGroup, historyGroups } from './historyGroups';

/**
 * The group the history lists, chosen in the section popup's group navigation or the history's filter, and that
 * navigation. The group is kept while the history stays open; the groups' expansion is saved in the global settings.
 */
export function useHistoryGroupNav(
  historyList: HistorySessionMeta[],
  activeSection: SectionType | null,
  openSection: (type: SectionType) => void
): {
  historyGroup: string | null;
  setHistoryGroup: (group: string | null) => void;
  historyGroupNav: HistoryGroupNavProps;
} {
  const [expanded, setExpanded] = useState(
    () => ACPBridge.getGlobalSettingsSnapshot()?.settings?.historyGroupsExpanded ?? false
  );
  /** `''` the ungrouped conversations, `null` all. */
  const [selected, setSelected] = useState<string | null>(null);
  const groups = useMemo(() => historyGroups(historyList), [historyList]);
  const projectPath = historyList[0]?.projectPath ?? '';

  useEffect(() => ACPBridge.onGlobalSettings((e) => {
    setExpanded(e.detail?.payload?.settings?.historyGroupsExpanded ?? false);
  }), []);

  useEffect(() => {
    if (activeSection !== 'history') setSelected(null);
  }, [activeSection]);

  const historyGroup = existingGroup(groups, selected);

  return {
    historyGroup,
    setHistoryGroup: setSelected,
    historyGroupNav: {
      groups,
      selected: historyGroup,
      expanded,
      onToggleExpanded: () => {
        setExpanded(!expanded);
        ACPBridge.saveGlobalSettings({ historyGroupsExpanded: !expanded });
      },
      onSelect: (group) => {
        setSelected(group);
        openSection('history');
      },
      onRename: (group, newName) => {
        ACPBridge.renameHistoryGroup(projectPath, group, newName);
        if (selected === group) setSelected(newName);
      },
      onDelete: (group) => ACPBridge.renameHistoryGroup(projectPath, group, ''),
    },
  };
}
