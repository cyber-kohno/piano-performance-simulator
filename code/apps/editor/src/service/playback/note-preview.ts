import type { PlaybackInstrumentPort } from './playback-instrument.ts';

const PREVIEW_VELOCITY = 88;
const PREVIEW_DURATION_MS = 500;

namespace NotePreview {
  export type Value = PlaybackInstrumentPort & {
    pitchChange(pitches: readonly number[]): void;
    dispose(): void;
  };

  export function create(instrument: PlaybackInstrumentPort): Value {
    return {
      startSequence: (sequence, callbacks) => instrument.startSequence(sequence, callbacks),
      play: (pitches, velocity, durationMs) => instrument.play(pitches, velocity, durationMs),
      setSustainPedal: down => instrument.setSustainPedal(down),
      stop: () => instrument.stop(),
      pitchChange(pitches) {
        instrument.stop();
        if (pitches.length > 0) instrument.play(pitches, PREVIEW_VELOCITY, PREVIEW_DURATION_MS);
      },
      dispose() {
        instrument.dispose();
      },
    };
  }
}
export default NotePreview;
