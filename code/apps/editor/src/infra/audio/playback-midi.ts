import type { PlaybackSequence } from '../../service/playback/playback-instrument.ts';

// Fixed tempo: performance expressions have already been converted to seconds.
// 10000 ticks per quarter at 120 BPM gives 50 microsecond event resolution.
const TICKS_PER_SECOND = 20000;
const CHANNELS = Array.from({ length: 16 }, (_, channel) => channel).filter(channel => channel !== 9);

export function createPlaybackMidi(sequence: PlaybackSequence, velocity = 88): ArrayBuffer {
  const events: { tick: number; priority: number; bytes: number[] }[] = [];
  const tickAt = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid playback event time.');
    return Math.round(seconds * TICKS_PER_SECOND);
  };
  const add = (tick: number, priority: number, bytes: number[]) => events.push({ tick, priority, bytes });
  add(0, -4, [0xff, 0x51, 3, 7, 0xa1, 0x20]);
  for (const channel of CHANNELS) {
    add(0, -3, [0xc0 | channel, 0]);
    add(0, -3, [0xb0 | channel, 64, sequence.pedalInitiallyDown ? 127 : 0]);
  }
  for (const event of sequence.pedalEvents) {
    for (const channel of CHANNELS) {
      if (event.action === 'change') add(tickAt(event.atSeconds), -2, [0xb0 | channel, 64, 0]);
      add(tickAt(event.atSeconds), -2, [0xb0 | channel, 64, event.action === 'stop' ? 0 : 127]);
    }
  }
  const attacks = sequence.events.flatMap(event => event.pitches.map((pitch, index) => {
    const start = tickAt(event.startSeconds);
    return { pitch, start, end: Math.max(start + 1, tickAt(event.startSeconds + (event.pitchDurationsSeconds?.[index] ?? event.durationSeconds))) };
  })).sort((a, b) => a.start - b.start || a.end - b.end);
  // SpessaSynth releases repeated pitches FIFO. Separate overlapping instances
  // onto different MIDI channels so out-of-order releases also remain correct.
  const releases = new Map<number, number[]>();
  let endTick = tickAt(sequence.durationSeconds);
  for (const attack of attacks) {
    const until = releases.get(attack.pitch) ?? CHANNELS.map(() => 0);
    const slot = until.findIndex(end => end <= attack.start);
    if (slot < 0) throw new Error('Too many overlapping instances of the same pitch.');
    until[slot] = attack.end;
    releases.set(attack.pitch, until);
    const channel = CHANNELS[slot];
    add(attack.start, 0, [0x90 | channel, attack.pitch, velocity]);
    add(attack.end, -1, [0x80 | channel, attack.pitch, 0]);
    endTick = Math.max(endTick, attack.end);
  }
  for (const channel of CHANNELS) add(endTick, 1, [0xb0 | channel, 64, 0]);
  add(endTick, 2, [0xff, 0x2f, 0]);
  events.sort((a, b) => a.tick - b.tick || a.priority - b.priority);
  const track: number[] = [];
  let previous = 0;
  for (const event of events) {
    let delta = event.tick - previous;
    // SMF delta times are limited to four bytes. Silent spacers support long rests.
    while (delta > 0x0fffffff) {
      track.push(0xff, 0xff, 0xff, 0x7f, 0xff, 0x01, 0);
      delta -= 0x0fffffff;
    }
    const variable = [delta & 0x7f];
    while ((delta = Math.floor(delta / 128)) > 0) variable.unshift((delta & 0x7f) | 0x80);
    track.push(...variable, ...event.bytes);
    previous = event.tick;
  }
  const length = track.length;
  return new Uint8Array([
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x27, 0x10,
    0x4d, 0x54, 0x72, 0x6b, (length >>> 24) & 255, (length >>> 16) & 255, (length >>> 8) & 255, length & 255,
    ...track,
  ]).buffer;
}
