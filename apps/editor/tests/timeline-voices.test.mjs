import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProject, createMeasureData, getElementSixteenths } from '../src/model/project.ts';
import {
  createTimelineCursor, addNextTimelineVoice, cycleTimelineVoice,
  moveTimelineCursorHorizontally, findTimelineNoteAtMove, getLocatedTimelineNotes,
  addTimelineNoteAt, appendFocusedTimelineTie, resizeFocusedTimelineTie,
  moveFocusedTimelineNote, setFocusedTimelineNoteType, toggleFocusedTimelineNoteDot,
  addFocusedNotePitch, moveFocusedTimelineNotePitch, deleteFocusedTimelineNote,
  switchTimelineStaff, resetTimelineCursorForStaff, focusAdjacentTimelineNote,
  extendTimelineNoteSelection, isTimelinePlacementInvalid,
} from '../src/state/timeline-cursor.ts';

function blankProject(count = 2) {
  const project = createProject();
  for (let index = 0; index < count; index += 1) project.outline.push({
    id: `measure-${index}`, type: 'measure', data: createMeasureData({ cnt: 4, unit: 4 }),
  });
  return project;
}
function withVoice(project, position = 0, index = 1, staff = 'upperStaff') {
  for (let voiceIndex = 0; voiceIndex < index; voiceIndex += 1) {
    project = addNextTimelineVoice(project, { ...createTimelineCursor(staff), positionSixteenths: position, voiceIndex });
  }
  return project;
}
function assertComplete(project) {
  for (const block of project.outline) if (block.type === 'measure') {
    for (const staff of [block.data.upperStaff, block.data.lowerStaff]) for (const voice of staff.voices) {
      assert.equal(voice.elements.reduce((sum, element) => sum + getElementSixteenths(element, block.data.length), 0), 16);
    }
  }
}

test('voice creation is local, bounded, rest-filled and does not change editing state', () => {
  const initial = blankProject();
  const cursor = createTimelineCursor();
  const before = structuredClone(cursor);
  const second = addNextTimelineVoice(initial, cursor);
  assert.equal(initial.outline[2].data.upperStaff.voices.length, 1);
  assert.equal(second.outline[2].data.upperStaff.voices.length, 2);
  assert.equal(second.outline[2].data.lowerStaff.voices.length, 1);
  assert.equal(second.outline[3], initial.outline[3]);
  assert.equal(second.outline[2].data.upperStaff.voices[1].elements[0].kind, 'measure-rest');
  assert.deepEqual(cursor, before);
  assert.equal(addNextTimelineVoice(second, cursor), second);
  const third = addNextTimelineVoice(second, { ...cursor, voiceIndex: 1 });
  assert.equal(third.outline[2].data.upperStaff.voices.length, 3);
  assert.equal(addNextTimelineVoice(third, { ...cursor, voiceIndex: 2 }), third);
  assert.equal(addNextTimelineVoice(createProject(), cursor).outline.length, 2);
  assertComplete(third);
});

test('Q cycles local voices, clears focus and preserves the selected onset, pitch and input value', () => {
  const project = withVoice(blankProject(), 0, 2);
  const placed = addTimelineNoteAt(project, createTimelineCursor(), 3, 72);
  const chord = addFocusedNotePitch(placed.project, placed.cursor);
  const cursor = { ...chord.cursor, placementValue: { type: 'quarter', dots: 0 } };
  const next = cycleTimelineVoice(chord.project.outline, cursor);
  assert.equal(next.voiceIndex, 1);
  assert.equal(next.positionSixteenths, 3);
  assert.equal(next.pitch, 71);
  assert.deepEqual(next.placementValue, cursor.placementValue);
  assert.equal(next.focusedNoteId, null);
  assert.equal(next.selectionAnchorNoteId, null);
  assert.equal(cycleTimelineVoice(project.outline, next).voiceIndex, 2);
  assert.equal(cycleTimelineVoice(project.outline, { ...next, voiceIndex: 2 }).voiceIndex, 0);
  assert.equal(cycleTimelineVoice(project.outline, { ...next, positionSixteenths: 16 }).voiceIndex, 0);
  const range = cycleTimelineVoice(chord.project.outline, { ...cursor, focusedPitchIndex: null, selectionAnchorNoteId: cursor.focusedNoteId });
  assert.equal(range.pitch, 72);
  assert.equal(range.selectionAnchorNoteId, null);
});

test('cursor movement retains an existing voice and resets on missing voices in either direction', () => {
  const project = withVoice(withVoice(blankProject(3)), 16);
  const cursor = { ...createTimelineCursor(), voiceIndex: 1, positionSixteenths: 15 };
  assert.equal(moveTimelineCursorHorizontally(cursor, project.outline, 1).voiceIndex, 1);
  const next = moveTimelineCursorHorizontally({ ...cursor, positionSixteenths: 31 }, project.outline, 1);
  assert.equal(next.voiceIndex, 0);
  assert.equal(next.positionSixteenths, 32);
  const left = moveTimelineCursorHorizontally({ ...cursor, positionSixteenths: 16 }, withVoice(blankProject(), 16).outline, -1);
  assert.equal(left.voiceIndex, 0);
  assert.equal(switchTimelineStaff(project.outline, cursor).voiceIndex, 0);
  assert.equal(resetTimelineCursorForStaff(project.outline, cursor, 'upperStaff').voiceIndex, 0);
});

