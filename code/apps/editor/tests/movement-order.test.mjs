import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProject, createMeasureData } from '../src/model/project.ts';
import { crossesStationaryNote } from '../src/state/movement-order.ts';
import { addTimelineNoteAt, createTimelineCursor, setTimelineCursorUnit, moveFocusedTimelineNote,
  appendFocusedTimelineTie, extendTimelineNoteSelection, convertFocusedTimelineTuplet } from '../src/state/timeline-cursor.ts';

function blank() {
  const project = createProject();
  for (let i = 0; i < 2; i++) project.outline.push({ id: `m${i}`, type: 'measure', data: createMeasureData({ cnt: 4, unit: 4 }) });
  return project;
}
test('large ordinary moves cannot pass a same-voice note in either direction, but exact touching is permitted', () => {
  const first = addTimelineNoteAt(blank(), createTimelineCursor(), 0);
  const other = addTimelineNoteAt(first.project, createTimelineCursor(), 2, 64);
  const before = structuredClone(other.project);
  assert.equal(moveFocusedTimelineNote(other.project, setTimelineCursorUnit(first.cursor, '3'), 1), undefined);
  const third = addTimelineNoteAt(other.project, createTimelineCursor(), 6, 67);
  assert.equal(moveFocusedTimelineNote(third.project, setTimelineCursorUnit(third.cursor, '3'), -1), undefined);
  assert.ok(moveFocusedTimelineNote(other.project, first.cursor, 1));
  assert.ok(moveFocusedTimelineNote(other.project, other.cursor, -1));
  assert.deepEqual(other.project, before);
});
test('ties and ranges exclude all moving notes and reject skipping stationary notes atomically', () => {
  for (const tied of [true, false]) {
    const first = addTimelineNoteAt(blank(), createTimelineCursor(), 0);
    const second = tied ? appendFocusedTimelineTie(first.project, first.cursor)
      : addTimelineNoteAt(first.project, first.cursor, 1, 64);
    const cursor = tied ? first.cursor : extendTimelineNoteSelection(second.project.outline, first.cursor, 1);
    const other = addTimelineNoteAt(second.project, createTimelineCursor(), 3, 67);
    assert.equal(moveFocusedTimelineNote(other.project, setTimelineCursorUnit(cursor, '3'), 1), undefined);
    assert.ok(moveFocusedTimelineNote(other.project, cursor, 1));
  }
});
test('whole triplet groups cannot jump over ordinary notes', () => {
  const placed = addTimelineNoteAt(blank(), setTimelineCursorUnit(createTimelineCursor(), '3'));
  const group = convertFocusedTimelineTuplet(placed.project, placed.cursor);
  const second = addTimelineNoteAt(group.project, group.cursor, 4 / 3, 64);
  const third = addTimelineNoteAt(second.project, second.cursor, 8 / 3, 67);
  let selection = extendTimelineNoteSelection(third.project.outline, group.cursor, 1);
  selection = extendTimelineNoteSelection(third.project.outline, selection, 1);
  const other = addTimelineNoteAt(third.project, createTimelineCursor(), 6, 72);
  const before = structuredClone(other.project);
  assert.equal(moveFocusedTimelineNote(other.project, { ...selection, placementValue: { type: 'half', dots: 0 } }, 1), undefined);
  assert.ok(moveFocusedTimelineNote(other.project, { ...selection, placementValue: { type: 'eighth', dots: 0 } }, 1));
  assert.deepEqual(other.project, before);
});
test('swept checks preserve fractional boundaries and ignore obstacles behind the movement', () => {
  assert.equal(crossesStationaryNote([{ start: 0, length: 2 / 3 }], [{ start: 4 / 3, length: 2 / 3 }], 2 / 3), false);
  assert.equal(crossesStationaryNote([{ start: 0, length: 2 / 3 }], [{ start: 4 / 3, length: 2 / 3 }], 4), true);
  assert.equal(crossesStationaryNote([{ start: 2, length: 1 }], [{ start: 0, length: 1 }], 4), false);
});
