import { WorkletSynthesizer } from 'spessasynth_lib';
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';
import type { PlaybackInstrumentPort } from '../../service/playback/playback-instrument.ts';

const SOUND_FONT_URL = '/assets/soundfonts/clavierdesk-grand-piano.sf2';
const SOUND_FONT_ID = 'clavierdesk-grand-piano';

namespace SpessaSynthInstrument {
  function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }

  export async function loadPiano(): Promise<PlaybackInstrumentPort> {
    const response = await fetch(new URL(SOUND_FONT_URL, window.location.href));
    if (!response.ok) throw new Error(`SoundFont request failed (${response.status}).`);

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength < 12 || new TextDecoder().decode(bytes.subarray(8, 12)) !== 'sfbk') {
      throw new Error('The piano SoundFont is not a valid SF2 file.');
    }

    const context = new AudioContext();
    try {
      await context.audioWorklet.addModule(processorUrl);
      const synth = new WorkletSynthesizer(context);
      synth.connect(context.destination);
      await synth.soundBankManager.addSoundBank(toArrayBuffer(bytes), SOUND_FONT_ID);
      await synth.isReady;
      synth.programChange(0, 0);

      let generation = 0;
      const noteOffTimers = new Set<number>();
      const activePitchCounts = new Map<number, number>();
      const stop = () => {
        generation++;
        for (const timer of noteOffTimers) window.clearTimeout(timer);
        noteOffTimers.clear();
        activePitchCounts.clear();
        synth.controllerChange(0, 64 as Parameters<typeof synth.controllerChange>[1], 0);
        synth.stopAll(true);
      };
      return {
        play(pitches, velocity, durationMs) {
          const currentGeneration = generation;
          void context.resume().then(() => {
            if (currentGeneration !== generation) return;
            for (const midi of pitches) {
              activePitchCounts.set(midi, (activePitchCounts.get(midi) ?? 0) + 1);
              synth.noteOn(0, midi, velocity);
            }
            const timer = window.setTimeout(() => {
              if (currentGeneration !== generation) return;
              for (const midi of pitches) {
                const count = activePitchCounts.get(midi) ?? 0;
                if (count <= 1) {
                  activePitchCounts.delete(midi);
                  synth.noteOff(0, midi);
                } else activePitchCounts.set(midi, count - 1);
              }
              noteOffTimers.delete(timer);
            }, durationMs);
            noteOffTimers.add(timer);
          }).catch((error: unknown) => console.error('Audio preview:', error));
        },
        setSustainPedal(down) {
          void context.resume().then(() => synth.controllerChange(0, 64 as Parameters<typeof synth.controllerChange>[1], down ? 127 : 0))
            .catch((error: unknown) => console.error('Sustain pedal:', error));
        },
        stop,
        dispose() {
          stop();
          synth.destroy();
          void context.close();
        },
      };
    } catch (error) {
      await context.close();
      throw error;
    }
  }
}

export default SpessaSynthInstrument;
