import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProject, createMeasureData } from '../src/model/project.ts';
import TimelineHeader from '../src/state/timeline-header.ts';
import ScoreClock from '../src/domain/performance/score-clock.ts';
import ScoreTimeline from '../src/domain/score/score-timeline.ts';
import ScoreVoice from '../src/domain/score/score-voice.ts';
import ScoreNotes from '../src/domain/score/score-notes.ts';
import NoteEditor from '../src/action/editor/note-editor.ts';
import { createTimelineCursor } from '../src/state/timeline-cursor.ts';
import { readFileSync } from 'node:fs';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';

function fixture(count = 3) {
  const project = createProject();
  project.outline[0].data.tempo = 120;
  project.outline[1].data.name = 'Intro';
  for (let i = 0; i < count; i++) {
    const data = createMeasureData({ cnt: 4, unit: 4 });
    data.upperStaff.voices[0].elements = Array.from({ length: 4 }, (_, n) => ({
      id: `n${i}-${n}`, kind: 'note', value: { type: 'quarter', dots: 0 }, pitches: [{ midi: 72 }],
    }));
    project.outline.push({ id: `m${i}`, type: 'measure', data });
  }
  return project;
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('measure boundaries include elapsed seconds and the final end, using actual measure lengths', () => {
  const p = fixture(); p.outline[0].data.tempo = 100;
  p.outline[2].data.length = { cnt: 1, unit: 4 };
  const data = TimelineHeader.create()(p);
  assert.deepEqual(data.boundaries.map(b => b.position), [0, 4, 20, 36]);
  assert.deepEqual(data.boundaries.map(b => b.label), ['0s', '0.6s', '3s', '5.4s']);
  assert.equal(TimelineHeader.formatSeconds(2.3456), '2.35s');
  assert.equal(TimelineHeader.formatSeconds(120), '120s');
  assert.equal(data.markers[0].events[0].label, 'Intro');
  const empty = createProject();
  assert.deepEqual(TimelineHeader.create()(empty).boundaries, []);
});

test('section, key and interior tempo events retain their positions and group simultaneous events', () => {
  const p = fixture();
  p.outline.splice(3, 0, { id: 's2', type: 'section', data: { name: 'Verse' } },
    { id: 'key1', type: 'key-change', data: { keySignature: { fifths: 2 } } });
  p.tempoChanges = [{ noteId: 'n1-0', bpm: 90 }, { noteId: 'n0-1', bpm: 60 }];
  p.outline.push({ id: 'tail', type: 'section', data: { name: 'End' } });
  const data = TimelineHeader.create()(p);
  assert.deepEqual(data.markers.map(m => m.position), [0, 4, 16, 48]);
  const start = data.markers.find(m => m.position === 16);
  assert.deepEqual(start.events.map(e => e.kind), ['section', 'key', 'tempo']);
  assert.deepEqual(start.events.map(e => e.label), ['Verse', 'Key: None → 2 sharps', 'Tempo: 60 → 90']);
  near(data.boundaries[1].seconds, 3.5);
  const clock = ScoreClock.create(p);
  data.boundaries.forEach(b => near(b.seconds, clock.secondsAt(b.position)));
});

test('elapsed seconds share playback semantics for fermata priority, overlapping layers and tempo changes', () => {
  const p = fixture(2), upper = p.outline[2].data.upperStaff.voices[0];
  upper.elements[3].fermata = { lengthRatio: 1.5 };
  p.outline[2].data.lowerStaff.voices[0].elements = [
    { id: 'low', kind: 'note', value: { type: 'whole', dots: 0 }, pitches: [{ midi: 48 }], fermata: { lengthRatio: 3 } },
  ];
  p.tempoChanges = [{ noteId: 'n0-1', bpm: 60 }];
  const header = TimelineHeader.create()(p), clock = ScoreClock.create(p);
  near(header.boundaries[1].seconds, 5.25);
  header.boundaries.forEach(b => near(b.seconds, clock.secondsAt(b.position)));
  assert.equal(header.boundaries[1].label, '5.25s');
  // Compound meter uses the same dotted beat unit as playback.
  p.outline[0].data.timeSignature = { cnt: 6, unit: 8 };
  TimelineHeader.create()(p).boundaries.forEach(b => near(b.seconds, ScoreClock.create(p).secondsAt(b.position)));
});

test('immutable pitch edits reuse header data and holds; moving anchors and editing holds invalidate it', () => {
  const p = fixture(100), build = TimelineHeader.create();
  p.outline[2].data.upperStaff.voices[0].elements[3].fermata = { lengthRatio: 2 };
  p.tempoChanges = [{ noteId: 'n0-1', bpm: 60 }];
  ScoreTimeline.prepare(p.outline);
  const before = build(p), cursor = { ...createTimelineCursor(), focusedNoteId: 'n50-0', focusedPitchIndex: 0,
    positionSixteenths: 800, pitch: 72 };
  const moved = NoteEditor.movePitch(p, cursor, 1);
  const original = ScoreVoice.flatten; let flattened = 0;
  ScoreVoice.flatten = (...args) => { flattened++; return original(...args); };
  try { assert.equal(build(moved.project), before); }
  finally { ScoreVoice.flatten = original; }
  assert.equal(flattened, 0, 'a pitch edit does not reflatten unchanged holds or empty measures');
  const changed = ScoreNotes.map(p, new Set(['n0-3']), n => ({ ...n, fermata: { lengthRatio: 3 } }), 'upperStaff');
  ScoreTimeline.prepare(changed.outline);
  const after = build(changed);
  assert.notEqual(after, before); assert.ok(after.boundaries[1].seconds > before.boundaries[1].seconds);
  const removed = { ...changed, tempoChanges: [] };
  assert.notEqual(build(removed), after);
});

test('mutable drafts, section/key changes, tempo changes and undo snapshots never reuse stale labels or times', () => {
  const p = fixture(), build = TimelineHeader.create(), saved = structuredClone(p);
  const before = build(p);
  p.outline[0].data.tempo = 60;
  const slower = build(p); assert.notEqual(slower, before); assert.equal(slower.boundaries[1].label, '4s');
  p.outline[1].data.name = 'Renamed';
  assert.equal(build(p).markers[0].events[0].label, 'Renamed');
  p.outline[2].data.upperStaff.voices[0].elements[0].fermata = { lengthRatio: 2 };
  assert.equal(build(p).boundaries[1].label, '5s');
  assert.deepEqual(build(saved), before);
});

test('moving a tempo anchor updates its event and all following elapsed times', () => {
  const p = fixture(), build = TimelineHeader.create();
  p.outline[2].data.upperStaff.voices[0].elements[0] = { id: 'rest', kind: 'rest', value: { type: 'quarter', dots: 0 } };
  p.tempoChanges = [{ noteId: 'n0-1', bpm: 60 }];
  ScoreTimeline.prepare(p.outline);
  const before = build(p);
  const cursor = { ...createTimelineCursor(), focusedNoteId: 'n0-1', focusedPitchIndex: 0, positionSixteenths: 4 };
  const result = NoteEditor.move(p, cursor, -1), after = build(result.project);
  assert.equal(before.markers.at(-1).position, 4);
  assert.equal(after.markers.at(-1).position, 3);
  near(before.boundaries[1].seconds, 3.5); near(after.boundaries[1].seconds, 3.625);
});

test('event row renders only the focused range at the same horizontal coordinates as measure starts', async () => {
  const p = fixture();
  p.outline.splice(3, 0, { id: 'verse', type: 'section', data: { name: 'Verse' } });
  p.tempoChanges = [{ noteId: 'n1-1', bpm: 60 }];
  const data = TimelineHeader.create()(p);
  const source = readFileSync(new URL('../src/components/TimelineEventRow.svelte', import.meta.url), 'utf8');
  const js = compile(source, { generate: 'server', filename: 'TimelineEventRow.svelte' }).js.code
    .replace(/(['"])svelte\/internal\/server\1/g, JSON.stringify(import.meta.resolve('svelte/internal/server')));
  const component = (await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))).default;
  const { body } = render(component, { props: { data, start: 480, end: 960, width: 1440, pixelsPerSixteenth: 30 } });
  assert.match(body, /Elapsed time: 2s/);
  assert.doesNotMatch(body, /Elapsed time: 0s/);
  assert.match(body, /left: 485px/);
  assert.match(body, /left: 605px/);
  assert.match(body, /Verse/); assert.doesNotMatch(body, /Intro/);
  assert.match(body, /data-kind="tempo"/);
});
