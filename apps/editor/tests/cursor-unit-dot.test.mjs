import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProject, createMeasureData, getNoteValueSixteenths } from '../src/model/project.ts';
import {
  createTimelineCursor, setTimelineCursorUnit, toggleTimelineCursorDot, moveTimelineCursorHorizontally,
  addTimelineNoteAt, getLocatedTimelineNote, appendFocusedTimelineTie, isTimelinePlacementInvalid,
} from '../src/state/timeline-cursor.ts';

function compoundProject() {
  const project = createProject();
  project.outline[0].data.timeSignature = { cnt: 6, unit: 8 };
  project.outline.push({ id: 'measure', type: 'measure', data: createMeasureData({ cnt: 6, unit: 8 }) });
  return project;
}

test('cursor dot toggles only quarter notes and preserves cursor location and selection', () => {
  const original = {
    ...setTimelineCursorUnit(createTimelineCursor(), '3'), positionSixteenths: 1,
    focusedNoteId: 'focus', focusedPitchIndex: null, selectionAnchorNoteId: 'anchor',
  };
  const dotted = toggleTimelineCursorDot(original);
  assert.deepEqual(dotted, { ...original, placementValue: { type: 'quarter', dots: 1 } });
  assert.deepEqual(toggleTimelineCursorDot(dotted), original);
  for (const key of ['1', '2']) {
    const cursor = setTimelineCursorUnit(original, key);
    assert.equal(toggleTimelineCursorDot(cursor), cursor);
  }
});

test('selecting the quarter type keeps its dot, while switching to eighth or sixteenth removes it', () => {
  const dotted = toggleTimelineCursorDot(setTimelineCursorUnit(createTimelineCursor(), '3'));
  assert.equal(setTimelineCursorUnit(dotted, '3'), dotted);
  for (const key of ['1', '2']) {
    const changed = setTimelineCursorUnit(dotted, key);
    assert.equal(changed.placementValue.dots, 0);
    assert.deepEqual(setTimelineCursorUnit(changed, '3').placementValue, { type: 'quarter', dots: 0 });
  }
});

test('dotted-quarter input moves and places notes by one compound beat on either staff', () => {
  for (const staff of ['upperStaff', 'lowerStaff']) {
    const project = compoundProject();
    const cursor = toggleTimelineCursorDot(setTimelineCursorUnit(createTimelineCursor(staff), '3'));
    assert.equal(getNoteValueSixteenths(cursor.placementValue), 6);
    const right = moveTimelineCursorHorizontally(cursor, project.outline, 1);
    assert.equal(right.positionSixteenths, 6);
    assert.equal(moveTimelineCursorHorizontally(right, project.outline, 1), right);
    assert.equal(moveTimelineCursorHorizontally(right, project.outline, -1).positionSixteenths, 0);
    const first = addTimelineNoteAt(project, cursor);
    const note = getLocatedTimelineNote(first.project.outline, first.cursor.focusedNoteId, staff).note;
    assert.deepEqual(note.value, { type: 'quarter', dots: 1 });
    const appended = appendFocusedTimelineTie(first.project, first.cursor);
    assert.equal(appended.cursor.positionSixteenths, 6);
    assert.deepEqual(getLocatedTimelineNote(appended.project.outline, appended.cursor.focusedNoteId, staff).note.value, note.value);
    assert.equal(isTimelinePlacementInvalid(project.outline, { ...cursor, positionSixteenths: 8 }), true);
    assert.equal(addTimelineNoteAt(project, cursor, 8), undefined);
  }
});

test('dotting input while a note is focused never changes its saved written value', () => {
  const placed = addTimelineNoteAt(compoundProject(), createTimelineCursor());
  const before = structuredClone(placed.project);
  const cursor = toggleTimelineCursorDot(setTimelineCursorUnit(placed.cursor, '3'));
  assert.equal(cursor.focusedNoteId, placed.cursor.focusedNoteId);
  assert.deepEqual(cursor.placementValue, { type: 'quarter', dots: 1 });
  assert.deepEqual(getLocatedTimelineNote(placed.project.outline, cursor.focusedNoteId).note.value, { type: '16th', dots: 0 });
  assert.deepEqual(placed.project, before);
});
