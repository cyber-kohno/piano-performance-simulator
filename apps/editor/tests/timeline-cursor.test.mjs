import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createMeasureData, createProject, createRestElements, getLocatedVoiceElements,
  getElementSixteenths, getNoteValueSixteenths, reconcileOutlineTies,
} from '../src/model/project.ts';
import {
  addFocusedNotePitch, addTimelineNoteAt, createTimelineCursor,
  getLocatedTimelineNote, getLocatedTimelineNotes, moveFocusedTimelineNotePitch,
  moveTimelineCursorHorizontally, selectFocusedNotePitch, deleteFocusedTimelineNote,
  getDiatonicPitchClasses, moveTimelineCursorPitch, focusAdjacentTimelineNote,
  findTimelineNoteAtMove, isTimelinePlacementInvalid, getTimelineTieChain,
  setTimelineCursorUnit,
  setFocusedTimelineNoteValue, setFocusedTimelineNoteType, toggleFocusedTimelineNoteDot,
  moveFocusedTimelineNote,
  appendFocusedTimelineTie,
  resizeFocusedTimelineTie,
  getSelectedTimelineNotes, extendTimelineNoteSelection, collapseTimelineNoteSelection,
  transposeSelectedTimelineNotes,
  resetTimelineCursorForStaff, switchTimelineStaff, duplicateFocusedTimelineNoteAfter,
  toggleTieToAdjacentTimelineNote,
} from '../src/state/timeline-cursor.ts';
import { addMeasureAfterCursor, deleteOutlineBlock } from '../src/state/outline-cursor.ts';

function blankProject(count = 1, length = { cnt: 4, unit: 4 }) {
  const project = createProject();
  for (let i = 0; i < count; i += 1) {
    project.outline.push({ id: `measure-${i}`, type: 'measure', data: createMeasureData(length) });
  }
  return project;
}
const voiceOf = (project, index = 2) => project.outline[index].data.upperStaff.voices[0];
const singleNote = (midi = 60) => addTimelineNoteAt(blankProject(), createTimelineCursor(), 0, midi);
const pitchesOf = ({ project, cursor }) => getLocatedTimelineNote(project.outline, cursor.focusedNoteId).note.pitches;
function assertComplete(project) {
  const ids = new Set();
  for (const block of project.outline) {
    if (block.type !== 'measure') continue;
    for (const staff of [block.data.upperStaff, block.data.lowerStaff]) {
      for (const voice of staff.voices) {
        assert.equal(voice.elements.reduce((sum, element) => sum + getElementSixteenths(element, block.data.length), 0), block.data.length.cnt / block.data.length.unit * 16);
        for (const element of voice.elements) {
          assert.equal('positionSixteenths' in element, false);
          assert.equal('duration' in element, false);
          assert.equal(ids.has(element.id), false);
          ids.add(element.id);
        }
      }
    }
  }
}

test('range selection expands and shrinks around a fixed anchor across rests and measures', () => {
  const first = addTimelineNoteAt(blankProject(2), createTimelineCursor(), 0, 60);
  const second = addTimelineNoteAt(first.project, first.cursor, 8, 65);
  const third = addTimelineNoteAt(second.project, second.cursor, 20, 72);
  const before = structuredClone(third.project);
  let cursor = extendTimelineNoteSelection(third.project.outline, second.cursor, 1);
  assert.equal(cursor.selectionAnchorNoteId, second.cursor.focusedNoteId);
  assert.equal(cursor.focusedPitchIndex, null);
  assert.deepEqual(getSelectedTimelineNotes(third.project.outline, cursor).map(({ note }) => note.id),
    [second.cursor.focusedNoteId, third.cursor.focusedNoteId]);
  assert.equal(extendTimelineNoteSelection(third.project.outline, cursor, 1), cursor);
  cursor = extendTimelineNoteSelection(third.project.outline, cursor, -1);
  assert.equal(getSelectedTimelineNotes(third.project.outline, cursor).length, 1);
  assert.equal(cursor.focusedPitchIndex, 0);
  cursor = extendTimelineNoteSelection(third.project.outline, cursor, -1);
  assert.equal(cursor.selectionAnchorNoteId, second.cursor.focusedNoteId);
  assert.equal(cursor.focusedNoteId, first.cursor.focusedNoteId);
  assert.equal(getSelectedTimelineNotes(third.project.outline, cursor).length, 2);
  assert.equal(cursor.pitch, 60);
  assert.equal(extendTimelineNoteSelection(third.project.outline, cursor, -1), cursor);
  assert.deepEqual(third.project, before);
  const input = createTimelineCursor();
  assert.equal(extendTimelineNoteSelection(third.project.outline, input, 1), input);
});

test('staff note positions derive independently from each staff’s saved rest sequence', () => {
  const state = singleNote(65);
  const measure = state.project.outline[2];
  measure.data.lowerStaff.voices[0].elements = [
    { id: 'lower-rest-before', kind: 'rest', value: { type: 'quarter', dots: 0 } },
    { id: 'lower-note', kind: 'note', value: { type: 'quarter', dots: 0 }, pitches: [{ midi: 48 }] },
    { id: 'lower-rest-after', kind: 'rest', value: { type: 'half', dots: 0 } },
  ];
  const upper = getLocatedTimelineNotes(state.project.outline);
  const lower = getLocatedTimelineNotes(state.project.outline, 'lowerStaff');
  assert.equal(upper.length, 1);
  assert.equal(upper[0].note.pitches[0].midi, 65);
  assert.equal(upper[0].positionSixteenths, 0);
  assert.equal(lower.length, 1);
  assert.equal(lower[0].note.id, 'lower-note');
  assert.equal(lower[0].note.pitches[0].midi, 48);
  assert.equal(lower[0].positionSixteenths, 4);
  assertComplete(state.project);
});

test('staff switches retain cursor position and input value, resetting pitch and selection only', () => {
  const project = blankProject(2, { cnt: 3, unit: 4 });
  project.outline[0].data.timeSignature = { cnt: 6, unit: 8 };
  const cursor = {
    ...createTimelineCursor(), positionSixteenths: 19, pitch: 90,
    focusedNoteId: 'old-focus', selectionAnchorNoteId: 'old-anchor', focusedPitchIndex: 2,
  };
  const lower = switchTimelineStaff(project.outline, cursor);
  assert.equal(lower.staff, 'lowerStaff');
  assert.equal(lower.positionSixteenths, 19);
  assert.equal(lower.pitch, 48);
  assert.deepEqual(lower.placementValue, cursor.placementValue);
  assert.equal(lower.focusedNoteId, null);
  assert.equal(lower.focusedPitchIndex, null);
  assert.equal(lower.selectionAnchorNoteId, null);
  const upper = switchTimelineStaff(project.outline, { ...lower, positionSixteenths: 22, pitch: 21 });
  assert.equal(upper.staff, 'upperStaff');
  assert.equal(upper.pitch, 60);
  assert.equal(upper.positionSixteenths, 22);
  assert.deepEqual(upper.placementValue, cursor.placementValue);
  const reentered = resetTimelineCursorForStaff(project.outline, {
    ...lower, positionSixteenths: 19, placementValue: { type: 'eighth', dots: 0 },
  }, 'upperStaff');
  assert.equal(reentered.positionSixteenths, 12);
  assert.deepEqual(reentered.placementValue, { type: 'quarter', dots: 0 });
  assert.equal(reentered.staff, 'upperStaff');
  assert.equal(reentered.pitch, 60);
  assert.equal(reentered.focusedNoteId, null);
  assert.equal(switchTimelineStaff(blankProject(0).outline, createTimelineCursor()).pitch, 48);
});

test('staff switching from a focused note or range uses the endpoint onset and retains the input value', () => {
  const placed = addTimelineNoteAt(blankProject(2), createTimelineCursor(), 19, 72);
  const cursor = {
    ...placed.cursor, positionSixteenths: 23, voiceIndex: 2,
    placementValue: { type: 'eighth', dots: 0 }, selectionAnchorNoteId: placed.cursor.focusedNoteId,
  };
  const before = structuredClone(placed.project);
  const lower = switchTimelineStaff(placed.project.outline, cursor);
  assert.equal(lower.positionSixteenths, 19);
  assert.deepEqual(lower.placementValue, cursor.placementValue);
  assert.equal(lower.pitch, 48);
  assert.equal(lower.voiceIndex, 0);
  assert.equal(lower.focusedNoteId, null);
  assert.equal(lower.selectionAnchorNoteId, null);
  assert.deepEqual(placed.project, before);
  const upper = switchTimelineStaff(placed.project.outline, lower);
  assert.equal(upper.positionSixteenths, 19);
  assert.deepEqual(upper.placementValue, cursor.placementValue);
  assert.equal(upper.pitch, 60);
});

