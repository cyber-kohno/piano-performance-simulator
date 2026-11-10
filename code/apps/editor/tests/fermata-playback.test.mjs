import assert from 'node:assert/strict';
import { test } from 'node:test';
import Authoring from '../src/action/editor/score-authoring.ts';
import Factory from '../src/domain/score/score-project.ts';
import Timeline from '../src/domain/score/score-timeline.ts';
import Clock from '../src/domain/performance/score-clock.ts';
import Plan from '../src/domain/performance/score-playback-plan.ts';
import Playback from '../src/service/playback/score-playback.ts';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
function fixture() {
  return Authoring.apply(Factory.create(), Authoring.createState(), [{ type: 'create_score',
    settings: { meter: [4, 4], keyFifths: 0, tempo: 120 }, measures: [{
      upper: [['C4', 'D4', 'E4', 'F4'].map(pitch => ({ value: '4', pitches: [pitch] }))],
      lower: [[{ value: '1', pitches: ['C3'] }]],
    }] }]).project;
}
const upper = p => Timeline.notes(p.outline).map(entry => entry.note);
const lower = p => Timeline.notes(p.outline, 'lowerStaff').map(entry => entry.note);

test('time and inverse position slow only inside a hold, including tempo changes and unity/adjacent ratios', () => {
  const p = fixture(), n = upper(p);
  n[1].fermata = { lengthRatio: 2 };
  let clock = Clock.create(p);
  for (const [position, seconds] of [[0, 0], [4, 0.5], [6, 1], [8, 1.5], [12, 2], [16, 2.5]]) {
    near(clock.secondsAt(position), seconds); near(clock.positionAt(seconds), position);
  }
  p.tempoChanges = [{ noteId: n[1].id, bpm: 60 }, { noteId: n[2].id, bpm: 240 }];
  clock = Clock.create(p);
  near(clock.secondsAt(8), 2.5); near(clock.secondsAt(12), 2.75);
  near(clock.positionAt(1.5), 6);
  delete p.tempoChanges;
  n[0].fermata = { lengthRatio: 1 }; n[2].fermata = { lengthRatio: 3 };
  clock = Clock.create(p);
  near(clock.secondsAt(12), 3); near(clock.secondsAt(16), 3.5);
  for (const position of [-0.1, 0, 3.999, 4, 4.001, 8, 11.999, 12, 16, 24]) {
    near(clock.positionAt(clock.secondsAt(position)), position);
  }
  n[1].fermata.lengthRatio = 1; n[2].fermata.lengthRatio = 1;
  const unity = Plan.create(p, 0);
  for (const note of n) delete note.fermata;
  assert.deepEqual(unity, Plan.create(p, 0));
});

test('priority ratio stretches the longest shared span across both staves without multiplying holds together', () => {
  const p = fixture(), n = upper(p), bass = lower(p)[0];
  n[3].fermata = { lengthRatio: 2 }; bass.fermata = { lengthRatio: 4 };
  const clock = Clock.create(p), plan = Plan.create(p, 0);
  near(clock.secondsAt(4), 1); near(clock.secondsAt(16), 4); near(plan.durationSeconds, 4);
  near(plan.events.find(event => event.sourceNoteId === bass.id).durationSeconds, 4);
  near(plan.events.find(event => event.sourceNoteId === n[2].id).startSeconds, 2);
  assert.equal(plan.events.length, 5);
});

test('interior starts stretch only remaining time and maintain pedal changes and notes spanning both boundaries', () => {
  const p = fixture(), n = upper(p), bass = lower(p)[0];
  bass.value = { type: 'half', dots: 0 }; bass.tieTo = 'bass-tail';
  p.outline.find(block => block.type === 'measure').data.lowerStaff.voices[0].elements.push({
    id: 'bass-tail', kind: 'note', value: { type: 'half', dots: 0 }, pitches: [{ midi: 48 }], tieFrom: bass.id,
  });
  n[1].fermata = { lengthRatio: 2 };
  p.outline.find(block => block.type === 'measure').data.pedalEvents = [
    { id: 'down', offset: { numerator: 0, denominator: 1 }, action: 'start' },
    { id: 'retake', offset: { numerator: 6, denominator: 1 }, action: 'change' },
    { id: 'up', offset: { numerator: 12, denominator: 1 }, action: 'stop' },
  ];
  const whole = Plan.create(p, 0);
  near(whole.events.find(event => event.sourceNoteId === bass.id).durationSeconds, 2.5);
  assert.deepEqual(whole.pedalEvents.map(event => event.atSeconds), [0, 1, 2]);
  const fromMiddle = Plan.prepare(p).create(6);
  near(fromMiddle.durationSeconds, 1.5);
  near(fromMiddle.events.find(event => event.sourceNoteId === bass.id).durationSeconds, 1.5);
  near(fromMiddle.events.find(event => event.sourceNoteId === n[2].id).startSeconds, 0.5);
  assert.equal(fromMiddle.pedalInitiallyDown, true);
  assert.deepEqual(fromMiddle.pedalEvents.map(event => event.atSeconds), [0, 1]);
  const after = Plan.create(p, 8);
  near(after.durationSeconds, 1);
  near(after.events.find(event => event.sourceNoteId === n[3].id).startSeconds, 0.5);
});

