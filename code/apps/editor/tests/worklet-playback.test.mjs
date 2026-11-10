import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { createPlaybackMidi } from '../src/infra/audio/playback-midi.ts';
import { createWorkletSequencePlayer } from '../src/infra/audio/worklet-sequence-player.ts';

// Test with the exact MIDI parser/sequencer shipped with our installed audio engine.
const require = createRequire(import.meta.url);
const dependency = createRequire(require.resolve('spessasynth_lib'));
const { BasicMIDI, SoundBankLoader, SpessaSynthProcessor, SpessaSynthSequencer, SpessaLog } = await import(pathToFileURL(dependency.resolve('spessasynth_core')).href);
SpessaLog.setLogLevel(false, false, false);
const plan = (events, extra = {}) => ({ events, durationSeconds: 2, pedalInitiallyDown: false, pedalEvents: [], ...extra });
const note = (startSeconds, durationSeconds, pitches = [64, 67]) => ({ sourceNoteId: `${startSeconds}`, startSeconds, durationSeconds, pitches });
const parse = sequence => BasicMIDI.fromArrayBuffer(createPlaybackMidi(sequence));
const messages = midi => midi.tracks[0].events;

test('measure 23 repeated chords have one release per attack and a silent fourth beat', () => {
  const quarter = 60 / 144;
  const sequence = plan([0, 0.5, 1, 1.5].map(beat => note(beat * quarter, 0.5 * quarter * 0.95))
    .concat(note(2 * quarter, quarter)), { durationSeconds: 4 * quarter });
  const midi = parse(sequence), events = messages(midi);
  const ons = events.filter(e => (e.statusByte & 0xf0) === 0x90);
  const offs = events.filter(e => (e.statusByte & 0xf0) === 0x80);
  assert.equal(ons.length, 10);
  assert.equal(offs.length, 10);
  assert.equal(Math.max(...offs.map(e => e.ticks)), Math.round(3 * quarter * 20000));
  assert.ok(Math.abs(midi.duration - 4 * quarter) <= 0.00005);
  assert.ok(events.filter(e => (e.statusByte & 0xf0) === 0xb0).every(e => e.data[1] === 0));
});

test('overlapping same pitches use independent channels and preserve per-pitch releases', () => {
  const midi = parse(plan([note(0, 1), { ...note(0.25, 0.8), pitchDurationsSeconds: [0.1, 0.8] }]));
  const events = messages(midi);
  for (const pitch of [64, 67]) {
    const on = events.filter(e => (e.statusByte & 0xf0) === 0x90 && e.data[0] === pitch);
    assert.notEqual(on[0].statusByte, on[1].statusByte);
    for (const attack of on) assert.equal(events.filter(e => e.statusByte === attack.statusByte - 16 && e.data[0] === pitch).length, 1);
  }
  const earlyOff = events.find(e => (e.statusByte & 0xf0) === 0x80 && e.data[0] === 64 && e.ticks === 7000);
  assert.ok(earlyOff);
});

test('initial pedal, retakes, trailing rests and releases survive the MIDI conversion', () => {
  const midi = parse(plan([note(0.25, 0.25)], { durationSeconds: 3, pedalInitiallyDown: true,
    pedalEvents: [{ atSeconds: 0.5, action: 'change' }, { atSeconds: 1, action: 'stop' }] }));
  const controls = messages(midi).filter(e => e.statusByte === 0xb0 && e.data[0] === 64);
  assert.deepEqual(controls.map(e => [e.ticks, e.data[1]]), [[0, 127], [10000, 0], [10000, 127], [20000, 0], [60000, 0]]);
  assert.equal(midi.duration, 3);
  assert.equal(messages(midi).find(e => e.statusByte === 0x90).ticks, 5000);
});