test('lower staff chord, value, tie, duplication, movement and deletion edits leave overlapping upper notes intact', () => {
  const upperFirst = addTimelineNoteAt(blankProject(), setTimelineCursorUnit(createTimelineCursor(), '3'), 0, 72);
  const upperSecond = addTimelineNoteAt(upperFirst.project, upperFirst.cursor, 8, 72);
  const before = structuredClone(upperSecond.project.outline[2].data.upperStaff);
  const lowerCursor = resetTimelineCursorForStaff(upperSecond.project.outline, upperSecond.cursor, 'lowerStaff');
  let state = addTimelineNoteAt(upperSecond.project, lowerCursor);
  assert.equal(state.cursor.staff, 'lowerStaff');
  assert.equal(getLocatedTimelineNotes(state.project.outline, 'lowerStaff')[0].note.pitches[0].midi, 48);
  state = addFocusedNotePitch(state.project, state.cursor);
  state = moveFocusedTimelineNotePitch(state.project, state.cursor, -1);
  state = appendFocusedTimelineTie(state.project, state.cursor);
  assert.equal(getTimelineTieChain(state.project.outline, state.cursor.focusedNoteId, 'lowerStaff').length, 2);
  state = setFocusedTimelineNoteType(state.project, state.cursor, '2');
  state = toggleFocusedTimelineNoteDot(state.project, state.cursor);
  assert.equal(getLocatedTimelineNote(state.project.outline, state.cursor.focusedNoteId, 'lowerStaff').note.value.dots, 1);
  state = resizeFocusedTimelineTie(state.project, setTimelineCursorUnit(state.cursor, '1'), 1);
  const sourceId = state.cursor.focusedNoteId;
  const source = getLocatedTimelineNote(state.project.outline, sourceId, 'lowerStaff');
  assert.deepEqual(source.note.value, { type: 'half', dots: 0 });
  state = duplicateFocusedTimelineNoteAfter(state.project, state.cursor);
  const duplicateId = state.cursor.focusedNoteId;
  assert.deepEqual(getLocatedTimelineNote(state.project.outline, duplicateId, 'lowerStaff').note.pitches, source.note.pitches);
  assert.equal(state.cursor.positionSixteenths, 8);
  const sourceCursor = { ...state.cursor, focusedNoteId: sourceId, positionSixteenths: 0 };
  const linked = toggleTieToAdjacentTimelineNote(state.project, sourceCursor);
  assert.equal(getLocatedTimelineNote(linked.outline, sourceId, 'lowerStaff').note.tieTo, duplicateId);
  state.project = toggleTieToAdjacentTimelineNote(linked, sourceCursor);
  state = moveFocusedTimelineNote(state.project, state.cursor, 1);
  assert.equal(state.cursor.positionSixteenths, 9);
  state = deleteFocusedTimelineNote(state.project, state.cursor, true);
  assert.equal(getLocatedTimelineNote(state.project.outline, duplicateId, 'lowerStaff').note.pitches.length, 1);
  const next = focusAdjacentTimelineNote(state.project.outline, state.cursor, -1);
  assert.equal(next.focusedNoteId, sourceId);
  assert.equal(findTimelineNoteAtMove(state.project.outline, {
    ...state.cursor, focusedNoteId: null, focusedPitchIndex: null, positionSixteenths: 0,
  }, 1).note.id, sourceId);
  state = deleteFocusedTimelineNote(state.project, state.cursor);
  assert.deepEqual(state.project.outline[2].data.upperStaff, before);
  assert.equal(getLocatedTimelineNotes(state.project.outline, 'lowerStaff').length, 1);
  assertComplete(state.project);
});

test('lower staff range selection, movement, transposition and bulk deletion never select or edit the upper staff', () => {
  const upper = addTimelineNoteAt(blankProject(), createTimelineCursor(), 0, 84);
  const before = structuredClone(upper.project.outline[2].data.upperStaff);
  const first = addTimelineNoteAt(upper.project, createTimelineCursor('lowerStaff'), 0, 48);
  const second = addTimelineNoteAt(first.project, first.cursor, 8, 55);
  const cursor = extendTimelineNoteSelection(second.project.outline, first.cursor, 1);
  assert.deepEqual(getSelectedTimelineNotes(second.project.outline, cursor).map(entry => entry.note.id),
    [first.cursor.focusedNoteId, second.cursor.focusedNoteId]);
  let state = moveFocusedTimelineNote(second.project, cursor, 1);
  assert.deepEqual(getLocatedTimelineNotes(state.project.outline, 'lowerStaff').map(entry => entry.positionSixteenths), [1, 9]);
  state = transposeSelectedTimelineNotes(state.project, state.cursor, 1);
  assert.deepEqual(getLocatedTimelineNotes(state.project.outline, 'lowerStaff').map(entry => entry.note.pitches[0].midi), [49, 56]);
  state = deleteFocusedTimelineNote(state.project, state.cursor);
  assert.equal(state.cursor.staff, 'lowerStaff');
  assert.equal(getLocatedTimelineNotes(state.project.outline, 'lowerStaff').length, 0);
  assert.deepEqual(state.project.outline[2].data.upperStaff, before);
  assertComplete(state.project);
});

test('range collapse picks the requested edge and ordinary note navigation clears the range even at the score end', () => {
  const first = singleNote();
  const second = addTimelineNoteAt(first.project, first.cursor, 8, 72);
  const range = extendTimelineNoteSelection(second.project.outline, first.cursor, 1);
  for (const direction of [-1, 1]) {
    const cursor = collapseTimelineNoteSelection(second.project.outline, range, direction);
    assert.equal(cursor.focusedNoteId, direction === -1 ? first.cursor.focusedNoteId : second.cursor.focusedNoteId);
    assert.equal(cursor.selectionAnchorNoteId, null);
    assert.equal(getSelectedTimelineNotes(second.project.outline, cursor).length, 1);
  }
  const atEnd = focusAdjacentTimelineNote(second.project.outline, range, 1);
  assert.equal(atEnd.focusedNoteId, second.cursor.focusedNoteId);
  assert.equal(atEnd.selectionAnchorNoteId, null);
  assert.equal(atEnd.focusedPitchIndex, 0);
});

test('range transposition moves every chord pitch exactly one semitone and preserves all intervals and editing state', () => {
  for (const direction of [-1, 1]) {
    const first = singleNote(65);
    pitchesOf(first).push({ midi: 60, fingering: 1 });
    const second = addTimelineNoteAt(first.project, first.cursor, 8, 74);
    pitchesOf(second).push({ midi: 67, fingering: 5 });
    const other = addTimelineNoteAt(second.project, second.cursor, 12, 80);
    const cursor = extendTimelineNoteSelection(other.project.outline, first.cursor, 1);
    const before = structuredClone(other.project);
    const moved = transposeSelectedTimelineNotes(other.project, cursor, direction);
    for (const id of [first.cursor.focusedNoteId, second.cursor.focusedNoteId]) {
      const original = getLocatedTimelineNote(other.project.outline, id);
      const updated = getLocatedTimelineNote(moved.project.outline, id);
      assert.deepEqual(updated.note, {
        ...original.note,
        pitches: original.note.pitches.map(pitch => ({ ...pitch, midi: pitch.midi + direction })),
      });
      assert.equal(updated.positionSixteenths, original.positionSixteenths);
    }
    assert.deepEqual(getLocatedTimelineNote(moved.project.outline, other.cursor.focusedNoteId).note,
      getLocatedTimelineNote(other.project.outline, other.cursor.focusedNoteId).note);
    assert.equal(moved.cursor.focusedPitchIndex, null);
    assert.equal(moved.cursor.pitch, 74 + direction);
    assert.equal(moved.cursor.selectionAnchorNoteId, cursor.selectionAnchorNoteId);
    assert.deepEqual(moved.cursor.placementValue, cursor.placementValue);
    assert.deepEqual(other.project, before);
    assertComplete(moved.project);
  }
});

test('range transposition rejects every edit if any pitch would exceed either piano bound', () => {
  for (const direction of [-1, 1]) {
    const first = singleNote(direction === 1 ? 108 : 25);
    if (direction === -1) pitchesOf(first).push({ midi: 21 });
    const second = addTimelineNoteAt(first.project, first.cursor, 8, 60);
    const cursor = extendTimelineNoteSelection(second.project.outline, first.cursor, 1);
    const before = structuredClone(second.project);
    assert.equal(transposeSelectedTimelineNotes(second.project, cursor, direction), undefined);
    assert.deepEqual(second.project, before);
    assert.ok(transposeSelectedTimelineNotes(second.project, cursor, -direction));
  }
  const single = singleNote();
  assert.equal(transposeSelectedTimelineNotes(single.project, single.cursor, 1), undefined);
  assert.equal(transposeSelectedTimelineNotes(single.project, createTimelineCursor(), 1), undefined);
});

test('range transposition preserves internal ties and removes mismatched ties outside the selection', () => {
  const first = singleNote();
  const second = appendFocusedTimelineTie(first.project, first.cursor);
  const third = appendFocusedTimelineTie(second.project, second.cursor);
  const cursor = extendTimelineNoteSelection(third.project.outline, second.cursor, 1);
  const moved = transposeSelectedTimelineNotes(third.project, cursor, 1);
  const notes = getLocatedTimelineNotes(moved.project.outline).map(entry => entry.note);
  assert.deepEqual(notes.map(note => note.pitches[0].midi), [60, 61, 61]);
  assert.equal(notes[0].tieTo, undefined);
  assert.equal(notes[1].tieFrom, undefined);
  assert.equal(notes[1].tieTo, notes[2].id);
  assert.equal(notes[2].tieFrom, notes[1].id);
  assertComplete(moved.project);
});

test('moving a range preserves spacing, identity, chord fingering and range endpoints', () => {
  const first = addTimelineNoteAt(blankProject(2), createTimelineCursor(), 1, 65);
  const chord = addFocusedNotePitch(first.project, first.cursor);
  pitchesOf(chord)[1].fingering = 5;
  const second = addTimelineNoteAt(chord.project, chord.cursor, 4, 72);
  const other = addTimelineNoteAt(second.project, second.cursor, 10, 80);
  const cursor = extendTimelineNoteSelection(other.project.outline, chord.cursor, 1);
  const before = structuredClone(other.project);
  const moved = moveFocusedTimelineNote(other.project, cursor, 1);
  assert.deepEqual(getLocatedTimelineNotes(moved.project.outline).map(entry => entry.positionSixteenths), [2, 5, 10]);
  assert.equal(moved.cursor.selectionAnchorNoteId, chord.cursor.focusedNoteId);
  assert.equal(moved.cursor.focusedNoteId, second.cursor.focusedNoteId);
  assert.equal(moved.cursor.positionSixteenths, 5);
  assert.equal(getSelectedTimelineNotes(moved.project.outline, moved.cursor).length, 2);
  assert.deepEqual(getLocatedTimelineNote(moved.project.outline, chord.cursor.focusedNoteId).note,
    getLocatedTimelineNote(other.project.outline, chord.cursor.focusedNoteId).note);
  assert.deepEqual(other.project, before);
  const reversed = moveFocusedTimelineNote(moved.project, moved.cursor, -1);
  assert.deepEqual(getLocatedTimelineNotes(reversed.project.outline).map(entry => entry.positionSixteenths), [1, 4, 10]);
  assertComplete(moved.project);
  assertComplete(reversed.project);
});