test('trill attack counts are preserved and intervals stretch only inside the fermata', () => {
  const p = fixture(), bass = lower(p)[0];
  upper(p)[1].fermata = { lengthRatio: 2 };
  p.trills = [{ id: 'trill', kind: 'trill', startNoteId: bass.id, endNoteId: bass.id,
    settings: { auxiliary: 'diatonic', start: 'main', attackCount: 4 } }];
  const attacks = Plan.create(p, 0).events.filter(event => event.sourceNoteId.includes('-trill-'));
  assert.equal(attacks.length, 4);
  assert.deepEqual(attacks.map(event => event.startSeconds), [0, 0.5, 1.5, 2]);
  assert.deepEqual(attacks.map(event => event.durationSeconds), [0.5, 1, 0.5, 0.5]);
});

test('graces, arpeggio preroll, staccato and per-pitch slur releases use the same warp on repeated interior starts', () => {
  const p = fixture(), n = upper(p);
  n[0].beforeGraceNotes = [{ id: 'grace', slash: true, value: { type: 'eighth', dots: 0 }, pitches: [{ midi: 59 }] }];
  n[0].gracePerformance = { spreadRatio: 1, timing: 1 };
  n[1].staccato = { type: 'normal', lengthRatio: 0.5 };
  n[2].pitches = [{ midi: 67 }, { midi: 64 }];
  n[2].arpeggio = { type: 'normal', spreadRatio: 1, timing: 1 };
  p.slurs = [{ id: 'slur', startNoteId: n[2].id, endNoteId: n[3].id }];
  const stretched = structuredClone(p);
  upper(stretched)[1].fermata = { lengthRatio: 2 };
  const snapshot = structuredClone(stretched), prepared = Plan.prepare(stretched);
  const warp = seconds => seconds + Math.max(0, Math.min(0.5, seconds - 0.5));
  for (const start of [0, 4, 5, 8, 9, 12]) {
    const base = Plan.create(p, start), actual = prepared.create(start), origin = start / 8;
    const mapped = seconds => warp(origin + seconds) - warp(origin);
    assert.equal(actual.events.length, base.events.length);
    base.events.forEach((event, i) => {
      const result = actual.events[i];
      assert.equal(result.sourceNoteId, event.sourceNoteId);
      assert.deepEqual(result.pitches, event.pitches);
      near(result.startSeconds, mapped(event.startSeconds));
      near(result.durationSeconds, mapped(event.startSeconds + event.durationSeconds) - result.startSeconds);
      event.pitchDurationsSeconds?.forEach((duration, j) => {
        near(result.pitchDurationsSeconds[j], mapped(event.startSeconds + duration) - result.startSeconds);
      });
    });
    near(actual.durationSeconds, mapped(base.durationSeconds));
  }
  assert.deepEqual(stretched, snapshot);
});

test('transport schedules slowed audio and advances the playhead with the same clock before, within and after the hold', t => {
  const oldWindow = globalThis.window, timers = new Map();
  let id = 0, interval, now = 0;
  globalThis.window = { setTimeout(fn, delay) { timers.set(++id, { fn, delay }); return id; },
    clearTimeout(key) { timers.delete(key); }, setInterval(fn) { interval = fn; return ++id; }, clearInterval() { interval = undefined; } };
  t.mock.method(performance, 'now', () => now);
  const positions = [], played = [];
  const player = Playback.create({ play: (...args) => played.push(args), stop() {}, setSustainPedal() {} });
  t.after(() => { player.dispose(); globalThis.window = oldWindow; });
  const p = fixture(); upper(p)[1].fermata = { lengthRatio: 2 };
  player.prepare(p); player.start(p, 0, position => positions.push(position), () => {});
  const atSecondNote = [...timers.values()].find(timer => timer.delay === 500);
  atSecondNote.fn(); assert.equal(played[0][0][0], 62);
  assert.ok(played[0][2] > 900); // Stretched articulation gap remains attached to the release.
  for (const [milliseconds, position] of [[250, 2], [500, 4], [1000, 6], [1500, 8], [1750, 10], [2000, 12]]) {
    now = milliseconds; interval(); near(positions.at(-1), position);
  }
  assert.ok([...timers.values()].some(timer => timer.delay === 2500), 'auto-stop includes the extension');
});
