import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProject, createMeasureData } from '../src/model/project.ts';
import { getClefAt, getClefChanges, setNoteClef, reconcileClefChanges } from '../src/model/clef.ts';
import { createChangesEditor, controlChangesEditor } from '../src/state/changes-editor.ts';
import { createTimelineCursor, addTimelineNoteAt, setTimelineCursorUnit, moveFocusedTimelineNote, deleteFocusedTimelineNote,
  duplicateFocusedTimelineNoteAfter, normalizeFocusedTimelineTie, appendFocusedTimelineTie, addNextTimelineVoice, convertFocusedTimelineTuplet } from '../src/state/timeline-cursor.ts';
import { createScorePreview } from '../src/model/score-preview.ts';
function blank() {
  const project = createProject();
  for (let i = 0; i < 4; i++) project.outline.push({ id: `m${i}`, type: 'measure', data: createMeasureData({ cnt: 4, unit: 4 }) });
  return project;
}
test('Changes offers independent optional Tempo and Clef editors with eligibility and inherited defaults', () => {
  let editor = createChangesEditor(undefined, 137, undefined, 'bass');
  assert.equal(controlChangesEditor(editor, 'Enter', false, true), editor);
  editor = controlChangesEditor(editor, 'ArrowDown', false, true);
  editor = controlChangesEditor(editor, 'Enter', false, true);
  assert.equal(editor.clef, 'bass');
  assert.equal(editor.detail, 'clef');
  editor = controlChangesEditor(editor, 'ArrowLeft', false, true);
  assert.equal(editor.clef, 'treble');
  assert.equal(controlChangesEditor(editor, 'Delete', false, true), editor);
  editor = controlChangesEditor(editor, 'Backspace', false, true);
  editor = controlChangesEditor(editor, 'Delete', false, true);
  assert.equal(editor.clef, null);
  editor = controlChangesEditor(editor, 'ArrowUp', true, true);
  editor = controlChangesEditor(editor, 'Enter', true, true);
  assert.equal(editor.tempo.bpm, 137);
  assert.equal(editor.detail, 'tempo');
  editor = controlChangesEditor(editor, 'Backspace', true, true);
  assert.equal(editor.detail, null);
  assert.equal(controlChangesEditor(editor, 'Enter', false, false), editor);
});

test('clefs apply per staff, require voice 1, and never change pitch or notation duration', () => {
  const first = addTimelineNoteAt(blank(), createTimelineCursor(), 2);
  const before = structuredClone(first.project.outline);
  let project = setNoteClef(first.project, first.cursor.focusedNoteId, 'bass');
  assert.deepEqual(project.outline, before);
  assert.equal(getClefAt(project, 'upperStaff', 1), 'treble');
  assert.equal(getClefAt(project, 'upperStaff', 2), 'bass');
  assert.equal(getClefAt(project, 'lowerStaff', 2), 'bass');
  const lower = addTimelineNoteAt(project, createTimelineCursor('lowerStaff'), 2);
  project = setNoteClef(lower.project, lower.cursor.focusedNoteId, 'treble');
  assert.equal(getClefAt(project, 'lowerStaff', 2), 'treble');
  assert.equal(getClefChanges(project).length, 2);
  const voiced = addNextTimelineVoice(project, first.cursor);
  const secondVoice = addTimelineNoteAt(voiced, { ...createTimelineCursor(), voiceIndex: 1 }, 4, 67);
  assert.equal(setNoteClef(secondVoice.project, secondVoice.cursor.focusedNoteId, 'bass'), secondVoice.project);
  assert.equal(setNoteClef(project, first.cursor.focusedNoteId, 'alto'), project);
  project = setNoteClef(project, first.cursor.focusedNoteId, null);
  assert.equal(getClefAt(project, 'upperStaff', 8), 'treble');
  assert.equal(getClefAt(project, 'lowerStaff', 8), 'treble');
});

test('anchor follows moves and survives normalization while duplicates and deletion do not retain changes', () => {
  const first = addTimelineNoteAt(blank(), createTimelineCursor(), 0);
  const second = appendFocusedTimelineTie(first.project, first.cursor);
  const project = setNoteClef(second.project, second.cursor.focusedNoteId, 'bass');
  const moved = moveFocusedTimelineNote(project, second.cursor, 1);
  assert.equal(getClefChanges(moved.project)[0].position, 2);
  const normalized = normalizeFocusedTimelineTie(moved.project, moved.cursor);
  assert.equal(getClefChanges(normalized.project)[0].position, 2);
  const duplicate = duplicateFocusedTimelineNoteAfter(project, second.cursor);
  assert.equal(getClefChanges(duplicate.project).length, 1);
  const deleted = deleteFocusedTimelineNote(project, second.cursor);
  assert.deepEqual(reconcileClefChanges(deleted.project).clefChanges, []);
});

test('MusicXML inserts staff-wide mid-measure attributes at the right score time and restores clipped clefs', () => {
  const first = addTimelineNoteAt(blank(), createTimelineCursor(), 2);
  const project = setNoteClef(first.project, first.cursor.focusedNoteId, 'bass');
  const xml = createScorePreview(project.outline, 0, [], [], project.clefChanges).xml;
  assert.match(xml, /<forward><duration>4<\/duration><\/forward><attributes><clef number="1"><sign>F<\/sign><line>4<\/line><\/clef><\/attributes><backup><duration>4<\/duration><\/backup>/);
  assert.match(xml, /<pitch><step>C<\/step><alter>0<\/alter><octave>4<\/octave>/);
  const clipped = createScorePreview(project.outline, 3, [], [], project.clefChanges).xml;
  assert.match(clipped, /<clef number="1"><sign>F<\/sign><line>4<\/line>/);
  const zero = addTimelineNoteAt(blank(), createTimelineCursor('lowerStaff'), 0);
  const changed = setNoteClef(zero.project, zero.cursor.focusedNoteId, 'treble');
  const headXml = createScorePreview(changed.outline, 0, [], [], changed.clefChanges).xml;
  assert.match(headXml, /<clef number="2"><sign>G<\/sign><line>2<\/line>/);
  assert.doesNotMatch(headXml, /<forward>/);
});

test('triplet anchors retain fractional positions and tempo and clef events are independent', () => {
  const ordinary = addTimelineNoteAt(blank(), setTimelineCursorUnit(createTimelineCursor(), '3'), 0);
  const first = convertFocusedTimelineTuplet(ordinary.project, ordinary.cursor);
  const next = addTimelineNoteAt(first.project, first.cursor, 4 / 3);
  const project = setNoteClef(next.project, next.cursor.focusedNoteId, 'bass');
  assert.equal(getClefChanges(project)[0].position, 4 / 3);
  const xml = createScorePreview(project.outline, 0, [], [], project.clefChanges).xml;
  assert.match(xml, /<forward><duration>8<\/duration><\/forward>/);
});
