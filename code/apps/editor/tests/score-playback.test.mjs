import assert from 'node:assert/strict';
import { test } from 'node:test';
import Authoring from '../src/action/editor/score-authoring.ts';
import Factory from '../src/domain/score/score-project.ts';
import Timeline from '../src/domain/score/score-timeline.ts';
import Tempo from '../src/domain/score/score-tempo.ts';
import Clock from '../src/domain/performance/score-clock.ts';
import Plan from '../src/domain/performance/score-playback-plan.ts';
import Playback from '../src/service/playback/score-playback.ts';

function fixture() {
  return Authoring.apply(Factory.create(), Authoring.createState(), [{ type: 'create_score',
    settings: { meter: [4, 4], keyFifths: 0, tempo: 120 }, measures: [{ upper: [[
      { value: '4', pitches: ['C4'] }, { value: '4', pitches: ['C4'] },
      { value: '2', pitches: ['E4', 'G4'] },
    ]] }] }]).project;
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('compiled tempo clock matches integration and inverts fractional positions across tempo boundaries', () => {
  const p = fixture(), notes = Timeline.notes(p.outline);
  p.tempoChanges = [{ noteId: notes[0].note.id, bpm: 90 }, { noteId: notes[1].note.id, bpm: 60 },
    { noteId: notes[2].note.id, bpm: 180 }];
  const clock = Clock.create(p);
  for (const position of [0, 1 / 3, 3.999, 4, 4.001, 8, 10.5, 16, 32]) {
    const seconds = Clock.secondsAt(p, position);
    near(clock.secondsAt(position), seconds);
    near(clock.positionAt(seconds), position);
  }
});

test('prepared playback preserves tied sounding tails, tempo changes and pedal state without rescanning', t => {
  const p = fixture(), [a, b] = Timeline.notes(p.outline).map(entry => entry.note);
  a.tieTo = b.id; b.tieFrom = a.id; b.staccato = { type: 'normal', lengthRatio: 0.5 };
  p.tempoChanges = [{ noteId: b.id, bpm: 60 }];
  p.outline.find(block => block.type === 'measure').data.pedalEvents = [
    { id: 'pedal-start', offset: { numerator: 0, denominator: 1 }, action: 'start' },
    { id: 'pedal-stop', offset: { numerator: 8, denominator: 1 }, action: 'stop' },
  ];
  const before = structuredClone(p), prepared = Plan.prepare(p);
  t.mock.method(Timeline, 'notes', () => { throw new Error('Prepared starts must reuse the note index'); });
  t.mock.method(Tempo, 'anchors', () => { throw new Error('Prepared starts must reuse the tempo map'); });
  const whole = prepared.create(0), interior = prepared.create(4);
  near(whole.events[0].durationSeconds, 1);
  near(interior.events[0].startSeconds, 0);
  near(interior.events[0].durationSeconds, 0.5);
  assert.equal(interior.events[0].sourceNoteId, a.id);
  assert.equal(interior.pedalInitiallyDown, true);
  near(interior.pedalEvents[0].atSeconds, 1);
  assert.deepEqual(prepared.create(0), whole);
  assert.deepEqual(p, before);
});

test('prepared ornaments preserve preroll at a fresh start and trim attacks on later starts', () => {
  const p = fixture(), [a, , chord] = Timeline.notes(p.outline).map(entry => entry.note);
  a.beforeGraceNotes = [{ id: 'grace', value: { type: 'eighth', dots: 0 }, slash: true, pitches: [{ midi: 59 }] }];
  a.gracePerformance = { spreadRatio: 1, timing: 1 };
  chord.arpeggio = { type: 'normal', spreadRatio: 1, timing: 1 };
  const prepared = Plan.prepare(p);
  const fresh = prepared.create(0);
  assert.equal(fresh.events[0].graceNote, true);
  near(fresh.events[0].startSeconds, 0);
  assert.ok(fresh.events.find(event => event.sourceNoteId === a.id).startSeconds > 0);
  const rolled = prepared.create(8).events.filter(event => event.sourceNoteId.includes('-arpeggio-'));
  near(rolled[0].startSeconds, 0);
  assert.ok(rolled[1].startSeconds > rolled[0].startSeconds);
  const later = prepared.create(9);
  assert.ok(later.events.every(event => !event.graceNote && event.startSeconds >= 0));
});

test('transport reuses preparation and plans, invalidates edits and converts progress without rescanning the score', t => {
  const oldWindow = globalThis.window;
  let interval, id = 0, now = 0, builds = 0, plans = 0;
  globalThis.window = { setTimeout() { throw new Error('Audio must not use UI timers'); },
    setInterval(fn) { interval = fn; return ++id; }, clearInterval() { interval = undefined; } };
  t.mock.method(performance, 'now', () => 999999); // Wall clock cannot advance audio.
  const prepare = Plan.prepare;
  t.mock.method(Plan, 'prepare', project => {
    builds++; const snapshot = prepare(project);
    return { ...snapshot, create(position) { plans++; return snapshot.create(position); } };
  });
  let callbacks;
  const positions = [], player = Playback.create({
    startSequence(sequence, handlers) {
      callbacks = handlers;
      const start = now;
      return { get currentTime() { return (now - start) / 1000; } };
    }, stop() {},
  });
  t.after(() => { player.dispose(); globalThis.window = oldWindow; });
  const p = fixture();
  player.prepare(p);
  player.start(p, 0, position => positions.push(position), () => {});
  const anchors = t.mock.method(Tempo, 'anchors', () => { throw new Error('Progress must not scan tempo anchors'); });
  now = 250; interval(); near(positions.at(-1), 2);
  now = 300;
  near(player.position, 2.4); // Stop can sample the clock between UI progress frames.
  near(positions.at(-1), 2);
  player.stop();
  assert.equal(player.position, null);
  player.start(p, 0, () => {}, () => {}); player.stop();
  assert.equal(builds, 1); assert.equal(plans, 1);
  anchors.mock.restore();
  const edited = structuredClone(p); edited.outline[0].data.tempo = 60;
  player.prepare(edited);
  player.start(edited, 0, position => positions.push(position), () => {});
  // start position is reported synchronously, without a pending progress frame.
  near(positions.at(-1), 0);
  now = 550; interval(); near(positions.at(-1), 1);
  assert.equal(builds, 2); assert.equal(plans, 2);
  callbacks.ended();
  assert.equal(player.playing, false);
});

test('edits only invalidate playback; the next start prepares the latest revision once', t => {
  const oldWindow = globalThis.window;
  globalThis.window = { setInterval() { return 1; }, clearInterval() {} };
  let builds = 0, plans = 0;
  const prepare = Plan.prepare;
  t.mock.method(Plan, 'prepare', project => {
    builds++;
    const snapshot = prepare(project);
    return { ...snapshot, create(position) { plans++; return snapshot.create(position); } };
  });
  const sequences = [];
  const player = Playback.create({
    startSequence(sequence) { sequences.push(sequence); return { currentTime: 0 }; }, stop() {},
  });
  t.after(() => { player.dispose(); globalThis.window = oldWindow; });
  const original = fixture();
  player.invalidate(original);
  let latest;
  for (const pitch of [61, 62, 63]) {
    latest = structuredClone(original);
    Timeline.notes(latest.outline)[0].note.pitches[0].midi = pitch;
    player.invalidate(latest);
  }
  assert.equal(builds, 0);
  assert.equal(plans, 0);
  const start = (project, position = 0) => {
    assert.equal(player.start(project, position, () => {}, () => {}), true);
    player.stop();
  };
  start(latest);
  assert.equal(builds, 1);
  assert.equal(plans, 1);
  assert.equal(sequences.at(-1).events[0].pitches[0], 63);
  player.invalidate(latest); // A repeated notification is not an edit.
  start(latest);
  assert.equal(builds, 1);
  assert.equal(plans, 1);
  assert.equal(sequences.at(-1), sequences.at(-2));
  start(latest, 4); // A different start reuses preparation, but creates a new plan.
  assert.equal(builds, 1);
  assert.equal(plans, 2);
  player.invalidate(original); // Undo must rebuild the restored score.
  assert.equal(builds, 1);
  start(original);
  assert.equal(builds, 2);
  assert.equal(sequences.at(-1).events[0].pitches[0], 60);
  player.dispose();
  start(original);
  assert.equal(builds, 3);
});
