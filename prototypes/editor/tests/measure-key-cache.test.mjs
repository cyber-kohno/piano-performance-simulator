import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProject, createMeasureData } from '../src/model/project.ts';
import { buildMeasureKeyCache, isDiatonicInMeasure, getKeySignatureAt } from '../src/model/key-signature.ts';
import { changeOutlineKeySignature, deleteOutlineBlock } from '../src/state/outline-cursor.ts';
import { addTimelineNoteAt, createTimelineCursor, moveFocusedTimelineNotePitch, moveTimelineCursorHorizontally } from '../src/state/timeline-cursor.ts';

function score() {
  const project = createProject();
  project.outline.push({ id: 'm0', type: 'measure', data: createMeasureData({ cnt: 2, unit: 4 }) },
    { id: 'key', type: 'key-change', data: { keySignature: { fifths: 1 } } },
    { id: 'm1', type: 'measure', data: createMeasureData({ cnt: 4, unit: 4 }) },
    { id: 'section2', type: 'section', data: { name: 'Next' } },
    { id: 'm2', type: 'measure', data: createMeasureData({ cnt: 4, unit: 4 }) });
  return project;
}
test('per-measure scale cache keeps both sides of a key boundary independent of cursor movement', () => {
  const project = score();
  const cache = buildMeasureKeyCache(project.outline);
  assert.equal(cache.size, 3);
  assert.equal(cache.get('m0').keySignature.fifths, 0);
  assert.equal(cache.get('m1').keySignature.fifths, 1);
  assert.equal(cache.get('m2'), cache.get('m1'));
  assert.equal(isDiatonicInMeasure(cache, 'm0', 65), true);
  assert.equal(isDiatonicInMeasure(cache, 'm0', 66), false);
  assert.equal(isDiatonicInMeasure(cache, 'm1', 65), false);
  assert.equal(isDiatonicInMeasure(cache, 'm1', 66), true);
  let cursor = createTimelineCursor();
  const before = [isDiatonicInMeasure(cache, 'm0', 66), isDiatonicInMeasure(cache, 'm1', 66)];
  for (let i = 0; i < 14; i++) cursor = moveTimelineCursorHorizontally(cursor, project.outline, 1);
  assert.equal(getKeySignatureAt(project.outline, cursor.positionSixteenths).fifths, 1);
  assert.deepEqual([isDiatonicInMeasure(cache, 'm0', 66), isDiatonicInMeasure(cache, 'm1', 66)], before);
});

test('editing and deleting a key change refreshes affected measures without changing earlier keys or old caches', () => {
  const project = score(), original = buildMeasureKeyCache(project.outline);
  const changed = changeOutlineKeySignature(project.outline, { blockId: 'key' }, 1);
  const cache = buildMeasureKeyCache(changed);
  assert.equal(cache.get('m0').keySignature.fifths, 0);
  assert.equal(cache.get('m1').keySignature.fifths, 2);
  assert.equal(isDiatonicInMeasure(cache, 'm1', 61), true);
  assert.equal(isDiatonicInMeasure(original, 'm1', 61), false);
  const deleted = deleteOutlineBlock(changed, { blockId: 'key' });
  const restored = buildMeasureKeyCache(deleted.outline);
  assert.equal(restored.get('m0'), restored.get('m2'));
  assert.equal(isDiatonicInMeasure(restored, 'm1', 65), true);
});

test('C-constrained pitch movement and note coloring use the same measure context at a local onset near zero', () => {
  for (const staff of ['upperStaff', 'lowerStaff']) {
    const state = addTimelineNoteAt(score(), createTimelineCursor(staff), 8.5, 65);
    const cache = buildMeasureKeyCache(state.project.outline);
    const moved = moveFocusedTimelineNotePitch(state.project, state.cursor, 1, cache.get('m1').keySignature);
    assert.equal(moved.cursor.pitch, 66);
    assert.equal(isDiatonicInMeasure(cache, 'm1', moved.cursor.pitch), true);
    // The former bug used the local onset 0.5 as a score-wide position (C major).
    assert.equal(getKeySignatureAt(state.project.outline, 0.5).fifths, 0);
    assert.equal(isDiatonicInMeasure(cache, 'm0', moved.cursor.pitch), false);
  }
});
