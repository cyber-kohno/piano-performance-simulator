import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProject, createMeasureData } from '../src/model/project.ts';
import { getTempoChanges, setNoteTempo, getTempoAt, getScoreTimeSeconds, reconcileTempoChanges } from '../src/model/tempo.ts';
import { createTimelineCursor, addTimelineNoteAt, setTimelineCursorUnit, moveFocusedTimelineNote, deleteFocusedTimelineNote, duplicateFocusedTimelineNoteAfter, normalizeFocusedTimelineTie, appendFocusedTimelineTie, setFocusedTimelineNoteType } from '../src/state/timeline-cursor.ts';
import { createScorePreview } from '../src/model/score-preview.ts';
function blank() {
  const project = createProject();
  project.outline[0].data.tempo = 120;
  for (let i = 0; i < 4; i++) project.outline.push({ id: `m${i}`, type: 'measure', data: createMeasureData({ cnt: 4, unit: 4 }) });
  return project;
}
test('tempo is global, limited to upper voice 1 and validates bounds without copying changes', () => {
  const first = addTimelineNoteAt(blank(), createTimelineCursor(), 2);
  const project = setNoteTempo(first.project, first.cursor.focusedNoteId, 60);
  assert.equal(getTempoAt(project, 1.5), 120);
  assert.equal(getTempoAt(project, 2), 60);
  for (const bpm of [9, 401, 60.5, NaN]) assert.equal(setNoteTempo(project, first.cursor.focusedNoteId, bpm), project);
  const lower = addTimelineNoteAt(project, createTimelineCursor('lowerStaff'), 0);
  assert.equal(setNoteTempo(lower.project, lower.cursor.focusedNoteId, 80), lower.project);
  const duplicate = duplicateFocusedTimelineNoteAfter(project, first.cursor);
  assert.equal(getTempoChanges(duplicate.project).length, 1);
  assert.equal(getTempoChanges(setNoteTempo(project, first.cursor.focusedNoteId, null)).length, 0);
});
test('tempo follows moves, tied successor shifts and normalization, and disappears when anchor is deleted', () => {
  const first = addTimelineNoteAt(blank(), createTimelineCursor(), 0);
  const second = appendFocusedTimelineTie(first.project, first.cursor);
  const project = setNoteTempo(second.project, second.cursor.focusedNoteId, 60);
  const resized = setFocusedTimelineNoteType(project, first.cursor, '3');
  assert.equal(getTempoChanges(resized.project)[0].position, 4);
  const moved = moveFocusedTimelineNote(resized.project, second.cursor, 1);
  assert.equal(getTempoChanges(moved.project)[0].position, 5);
  const normalized = normalizeFocusedTimelineTie(moved.project, moved.cursor);
  assert.equal(getTempoChanges(normalized.project)[0].position, 5);
  const deleted = deleteFocusedTimelineNote(project, second.cursor);
  assert.deepEqual(reconcileTempoChanges(deleted.project).tempoChanges, []);
});
test('time conversion integrates changes inside sustained notes and uses compound beats', () => {
  const first = addTimelineNoteAt(blank(), createTimelineCursor(), 2);
  const project = setNoteTempo(first.project, first.cursor.focusedNoteId, 60);
  assert.equal(getScoreTimeSeconds(project, 4), 0.75);
  assert.equal(getScoreTimeSeconds(project, 2), 0.25);
  assert.equal(getScoreTimeSeconds(project, 6) - getScoreTimeSeconds(project, 2), 1);
  const compound = blank(); compound.outline[0].data.timeSignature = { cnt: 6, unit: 8 };
  assert.equal(getScoreTimeSeconds(compound, 6), 0.5);
});
test('preview writes global tempo at note position and reconstructs incoming tempo in clipped views', () => {
  const first = addTimelineNoteAt(blank(), setTimelineCursorUnit(createTimelineCursor(), '4'), 2.5);
  const project = setNoteTempo(first.project, first.cursor.focusedNoteId, 60);
  const xml = createScorePreview(project.outline, 0, [], project.tempoChanges).xml;
  assert.match(xml, /<per-minute>60<\/per-minute>/);
  assert.match(xml, /<offset sound="yes">5<\/offset><staff>1<\/staff><sound tempo="60"\/>/);
  const clipped = createScorePreview(project.outline, 3, [], project.tempoChanges).xml;
  assert.match(clipped, /<per-minute>60<\/per-minute>/);
  assert.doesNotMatch(clipped, /<per-minute>120<\/per-minute>/);
});