test('range movement rejects all edits on any collision, score overflow or individual bar crossing', () => {
  const first = singleNote();
  const second = addTimelineNoteAt(first.project, first.cursor, 4, 72);
  const other = addTimelineNoteAt(second.project, second.cursor, 5, 80);
  const range = extendTimelineNoteSelection(other.project.outline, first.cursor, 1);
  const before = structuredClone(other.project);
  assert.equal(moveFocusedTimelineNote(other.project, range, 1), undefined);
  assert.equal(moveFocusedTimelineNote(other.project, range, -1), undefined);
  assert.deepEqual(other.project, before);
  const tail = addTimelineNoteAt(blankProject(), createTimelineCursor(), 14);
  const end = addTimelineNoteAt(tail.project, tail.cursor, 15);
  assert.equal(moveFocusedTimelineNote(end.project, extendTimelineNoteSelection(end.project.outline, tail.cursor, 1), 1), undefined);
  const eighth = setTimelineCursorUnit(createTimelineCursor(), '2');
  const early = addTimelineNoteAt(blankProject(2), eighth, 0);
  const late = addTimelineNoteAt(early.project, eighth, 13);
  assert.equal(moveFocusedTimelineNote(late.project, extendTimelineNoteSelection(late.project.outline, early.cursor, 1), 1), undefined);
});

test('adjacent selected notes can move into each other’s old positions and across a bar', () => {
  const first = addTimelineNoteAt(blankProject(2), createTimelineCursor(), 15);
  const second = addTimelineNoteAt(first.project, first.cursor, 16);
  const range = extendTimelineNoteSelection(second.project.outline, first.cursor, 1);
  const moved = moveFocusedTimelineNote(second.project, range, 1);
  assert.deepEqual(getLocatedTimelineNotes(moved.project.outline).map(entry => entry.measureStartSixteenths + entry.positionSixteenths), [16, 17]);
  assert.equal(getSelectedTimelineNotes(moved.project.outline, moved.cursor).length, 2);
  assertComplete(moved.project);
});

test('range movement preserves internal ties and detaches only ties to notes left outside the selection', () => {
  const first = singleNote();
  const second = appendFocusedTimelineTie(first.project, first.cursor);
  const third = appendFocusedTimelineTie(second.project, second.cursor);
  const cursor = extendTimelineNoteSelection(third.project.outline, second.cursor, 1);
  const moved = moveFocusedTimelineNote(third.project, cursor, 1);
  const notes = getLocatedTimelineNotes(moved.project.outline).map(entry => entry.note);
  assert.equal(notes[0].tieTo, undefined);
  assert.equal(notes[1].tieFrom, undefined);
  assert.equal(notes[1].tieTo, notes[2].id);
  assert.equal(notes[2].tieFrom, notes[1].id);
  assert.deepEqual(getLocatedTimelineNotes(moved.project.outline).map(entry => entry.positionSixteenths), [0, 2, 3]);
  assertComplete(moved.project);
});

test('bulk deletion replaces only selected notes with equal rests, preserves later onsets and clears selection', () => {
  const first = singleNote();
  const second = appendFocusedTimelineTie(first.project, first.cursor);
  const third = appendFocusedTimelineTie(second.project, second.cursor);
  const later = addTimelineNoteAt(third.project, third.cursor, 8, 80);
  const range = extendTimelineNoteSelection(later.project.outline, second.cursor, 1);
  const before = structuredClone(later.project);
  const deleted = deleteFocusedTimelineNote(later.project, range);
  assert.deepEqual(getLocatedTimelineNotes(deleted.project.outline).map(entry => entry.positionSixteenths), [0, 8]);
  assert.equal(getLocatedTimelineNote(deleted.project.outline, first.cursor.focusedNoteId).note.tieTo, undefined);
  assert.equal(deleted.cursor.focusedNoteId, null);
  assert.equal(deleted.cursor.selectionAnchorNoteId, null);
  assert.equal(deleted.cursor.positionSixteenths, 1);
  assert.deepEqual(later.project, before);
  assert.ok(addTimelineNoteAt(deleted.project, deleted.cursor));
  assert.equal(deleteFocusedTimelineNote(later.project, range, true), undefined);
  assertComplete(deleted.project);
});

test('new measures fill both staves with full-measure rests using actual length', () => {
  for (const length of [{ cnt: 4, unit: 4 }, { cnt: 3, unit: 4 }, { cnt: 1, unit: 4 }, { cnt: 6, unit: 8 }]) {
    const project = blankProject(2, length);
    assertComplete(project);
    assert.equal(voiceOf(project).elements[0].kind, 'measure-rest');
    assert.equal('value' in voiceOf(project).elements[0], false);
  }
});

test('placement splits only its rest into the agreed sixteenth/note/eighth/quarter/half sequence', () => {
  const project = blankProject();
  const snapshot = structuredClone(project);
  const state = addTimelineNoteAt(project, createTimelineCursor(), 1);
  assert.deepEqual(voiceOf(state.project).elements.map((element) => [element.kind, element.value.type, element.value.dots]), [
    ['rest', '16th', 0], ['note', '16th', 0], ['rest', 'eighth', 0], ['rest', 'quarter', 0], ['rest', 'half', 0],
  ]);
  assert.equal(getLocatedTimelineNote(state.project.outline, state.cursor.focusedNoteId).positionSixteenths, 1);
  assert.equal(state.cursor.positionSixteenths, 1);
  assert.equal(state.cursor.focusedPitchIndex, 0);
  assert.equal('operationUnit' in state.cursor, false);
  assertComplete(state.project);
  assert.deepEqual(project, snapshot);
});

test('rest spelling and other note onsets outside the replaced element are preserved', () => {
  const project = blankProject();
  voiceOf(project).elements = [
    { id: 'manual-1', kind: 'rest', value: { type: '16th', dots: 0 } },
    { id: 'manual-2', kind: 'rest', value: { type: '16th', dots: 0 } },
    { id: 'manual-3', kind: 'rest', value: { type: 'eighth', dots: 0 } },
    ...createRestElements(4, 12),
  ];
  const untouched = voiceOf(project).elements.slice(0, 3);
  const later = addTimelineNoteAt(project, createTimelineCursor(), 10, 72);
  const state = addTimelineNoteAt(later.project, later.cursor, 5, 60);
  assert.deepEqual(voiceOf(state.project).elements.slice(0, 3), untouched);
  assert.equal(getLocatedTimelineNote(state.project.outline, later.cursor.focusedNoteId).positionSixteenths, 10);
  const deleted = deleteFocusedTimelineNote(state.project, state.cursor);
  assert.deepEqual(voiceOf(deleted.project).elements.slice(0, 3), untouched);
  assert.equal(getLocatedTimelineNote(deleted.project.outline, later.cursor.focusedNoteId).positionSixteenths, 10);
  assertComplete(deleted.project);
});

test('every cell can be placed and deleted while all voices stay complete', () => {
  for (const length of [{ cnt: 4, unit: 4 }, { cnt: 3, unit: 4 }, { cnt: 1, unit: 4 }]) {
    let project = blankProject(1, length);
    const total = length.cnt / length.unit * 16;
    const noteIds = [];
    for (let position = 0; position < total; position += 1) {
      const state = addTimelineNoteAt(project, createTimelineCursor(), position);
      assert.ok(state);
      project = state.project;
      noteIds.push(state.cursor.focusedNoteId);
      assertComplete(project);
      assert.deepEqual(getLocatedTimelineNotes(project.outline).map((entry) => entry.positionSixteenths), Array.from({ length: position + 1 }, (_, i) => i));
    }
    for (const id of noteIds.reverse()) {
      project = deleteFocusedTimelineNote(project, { ...createTimelineCursor(), focusedNoteId: id, focusedPitchIndex: 0 }).project;
      assertComplete(project);
    }
    assert.equal(getLocatedTimelineNotes(project.outline).length, 0);
  }
});

test('overlap, off-grid positions, outside the score and invalid pitches reject without editing', () => {
  const state = singleNote();
  const before = structuredClone(state.project);
  for (const position of [-1, 0, 0.5, 16, 32]) assert.equal(addTimelineNoteAt(state.project, state.cursor, position), undefined);
  for (const pitch of [20, 109, 60.5]) assert.equal(addTimelineNoteAt(state.project, state.cursor, 1, pitch), undefined);
  assert.equal(isTimelinePlacementInvalid(state.project.outline, createTimelineCursor()), true);
  assert.equal(isTimelinePlacementInvalid(state.project.outline, { ...createTimelineCursor(), positionSixteenths: 1 }), false);
  assert.equal(isTimelinePlacementInvalid(state.project.outline, state.cursor), false);
  assert.deepEqual(state.project, before);
});

test('positions and lengths derive from written values, including a quarter at a sixteenth offset', () => {
  const project = blankProject();
  voiceOf(project).elements = [
    ...createRestElements(0, 1),
    { id: 'quarter', kind: 'note', value: { type: 'quarter', dots: 0 }, pitches: [{ midi: 60 }] },
    ...createRestElements(5, 11),
  ];
  assert.equal(getNoteValueSixteenths({ type: 'eighth', dots: 1 }), 3);
  assert.equal(getLocatedTimelineNote(project.outline, 'quarter').positionSixteenths, 1);
  assert.equal(getLocatedVoiceElements(voiceOf(project), project.outline[2].data.length)[1].lengthSixteenths, 4);
  const cursor = moveTimelineCursorHorizontally(createTimelineCursor(), project.outline, 1);
  assert.equal(cursor.positionSixteenths, 1);
  assert.equal(findTimelineNoteAtMove(project.outline, cursor, 1).note.id, 'quarter');
  assertComplete(project);
});

test('cursor movement is always one sixteenth across measures and stops at score boundaries', () => {
  const project = blankProject(2);
  let cursor = createTimelineCursor();
  assert.equal(moveTimelineCursorHorizontally(cursor, project.outline, -1), cursor);
  for (let i = 0; i < 31; i += 1) cursor = moveTimelineCursorHorizontally(cursor, project.outline, 1);
  assert.equal(cursor.positionSixteenths, 31);
  assert.equal(moveTimelineCursorHorizontally(cursor, project.outline, 1), cursor);
  cursor = moveTimelineCursorHorizontally({ ...cursor, focusedNoteId: 'old', focusedPitchIndex: 0 }, project.outline, -1);
  assert.equal(cursor.positionSixteenths, 30);
  assert.equal(cursor.focusedNoteId, null);
  assert.equal(cursor.focusedPitchIndex, null);
});

