import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProject, createMeasureData } from '../src/model/project.ts';
import { createTimelineCursor } from '../src/state/timeline-cursor.ts';
import NoteEditor from '../src/action/editor/note-editor.ts';
import ScoreTimeline from '../src/domain/score/score-timeline.ts';
import ScoreVoice from '../src/domain/score/score-voice.ts';
import ScoreKey from '../src/domain/score/score-key.ts';
import TimelineView from '../src/state/timeline-view.ts';
import { createProjectFingerprint } from '../src/service/project/project-fingerprint.ts';
import EditorHistory from '../src/service/history/editor-history.ts';
import TupletNotes from '../src/domain/score/tuplet-notes.ts';

function fixture(count = 100) {
  const project = createProject();
  for (let i = 0; i < count; i++) {
    const data = createMeasureData({ cnt: 4, unit: 4 });
    for (const [staff, base] of [['upperStaff', 72], ['lowerStaff', 48]]) {
      data[staff].voices[0].elements = Array.from({ length: 8 }, (_, n) => ({
        id: `${staff}-${i}-${n}`, kind: 'note', value: { type: 'eighth', dots: 0 }, pitches: [{ midi: base + n % 3 }],
      }));
    }
    project.outline.push({ id: `m${i}`, type: 'measure', data });
  }
  const cursor = { ...createTimelineCursor(), focusedNoteId: 'upperStaff-0-0', focusedPitchIndex: 0, pitch: 72 };
  return { project, cursor };
}

test('single pitch changes share untouched measures, voices, tuplets and notes', () => {
  const { project, cursor } = fixture(20);
  const saved = JSON.stringify(project);
  const before = project.outline[2];
  const next = NoteEditor.movePitch(project, cursor, 1);
  assert.ok(next);
  assert.equal(JSON.stringify(project), saved);
  assert.notEqual(next.project.outline[2], before);
  assert.equal(next.project.outline[2].data.lowerStaff, before.data.lowerStaff);
  assert.equal(next.project.outline[2].data.upperStaff.voices[0].elements[1], before.data.upperStaff.voices[0].elements[1]);
  for (let i = 3; i < project.outline.length; i++) assert.equal(next.project.outline[i], project.outline[i]);
  const voice = { id: 'v', elements: [{ id: 't', kind: 'tuplet', actual: 3, normal: 2, baseType: 'eighth',
    elements: [before.data.upperStaff.voices[0].elements[0]] }] };
  assert.equal(ScoreVoice.mapNotes(voice, note => note), voice);
});

test('warm pitch edits flatten a bounded number of voices and reuse timing-only projections', () => {
  for (const count of [20, 100, 300]) {
    const { project, cursor } = fixture(count);
    ScoreTimeline.prepare(project.outline);
    ScoreTimeline.note(project.outline, cursor.focusedNoteId);
    const gaps = TimelineView.visualGaps(project.outline);
    const layout = TimelineView.layout(project.outline, 480);
    const keys = ScoreKey.buildMeasureCache(project.outline);
    const original = ScoreVoice.flatten;
    let flattened = 0;
    ScoreVoice.flatten = (...args) => { flattened++; return original(...args); };
    let next;
    try { next = NoteEditor.movePitch(project, cursor, 1); }
    finally { ScoreVoice.flatten = original; }
    assert.ok(next);
    assert.ok(flattened <= 6, `${count} bars flattened ${flattened} voices`);
    assert.equal(TimelineView.visualGaps(next.project.outline), gaps);
    assert.equal(TimelineView.layout(next.project.outline, 480), layout);
    assert.equal(ScoreKey.buildMeasureCache(next.project.outline), keys);
    const untouched = project.outline[3];
    assert.equal(TimelineView.notesForMeasure(untouched, gaps, 4, 30, true),
      TimelineView.notesForMeasure(next.project.outline[3], gaps, 4, 30, true));
    assert.equal(ScoreTimeline.note(next.project.outline, cursor.focusedNoteId).note.pitches[0].midi, 73);
    assert.equal(ScoreTimeline.note(project.outline, cursor.focusedNoteId).note.pitches[0].midi, 72);
  }
});

test('cached reads distinguish edits, structural changes, mutable drafts and Undo snapshots', () => {
  const { project, cursor } = fixture(4);
  // Mutable drafts are deliberately not registered for immutable caching.
  ScoreTimeline.note(project.outline, cursor.focusedNoteId);
  project.outline[2].data.upperStaff.voices[0].elements[0].pitches[0].midi = 74;
  assert.equal(ScoreTimeline.note(project.outline, cursor.focusedNoteId).note.pitches[0].midi, 74);
  ScoreTimeline.prepare(project.outline);
  const next = NoteEditor.movePitch(project, cursor, 1);
  const inserted = { ...next.project, outline: [...next.project.outline.slice(0, 2),
    { id: 'pickup', type: 'measure', data: createMeasureData({ cnt: 1, unit: 4 }) }, ...next.project.outline.slice(2)] };
  ScoreTimeline.prepare(inserted.outline);
  assert.notEqual(ScoreTimeline.timingKey(inserted.outline), ScoreTimeline.timingKey(next.project.outline));
  assert.equal(ScoreTimeline.note(inserted.outline, cursor.focusedNoteId).measureStartSixteenths, 4);
  assert.equal(ScoreTimeline.note(project.outline, cursor.focusedNoteId).measureStartSixteenths, 0);
  const history = EditorHistory.create({ project });
  history.record({ project: next.project });
  assert.equal(ScoreTimeline.note(history.undo().project.outline, cursor.focusedNoteId).note.pitches[0].midi, 74);
  assert.equal(ScoreTimeline.note(history.redo().project.outline, cursor.focusedNoteId).note.pitches[0].midi, 75);
});

