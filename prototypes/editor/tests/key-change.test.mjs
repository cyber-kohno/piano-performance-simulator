import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProject, createMeasureData } from '../src/model/project.ts';
import { getKeySignatureAt, getKeySignatureForBlock, getNoteKeySignature } from '../src/model/key-signature.ts';
import { addKeyChangeAfterCursor, changeOutlineKeySignature, deleteOutlineBlock, addMeasureAfterCursor } from '../src/state/outline-cursor.ts';
import { createTimelineCursor, addTimelineNoteAt, getTimelineLengthSixteenths, moveTimelineCursorPitch } from '../src/state/timeline-cursor.ts';
import { getTrillAuxiliary } from '../src/model/trill.ts';
import { createScorePreview } from '../src/model/score-preview.ts';
function score() {
  const project = createProject();
  for (let i = 0; i < 4; i++) project.outline.push({ id: `m${i}`, type: 'measure', data: createMeasureData({ cnt: 4, unit: 4 }) });
  return project;
}
function changed() {
  const project = score();
  const inserted = addKeyChangeAfterCursor(project.outline, { blockId: 'm0' });
  project.outline = changeOutlineKeySignature(inserted.outline, inserted.cursor, 1);
  return { project, cursor: inserted.cursor };
}
test('X inserts directly below focus with inherited key, preserves required leading section and allows following measure insertion', () => {
  const { project, cursor } = changed();
  assert.equal(project.outline[3].id, cursor.blockId);
  assert.equal(project.outline[3].type, 'key-change');
  assert.equal(getKeySignatureAt(project.outline, 15.5).fifths, 0);
  assert.equal(getKeySignatureAt(project.outline, 16).fifths, 1);
  assert.equal(getKeySignatureForBlock(project.outline, cursor.blockId).fifths, 1);
  assert.equal(getTimelineLengthSixteenths(project.outline), 64);
  const next = addKeyChangeAfterCursor(project.outline, { blockId: 'm2' });
  assert.equal(getKeySignatureForBlock(next.outline, next.cursor.blockId).fifths, 1);
  assert.equal(addKeyChangeAfterCursor(project.outline, { blockId: project.outline[0].id }).outline, project.outline);
  const measure = addMeasureAfterCursor(project.outline, cursor);
  assert.equal(getKeySignatureForBlock(measure.outline, measure.cursor.blockId).fifths, 1);
});
test('change blocks use the same 15 enharmonic choices and wraparound as initial values', () => {
  const project = score();
  const inserted = addKeyChangeAfterCursor(project.outline, { blockId: project.outline[1].id });
  let a = project.outline, b = inserted.outline;
  for (let i = 0; i < 15; i++) {
    a = changeOutlineKeySignature(a, { blockId: a[0].id }, 1);
    b = changeOutlineKeySignature(b, inserted.cursor, 1);
    assert.equal(getKeySignatureForBlock(b, inserted.cursor.blockId).fifths, a[0].data.keySignature.fifths);
  }
  assert.equal(getKeySignatureForBlock(b, inserted.cursor.blockId).fifths, 0);
  assert.equal(getKeySignatureForBlock(changeOutlineKeySignature(b, inserted.cursor, -1), inserted.cursor.blockId).fifths, -1);
  assert.equal(changeOutlineKeySignature(b, { blockId: 'm0' }, 1), b);
});
test('deleting a change restores the previous key and never alters saved pitches', () => {
  const { project, cursor } = changed();
  const note = addTimelineNoteAt(project, createTimelineCursor('lowerStaff'), 16, 66);
  assert.equal(getNoteKeySignature(note.project.outline, note.cursor.focusedNoteId).fifths, 1);
  const before = structuredClone(note.project.outline.filter(b => b.type === 'measure'));
  const removed = deleteOutlineBlock(note.project.outline, cursor);
  assert.equal(getKeySignatureAt(removed.outline, 16).fifths, 0);
  assert.deepEqual(removed.outline.filter(b => b.type === 'measure'), before);
  const key = getKeySignatureAt(note.project.outline, 16);
  assert.equal(moveTimelineCursorPitch({ ...createTimelineCursor(), pitch: 65 }, 1, key).pitch, 66);
  assert.equal(getTrillAuxiliary(64, key, 'diatonic').midi, 66);
});
test('MusicXML emits a shared key at the next measure head and restores it for clipped previews', () => {
  const { project } = changed();
  const xml = createScorePreview(project.outline, 0).xml;
  assert.match(xml, /<measure number="2"[^>]*><attributes><key><fifths>1<\/fifths><\/key><\/attributes>/);
  assert.equal((xml.match(/<fifths>1<\/fifths>/g) ?? []).length, 1);
  const clipped = createScorePreview(project.outline, 3).xml;
  assert.match(clipped, /<key><fifths>1<\/fifths><\/key>/);
  assert.doesNotMatch(clipped, /<fifths>0<\/fifths>/);
});