test('number keys select cursor movement and placement values without moving its position', () => {
  const project = blankProject(2);
  let cursor = { ...createTimelineCursor(), positionSixteenths: 1 };
  const expected = [['1', '16th', 1], ['2', 'eighth', 2], ['3', 'quarter', 4]];
  for (const [key, type, step] of expected) {
    cursor = setTimelineCursorUnit(cursor, key);
    assert.equal(cursor.positionSixteenths, 1);
    assert.deepEqual(cursor.placementValue, { type, dots: 0 });
    assert.equal(moveTimelineCursorHorizontally(cursor, project.outline, 1).positionSixteenths, 1 + step);
    const placed = addTimelineNoteAt(project, cursor);
    assert.deepEqual(getLocatedTimelineNote(placed.project.outline, placed.cursor.focusedNoteId).note.value, { type, dots: 0 });
    assertComplete(placed.project);
  }
  assert.equal(setTimelineCursorUnit(cursor, '9'), cursor);
  assert.equal(setTimelineCursorUnit(cursor, '3'), cursor);
  const state = singleNote();
  const changed = setTimelineCursorUnit(state.cursor, '3');
  assert.equal(changed.focusedNoteId, state.cursor.focusedNoteId);
  assert.deepEqual(getLocatedTimelineNote(state.project.outline, changed.focusedNoteId).note.value, { type: '16th', dots: 0 });
});

test('quarter placement consumes several rests but retains untouched spelling and later note onsets', () => {
  const project = blankProject();
  const originalRests = [
    { id: 'keep-before', kind: 'rest', value: { type: '16th', dots: 0 } },
    { id: 'consume-1', kind: 'rest', value: { type: '16th', dots: 0 } },
    { id: 'consume-2', kind: 'rest', value: { type: 'eighth', dots: 0 } },
    { id: 'consume-3', kind: 'rest', value: { type: 'quarter', dots: 0 } },
    { id: 'keep-after', kind: 'rest', value: { type: 'half', dots: 0 } },
  ];
  voiceOf(project).elements = originalRests;
  const cursor = setTimelineCursorUnit({ ...createTimelineCursor(), positionSixteenths: 1 }, '3');
  const snapshot = structuredClone(project);
  const state = addTimelineNoteAt(project, cursor);
  assert.deepEqual(voiceOf(state.project).elements[0], originalRests[0]);
  assert.deepEqual(voiceOf(state.project).elements.at(-1), originalRests.at(-1));
  assert.deepEqual(voiceOf(state.project).elements.map((element) => [element.kind, element.value.type]), [
    ['rest', '16th'], ['note', 'quarter'], ['rest', '16th'], ['rest', 'eighth'], ['rest', 'half'],
  ]);
  assertComplete(state.project);
  const deleted = deleteFocusedTimelineNote(state.project, state.cursor);
  assert.equal(voiceOf(deleted.project).elements[1].value.type, 'quarter');
  assert.ok(addTimelineNoteAt(deleted.project, deleted.cursor));
  assertComplete(deleted.project);
  assert.deepEqual(project, snapshot);
});

test('cursor-sized placement rejects notes inside its span and never crosses a measure boundary', () => {
  const initial = addTimelineNoteAt(blankProject(2), createTimelineCursor(), 3);
  const cursor = setTimelineCursorUnit(createTimelineCursor(), '3');
  assert.equal(isTimelinePlacementInvalid(initial.project.outline, cursor), true);
  assert.equal(addTimelineNoteAt(initial.project, cursor), undefined);
  assert.equal(findTimelineNoteAtMove(initial.project.outline, cursor, 1).note.id, initial.cursor.focusedNoteId);
  assert.equal(addTimelineNoteAt(initial.project, { ...cursor, positionSixteenths: 14 }), undefined);
  assert.equal(isTimelinePlacementInvalid(initial.project.outline, { ...cursor, positionSixteenths: 14 }), true);
  assert.ok(addTimelineNoteAt(initial.project, { ...cursor, positionSixteenths: 12 }));
  assert.ok(addTimelineNoteAt(initial.project, { ...setTimelineCursorUnit(cursor, '2'), positionSixteenths: 14 }));
  assertComplete(initial.project);
});

test('written-value changes consume or restore rests while retaining note identity, chord and input unit', () => {
  const initial = singleNote();
  pitchesOf(initial)[0].fingering = 1;
  const chord = addFocusedNotePitch(initial.project, initial.cursor);
  const cursor = setTimelineCursorUnit(chord.cursor, '2');
  const before = structuredClone(chord.project);
  const enlarged = setFocusedTimelineNoteType(chord.project, cursor, '3');
  const selected = getLocatedTimelineNote(enlarged.project.outline, cursor.focusedNoteId);
  assert.deepEqual(selected.note.value, { type: 'quarter', dots: 0 });
  assert.equal(selected.positionSixteenths, 0);
  assert.deepEqual(selected.note.pitches, pitchesOf(chord));
  assert.deepEqual(enlarged.cursor, cursor);
  const shortened = setFocusedTimelineNoteType(enlarged.project, enlarged.cursor, '1');
  assert.deepEqual(getLocatedTimelineNote(shortened.project.outline, cursor.focusedNoteId).note.value, { type: '16th', dots: 0 });
  assert.deepEqual(voiceOf(shortened.project).elements.slice(1, 3).map((element) => [element.kind, element.value.type]), [['rest', '16th'], ['rest', 'eighth']]);
  assertComplete(enlarged.project);
  assertComplete(shortened.project);
  assert.deepEqual(chord.project, before);
});

test('dot toggling edits the written value and preserves input settings; dotted thirty-seconds remain rejected', () => {
  const initial = singleNote();
  const dottedSixteenth = toggleFocusedTimelineNoteDot(initial.project, initial.cursor);
  assert.deepEqual(getLocatedTimelineNote(dottedSixteenth.project.outline, initial.cursor.focusedNoteId).note.value, { type: '16th', dots: 1 });
  const thirtySecond = setFocusedTimelineNoteType(initial.project, initial.cursor, '4');
  assert.equal(toggleFocusedTimelineNoteDot(thirtySecond.project, thirtySecond.cursor), undefined);
  const eighth = setFocusedTimelineNoteType(initial.project, initial.cursor, '2');
  const dotted = toggleFocusedTimelineNoteDot(eighth.project, eighth.cursor);
  assert.deepEqual(getLocatedTimelineNote(dotted.project.outline, dotted.cursor.focusedNoteId).note.value, { type: 'eighth', dots: 1 });
  assert.deepEqual(dotted.cursor.placementValue, { type: '16th', dots: 0 });
  assert.equal(setFocusedTimelineNoteType(dotted.project, dotted.cursor, '2'), undefined);
  const sixteenth = setFocusedTimelineNoteType(dotted.project, dotted.cursor, '1');
  assert.deepEqual(getLocatedTimelineNote(sixteenth.project.outline, sixteenth.cursor.focusedNoteId).note.value, { type: '16th', dots: 0 });
  const quarter = setFocusedTimelineNoteType(dotted.project, dotted.cursor, '3');
  assert.deepEqual(getLocatedTimelineNote(quarter.project.outline, quarter.cursor.focusedNoteId).note.value, { type: 'quarter', dots: 0 });
  const dottedQuarter = toggleFocusedTimelineNoteDot(quarter.project, quarter.cursor);
  const backToEighth = setFocusedTimelineNoteType(dottedQuarter.project, dottedQuarter.cursor, '2');
  assert.deepEqual(getLocatedTimelineNote(backToEighth.project.outline, backToEighth.cursor.focusedNoteId).note.value, { type: 'eighth', dots: 0 });
  const undotted = toggleFocusedTimelineNoteDot(dottedQuarter.project, dottedQuarter.cursor);
  assert.deepEqual(getLocatedTimelineNote(undotted.project.outline, undotted.cursor.focusedNoteId).note.value, { type: 'quarter', dots: 0 });
  assertComplete(dotted.project);
  assertComplete(quarter.project);
  assertComplete(undotted.project);
});

test('note value edits allow offbeat notation, preserve unrelated onsets and reject collisions and bar overflow', () => {
  const initial = addTimelineNoteAt(blankProject(2), createTimelineCursor(), 1);
  const later = addTimelineNoteAt(initial.project, initial.cursor, 7, 72);
  const enlarged = setFocusedTimelineNoteType(later.project, initial.cursor, '3');
  assert.equal(getLocatedTimelineNote(enlarged.project.outline, initial.cursor.focusedNoteId).positionSixteenths, 1);
  assert.equal(getLocatedTimelineNote(enlarged.project.outline, later.cursor.focusedNoteId).positionSixteenths, 7);
  const dotted = toggleFocusedTimelineNoteDot(enlarged.project, enlarged.cursor);
  assert.ok(dotted); // Ending at the next note's onset is allowed.
  assert.equal(setFocusedTimelineNoteValue(dotted.project, dotted.cursor, { type: 'half', dots: 0 }), undefined);
  const last = addTimelineNoteAt(later.project, later.cursor, 14);
  assert.equal(setFocusedTimelineNoteType(last.project, last.cursor, '3'), undefined);
  const end = setFocusedTimelineNoteType(last.project, last.cursor, '2');
  assert.ok(end);
  assert.equal(toggleFocusedTimelineNoteDot(end.project, end.cursor), undefined);
  assertComplete(dotted.project);
  assertComplete(end.project);
});

test('editing a middle tied segment moves its successors only, keeping every voice complete', () => {
  const project = blankProject();
  voiceOf(project).elements = [
    { id: 'h', kind: 'note', value: { type: 'eighth', dots: 0 }, pitches: [{ midi: 60 }], tieTo: 'm' },
    { id: 'm', kind: 'note', value: { type: 'eighth', dots: 0 }, pitches: [{ midi: 60 }], tieFrom: 'h', tieTo: 't' },
    { id: 't', kind: 'note', value: { type: 'eighth', dots: 0 }, pitches: [{ midi: 60 }], tieFrom: 'm' },
    ...createRestElements(6, 6),
    { id: 'other', kind: 'note', value: { type: '16th', dots: 0 }, pitches: [{ midi: 72 }] },
    ...createRestElements(13, 3),
  ];
  const cursor = { ...createTimelineCursor(), positionSixteenths: 2, focusedNoteId: 'm', focusedPitchIndex: 0 };
  const enlarged = setFocusedTimelineNoteType(project, cursor, '3');
  assert.deepEqual(getTimelineTieChain(enlarged.project.outline, 'm').map((entry) => [entry.note.id, entry.positionSixteenths]), [['h', 0], ['m', 2], ['t', 6]]);
  assert.equal(enlarged.cursor.focusedNoteId, 'm');
  const shortened = setFocusedTimelineNoteType(enlarged.project, enlarged.cursor, '1');
  assert.deepEqual(getTimelineTieChain(shortened.project.outline, 'm').map((entry) => [entry.note.id, entry.positionSixteenths]), [['h', 0], ['m', 2], ['t', 3]]);
  assert.equal(getLocatedTimelineNote(shortened.project.outline, 'other').positionSixteenths, 12);
  assert.equal(getTimelineTieChain(reconcileOutlineTies(shortened.project.outline), 'm').length, 3);
  const blocked = addTimelineNoteAt(project, createTimelineCursor(), 8, 72);
  const before = structuredClone(blocked.project);
  assert.equal(setFocusedTimelineNoteValue(blocked.project, cursor, { type: 'quarter', dots: 1 }), undefined);
  assert.deepEqual(blocked.project, before);
  assertComplete(enlarged.project);
  assertComplete(shortened.project);
});