test('input, focus and note edits operate on the selected voice while preserving other voices', () => {
  const project = withVoice(blankProject());
  const base = addTimelineNoteAt(project, createTimelineCursor(), 0, 60);
  const untouched = structuredClone(base.project.outline[2].data.upperStaff.voices[0]);
  const cursor = { ...createTimelineCursor(), voiceIndex: 1 };
  assert.equal(isTimelinePlacementInvalid(base.project.outline, cursor), true);
  assert.equal(addTimelineNoteAt(base.project, cursor), undefined);
  let result = addTimelineNoteAt(base.project, cursor, 2, 72);
  assert.ok(result);
  assert.equal(findTimelineNoteAtMove(result.project.outline, { ...cursor, positionSixteenths: 2 }, 1).note.id, result.cursor.focusedNoteId);
  assert.equal(findTimelineNoteAtMove(result.project.outline, { ...cursor, positionSixteenths: 0 }, 1), undefined);
  result = setFocusedTimelineNoteType(result.project, result.cursor, '2');
  result = toggleFocusedTimelineNoteDot(result.project, result.cursor);
  result = addFocusedNotePitch(result.project, result.cursor);
  result = moveFocusedTimelineNotePitch(result.project, result.cursor, -1);
  result = moveFocusedTimelineNote(result.project, result.cursor, 1);
  result = appendFocusedTimelineTie(result.project, result.cursor);
  result = resizeFocusedTimelineTie(result.project, result.cursor, 1);
  assert.ok(result);
  assert.deepEqual(result.project.outline[2].data.upperStaff.voices[0], untouched);
  assert.ok(getLocatedTimelineNotes(result.project.outline, 'upperStaff', 1).length);
  const deleted = deleteFocusedTimelineNote(result.project, result.cursor);
  assert.ok(deleted);
  assert.deepEqual(deleted.project.outline[2].data.upperStaff.voices[0], untouched);
  assertComplete(deleted.project);
});

test('tie append, resize and movement reject a missing destination voice atomically', () => {
  const project = withVoice(blankProject());
  const placed = addTimelineNoteAt(project, { ...createTimelineCursor(), voiceIndex: 1 }, 15, 72);
  const before = structuredClone(placed);
  assert.equal(appendFocusedTimelineTie(placed.project, placed.cursor), undefined);
  assert.equal(resizeFocusedTimelineTie(placed.project, placed.cursor, 1), undefined);
  assert.equal(moveFocusedTimelineNote(placed.project, placed.cursor, 1), undefined);
  assert.deepEqual(placed, before);
  const complete = withVoice(placed.project, 16);
  for (const edit of [appendFocusedTimelineTie, (p, c) => resizeFocusedTimelineTie(p, c, 1), (p, c) => moveFocusedTimelineNote(p, c, 1)]) {
    const result = edit(complete, placed.cursor);
    assert.ok(result);
    assert.equal(result.cursor.voiceIndex, 1);
    assert.equal(getLocatedTimelineNotes(result.project.outline, 'upperStaff', 0).length, 0);
    assertComplete(result.project);
  }
});

test('multi-measure resize requires the same voice in every touched measure', () => {
  const project = withVoice(withVoice(blankProject(3)), 32);
  const placed = addTimelineNoteAt(project, { ...createTimelineCursor(), voiceIndex: 1 }, 15, 72);
  const before = structuredClone(placed.project);
  assert.equal(resizeFocusedTimelineTie(placed.project, { ...placed.cursor, placementValue: { type: 'whole', dots: 1 } }, 1), undefined);
  assert.deepEqual(placed.project, before);
});

test('crossing a missing voice never focuses a voice-1 note in the source measure', () => {
  const base = addTimelineNoteAt(withVoice(blankProject()), createTimelineCursor(), 15, 60);
  const cursor = { ...createTimelineCursor(), voiceIndex: 1, positionSixteenths: 15 };
  assert.equal(findTimelineNoteAtMove(base.project.outline, cursor, 1), undefined);
  assert.equal(moveTimelineCursorHorizontally(cursor, base.project.outline, 1).voiceIndex, 0);
});

test('third voice editing on the lower staff preserves the other staff and local voices', () => {
  const project = withVoice(blankProject(), 0, 2, 'lowerStaff');
  const untouched = structuredClone(project.outline[2].data);
  const placed = addTimelineNoteAt(project, { ...createTimelineCursor('lowerStaff'), voiceIndex: 2 }, 0, 48);
  assert.ok(placed);
  assert.equal(placed.cursor.voiceIndex, 2);
  assert.deepEqual(placed.project.outline[2].data.upperStaff, untouched.upperStaff);
  assert.deepEqual(placed.project.outline[2].data.lowerStaff.voices.slice(0, 2), untouched.lowerStaff.voices.slice(0, 2));
  assertComplete(placed.project);
});

test('note navigation falls back at missing voices and range selection never crosses voice indices', () => {
  let project = withVoice(withVoice(blankProject(3)), 32);
  const first = addTimelineNoteAt(project, { ...createTimelineCursor(), voiceIndex: 1 }, 0, 72);
  const second = addTimelineNoteAt(first.project, createTimelineCursor(), 20, 60);
  const third = addTimelineNoteAt(second.project, { ...createTimelineCursor(), voiceIndex: 1 }, 32, 74);
  project = third.project;
  const next = focusAdjacentTimelineNote(project.outline, first.cursor, 1);
  assert.equal(next.voiceIndex, 0);
  assert.equal(next.focusedNoteId, second.cursor.focusedNoteId);
  assert.equal(extendTimelineNoteSelection(project.outline, first.cursor, 1), first.cursor);
});
