import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProject, createMeasureData, createRestElements, getElementSixteenths, getNoteValueSixteenths } from '../src/model/project.ts';
import {
  createTimelineCursor, setTimelineCursorUnit, toggleTimelineCursorDot, addTimelineNoteAt,
  getLocatedTimelineNote, getTimelineTieChain, appendFocusedTimelineTie, deleteFocusedTimelineNote,
  moveFocusedTimelineNote, resizeFocusedTimelineNote, resizeFocusedTimelineTie,
  normalizeFocusedTimelineTie, toggleFocusedTimelineNoteDot, setFocusedTimelineNoteType,
  moveTimelineCursorHorizontally,
} from '../src/state/timeline-cursor.ts';
import { createScorePreview } from '../src/model/score-preview.ts';

function blank() {
  const project = createProject();
  for (let i = 0; i < 2; i++) project.outline.push({ id: `m${i}`, type: 'measure', data: createMeasureData({ cnt: 4, unit: 4 }) });
  return project;
}
const cursor32 = (staff = 'upperStaff') => setTimelineCursorUnit(createTimelineCursor(staff), '4');
const note = state => getLocatedTimelineNote(state.project.outline, state.cursor.focusedNoteId, state.cursor.staff).note;
function complete(project) {
  for (const block of project.outline.filter(b => b.type === 'measure')) {
    for (const staff of [block.data.upperStaff, block.data.lowerStaff]) {
      for (const voice of staff.voices) assert.equal(voice.elements.reduce((sum, e) => sum + getElementSixteenths(e, block.data.length), 0), 16);
    }
  }
}

test('32nd input moves by half a sixteenth on either staff and does not acquire dots', () => {
  for (const staff of ['upperStaff', 'lowerStaff']) {
    const cursor = cursor32(staff);
    assert.deepEqual(cursor.placementValue, { type: '32nd', dots: 0 });
    assert.equal(toggleTimelineCursorDot(cursor), cursor);
    assert.equal(moveTimelineCursorHorizontally(cursor, blank().outline, 1).positionSixteenths, 0.5);
    const first = addTimelineNoteAt(blank(), cursor, 0.5);
    assert.equal(getNoteValueSixteenths(note(first).value), 0.5);
    const tied = appendFocusedTimelineTie(first.project, first.cursor);
    assert.equal(tied.cursor.positionSixteenths, 1);
    const moved = moveFocusedTimelineNote(tied.project, tied.cursor, 1);
    assert.deepEqual(getTimelineTieChain(moved.project.outline, moved.cursor.focusedNoteId, staff).map(e => e.positionSixteenths), [1, 1.5]);
    const deleted = deleteFocusedTimelineNote(moved.project, moved.cursor, false);
    complete(deleted.project);
    assert.ok(addTimelineNoteAt(deleted.project, cursor, 1.5));
  }
});

test('dotted sixteenths edit, normalize and resize while dotted 32nds and quarter-step positions are rejected', () => {
  const first = addTimelineNoteAt(blank(), createTimelineCursor(), 0);
  const dotted = toggleFocusedTimelineNoteDot(first.project, first.cursor);
  assert.deepEqual(note(dotted).value, { type: '16th', dots: 1 });
  const smaller = setFocusedTimelineNoteType(dotted.project, dotted.cursor, '4');
  assert.deepEqual(note(smaller).value, { type: '32nd', dots: 0 });
  assert.equal(toggleFocusedTimelineNoteDot(smaller.project, smaller.cursor), undefined);
  const resized = resizeFocusedTimelineNote(first.project, { ...first.cursor, placementValue: cursor32().placementValue }, 1);
  assert.deepEqual(note(resized).value, { type: '16th', dots: 1 });
  const offbeat = addTimelineNoteAt(blank(), createTimelineCursor(), 0.5);
  const normalized = normalizeFocusedTimelineTie(offbeat.project, offbeat.cursor);
  assert.deepEqual(getTimelineTieChain(normalized.project.outline, normalized.cursor.focusedNoteId).map(e => getNoteValueSixteenths(e.note.value)), [0.5, 0.5]);
  assert.equal(addTimelineNoteAt(blank(), cursor32(), 0.25), undefined);
  assert.equal(addTimelineNoteAt(blank(), { ...cursor32(), placementValue: { type: '32nd', dots: 1 } }), undefined);
  complete(dotted.project);
  complete(normalized.project);
});

test('32nd extension crosses a barline and rejects an occupied continuation atomically', () => {
  const first = addTimelineNoteAt(blank(), cursor32(), 15.5);
  const grown = resizeFocusedTimelineTie(first.project, first.cursor, 1);
  assert.deepEqual(getTimelineTieChain(grown.project.outline, grown.cursor.focusedNoteId).map(e => [e.measureStartSixteenths + e.positionSixteenths, getNoteValueSixteenths(e.note.value)]), [[15.5, 0.5], [16, 0.5]]);
  const blocked = addTimelineNoteAt(first.project, cursor32('lowerStaff'), 16, 60);
  const before = structuredClone(blocked.project);
  assert.equal(resizeFocusedTimelineTie(blocked.project, first.cursor, 1), undefined);
  assert.deepEqual(blocked.project, before);
  const touching = addTimelineNoteAt(first.project, cursor32('lowerStaff'), 16.5, 60);
  assert.ok(resizeFocusedTimelineTie(touching.project, first.cursor, 1));
  complete(grown.project);
});

test('rests cover half-step spans exactly and preview writes integer durations with 32nd and dotted 16th types', () => {
  const rests = createRestElements(0.5, 2);
  assert.equal(rests.reduce((sum, r) => sum + getNoteValueSixteenths(r.value), 0), 2);
  assert.equal(rests[0].value.type, '32nd');
  assert.throws(() => createRestElements(0.25, 1), RangeError);
  const first = addTimelineNoteAt(blank(), cursor32(), 0);
  const second = addTimelineNoteAt(first.project, createTimelineCursor(), 0.5, 64);
  const dotted = toggleFocusedTimelineNoteDot(second.project, second.cursor);
  const { xml } = createScorePreview(dotted.project.outline, 0);
  assert.match(xml, /<divisions>8<\/divisions>/);
  assert.match(xml, /<duration>1<\/duration><voice>1<\/voice><type>32nd<\/type>/);
  assert.match(xml, /<duration>3<\/duration><voice>1<\/voice><type>16th<\/type><dot\/>/);
  complete(dotted.project);
});
