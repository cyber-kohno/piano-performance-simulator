import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProject, createMeasureData } from '../src/model/project.ts';
import { createTimelineCursor } from '../src/state/timeline-cursor.ts';
import * as Timeline from '../src/state/timeline-cursor.ts';
import NoteEditor from '../src/action/editor/note-editor.ts';
import EditTransaction from '../src/action/editor/edit-transaction.ts';
import ScoreTimeline from '../src/domain/score/score-timeline.ts';
import ScoreVoice from '../src/domain/score/score-voice.ts';
import ScoreTies from '../src/domain/score/score-ties.ts';
import ScoreFermata from '../src/domain/score/score-fermata.ts';
import ScoreTempo from '../src/domain/score/score-tempo.ts';
import ScoreClef from '../src/domain/score/score-clef.ts';
import ScoreDynamics from '../src/domain/score/score-dynamics.ts';
import ScoreSlur from '../src/domain/score/score-slur.ts';
import ScoreTrill from '../src/domain/score/score-trill.ts';
import RestSpelling from '../src/domain/score/rest-spelling.ts';
import EditorHistory from '../src/service/history/editor-history.ts';
import MusicalTime from '../src/domain/theory/musical-time.ts';

function fixture(count = 20, expressions = false) {
  const project = createProject(), middle = Math.floor(count / 2);
  for (let i = 0; i < count; i++) {
    const data = createMeasureData({ cnt: 4, unit: 4 });
    for (const [staff, midi] of [['upperStaff', 72], ['lowerStaff', 48]]) {
      data[staff].voices[0].elements = Array.from({ length: 16 }, (_, n) => ({
        id: `${staff}-${i}-${n}`, kind: staff === 'upperStaff' && (n === 1 || n === 2) ? 'rest' : 'note',
        value: { type: '16th', dots: 0 }, ...(staff === 'upperStaff' && (n === 1 || n === 2) ? {} : { pitches: [{ midi }] }),
      }));
    }
    project.outline.push({ id: `m${i}`, type: 'measure', data });
  }
  const id = `upperStaff-${middle}-0`;
  if (expressions) {
    project.outline[middle + 2].data.upperStaff.voices[0].elements[0].fermata = { lengthRatio: 2 };
    project.outline[2].data.upperStaff.voices[0].elements[0].fermata = { lengthRatio: 3 };
    project.tempoChanges = [{ noteId: id, bpm: 100 }];
    project.clefChanges = [{ noteId: id, clef: 'bass' }];
    project.dynamicChanges = [{ noteId: id, level: 'f', velocity: 100 }];
    project.slurs = [{ id: 'slur', startNoteId: id, endNoteId: `upperStaff-${middle}-4` }];
    project.trills = [{ id: 'trill', kind: 'trill', startNoteId: id, endNoteId: id, settings: ScoreTrill.defaults }];
  }
  return { project, cursor: { ...createTimelineCursor(), focusedNoteId: id, focusedPitchIndex: 0,
    positionSixteenths: middle * 16, pitch: 72 } };
}
const actions = [
  ['move', (p, c) => NoteEditor.move(p, c, 1), (p, c) => Timeline.moveFocusedTimelineNote(p, c, 1)],
  ['duration', (p, c) => NoteEditor.setValue(p, c, { type: 'eighth', dots: 0 }),
    (p, c) => Timeline.setFocusedTimelineNoteValue(p, c, { type: 'eighth', dots: 0 })],
  ['resize', (p, c) => NoteEditor.resize(p, c, 1), (p, c) => Timeline.resizeFocusedTimelineNote(p, c, 1)],
  ['dot', (p, c) => NoteEditor.toggleDot(p, c), (p, c) => Timeline.toggleFocusedTimelineNoteDot(p, c)],
];
// Rest spelling allocates fresh IDs on each edit; compare notation and note IDs.
const notation = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value, (_, item) => item?.kind === 'rest' ? { ...item, id: 'rest' } : item));

test('warm time edits visit a bounded number of voices at 20, 100 and 300 bars, including expressions', t => {
  for (const expressions of [false, true]) for (const [name, edit] of actions) {
    const counts = [];
    for (const count of [20, 100, 300]) {
      const { project, cursor } = fixture(count, expressions), saved = JSON.stringify(project);
      ScoreTimeline.prepare(project.outline);
      ScoreTimeline.note(project.outline, cursor.focusedNoteId);
      const flatten = ScoreVoice.flatten, locate = ScoreVoice.locate;
      let flattened = 0, located = 0, next;
      ScoreVoice.flatten = (...args) => { flattened++; return flatten(...args); };
      ScoreVoice.locate = (...args) => { located++; return locate(...args); };
      try { next = edit(project, cursor); }
      finally { ScoreVoice.flatten = flatten; ScoreVoice.locate = locate; }
      assert.ok(next, `${name} must succeed`);
      assert.ok(flattened <= 20, `${name}/${expressions}/${count} flattened ${flattened}`);
      assert.ok(located <= 10, `${name}/${expressions}/${count} located ${located}`);
      counts.push([flattened, located]);
      assert.equal(JSON.stringify(project), saved);
      assert.equal(next.project.outline[2], project.outline[2]);
      assert.equal(next.project.outline.at(-1), project.outline.at(-1));
    }
    assert.deepEqual(counts[0], counts[1]);
    assert.deepEqual(counts[1], counts[2]);
    t.diagnostic(`${name}, expressions=${expressions}: flatten/locate=${counts[0].join('/')} at all sizes`);
  }
});