test('real audio engine sequencer releases repeated notes and ends without UI timer callbacks', () => {
  const synth = new SpessaSynthProcessor(48000);
  const seq = new SpessaSynthSequencer(synth);
  seq.preload = false;
  seq.skipToFirstNoteOn = false;
  seq.loopCount = 0;
  seq.externalMIDIPlayback = true;
  const events = [];
  seq.onEventCall = event => {
    if (event.type === 'midiMessage' && [0x80, 0x90].includes(event.data.message[0] & 0xf0))
      events.push({ time: synth.currentTime, bytes: [...event.data.message] });
  };
  const sequence = plan([note(0, 0.2, [64]), note(0.21, 0.2, [64]), note(0.42, 0.3, [64])]);
  seq.loadNewSongList([parse(sequence)]);
  seq.play();
  const left = new Float32Array(128), right = new Float32Array(128);
  // Drive the same per-audio-quantum methods as the Worklet, with no UI progress calls.
  while (synth.currentTime < 2.1) { seq.processTick(); synth.process(left, right); }
  assert.equal(events.length, 6);
  [0, 0.2, 0.21, 0.41, 0.42, 0.72].forEach((expected, i) => assert.ok(Math.abs(events[i].time - expected) < 128 / 48000 + 1e-8));
  assert.equal(seq.paused, true);
});

function fakeEngine() {
  const calls = [];
  const engine = { currentTime: 0, resume: () => Promise.resolve(), load: () => calls.push('load'),
    play: () => calls.push('play'), pause: () => calls.push('pause'), silence: () => calls.push('silence') };
  return { engine, calls, player: createWorkletSequencePlayer(engine) };
}

test('bundled piano releases every repeated chord before the fourth beat over repeated restarts', () => {
  const synth = new SpessaSynthProcessor(48000);
  const bytes = readFileSync(new URL('../public/assets/soundfonts/clavierdesk-grand-piano.sf2', import.meta.url));
  synth.soundBankManager.addSoundBank(SoundBankLoader.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), 'test-piano');
  const seq = new SpessaSynthSequencer(synth);
  seq.preload = false; seq.skipToFirstNoteOn = false; seq.loopCount = 0;
  const quarter = 60 / 144;
  const midi = parse(plan([0, 0.5, 1, 1.5].map(beat => note(beat * quarter, quarter * 0.475))
    .concat(note(2 * quarter, quarter)), { durationSeconds: 4 * quarter }));
  const left = new Float32Array(128), right = new Float32Array(128);
  let sounded = false;
  for (let repeat = 0; repeat < 6; repeat++) {
    seq.pause(); synth.stopAll(true);
    seq.loadNewSongList([midi]); seq.currentTime = 0; seq.play();
    const began = synth.currentTime;
    while (synth.currentTime - began < 4 * quarter + 0.05) {
      seq.processTick(); synth.process(left, right);
      if (left.some(value => Math.abs(value) > 0.0001)) sounded = true;
      const elapsed = synth.currentTime - began;
      if (elapsed > 3 * quarter + 0.02 && elapsed < 4 * quarter) {
        const held = synth.voices.filter(voice => voice.isActive && !voice.isInRelease && [64, 67].includes(voice.midiNote));
        assert.equal(held.length, 0, `held notes in rest on restart ${repeat}`);
      }
    }
  }
  assert.equal(sounded, true);
  synth.stopAll(true);
});
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test('stop during resume or load cannot restart cancelled playback; rapid restart ignores stale acknowledgements', async () => {
  const { engine, calls, player } = fakeEngine();
  let ended = 0;
  const handlers = { ended: () => ended++, failed: error => { throw error; } };
  player.startSequence(plan([note(0, 1)]), handlers);
  player.stop();
  await flush();
  assert.ok(!calls.includes('load'));
  player.startSequence(plan([note(0, 1)]), handlers);
  await flush();
  const run = player.startSequence(plan([note(0, 1)]), handlers);
  await flush();
  player.loaded(); // Old load must never play.
  assert.ok(!calls.includes('play'));
  assert.equal(run.currentTime, 0);
  player.loaded();
  assert.equal(calls.filter(call => call === 'play').length, 1);
  engine.currentTime = 0.75;
  assert.equal(run.currentTime, 0.75);
  player.stop();
  player.ended();
  assert.equal(ended, 0);
  assert.equal(run.currentTime, 0);
});

test('sequence end is delivered once, and failed loads can be followed by a fresh start', async () => {
  const { player } = fakeEngine();
  let ended = 0, failed = 0;
  const handlers = { ended: () => ended++, failed: () => failed++ };
  player.startSequence(plan([note(0, 1)]), handlers);
  await flush();
  player.failed(new Error('bad load'));
  assert.equal(failed, 1);
  player.startSequence(plan([note(0, 1)]), handlers);
  await flush();
  player.loaded();
  player.ended(); player.ended();
  assert.equal(ended, 1);
});