test('tied successors may move to an existing measure only when each explicit note still fits', () => {
  const project = blankProject(2);
  voiceOf(project).elements = [
    ...createRestElements(0, 8),
    { id: 'h', kind: 'note', value: { type: 'quarter', dots: 0 }, pitches: [{ midi: 60 }], tieTo: 't' },
    { id: 't', kind: 'note', value: { type: 'quarter', dots: 0 }, pitches: [{ midi: 60 }], tieFrom: 'h' },
  ];
  const cursor = { ...createTimelineCursor(), positionSixteenths: 8, focusedNoteId: 'h', focusedPitchIndex: 0 };
  const before = structuredClone(project);
  const moved = setFocusedTimelineNoteValue(project, cursor, { type: 'half', dots: 0 });
  const tail = getLocatedTimelineNote(moved.project.outline, 't');
  assert.equal(tail.measure.id, 'measure-1');
  assert.equal(tail.positionSixteenths, 0);
  assert.equal(getTimelineTieChain(reconcileOutlineTies(moved.project.outline), 'h').length, 2);
  // The selected dotted quarter fits, but moves its quarter successor to offset 14.
  assert.equal(setFocusedTimelineNoteValue(project, cursor, { type: 'quarter', dots: 1 }), undefined);
  assertComplete(moved.project);
  assert.deepEqual(project, before);
});

test('value edits with missing selection, invalid dots or unchanged value do nothing', () => {
  const state = singleNote();
  assert.equal(setFocusedTimelineNoteType(state.project, createTimelineCursor(), '3'), undefined);
  assert.equal(toggleFocusedTimelineNoteDot(state.project, createTimelineCursor()), undefined);
  assert.equal(setFocusedTimelineNoteType(state.project, state.cursor, '9'), undefined);
  assert.equal(setFocusedTimelineNoteType(state.project, state.cursor, '1'), undefined);
  for (const dots of [-1, 0.5, Infinity]) assert.equal(setFocusedTimelineNoteValue(state.project, state.cursor, { type: 'quarter', dots }), undefined);
});

test('D movement uses the input unit and retains chord spelling, identity, fingering and pitch focus', () => {
  const initial = singleNote();
  pitchesOf(initial)[0].fingering = 1;
  const state = addFocusedNotePitch(initial.project, initial.cursor);
  const cursor = setTimelineCursorUnit(state.cursor, '2');
  const before = structuredClone(state.project);
  const moved = moveFocusedTimelineNote(state.project, cursor, 1);
  assert.equal(moved.cursor.positionSixteenths, 2);
  assert.equal(moved.cursor.focusedNoteId, cursor.focusedNoteId);
  assert.equal(moved.cursor.focusedPitchIndex, cursor.focusedPitchIndex);
  assert.equal(moved.cursor.pitch, cursor.pitch);
  assert.deepEqual(moved.cursor.placementValue, cursor.placementValue);
  assert.deepEqual(getLocatedTimelineNote(moved.project.outline, cursor.focusedNoteId).note, getLocatedTimelineNote(state.project.outline, cursor.focusedNoteId).note);
  const returned = moveFocusedTimelineNote(moved.project, moved.cursor, -1);
  assert.equal(returned.cursor.positionSixteenths, 0);
  assert.equal(moveFocusedTimelineNote(returned.project, returned.cursor, -1), undefined);
  assertComplete(moved.project);
  assertComplete(returned.project);
  assert.deepEqual(state.project, before);
});

test('moving over a note into an empty destination preserves the intervening note and rest spelling', () => {
  const first = singleNote();
  const other = addTimelineNoteAt(first.project, first.cursor, 2, 72);
  const gap = getLocatedVoiceElements(voiceOf(other.project), other.project.outline[2].data.length)
    .filter((entry) => entry.positionSixteenths >= 1 && entry.positionSixteenths + entry.lengthSixteenths <= 4).map((entry) => entry.element);
  const moved = moveFocusedTimelineNote(other.project, setTimelineCursorUnit(first.cursor, '3'), 1);
  assert.equal(moved.cursor.positionSixteenths, 4);
  assert.equal(getLocatedTimelineNote(moved.project.outline, other.cursor.focusedNoteId).positionSixteenths, 2);
  const afterGap = getLocatedVoiceElements(voiceOf(moved.project), moved.project.outline[2].data.length)
    .filter((entry) => entry.positionSixteenths >= 1 && entry.positionSixteenths + entry.lengthSixteenths <= 4).map((entry) => entry.element);
  assert.deepEqual(afterGap, gap);
  assertComplete(moved.project);
});

test('movement permits touching another note but rejects overlapping destinations without edits', () => {
  const first = addTimelineNoteAt(blankProject(), setTimelineCursorUnit(createTimelineCursor(), '3'));
  const other = addTimelineNoteAt(first.project, createTimelineCursor(), 6, 72);
  const moved = moveFocusedTimelineNote(other.project, setTimelineCursorUnit(first.cursor, '2'), 1);
  assert.equal(moved.cursor.positionSixteenths, 2);
  const before = structuredClone(moved);
  assert.equal(moveFocusedTimelineNote(moved.project, moved.cursor, 1), undefined);
  assert.deepEqual(moved, before);
  assertComplete(moved.project);
});

test('notes transfer between existing measures only when their unchanged written value fits', () => {
  const first = addTimelineNoteAt(blankProject(2), setTimelineCursorUnit(createTimelineCursor(), '3'), 12);
  assert.equal(moveFocusedTimelineNote(first.project, setTimelineCursorUnit(first.cursor, '1'), 1), undefined);
  const moved = moveFocusedTimelineNote(first.project, first.cursor, 1);
  const note = getLocatedTimelineNote(moved.project.outline, moved.cursor.focusedNoteId);
  assert.equal(note.measure.id, 'measure-1');
  assert.equal(note.positionSixteenths, 0);
  assert.equal(moved.cursor.positionSixteenths, 16);
  assert.equal(voiceOf(moved.project).elements.some((element) => element.kind === 'note'), false);
  const returned = moveFocusedTimelineNote(moved.project, moved.cursor, -1);
  assert.equal(getLocatedTimelineNote(returned.project.outline, first.cursor.focusedNoteId).measure.id, 'measure-0');
  const tail = addTimelineNoteAt(first.project, first.cursor, 28);
  assert.equal(moveFocusedTimelineNote(tail.project, tail.cursor, 1), undefined);
  assertComplete(moved.project);
  assertComplete(returned.project);
});

test('moving a focused tie segment shifts its whole chain and rejects any segment collision atomically', () => {
  const state = tiedState();
  const other = addTimelineNoteAt(state.project, createTimelineCursor(), 24, 72);
  const cursor = setTimelineCursorUnit(state.cursor, '3');
  const moved = moveFocusedTimelineNote(other.project, cursor, 1);
  assert.deepEqual(getTimelineTieChain(moved.project.outline, 'tail').map((entry) => [entry.note.id, entry.measureStartSixteenths + entry.positionSixteenths]), [['head', 16], ['tail', 20]]);
  assert.equal(moved.cursor.focusedNoteId, 'tail');
  assert.equal(moved.cursor.positionSixteenths, 20);
  assert.equal(getTimelineTieChain(reconcileOutlineTies(moved.project.outline), 'head').length, 2);
  const before = structuredClone(moved);
  assert.equal(moveFocusedTimelineNote(moved.project, moved.cursor, 1), undefined);
  assert.deepEqual(moved, before);
  assert.equal(moveFocusedTimelineNote(other.project, setTimelineCursorUnit(state.cursor, '1'), 1), undefined);
  assertComplete(moved.project);
});

test('D movement without a valid selected note does nothing', () => {
  const state = singleNote();
  assert.equal(moveFocusedTimelineNote(state.project, createTimelineCursor(), 1), undefined);
  assert.equal(moveFocusedTimelineNote(state.project, { ...state.cursor, focusedNoteId: 'missing' }, 1), undefined);
});

test('F+A copies the chord and fingering using the input value, then focuses the corresponding new pitch', () => {
  const initial = singleNote();
  const quarter = setFocusedTimelineNoteType(initial.project, initial.cursor, '3');
  const chord = addFocusedNotePitch(quarter.project, quarter.cursor);
  pitchesOf(chord)[0].fingering = 1;
  pitchesOf(chord)[1].fingering = 2;
  const cursor = setTimelineCursorUnit(chord.cursor, '2');
  const before = structuredClone(chord.project);
  const result = appendFocusedTimelineTie(chord.project, cursor);
  const chain = getTimelineTieChain(result.project.outline, result.cursor.focusedNoteId);
  assert.equal(chain.length, 2);
  assert.deepEqual(chain.map(({ note }) => note.value), [{ type: 'quarter', dots: 0 }, { type: 'eighth', dots: 0 }]);
  assert.deepEqual(chain[1].note.pitches, pitchesOf(chord));
  assert.notEqual(chain[1].note.pitches, chain[0].note.pitches);
  assert.notEqual(chain[1].note.pitches[0], chain[0].note.pitches[0]);
  assert.equal(chain[0].note.tieTo, chain[1].note.id);
  assert.equal(chain[1].note.tieFrom, chain[0].note.id);
  assert.equal(result.cursor.positionSixteenths, 4);
  assert.equal(result.cursor.focusedPitchIndex, 1);
  assert.equal(result.cursor.pitch, 59);
  assert.deepEqual(result.cursor.placementValue, cursor.placementValue);
  assertComplete(result.project);
  assert.deepEqual(chord.project, before);
});