test('local tuplet lookup agrees with full-score lookup at fractional positions and boundaries', () => {
  const { project } = fixture(3);
  const group = { id: 'triplet', kind: 'tuplet', actual: 3, normal: 2, baseType: 'eighth',
    elements: Array.from({ length: 3 }, (_, i) => ({ id: `t${i}`, kind: 'note',
      value: { type: 'eighth', dots: 0 }, pitches: [{ midi: 72 }] })) };
  project.outline[3].data.upperStaff.voices[0].elements = [
    { id: 'r1', kind: 'rest', value: { type: 'quarter', dots: 0 } }, group,
    { id: 'r2', kind: 'rest', value: { type: 'half', dots: 0 } },
  ];
  const cases = [
    { position: 0, noteId: 'upperStaff-0-0', useFocus: true },
    { position: 20 + 4 / 3, noteId: 't1', useFocus: true },
    ...[19, 20, 20 + 4 / 3, 24, 31, 32].map(position => ({ position, noteId: null, useFocus: false })),
  ];
  const expected = cases.map(item => TupletNotes.context(project.outline,
    { ...item, staff: 'upperStaff', voiceIndex: 0 }, item.position, item.useFocus));
  ScoreTimeline.prepare(project.outline);
  cases.forEach((item, i) => assert.deepEqual(TupletNotes.context(project.outline,
    { ...item, staff: 'upperStaff', voiceIndex: 0 }, item.position, item.useFocus), expected[i]));
});

test('pitch fast path preserves fermata, anchors and ties and still rejects other-voice collisions', () => {
  const { project, cursor } = fixture(2);
  const note = project.outline[2].data.upperStaff.voices[0].elements[0];
  note.fermata = { lengthRatio: 2 };
  project.tempoChanges = [{ noteId: note.id, bpm: 110 }];
  project.dynamicChanges = [{ noteId: note.id, level: 'f', velocity: 100 }];
  // An attack in the other staff occupies the proposed pitch at the same time.
  project.outline[2].data.lowerStaff.voices[0].elements[0].pitches[0].midi = 73;
  ScoreTimeline.prepare(project.outline);
  assert.equal(NoteEditor.movePitch(project, cursor, 1), undefined);
  const down = NoteEditor.movePitch(project, cursor, -1);
  assert.equal(ScoreTimeline.note(down.project.outline, note.id).note.fermata, note.fermata);
  assert.equal(down.project.tempoChanges, project.tempoChanges);
  assert.equal(down.project.dynamicChanges, project.dynamicChanges);
  const tied = fixture(2);
  const first = tied.project.outline[2].data.upperStaff.voices[0].elements[0];
  const second = tied.project.outline[2].data.upperStaff.voices[0].elements[1];
  second.pitches = [{ midi: 72 }]; first.tieTo = second.id; second.tieFrom = first.id;
  ScoreTimeline.prepare(tied.project.outline);
  const moved = NoteEditor.movePitch(tied.project, tied.cursor, 1);
  const chain = ScoreTimeline.tieChain(moved.project.outline, first.id);
  assert.deepEqual(chain.map(entry => entry.note.pitches[0].midi), [73, 73]);
});

test('incremental fingerprints exactly match JSON, reuse untouched subtrees and recognize saved content', () => {
  const { project, cursor } = fixture(20);
  project.trills = undefined;
  const fingerprint = createProjectFingerprint();
  const saved = fingerprint(project);
  assert.equal(saved, JSON.stringify(project));
  const next = NoteEditor.movePitch(project, cursor, 1, undefined, true);
  assert.equal(fingerprint(next.project), JSON.stringify(next.project));
  assert.notEqual(fingerprint(next.project), saved);
  const restored = NoteEditor.movePitch(next.project, next.cursor, -1, undefined, true);
  assert.equal(fingerprint(restored.project), saved);
  assert.equal(fingerprint(project), saved);
  let reads = 0;
  const oldNote = project.outline[3].data.upperStaff.voices[0].elements[0];
  project.outline[3].data.upperStaff.voices[0].elements[0] = new Proxy(oldNote, {
    get(target, key) { reads++; return Reflect.get(target, key); },
  });
  const cached = createProjectFingerprint(); cached(project); reads = 0;
  const changed = NoteEditor.movePitch(project, cursor, 1);
  reads = 0;
  cached(changed.project);
  assert.equal(reads, 0);
});

test('pitch commits still reconcile trills while retaining an unrelated range', () => {
  const { project, cursor } = fixture(2);
  const first = project.outline[2].data.upperStaff.voices[0].elements[0];
  const second = project.outline[2].data.upperStaff.voices[0].elements[1];
  second.pitches = [{ midi: 72 }]; first.tieTo = second.id; second.tieFrom = first.id;
  project.trills = [{ id: 'trill', kind: 'trill', startNoteId: first.id, endNoteId: second.id,
    settings: { auxiliary: 'diatonic', start: 'main', attackCount: 8 } }];
  ScoreTimeline.prepare(project.outline);
  const unrelated = NoteEditor.movePitch(project, { ...cursor, focusedNoteId: 'upperStaff-1-0', positionSixteenths: 16 }, 1);
  assert.deepEqual(unrelated.project.trills, project.trills);
  const changed = NoteEditor.movePitch(project, cursor, 1);
  assert.equal(changed.project.trills, undefined);
});
