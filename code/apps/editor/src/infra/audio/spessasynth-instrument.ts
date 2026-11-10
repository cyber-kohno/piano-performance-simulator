import { Sequencer, WorkletSynthesizer } from 'spessasynth_lib';
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';
import type { PlaybackInstrumentPort } from '../../service/playback/playback-instrument.ts';
import { createWorkletSequencePlayer } from './worklet-sequence-player.ts';

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

      const sequencer = new Sequencer(synth, { skipToFirstNoteOn: false });
      sequencer.loopCount = 0;
      sequencer.eventHandler.timeDelay = 0;
      const player = createWorkletSequencePlayer({
        resume: () => context.resume(),
        load: binary => sequencer.loadNewSongList([{ binary }]),
        play: () => { sequencer.currentTime = 0; sequencer.play(); },
        pause: () => sequencer.pause(),
        get currentTime() { return sequencer.currentTime; },
        silence() {
          for (let channel = 0; channel < 16; channel++) synth.controllerChange(channel, 64, 0);
          synth.stopAll(true);
        },
      });
      sequencer.eventHandler.addEvent('songChange', 'clavierdesk', () => player.loaded());
      sequencer.eventHandler.addEvent('songEnded', 'clavierdesk', () => player.ended());
      sequencer.eventHandler.addEvent('midiError', 'clavierdesk', error => player.failed(error));
      return {
        startSequence: (sequence, callbacks) => player.startSequence(sequence, callbacks),
        play(pitches, velocity, durationMs) {
          const durationSeconds = Math.max(0.001, durationMs / 1000);
          player.startSequence({ durationSeconds, pedalInitiallyDown: false, pedalEvents: [], events: [
            { sourceNoteId: 'preview', startSeconds: 0, durationSeconds, pitches: [...pitches] },
          ] }, { ended: () => {}, failed: error => console.error('Audio preview:', error) }, velocity);
        },
        setSustainPedal(down) {
          void context.resume().then(() => synth.controllerChange(0, 64 as Parameters<typeof synth.controllerChange>[1], down ? 127 : 0))
            .catch((error: unknown) => console.error('Sustain pedal:', error));
        },
        stop: player.stop,
        dispose() {
          player.stop();
          sequencer.eventHandler.removeEvent('songChange', 'clavierdesk');
          sequencer.eventHandler.removeEvent('songEnded', 'clavierdesk');
          sequencer.eventHandler.removeEvent('midiError', 'clavierdesk');
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
