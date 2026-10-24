/**
 * Dictation in a web browser, with the microphone of the device showing the page. The recording
 * goes to the IDE as the same 16 kHz WAV that AudioCaptureManager records, and the IDE transcribes it.
 */
const SAMPLE_RATE = 16_000;

interface Recording {
  ownerId: string;
  chunks: Blob[];
  stream?: MediaStream;
  recorder?: MediaRecorder;
}

let active: Recording | null = null;

function release(recording: Recording) {
  if (recording.recorder?.state === 'recording') recording.recorder.stop();
  recording.stream?.getTracks().forEach((track) => track.stop());
}

function reportError(ownerId: string, error: string) {
  window.__onAudioRecordingState?.({ recording: false, error, ownerId });
}

async function encodeWav(recorded: Blob): Promise<string> {
  // Decoding also resamples the audio to the context's rate.
  const audio = await new OfflineAudioContext(1, 1, SAMPLE_RATE).decodeAudioData(await recorded.arrayBuffer());
  const samples = audio.getChannelData(0);
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (at: number, value: string) => [...value].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true));
  const bytes = new Uint8Array(view.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export const browserMicrophone = {
  async start(ownerId: string) {
    browserMicrophone.cancel();
    if (!navigator.mediaDevices) {
      reportError(ownerId, 'A web browser lets the page use the microphone only through an HTTPS address.');
      return;
    }
    const recording: Recording = { ownerId, chunks: [] };
    active = recording;
    try {
      recording.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Stopped or cancelled while the browser asked for the permission.
      if (active !== recording) return release(recording);
      const recorder = new MediaRecorder(recording.stream);
      recorder.ondataavailable = (e) => recording.chunks.push(e.data);
      recorder.start();
      recording.recorder = recorder;
    } catch (error) {
      release(recording);
      if (active !== recording) return;
      active = null;
      reportError(ownerId, error instanceof Error ? error.message : String(error));
    }
  },

  /** Ends the recording of [ownerId]; resolves with it as base64 WAV, or null when nothing was recorded. */
  async stop(ownerId: string): Promise<string | null> {
    const recording = active;
    if (!recording || recording.ownerId !== ownerId) return null;
    active = null;
    const recorder = recording.recorder;
    if (!recorder) return null;
    // The recorded data arrives before the recorder reports it has stopped. A lost microphone has stopped it already.
    if (recorder.state !== 'inactive') {
      await new Promise((resolve) => {
        recorder.onstop = resolve;
        recorder.stop();
      });
    }
    release(recording);
    return recording.chunks.length ? encodeWav(new Blob(recording.chunks, { type: recorder.mimeType })) : null;
  },

  cancel(ownerId?: string) {
    if (!active || (ownerId && active.ownerId !== ownerId)) return;
    release(active);
    active = null;
  },
};