test('repeated explicit tie additions keep separate written notes instead of normalizing them together', () => {
  let state = addTimelineNoteAt(blankProject(), createTimelineCursor(), 1);
  for (let i = 0; i < 3; i += 1) state = appendFocusedTimelineTie(state.project, state.cursor);
  const chain = getTimelineTieChain(state.project.outline, state.cursor.focusedNoteId);
  assert.equal(chain.length, 4);
  assert.deepEqual(chain.map((entry) => entry.positionSixteenths), [1, 2, 3, 4]);
  assert.ok(chain.every(({ note }) => note.value.type === '16th' && note.value.dots === 0));
  assert.equal(state.cursor.focusedNoteId, chain.at(-1).note.id);
  assert.equal(getTimelineTieChain(reconcileOutlineTies(state.project.outline), chain[0].note.id).length, 4);
  assertComplete(state.project);
});

test('explicit tie addition can start at the next existing measure using actual measure length', () => {
  const source = addTimelineNoteAt(blankProject(2, { cnt: 3, unit: 4 }), setTimelineCursorUnit(createTimelineCursor(), '3'), 8);
  const result = appendFocusedTimelineTie(source.project, setTimelineCursorUnit(source.cursor, '2'));
  const added = getLocatedTimelineNote(result.project.outline, result.cursor.focusedNoteId);
  assert.equal(added.measure.id, 'measure-1');
  assert.equal(added.positionSixteenths, 0);
  assert.equal(result.cursor.positionSixteenths, 12);
  assert.deepEqual(added.note.value, { type: 'eighth', dots: 0 });
  assert.equal(getTimelineTieChain(reconcileOutlineTies(result.project.outline), added.note.id).length, 2);
  assertComplete(result.project);
});

test('tie addition rejects overlaps, existing successors, bar overflow and score overflow atomically', () => {
  const source = addTimelineNoteAt(blankProject(2), setTimelineCursorUnit(createTimelineCursor(), '3'), 0);
  const blocked = addTimelineNoteAt(source.project, createTimelineCursor(), 5, 72);
  const before = structuredClone(blocked.project);
  assert.equal(appendFocusedTimelineTie(blocked.project, source.cursor), undefined);
  assert.deepEqual(blocked.project, before);
  const tied = appendFocusedTimelineTie(source.project, source.cursor);
  const linkedBefore = structuredClone(tied.project);
  assert.equal(appendFocusedTimelineTie(tied.project, source.cursor), undefined);
  assert.deepEqual(tied.project, linkedBefore);
  const nearBarEnd = addTimelineNoteAt(blankProject(2), createTimelineCursor(), 14);
  assert.equal(appendFocusedTimelineTie(nearBarEnd.project, setTimelineCursorUnit(nearBarEnd.cursor, '3')), undefined);
  const final = addTimelineNoteAt(blankProject(), createTimelineCursor(), 15);
  assert.equal(appendFocusedTimelineTie(final.project, final.cursor), undefined);
  assert.equal(appendFocusedTimelineTie(final.project, createTimelineCursor()), undefined);
  assert.equal(appendFocusedTimelineTie(final.project, { ...final.cursor, focusedNoteId: 'missing' }), undefined);
  assertComplete(final.project);
});

test('newly appended ties participate in value edits, whole-chain movement and chord pitch edits', () => {
  const source = singleNote();
  const appended = appendFocusedTimelineTie(source.project, source.cursor);
  const resized = setFocusedTimelineNoteType(appended.project, source.cursor, '3');
  assert.deepEqual(getTimelineTieChain(resized.project.outline, source.cursor.focusedNoteId).map((entry) => entry.positionSixteenths), [0, 4]);
  const moved = moveFocusedTimelineNote(resized.project, setTimelineCursorUnit(resized.cursor, '3'), 1);
  assert.deepEqual(getTimelineTieChain(moved.project.outline, source.cursor.focusedNoteId).map((entry) => entry.positionSixteenths), [4, 8]);
  const chord = addFocusedNotePitch(moved.project, moved.cursor);
  assert.ok(getTimelineTieChain(chord.project.outline, chord.cursor.focusedNoteId).every(({ note }) => note.pitches.length === 2));
  assertComplete(chord.project);
});

test('F+arrows resize and normalize a tie chain, preserving input and focusing the resulting tail', () => {
  const initial = addTimelineNoteAt(blankProject(2), createTimelineCursor());
  const before = structuredClone(initial);
  let state = initial;
  const expected = [
    [{ type: '16th', dots: 0 }], [{ type: 'eighth', dots: 0 }], [{ type: 'eighth', dots: 1 }],
    [{ type: 'quarter', dots: 0 }], [{ type: 'quarter', dots: 0 }, { type: '16th', dots: 0 }],
    [{ type: 'quarter', dots: 1 }], [{ type: 'quarter', dots: 0 }, { type: 'eighth', dots: 1 }],
    [{ type: 'half', dots: 0 }],
  ];
  const check = (length) => {
    const chain = getTimelineTieChain(state.project.outline, state.cursor.focusedNoteId);
    assert.equal(chain.reduce((sum, { note }) => sum + getNoteValueSixteenths(note.value), 0), length);
    if (expected[length - 1]) assert.deepEqual(chain.map(({ note }) => note.value), expected[length - 1]);
    if (length === 16) assert.deepEqual(chain.map(({ note }) => note.value), [{ type: 'whole', dots: 0 }]);
    const tail = chain.at(-1);
    assert.equal(state.cursor.positionSixteenths, tail.measureStartSixteenths + tail.positionSixteenths);
    assert.equal(state.cursor.focusedNoteId, tail.note.id);
    assert.deepEqual(state.cursor.placementValue, { type: '16th', dots: 0 });
    assert.equal(getTimelineTieChain(reconcileOutlineTies(state.project.outline), tail.note.id).length, chain.length);
    assertComplete(state.project);
  };
  for (let length = 1; length <= 16; length += 1) {
    if (length > 1) state = resizeFocusedTimelineTie(state.project, state.cursor, 1);
    check(length);
  }
  const across = resizeFocusedTimelineTie(state.project, state.cursor, 1);
  assert.equal(across.cursor.positionSixteenths, 16);
  assertComplete(across.project);
  for (let length = 15; length >= 1; length -= 1) {
    state = resizeFocusedTimelineTie(state.project, state.cursor, -1);
    check(length);
  }
  assert.equal(resizeFocusedTimelineTie(state.project, state.cursor, -1), undefined);
  assert.deepEqual(initial, before);
});

test('normalization is opt-in and works from any segment without losing the selected chord pitch', () => {
  const initial = singleNote();
  const quarter = setFocusedTimelineNoteType(initial.project, initial.cursor, '3');
  const chord = addFocusedNotePitch(quarter.project, quarter.cursor);
  const manual = appendFocusedTimelineTie(chord.project, setTimelineCursorUnit(chord.cursor, '2'));
  assert.deepEqual(getTimelineTieChain(manual.project.outline, manual.cursor.focusedNoteId).map(({ note }) => note.value), [
    { type: 'quarter', dots: 0 }, { type: 'eighth', dots: 0 },
  ]);
  const cursor = { ...setTimelineCursorUnit(manual.cursor, '1'), focusedNoteId: quarter.cursor.focusedNoteId, positionSixteenths: 0 };
  const grown = resizeFocusedTimelineTie(manual.project, cursor, 1);
  assert.deepEqual(getTimelineTieChain(grown.project.outline, grown.cursor.focusedNoteId).map(({ note }) => note.value), [
    { type: 'quarter', dots: 0 }, { type: 'eighth', dots: 1 },
  ]);
  const merged = resizeFocusedTimelineTie(grown.project, grown.cursor, -1);
  assert.deepEqual(getTimelineTieChain(merged.project.outline, merged.cursor.focusedNoteId).map(({ note }) => note.value), [{ type: 'quarter', dots: 1 }]);
  assert.equal(merged.cursor.focusedPitchIndex, 1);
  assert.equal(merged.cursor.pitch, 59);
  assert.deepEqual(pitchesOf(merged), pitchesOf(manual));
  assertComplete(merged.project);
});

test('F+arrows expose offbeat boundaries without normalizing unrelated rests or shifting other notes', () => {
  const project = blankProject();
  const manualRests = [
    { id: 'r1', kind: 'rest', value: { type: '16th', dots: 0 } },
    { id: 'r2', kind: 'rest', value: { type: '16th', dots: 0 } },
  ];
  voiceOf(project).elements = [
    ...manualRests,
    { id: 's', kind: 'note', value: { type: 'quarter', dots: 0 }, pitches: [{ midi: 60 }] },
    ...createRestElements(6, 6),
    { id: 'other', kind: 'note', value: { type: '16th', dots: 0 }, pitches: [{ midi: 72 }] },
    ...createRestElements(13, 3),
  ];
  const cursor = { ...createTimelineCursor(), focusedNoteId: 's', focusedPitchIndex: 0, positionSixteenths: 2 };
  const split = resizeFocusedTimelineTie(project, cursor, 1);
  const merged = resizeFocusedTimelineTie(split.project, split.cursor, 1);
  const chain = getTimelineTieChain(merged.project.outline, merged.cursor.focusedNoteId);
  assert.equal(chain.length, 2);
  assert.equal(chain[0].positionSixteenths, 2);
  assert.deepEqual(chain.map((entry) => [entry.positionSixteenths, entry.note.value]), [
    [2, { type: 'eighth', dots: 0 }], [4, { type: 'quarter', dots: 0 }],
  ]);
  assert.deepEqual(voiceOf(merged.project).elements.slice(0, 2), manualRests);
  assert.equal(getLocatedTimelineNote(merged.project.outline, 'other').positionSixteenths, 12);
  assertComplete(merged.project);
});

