import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProject, createMeasureData } from '../src/model/project.ts';
import { addSlur, removeSlur, getSlurActions, getSlurRanges, reconcileSlurs } from '../src/model/slur.ts';
import { createNoteMenuItems, controlNoteMenu } from '../src/state/note-menu.ts';
import { createTimelineCursor, addTimelineNoteAt, deleteFocusedTimelineNote, moveFocusedTimelineNote,
  appendFocusedTimelineTie, normalizeFocusedTimelineTie, duplicateFocusedTimelineNoteAfter } from '../src/state/timeline-cursor.ts';
import { createScorePreview } from '../src/model/score-preview.ts';
function setup(positions = [0, 2, 4, 6], staff = 'upperStaff') {
  let project = createProject();
  for (let i = 0; i < 5; i++) project.outline.push({ id: `m${i}`, type: 'measure', data: createMeasureData({ cnt: 4, unit: 4 }) });
  const states = [];
  for (const position of positions) {
    const state = addTimelineNoteAt(project, createTimelineCursor(staff), position, 60);
    states.push(state); project = state.project;
  }
  return { project, states, ids: states.map(state => state.cursor.focusedNoteId) };
}
test('slur addition stores temporal endpoints, rejects single, overlapping, nested and shared endpoints', () => {
  const { project, ids } = setup();
  const updated = addSlur(project, [ids[2], ids[0]]);
  assert.deepEqual(updated.slurs.map(s => [s.startNoteId, s.endNoteId]), [[ids[0], ids[2]]]);
  assert.deepEqual(getSlurRanges(updated)[0].members.map(e => e.note.id), ids.slice(0, 3));
  assert.equal(addSlur(project, [ids[0]]), project);
  for (const selection of [[ids[1], ids[2]], [ids[2], ids[3]], ids]) assert.equal(addSlur(updated, selection), updated);
  const otherStaff = addTimelineNoteAt(updated, createTimelineCursor('lowerStaff'), 0, 48);
  assert.equal(addSlur(otherStaff.project, [ids[0], otherStaff.cursor.focusedNoteId]), otherStaff.project);
});
test('removal accepts any nonempty subset of one slur and rejects unassigned or mixed selections', () => {
  const { project, ids } = setup([0, 2, 4, 6, 8]);
  const updated = addSlur(addSlur(project, ids.slice(0, 2)), ids.slice(2, 4));
  assert.equal(getSlurActions(updated, [ids[0]]).canRemove, true);
  assert.equal(removeSlur(updated, [ids[0]]).slurs.length, 1);
  for (const selected of [[ids[4]], [ids[1], ids[2]], [ids[3], ids[4]], []]) assert.equal(removeSlur(updated, selected), updated);
});
test('insertion and intermediate deletion recompute membership; deleting either endpoint removes the slur', () => {
  const { project, ids, states } = setup([0, 2, 4]);
  const updated = addSlur(project, ids);
  const inserted = addTimelineNoteAt(updated, createTimelineCursor(), 3, 64);
  assert.equal(getSlurRanges(inserted.project)[0].members.length, 4);
  const middleDeleted = deleteFocusedTimelineNote(updated, states[1].cursor);
  assert.equal(reconcileSlurs(middleDeleted.project).slurs.length, 1);
  for (const state of [states[0], states[2]]) {
    assert.equal(reconcileSlurs(deleteFocusedTimelineNote(updated, state.cursor).project).slurs.length, 0);
  }
});
test('moving endpoints follows IDs, and independent copies do not copy the range', () => {
  const { project, ids, states } = setup([0, 3]);
  const updated = addSlur(project, ids);
  const moved = moveFocusedTimelineNote(updated, states[0].cursor, 1);
  assert.equal(getSlurRanges(moved.project)[0].first.start, 1);
  const duplicate = duplicateFocusedTimelineNoteAfter(updated, states[1].cursor);
  assert.equal(getSlurRanges(duplicate.project)[0].members.length, 2);
  assert.equal(getSlurActions(duplicate.project, [duplicate.cursor.focusedNoteId]).canRemove, false);
});
test('normalization preserves both endpoint identities and a boundary after the end note', () => {
  const { project, states } = setup([0]);
  const first = states[0];
  const second = appendFocusedTimelineTie(project, first.cursor);
  const third = appendFocusedTimelineTie(second.project, second.cursor);
  const fourth = appendFocusedTimelineTie(third.project, third.cursor);
  const updated = addSlur(fourth.project, [second.cursor.focusedNoteId, third.cursor.focusedNoteId]);
  const normalized = normalizeFocusedTimelineTie(updated, second.cursor);
  const slur = getSlurRanges(normalized.project)[0];
  assert.equal(slur.first.note.id, second.cursor.focusedNoteId);
  assert.equal(slur.last.note.id, third.cursor.focusedNoteId);
  assert.equal(slur.members.length, 2);
});
test('menu checks disable commands before execution and do not run disabled actions', () => {
  const { project, ids } = setup();
  let items = createNoteMenuItems(project, [ids[0]]);
  assert.equal(items[1].disabled, true);
  assert.deepEqual(controlNoteMenu([1], 'Enter', items).path, [1]);
  items = createNoteMenuItems(project, ids);
  assert.equal(items[0].disabled, true);
  assert.equal(items[1].disabled, false);
  assert.equal(items[2].disabled, true);
  const updated = addSlur(project, ids);
  assert.equal(createNoteMenuItems(updated, [ids[1]])[2].disabled, false);
});
test('MusicXML renders one slur per range and reconstructs clipped windows', () => {
  const { project, ids } = setup([0, 16, 32, 48]);
  const updated = addSlur(project, ids);
  const xml = createScorePreview(updated.outline, 1, [], [], [], updated.slurs).xml;
  assert.equal((xml.match(/<slur type="start"/g) ?? []).length, 1);
  assert.equal((xml.match(/<slur type="stop"/g) ?? []).length, 1);
  const clipped = createScorePreview(updated.outline, 3, [], [], [], updated.slurs).xml;
  assert.match(clipped, /<slur type="start" number="1"/);
  assert.match(clipped, /<slur type="stop" number="1"/);
});
