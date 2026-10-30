import assert from 'node:assert/strict';
import { test } from 'node:test';
import { controlArticulationMenu, menuItemsAt, articulationItems, isMenuItemSelected } from '../src/state/articulation-menu.ts';
import { createProject, createMeasureData } from '../src/model/project.ts';
import { createTimelineCursor, addTimelineNoteAt, appendFocusedTimelineTie, setFocusedNoteArticulation, getLocatedTimelineNote, normalizeFocusedTimelineTie, extendTimelineNoteSelection } from '../src/state/timeline-cursor.ts';
import { createScorePreview } from '../src/model/score-preview.ts';

test('selection checks propagate to parents, while None and Exit stay distinct', () => {
  assert.deepEqual(articulationItems.map(item => isMenuItemSelected(item)), [false, true, false]);
  assert.deepEqual(articulationItems.map(item => isMenuItemSelected(item, 'staccato')), [true, false, false]);
  assert.equal(isMenuItemSelected(articulationItems[0].children[0], 'staccato'), true);
  assert.equal(isMenuItemSelected({ label: 'Nested', children: [articulationItems[0]] }, 'staccato'), true);
});

test('menu navigation matches scorehack, including preview entry, clamped movement and root back', () => {
  assert.deepEqual(controlArticulationMenu([0], 'ArrowUp').path, [0]);
  assert.deepEqual(controlArticulationMenu([2], 'ArrowDown').path, [2]);
  assert.deepEqual(controlArticulationMenu([0], 'ArrowLeft').path, [0]);
  assert.deepEqual(controlArticulationMenu([0], 'ArrowRight').path, [0, 0]);
  assert.deepEqual(controlArticulationMenu([0], 'Enter').path, [0, 0]);
  assert.equal(menuItemsAt([0, 0])[0].action, 'staccato');
  assert.deepEqual(controlArticulationMenu([0, 0], 'Enter'), { path: null, action: 'staccato' });
  assert.deepEqual(controlArticulationMenu([0, 0], 'ArrowLeft').path, [0]);
  for (const key of ['Escape', 'm', 'M']) assert.equal(controlArticulationMenu([0, 0], key).path, null);
  assert.deepEqual(controlArticulationMenu([1], 'Enter'), { path: null, action: 'none' });
  assert.deepEqual(controlArticulationMenu([2], 'Enter'), { path: null, action: 'exit' });
  assert.deepEqual(controlArticulationMenu([0], 'Delete').path, [0]);
});

test('staccato belongs only to the selected chord, survives normalization and exports once', () => {
  const project = createProject();
  project.outline.push({ id: 'm', type: 'measure', data: createMeasureData({ cnt: 4, unit: 4 }) });
  const first = addTimelineNoteAt(project, createTimelineCursor());
  const second = appendFocusedTimelineTie(first.project, first.cursor);
  const before = structuredClone(second.project);
  const updated = setFocusedNoteArticulation(second.project, second.cursor, 'staccato');
  assert.deepEqual(second.project, before);
  assert.equal(getLocatedTimelineNote(updated.outline, first.cursor.focusedNoteId).note.articulation, undefined);
  assert.equal(getLocatedTimelineNote(updated.outline, second.cursor.focusedNoteId).note.articulation, 'staccato');
  const normalized = normalizeFocusedTimelineTie(updated, second.cursor);
  assert.equal(getLocatedTimelineNote(normalized.project.outline, second.cursor.focusedNoteId).note.articulation, 'staccato');
  const xml = createScorePreview(updated.outline, 0).xml;
  assert.equal((xml.match(/<staccato\/>/g) ?? []).length, 1);
  const removed = setFocusedNoteArticulation(updated, second.cursor, null);
  assert.equal(getLocatedTimelineNote(removed.outline, second.cursor.focusedNoteId).note.articulation, undefined);
  const range = extendTimelineNoteSelection(updated.outline, first.cursor, 1);
  assert.equal(setFocusedNoteArticulation(updated, range, 'staccato'), updated);
  assert.equal(setFocusedNoteArticulation(updated, createTimelineCursor(), 'staccato'), updated);
});
