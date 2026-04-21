import type { AgentOption, HistorySessionMeta } from '../types/chat';
import ConfirmationModal from './ConfirmationModal';
import { RefreshCw, Funnel, X } from 'lucide-react';
import { Button } from './ui/Button';
import { LoadingSpinner } from './ui/LoadingSpinner';
import { Tooltip } from './chat/shared/Tooltip';
import { HistoryListItem } from './history/HistoryListItem';
import { useHistoryPanelController } from './history/useHistoryPanelController';

interface HistoryPanelProps {
  availableAgents: AgentOption[];
  onOpenSession: (session: HistorySessionMeta) => void;
}

export default function HistoryPanel({ availableAgents, onOpenSession }: HistoryPanelProps) {
  const {
    historyList,
    isLoading,
    selectedConversationIds,
    pendingDeleteIds,
    selectedAgents,
    isFilterOpen,
    editingId,
    editTitle,
    isDeleting,
    deleteErrors,
    filterButtonRef,
    filterOptionRefs,
    adapterDisplay,
    uniqueAgentsInHistory,
    filteredHistoryList,
    selectedAgentLabel,
    selectedCount,
    filteredConversationIds,
    areAllFilteredSelected,
    formatDate,
    formatConversationLength,
    setSelectedAgents,
    setIsFilterOpen,
    setEditTitle,
    setEditingId,
    closeFilter,
    confirmDelete,
    refreshHistory,
    toggleSelectAllFiltered,
    openDeleteConfirmation,
    startEditing,
    submitRename,
    handleEditKeyDown,
    handleFilterButtonKeyDown,
    handleFilterOptionKeyDown,
    toggleSelection,
    cancelDelete,
  } = useHistoryPanelController(availableAgents);

  return (
    <div className="flex flex-col h-full bg-background text-foreground z-10 w-full overflow-hidden relative pb-4">
      <div className="flex items-center justify-between min-h-12 px-3 py-1 border-b border-border shrink-0 relative z-20">
        <div className="flex items-center gap-2">
          <Tooltip variant="minimal" content="Synchronize history">
            <button
              onClick={refreshHistory}
              disabled={isLoading}
              className={`rounded-[4px] p-1 text-foreground-secondary transition-colors hover:text-foreground 
                focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)] focus-visible:outline-none 
                ${isLoading ? 'animate-spin' : ''}`}
              aria-label="Refresh history"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </Tooltip>

          <div className="relative flex items-center gap-1.5">
            <Tooltip variant="minimal" content="Filter by AI agent">
              <button
                type="button"
                ref={filterButtonRef}
                onClick={() => setIsFilterOpen(!isFilterOpen)}
                onKeyDown={handleFilterButtonKeyDown}
                aria-label="Filter by AI agent"
                className={`rounded-[4px] p-1 text-foreground-secondary transition-colors 
                  focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)] focus-visible:outline-none 
                  ${isFilterOpen || selectedAgents.length > 0 ? 'text-foreground' : 'text-foreground-secondary hover:text-foreground'}`}
              >
                <Funnel className="h-4 w-4" />
              </button>
            </Tooltip>

            {selectedAgents.length > 0 ? (
              <div className="flex items-center gap-1 mt-[1px]">
                <span className="max-w-[140px] truncate text-ide-small text-foreground">
                  {selectedAgentLabel}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedAgents([]);
                    closeFilter();
                  }}
                  className="rounded-[4px] mt-[-1px] p-0.5 text-foreground-secondary hover:text-foreground
                    focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)] focus-visible:outline-none"
                >
                  <X size={12} />
                </button>
              </div>
            ) : null}
            
            {isFilterOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => closeFilter()} />
                <div role="listbox"
                  className="absolute top-full left-0 mt-1 z-50 min-w-max overflow-hidden rounded-[7px] border border-border bg-background p-1"
                >
                  {uniqueAgentsInHistory.map((agentId, index) => {
                    const agent = adapterDisplay.get(agentId);
                    const label = agent?.name || agentId;
                    const isSelected = selectedAgents.includes(agentId);
                    return (
                      <button 
                        key={agentId}
                        ref={(element) => {
                          filterOptionRefs.current[index] = element;
                        }}
                        role="option"
                        aria-selected={isSelected}
                        className={`flex w-full items-center rounded-[4px] my-0.5 px-3 py-1 text-left text-ide-small whitespace-nowrap 
                          transition-colors focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)] focus-visible:outline-none 
                          ${isSelected ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent hover:text-accent-foreground'}`}
                        onClick={() => {
                          setSelectedAgents([agentId]);
                          closeFilter();
                        }}
                        onKeyDown={(event) => handleFilterOptionKeyDown(event, agentId, index)}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>
          
          <span className="pl-1 text-foreground-secondary text-ide-small max-[399px]:hidden">
            {filteredHistoryList.length} chat{filteredHistoryList.length !== 1 ? 's' : ''}
          </span>
        </div>
        
        <div className="flex items-center gap-3 shrink-0">
          {selectedCount > 0 && (
            <Button
              onClick={() => openDeleteConfirmation(historyList.filter((item) => selectedConversationIds.includes(item.conversationId)))}
              variant="danger"
              className="max-h-8"
            >
              Delete ({selectedCount})
            </Button>
          )}

          {filteredConversationIds.length > 0 && (
            <button
              type="button"
              onClick={toggleSelectAllFiltered}
              className="text-ide-small text-link hover:underline p-1 rounded-[4px] focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
            >
              {areAllFilteredSelected ? 'Clear all' : 'Select all'}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto w-full space-y-1 mt-1">
        <div className="max-w-[1200px] mx-auto w-full min-h-full flex flex-col">
        {isLoading ? (
          <div className="flex justify-center p-8 text-foreground">Loading history...</div>
        ) : filteredHistoryList.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-foreground">
            No history available yet.
          </div>
        ) : (
          filteredHistoryList.map((item) => {
            const conversationId = item.conversationId;
            return (
              <HistoryListItem
                key={conversationId}
                item={item}
                adapterDisplay={adapterDisplay}
                isSelected={selectedConversationIds.includes(conversationId)}
                conversationLength={formatConversationLength(item.promptCount)}
                deleteError={deleteErrors[conversationId]}
                editingId={editingId}
                editTitle={editTitle}
                formatDate={formatDate}
                onOpenSession={onOpenSession}
                onEditTitleChange={setEditTitle}
                onEditKeyDown={handleEditKeyDown}
                onSubmitRename={submitRename}
                onCancelEdit={() => setEditingId(null)}
                onStartEditing={startEditing}
                onOpenDeleteConfirmation={openDeleteConfirmation}
                onToggleSelection={toggleSelection}
              />
            );
          })
        )}
        </div>
      </div>

      <ConfirmationModal
        isOpen={pendingDeleteIds.length > 0}
        title={pendingDeleteIds.length > 1 ? 'Delete Chats' : 'Delete Chat'}
        message={
          pendingDeleteIds.length > 1
            ? `Do you want to delete these ${pendingDeleteIds.length} chats?`
            : 'Do you want to delete this chat?'
        }
        onConfirm={confirmDelete}
        confirmLabel="Yes"
        cancelLabel="No"
        onCancel={cancelDelete}
      />

      {isDeleting && (
        <div className="absolute inset-0 z-[90] flex items-center justify-center transition-all duration-200">
          <div className="absolute inset-0 bg-black opacity-50" />
          <div className="relative flex flex-col items-center gap-3 bg-[var(--ide-Panel-background)] border border-border p-5 rounded text-foreground">
            <LoadingSpinner className="w-6 h-6 text-foreground-secondary" />
            <span className="text-ide-small font-medium leading-none mt-1">Deleting...</span>
          </div>
        </div>
      )}
    </div>
  );
}