test('sixteenth-offbeat resize keeps the initial sixteenth and groups the following notes', () => {
  let state = addTimelineNoteAt(blankProject(), createTimelineCursor(), 1);
  const expected = [
    ['16th'], ['16th', '16th'], ['16th', 'eighth'], ['16th', 'eighth', '16th'],
  ];
  const check = (length) => {
    const chain = getTimelineTieChain(state.project.outline, state.cursor.focusedNoteId);
    assert.deepEqual(chain.map(({ note }) => note.value.type), expected[length - 1]);
    assert.ok(chain.every(({ note }) => note.value.dots === 0));
    assert.equal(chain[0].positionSixteenths, 1);
    assert.equal(chain.reduce((sum, { note }) => sum + getNoteValueSixteenths(note.value), 0), length);
    assert.equal(state.cursor.focusedNoteId, chain.at(-1).note.id);
    assertComplete(state.project);
  };
  check(1);
  for (let length = 2; length <= 4; length += 1) {
    state = resizeFocusedTimelineTie(state.project, state.cursor, 1);
    check(length);
  }
  for (let length = 3; length >= 1; length -= 1) {
    state = resizeFocusedTimelineTie(state.project, state.cursor, -1);
    check(length);
  }
});

test('note grouping uses local measure position after an irregular preceding measure', () => {
  const project = blankProject(2);
  project.outline[2].data = createMeasureData({ cnt: 3, unit: 8 });
  let state = addTimelineNoteAt(project, createTimelineCursor(), 8);
  for (let i = 0; i < 3; i += 1) state = resizeFocusedTimelineTie(state.project, state.cursor, 1);
  const chain = getTimelineTieChain(state.project.outline, state.cursor.focusedNoteId);
  assert.deepEqual(chain.map((entry) => [entry.positionSixteenths, entry.note.value]), [
    [2, { type: 'eighth', dots: 0 }], [4, { type: 'eighth', dots: 0 }],
  ]);
  assertComplete(state.project);
});

test('compound-meter grouping respects dotted-quarter beats and their subdivisions', () => {
  const project = blankProject(1, { cnt: 6, unit: 8 });
  project.outline[0].data.timeSignature = { cnt: 6, unit: 8 };
  let state = addTimelineNoteAt(project, createTimelineCursor(), 6);
  for (let i = 0; i < 3; i += 1) state = resizeFocusedTimelineTie(state.project, state.cursor, 1);
  assert.deepEqual(getTimelineTieChain(state.project.outline, state.cursor.focusedNoteId).map(({ note }) => note.value), [{ type: 'quarter', dots: 0 }]);
  for (let i = 0; i < 2; i += 1) state = resizeFocusedTimelineTie(state.project, state.cursor, 1);
  assert.deepEqual(getTimelineTieChain(state.project.outline, state.cursor.focusedNoteId).map(({ note }) => note.value), [{ type: 'quarter', dots: 1 }]);
  let long = addTimelineNoteAt(project, createTimelineCursor(), 0);
  for (let i = 0; i < 7; i += 1) long = resizeFocusedTimelineTie(long.project, long.cursor, 1);
  assert.deepEqual(getTimelineTieChain(long.project.outline, long.cursor.focusedNoteId).map(({ note }) => note.value), [
    { type: 'quarter', dots: 1 }, { type: 'eighth', dots: 0 },
  ]);
  assertComplete(state.project);
  assertComplete(long.project);
});

test('F+arrows extend into an existing empty measure and remove/restore that segment on shrink/grow', () => {
  const source = addTimelineNoteAt(blankProject(2), setTimelineCursorUnit(createTimelineCursor(), '3'), 12);
  const cursor = setTimelineCursorUnit(source.cursor, '1');
  const appended = resizeFocusedTimelineTie(source.project, cursor, 1);
  assert.equal(appended.cursor.positionSixteenths, 16);
  assert.equal(getTimelineTieChain(appended.project.outline, appended.cursor.focusedNoteId).length, 2);
  const grown = resizeFocusedTimelineTie(appended.project, appended.cursor, 1);
  assert.deepEqual(getTimelineTieChain(grown.project.outline, grown.cursor.focusedNoteId).map(({ note }) => note.value), [
    { type: 'quarter', dots: 0 }, { type: 'eighth', dots: 0 },
  ]);
  const shortened = resizeFocusedTimelineTie(grown.project, setTimelineCursorUnit(grown.cursor, '3'), -1);
  assert.equal(shortened.cursor.positionSixteenths, 12);
  assert.equal(getLocatedTimelineNotes(shortened.project.outline).length, 1);
  let state = { ...shortened, cursor: setTimelineCursorUnit(shortened.cursor, '1') };
  state = resizeFocusedTimelineTie(state.project, state.cursor, 1);
  state = resizeFocusedTimelineTie(state.project, state.cursor, 1);
  const restored = resizeFocusedTimelineTie(state.project, state.cursor, 1);
  assert.equal(restored.cursor.positionSixteenths, 16);
  assert.equal(getTimelineTieChain(reconcileOutlineTies(restored.project.outline), restored.cursor.focusedNoteId).length, 2);
  assert.ok(appendFocusedTimelineTie(state.project, state.cursor));
  assertComplete(grown.project);
  assertComplete(shortened.project);
  assertComplete(restored.project);
});

test('cross-bar resize consumes only the required rests and preserves chord fingering and later notes', () => {
  const source = addTimelineNoteAt(blankProject(2), setTimelineCursorUnit(createTimelineCursor(), '3'), 12);
  const chord = addFocusedNotePitch(source.project, source.cursor);
  pitchesOf(chord)[0].fingering = 1;
  pitchesOf(chord)[1].fingering = 2;
  const later = addTimelineNoteAt(chord.project, createTimelineCursor(), 20, 72);
  const cursor = setTimelineCursorUnit(chord.cursor, '2');
  const before = structuredClone(later.project);
  const grown = resizeFocusedTimelineTie(later.project, cursor, 1);
  const chain = getTimelineTieChain(grown.project.outline, grown.cursor.focusedNoteId);
  assert.deepEqual(chain.map((entry) => [entry.measure.id, entry.positionSixteenths, entry.note.value.type]), [
    ['measure-0', 12, 'quarter'], ['measure-1', 0, 'eighth'],
  ]);
  assert.deepEqual(chain[1].note.pitches, pitchesOf(chord));
  assert.notEqual(chain[1].note.pitches, chain[0].note.pitches);
  assert.equal(grown.cursor.focusedPitchIndex, 1);
  assert.equal(getLocatedTimelineNote(grown.project.outline, later.cursor.focusedNoteId).positionSixteenths, 4);
  assertComplete(grown.project);
  assert.deepEqual(later.project, before);
});

test('cross-bar resizing rejects occupied continuation and score overflow without partial edits', () => {
  const source = addTimelineNoteAt(blankProject(2), setTimelineCursorUnit(createTimelineCursor(), '3'), 12);
  const blocked = addTimelineNoteAt(source.project, createTimelineCursor(), 18, 72);
  const before = structuredClone(blocked.project);
  assert.equal(resizeFocusedTimelineTie(blocked.project, source.cursor, 1), undefined);
  assert.deepEqual(blocked.project, before);
  const final = addTimelineNoteAt(blankProject(), setTimelineCursorUnit(createTimelineCursor(), '3'), 12);
  const finalBefore = structuredClone(final.project);
  assert.equal(resizeFocusedTimelineTie(final.project, final.cursor, 1), undefined);
  assert.deepEqual(final.project, finalBefore);
});

test('one resize can span several existing short measures while keeping every voice complete', () => {
  const source = addTimelineNoteAt(blankProject(5, { cnt: 1, unit: 16 }), createTimelineCursor());
  const grown = resizeFocusedTimelineTie(source.project, setTimelineCursorUnit(source.cursor, '3'), 1);
  const chain = getTimelineTieChain(grown.project.outline, grown.cursor.focusedNoteId);
  assert.equal(chain.length, 5);
  assert.deepEqual(chain.map((entry) => entry.positionSixteenths), [0, 0, 0, 0, 0]);
  assert.equal(getTimelineTieChain(reconcileOutlineTies(grown.project.outline), chain[0].note.id).length, 5);
  assert.equal(resizeFocusedTimelineTie(grown.project, grown.cursor, 1), undefined);
  assertComplete(grown.project);
});

test('automatic merging preserves distinct fingering boundaries inside tied chords', () => {
  const initial = singleNote();
  pitchesOf(initial)[0].fingering = 1;
  const quarter = setFocusedTimelineNoteType(initial.project, initial.cursor, '3');
  const appended = appendFocusedTimelineTie(quarter.project, setTimelineCursorUnit(quarter.cursor, '2'));
  pitchesOf(appended)[0].fingering = 2;
  const before = structuredClone(appended.project);
  const grown = resizeFocusedTimelineTie(appended.project, setTimelineCursorUnit(appended.cursor, '1'), 1);
  const shrunk = resizeFocusedTimelineTie(grown.project, grown.cursor, -1);
  const chain = getTimelineTieChain(shrunk.project.outline, shrunk.cursor.focusedNoteId);
  assert.deepEqual(chain.map(({ note }) => note.value), [{ type: 'quarter', dots: 0 }, { type: 'eighth', dots: 0 }]);
  assert.deepEqual(chain.map(({ note }) => note.pitches[0].fingering), [1, 2]);
  assertComplete(shrunk.project);
  assert.deepEqual(appended.project, before);
});

test('automatic resizing rejects overlap, zero/negative length and missing selection atomically', () => {
  const initial = singleNote();
  const quarter = setFocusedTimelineNoteType(initial.project, initial.cursor, '3');
  const other = addTimelineNoteAt(quarter.project, createTimelineCursor(), 8, 72);
  const cursor = setTimelineCursorUnit(quarter.cursor, '3');
  const grown = resizeFocusedTimelineTie(other.project, cursor, 1);
  assert.ok(grown); // Ending exactly at the other note is valid.
  const before = structuredClone(grown);
  assert.equal(resizeFocusedTimelineTie(grown.project, grown.cursor, 1), undefined);
  assert.deepEqual(grown, before);
  assert.equal(resizeFocusedTimelineTie(quarter.project, cursor, -1), undefined);
  assert.equal(resizeFocusedTimelineTie(initial.project, { ...cursor, focusedNoteId: initial.cursor.focusedNoteId }, -1), undefined);
  assert.equal(resizeFocusedTimelineTie(initial.project, createTimelineCursor(), 1), undefined);
  assertComplete(grown.project);
});