test('cached time edits match full reconciliation, retain anchors and history, and remove only changed fermatas', () => {
  for (const [name, edit, rawEdit] of actions) {
    const { project, cursor } = fixture(4, true);
    const raw = rawEdit(project, cursor);
    assert.ok(raw, name);
    const expected = EditTransaction.commit(project, raw.project);
    ScoreTimeline.prepare(project.outline);
    ScoreTimeline.note(project.outline, cursor.focusedNoteId);
    const result = edit(project, cursor);
    assert.deepEqual(notation(result.project), notation(expected), name);
    assert.deepEqual(EditTransaction.commitTime(project, raw.project), expected, name);
    assert.equal(ScoreTimeline.note(result.project.outline, cursor.focusedNoteId).note.fermata, undefined);
    assert.deepEqual(ScoreTimeline.note(result.project.outline, 'upperStaff-0-0').note.fermata, { lengthRatio: 3 });
    assert.deepEqual(result.project.tempoChanges, project.tempoChanges);
    assert.deepEqual(result.project.dynamicChanges, project.dynamicChanges);
    assert.equal(result.project.outline[4].data.lowerStaff, project.outline[4].data.lowerStaff);
    const history = EditorHistory.create({ project });
    history.record({ project: result.project });
    assert.equal(history.undo().project, project);
    assert.equal(history.redo().project, result.project);
  }
});

test('local tie reconciliation agrees with the full pass when part of a chain is moved', () => {
  const { project } = fixture(3);
  const voice = project.outline[3].data.upperStaff.voices[0];
  const note = (id, extra) => ({ id, kind: 'note', value: { type: '16th', dots: 0 }, pitches: [{ midi: 72 }], ...extra });
  voice.elements = [note('a', { tieTo: 'b' }), note('b', { tieFrom: 'a', tieTo: 'c' }),
    note('c', { tieFrom: 'b', tieTo: 'd' }), note('d', { tieFrom: 'c' }), ...RestSpelling.create(4, 12)];
  // Moving only c and d breaks b->c, while a->b and c->d remain valid.
  ScoreTimeline.prepare(project.outline);
  const cursor = { ...createTimelineCursor(), focusedNoteId: 'd', selectionAnchorNoteId: 'c',
    focusedPitchIndex: null, positionSixteenths: 19 };
  const result = NoteEditor.move(project, cursor, 1);
  assert.ok(result);
  assert.deepEqual(result.project.outline, ScoreTies.reconcile(result.project.outline));
  const get = id => ScoreTimeline.note(result.project.outline, id).note;
  assert.equal(get('a').tieTo, 'b'); assert.equal(get('b').tieFrom, 'a');
  assert.equal(get('b').tieTo, undefined); assert.equal(get('c').tieFrom, undefined);
  assert.equal(get('c').tieTo, 'd'); assert.equal(get('d').tieFrom, 'c');
});

test('moving an entire tie across a barline retains reciprocal links and matches the uncached edit', () => {
  const { project } = fixture(4);
  project.outline[3].data.upperStaff.voices[0].elements = [...RestSpelling.create(0, 14),
    { id: 'head', kind: 'note', value: { type: 'eighth', dots: 0 }, pitches: [{ midi: 72 }], tieTo: 'tail' }];
  project.outline[4].data.upperStaff.voices[0].elements = [
    { id: 'tail', kind: 'note', value: { type: 'eighth', dots: 0 }, pitches: [{ midi: 72 }], tieFrom: 'head' },
    ...RestSpelling.create(2, 14)];
  const cursor = { ...createTimelineCursor(), placementValue: { type: 'eighth', dots: 0 },
    focusedNoteId: 'tail', focusedPitchIndex: 0, positionSixteenths: 32 };
  const expected = NoteEditor.move(project, cursor, 1);
  ScoreTimeline.prepare(project.outline);
  const result = NoteEditor.move(project, cursor, 1);
  assert.ok(result); assert.deepEqual(notation(result), notation(expected));
  assert.deepEqual(ScoreTimeline.tieChain(result.project.outline, 'head').map(e => e.note.id), ['head', 'tail']);
});

test('prepared expression lookup matches uncached results, including lower staff and deleted anchors', () => {
  const { project } = fixture(4, true);
  project.clefChanges.push({ noteId: 'lowerStaff-1-0', clef: 'treble' });
  project.tempoChanges.push({ noteId: 'missing', bpm: 120 }, { noteId: 'lowerStaff-1-0', bpm: 110 });
  project.slurs.push({ id: 'invalid', startNoteId: 'upperStaff-2-4', endNoteId: 'upperStaff-2-0' });
  for (const fn of [ScoreTempo.changes, ScoreClef.changes, ScoreDynamics.changes, ScoreSlur.reconcile,
    p => ScoreTrill.chain(p, 'upperStaff-2-0')]) {
    const draft = structuredClone(project), expected = fn(draft);
    ScoreTimeline.prepare(draft.outline);
    assert.deepEqual(fn(draft), expected);
  }
});

