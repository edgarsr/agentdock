import { LoaderCircle, Mic } from 'lucide-react';
import { Tooltip } from '../chat/shared/Tooltip';
import { useAudioTranscription } from './useAudioTranscription';
import { useAudioInputController } from './useAudioInputController';
import { AUDIO_TRANSCRIPTION_NONE } from './audioTranscription';

interface VoiceInputButtonProps {
  conversationId: string;
  insertText: (text: string) => void;
}

export function VoiceInputButton(props: VoiceInputButtonProps) {
  const { provider, feature } = useAudioTranscription();
  if (provider === AUDIO_TRANSCRIPTION_NONE || feature.id !== provider || !feature.installed) return null;
  return <ActiveVoiceInputButton key={provider} {...props} />;
}

function ActiveVoiceInputButton({ conversationId, insertText }: VoiceInputButtonProps) {
  const { isTranscribing, isRecording, handleVoiceInput: onRecord, handleCancelVoiceInput: onCancel } =
    useAudioInputController({ conversationId, insertTranscript: insertText });

  if (isTranscribing) {
    return (
      <button type="button" onClick={onCancel}
        aria-label="Cancel transcription"
        className="flex items-center h-full px-1.5 rounded appearance-none
          border-0 bg-editor-bg outline-none text-ide-small text-foreground-secondary
          hover:bg-hover hover:text-foreground
          focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
      >
        <Tooltip variant="minimal" content="Cancel transcription">
          <div className="flex items-center">
            <LoaderCircle size={16} className="animate-spin" />
            <span className="invisible w-0" aria-hidden="true">&nbsp;</span>
          </div>
        </Tooltip>
      </button>
    );
  }

  const recordClassName = isRecording
    ? 'bg-[#db5c5c] text-foreground'
    : 'bg-editor-bg text-foreground hover:text-foreground hover:bg-hover focus-visible:bg-hover focus-visible:text-foreground';

  return (
    <button type="button" onClick={onRecord}
      className={`flex items-center h-full px-1.5 rounded appearance-none border-0 outline-none text-ide-small
        focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]
        ${recordClassName}`}
    >
      <Tooltip variant="minimal" content={isRecording ? 'Stop recording' : 'Voice input'}>
        <div className="flex items-center">
          <Mic size={16} className="block translate-y-px" />
          <span className="invisible w-0" aria-hidden="true">&nbsp;</span>
        </div>
      </Tooltip>
    </button>
  );
}