test('note navigation crosses rests and measure boundaries, selecting the highest chord pitch', () => {
  const first = addTimelineNoteAt(blankProject(2), createTimelineCursor(), 0, 60);
  const middle = addTimelineNoteAt(first.project, first.cursor, 8, 67);
  const chord = addFocusedNotePitch(middle.project, middle.cursor);
  const last = addTimelineNoteAt(chord.project, chord.cursor, 20, 72);
  let cursor = focusAdjacentTimelineNote(last.project.outline, first.cursor, 1);
  assert.equal(cursor.focusedNoteId, middle.cursor.focusedNoteId);
  assert.equal(cursor.pitch, 67);
  assert.equal(cursor.positionSixteenths, 8);
  cursor = focusAdjacentTimelineNote(last.project.outline, cursor, 1);
  assert.equal(cursor.positionSixteenths, 20);
  assert.equal(focusAdjacentTimelineNote(last.project.outline, cursor, 1), cursor);
  cursor = focusAdjacentTimelineNote(last.project.outline, cursor, -1);
  assert.equal(cursor.positionSixteenths, 8);
  assertComplete(last.project);
});

test('chord addition, pitch selection and movement retain fingering, order and voice duration', () => {
  const initial = singleNote();
  pitchesOf(initial)[0].fingering = 1;
  const before = structuredClone(initial.project);
  let state = addFocusedNotePitch(initial.project, initial.cursor);
  assert.deepEqual(pitchesOf(state).map((pitch) => pitch.midi), [60, 59]);
  assert.equal(state.cursor.focusedPitchIndex, 1);
  state = moveFocusedTimelineNotePitch(state.project, state.cursor, 1);
  assert.deepEqual(pitchesOf(state), [{ midi: 61 }, { midi: 60, fingering: 1 }]);
  assert.equal(state.cursor.focusedPitchIndex, 0);
  const selected = selectFocusedNotePitch(state.project, state.cursor, -1);
  assert.equal(selected.pitch, 60);
  assert.equal(selectFocusedNotePitch(state.project, selected, -1), selected);
  const reversed = moveFocusedTimelineNotePitch(state.project, selected, 1);
  assert.equal(reversed.cursor.pitch, 62);
  assert.deepEqual(pitchesOf(reversed)[0], { midi: 62, fingering: 1 });
  assert.deepEqual(initial.project, before);
  assertComplete(reversed.project);
});

test('chord addition permits 15 semitones and rejects a major tenth without changing the score', () => {
  const initial = singleNote(75);
  pitchesOf(initial).push({ midi: 61 });
  const cursor = { ...initial.cursor, focusedPitchIndex: 1, pitch: 61 };
  const allowed = addFocusedNotePitch(initial.project, cursor);
  assert.deepEqual(pitchesOf(allowed).map((pitch) => pitch.midi), [75, 61, 60]);
  const before = structuredClone(allowed);
  assert.equal(addFocusedNotePitch(allowed.project, allowed.cursor), undefined);
  assert.deepEqual(allowed, before);
  assertComplete(allowed.project);
});

test('pitch movement rejects a major tenth in either direction, including skipped and diatonic pitches', () => {
  const state = singleNote(74);
  pitchesOf(state).push({ midi: 60 });
  const allowed = moveFocusedTimelineNotePitch(state.project, state.cursor, 1);
  assert.deepEqual(pitchesOf(allowed).map((pitch) => pitch.midi), [75, 60]);
  const before = structuredClone(allowed);
  assert.equal(moveFocusedTimelineNotePitch(allowed.project, allowed.cursor, 1), undefined);
  const low = { ...allowed.cursor, focusedPitchIndex: 1, pitch: 60 };
  assert.equal(moveFocusedTimelineNotePitch(allowed.project, low, -1), undefined);
  assert.equal(moveFocusedTimelineNotePitch(allowed.project, allowed.cursor, 1, { fifths: 0 }), undefined);
  assert.deepEqual(allowed, before);
  const skipped = singleNote(61);
  pitchesOf(skipped).push({ midi: 60 }, { midi: 46 });
  assert.equal(moveFocusedTimelineNotePitch(skipped.project, {
    ...skipped.cursor, focusedPitchIndex: 1, pitch: 60,
  }, 1), undefined);
});

test('rejected chord edits preserve every segment of a tied chord', () => {
  const state = singleNote(75);
  pitchesOf(state).push({ midi: 60, fingering: 5 });
  const tied = appendFocusedTimelineTie(state.project, state.cursor);
  const before = structuredClone(tied);
  assert.equal(moveFocusedTimelineNotePitch(tied.project, tied.cursor, 1), undefined);
  assert.equal(addFocusedNotePitch(tied.project, {
    ...tied.cursor, focusedPitchIndex: 1, pitch: 60,
  }), undefined);
  assert.deepEqual(tied, before);
  assertComplete(tied.project);
});

test('piano bounds and occupied chord pitches reject edits', () => {
  const low = singleNote(21);
  assert.equal(addFocusedNotePitch(low.project, low.cursor), undefined);
  assert.equal(moveFocusedTimelineNotePitch(low.project, low.cursor, -1), undefined);
  const high = singleNote(108);
  assert.equal(moveFocusedTimelineNotePitch(high.project, high.cursor, 1), undefined);
  const chord = addFocusedNotePitch(high.project, high.cursor);
  assert.equal(addFocusedNotePitch(chord.project, { ...chord.cursor, focusedPitchIndex: 0 }), undefined);
  assert.equal(moveFocusedTimelineNotePitch(chord.project, chord.cursor, 1), undefined);
});

test('diatonic movement follows key signatures and skips occupied chord tones', () => {
  assert.deepEqual([...getDiatonicPitchClasses({ fifths: 0 })].sort((a, b) => a - b), [0, 2, 4, 5, 7, 9, 11]);
  assert.ok(getDiatonicPitchClasses({ fifths: 1 }).has(6));
  assert.ok(getDiatonicPitchClasses({ fifths: -1 }).has(10));
  assert.equal(moveTimelineCursorPitch({ ...createTimelineCursor(), pitch: 61 }, 1, { fifths: 0 }).pitch, 62);
  const initial = singleNote();
  const state = addFocusedNotePitch(initial.project, initial.cursor);
  const moved = moveFocusedTimelineNotePitch(state.project, state.cursor, 1, { fifths: 0 });
  assert.equal(moved.cursor.pitch, 62);
  assertComplete(moved.project);
});

test('note deletion restores an equal-value rest and permits replacement at the same onset', () => {
  const state = addTimelineNoteAt(blankProject(2), createTimelineCursor(), 19, 65);
  const later = addTimelineNoteAt(state.project, state.cursor, 23, 72);
  const before = structuredClone(later.project);
  const deleted = deleteFocusedTimelineNote(later.project, state.cursor);
  assert.equal(deleted.cursor.focusedNoteId, null);
  assert.equal(deleted.cursor.positionSixteenths, 19);
  assert.equal(getLocatedTimelineNote(deleted.project.outline, later.cursor.focusedNoteId).positionSixteenths, 7);
  assert.ok(addTimelineNoteAt(deleted.project, deleted.cursor));
  assertComplete(deleted.project);
  assert.deepEqual(later.project, before);
});

test('pitch deletion preserves the note until its last pitch is removed', () => {
  const initial = singleNote();
  const chord = addFocusedNotePitch(initial.project, initial.cursor);
  const deleted = deleteFocusedTimelineNote(chord.project, { ...chord.cursor, focusedPitchIndex: 0 }, true);
  assert.deepEqual(pitchesOf(deleted), [{ midi: 59 }]);
  assert.equal(deleted.cursor.pitch, 59);
  const last = deleteFocusedTimelineNote(deleted.project, deleted.cursor, true);
  assert.equal(getLocatedTimelineNotes(last.project.outline).length, 0);
  assert.equal(last.cursor.focusedNoteId, null);
  assertComplete(last.project);
  assert.equal(deleteFocusedTimelineNote(last.project, last.cursor), undefined);
});

function tiedState() {
  const project = blankProject(2);
  voiceOf(project).elements = [
    ...createRestElements(0, 12),
    { id: 'head', kind: 'note', value: { type: 'quarter', dots: 0 }, pitches: [{ midi: 60 }], tieTo: 'tail' },
  ];
  voiceOf(project, 3).elements = [
    { id: 'tail', kind: 'note', value: { type: 'quarter', dots: 0 }, pitches: [{ midi: 60 }], tieFrom: 'head' },
    ...createRestElements(4, 12),
  ];
  return { project, cursor: { ...createTimelineCursor(), positionSixteenths: 16, focusedNoteId: 'tail', focusedPitchIndex: 0 } };
}

test('existing tie links still support chord edits and detach when a segment becomes a rest', () => {
  let state = tiedState();
  state = addFocusedNotePitch(state.project, state.cursor);
  state = moveFocusedTimelineNotePitch(state.project, state.cursor, 1);
  getTimelineTieChain(state.project.outline, 'tail').forEach(({ note }) => assert.deepEqual(note.pitches.map((pitch) => pitch.midi), [61, 60]));
  const deleted = deleteFocusedTimelineNote(state.project, { ...state.cursor, focusedNoteId: 'head' });
  assert.equal(getLocatedTimelineNote(deleted.project.outline, 'tail').note.tieFrom, undefined);
  assertComplete(deleted.project);
});

test('outline insertion/deletion preserve required blocks and reconcile ties without losing rest coverage', () => {
  const state = tiedState();
  const outline = state.project.outline;
  assert.equal(deleteOutlineBlock(outline, { blockId: outline[0].id }).outline, outline);
  assert.equal(deleteOutlineBlock(outline, { blockId: outline[1].id }).outline, outline);
  const inserted = addMeasureAfterCursor(outline, { blockId: 'measure-0' });
  assert.equal(getLocatedTimelineNote(inserted.outline, 'head').note.tieTo, undefined);
  assert.equal(getLocatedTimelineNote(inserted.outline, 'tail').note.tieFrom, undefined);
  assertComplete({ outline: inserted.outline });
  const deleted = deleteOutlineBlock(outline, { blockId: 'measure-1' });
  assert.equal(getLocatedTimelineNote(deleted.outline, 'head').note.tieTo, undefined);
  assertComplete({ outline: deleted.outline });
  assert.equal(getTimelineTieChain(reconcileOutlineTies(outline), 'head').length, 2);
});