test('time commits fall back to full fermata handling when a preceding measure length changes', () => {
  const { project } = fixture(4, true), old = project.outline[2];
  const changed = { ...project, outline: project.outline.map(block => block === old ? { ...old,
    data: { ...old.data, length: { cnt: 3, unit: 4 } } } : block) };
  assert.deepEqual(EditTransaction.commitTime(project, changed), EditTransaction.commit(project, changed));
  const moved = { ...project, outline: [...project.outline.slice(0, 2), ...project.outline.slice(3), old] };
  assert.deepEqual(EditTransaction.commitTime(project, moved), EditTransaction.commit(project, moved));
  assert.equal(ScoreFermata.hasConflicts(project), false);
});

test('cached moves and durations still reject collisions, stationary notes and occupied tuplets atomically', () => {
  for (const [name, edit] of actions.slice(0, 3)) for (const obstruction of ['voice', 'staff', 'note', 'tuplet']) {
    const { project, cursor } = fixture(4), block = project.outline[4];
    const note = { id: 'obstacle', kind: 'note', value: { type: '16th', dots: 0 }, pitches: [{ midi: 72 }] };
    if (obstruction === 'voice') block.data.upperStaff.voices.push({ id: 'voice-1',
      elements: [...RestSpelling.create(0, 1), note, ...RestSpelling.create(2, 14)] });
    if (obstruction === 'staff') block.data.lowerStaff.voices[0].elements[1] = note;
    if (obstruction === 'note') block.data.upperStaff.voices[0].elements[1] = note;
    if (obstruction === 'tuplet') block.data.upperStaff.voices[0].elements.splice(1, 2,
      { id: 'triplet', kind: 'tuplet', actual: 3, normal: 2, baseType: '16th',
        elements: [0, 1, 2].map(i => ({ ...note, id: `tuplet-${i}` })) });
    const saved = JSON.stringify(project);
    assert.equal(edit(project, cursor), undefined, `uncached ${name}/${obstruction}`);
    ScoreTimeline.prepare(project.outline);
    assert.equal(edit(project, cursor), undefined, `cached ${name}/${obstruction}`);
    assert.equal(JSON.stringify(project), saved);
  }
});

test('cached tuplet edits and fractional fermata cleanup match full reconciliation', () => {
  const { project, cursor } = fixture(4, true), block = project.outline[4];
  block.data.upperStaff.voices[0].elements = [{ id: 'triplet', kind: 'tuplet', actual: 3, normal: 2, baseType: 'eighth',
    elements: [0, 1, 2].map(i => ({ id: `t${i}`, kind: 'note', value: { type: 'eighth', dots: 0 },
      pitches: [{ midi: 72 }], ...(i === 2 ? { fermata: { lengthRatio: 2 } } : {}) })) }, ...RestSpelling.create(4, 12)];
  const c = { ...cursor, focusedNoteId: 't1', positionSixteenths: 32 + 4 / 3 };
  for (const [name, edit, rawEdit] of actions.slice(0, 3)) {
    const draft = structuredClone(project), raw = rawEdit(draft, c);
    const expected = raw && EditTransaction.commit(draft, raw.project);
    ScoreTimeline.prepare(draft.outline);
    const result = edit(draft, c);
    assert.deepEqual(notation(result?.project), notation(expected), name);
    if (result) assert.equal(ScoreFermata.hasConflicts(result.project), false);
  }
});

test('range searches match exact half-open filtering around fractional notes, rests and barlines', () => {
  const { project } = fixture(4), block = project.outline[3];
  block.data.upperStaff.voices[0].elements = [{ id: 'triplet', kind: 'tuplet', actual: 3, normal: 2, baseType: 'eighth',
    elements: [0, 1, 2].map(i => ({ id: `t${i}`, kind: 'note', value: { type: 'eighth', dots: 0 }, pitches: [{ midi: 72 }] })) },
    ...RestSpelling.create(4, 12)];
  ScoreTimeline.prepare(project.outline);
  const notes = ScoreTimeline.notes(project.outline);
  for (const start of [-1, 0, 1, 3, 15, 16, 16 + 4 / 3, 20, 31, 32, 64]) {
    for (const length of [0, 1 / 3, 1, 4, 16]) {
      const end = MusicalTime.addNumbers(start, length);
      const expected = length === 0 ? [] : notes.filter(entry => {
        const onset = MusicalTime.addNumbers(entry.measureStartSixteenths, entry.positionSixteenths);
        return MusicalTime.compareNumbers(onset, end) < 0 &&
          MusicalTime.compareNumbers(MusicalTime.addNumbers(onset, entry.lengthSixteenths), start) > 0;
      });
      assert.deepEqual(ScoreTimeline.notesInRange(project.outline, 'upperStaff', 0, start, end), expected);
    }
  }
});
