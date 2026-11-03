import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProject, createMeasureData } from '../src/model/project.ts';
import { changeInitialKeySignature, changeInitialTempo, changeInitialMeter, createOutlineCursor, addMeasureAfterCursor, deleteOutlineBlock } from '../src/state/outline-cursor.ts';
import { getDiatonicPitchClasses } from '../src/state/timeline-cursor.ts';

test('initial-key candidate changes preserve notes and other initial values', () => {
  const project = createProject();
  const data = createMeasureData({ cnt: 4, unit: 4 });
  data.upperStaff.voices[0].elements = [{
    id: 'sounding-b-flat', kind: 'note', value: { type: 'whole', dots: 0 }, pitches: [{ midi: 70, fingering: 2 }],
  }];
  project.outline.push({ id: 'measure', type: 'measure', data });
  const before = structuredClone(project.outline);
  const cursor = { blockId: project.outline[0].id };
  const sharp = changeInitialKeySignature(project.outline, cursor, 1);
  const flat = changeInitialKeySignature(project.outline, cursor, -1);
  assert.equal(sharp[0].data.keySignature.fifths, 1);
  assert.equal(flat[0].data.keySignature.fifths, -1);
  assert.equal(changeInitialKeySignature(sharp, cursor, -1)[0].data.keySignature.fifths, 0);
  assert.equal(sharp[2], project.outline[2]);
  assert.equal(flat[2], project.outline[2]);
  assert.deepEqual(sharp[0].data.timeSignature, before[0].data.timeSignature);
  assert.equal(sharp[0].data.tempo, before[0].data.tempo);
  assert.deepEqual(project.outline, before);
});

test('initial-key selection traverses all 15 spellings in order and wraps in both directions', () => {
  const project = createProject();
  const cursor = { blockId: project.outline[0].id };
  const forward = [0, 1, 2, 3, 4, 5, -7, 6, -6, 7, -5, -4, -3, -2, -1];
  for (const direction of [-1, 1]) {
    const expected = direction === 1 ? forward : [0, ...forward.slice(1).reverse()];
    let outline = project.outline;
    for (const fifths of expected) {
      assert.equal(outline[0].data.keySignature.fifths, fifths);
      const next = changeInitialKeySignature(outline, cursor, direction);
      assert.equal(changeInitialKeySignature(next, cursor, -direction)[0].data.keySignature.fifths, fifths);
      outline = next;
    }
    assert.equal(outline[0].data.keySignature.fifths, 0);
  }
});

test('enharmonic candidates are adjacent, separately stored spellings with identical pitch classes', () => {
  for (const [from, to] of [[5, -7], [6, -6], [7, -5]]) {
    const { outline } = createProject();
    outline[0].data.keySignature.fifths = from;
    const next = changeInitialKeySignature(outline, { blockId: outline[0].id }, 1);
    assert.equal(next[0].data.keySignature.fifths, to);
    assert.deepEqual([...getDiatonicPitchClasses(next[0].data.keySignature)].sort((a, b) => a - b),
      [...getDiatonicPitchClasses(outline[0].data.keySignature)].sort((a, b) => a - b));
  }
});

test('key editing requires focus on the initial-values block', () => {
  const { outline } = createProject();
  assert.equal(changeInitialKeySignature(outline, createOutlineCursor(outline), 1), outline);
  assert.equal(changeInitialKeySignature(outline, { blockId: 'missing' }, -1), outline);
});

test('tempo changes by one while preserving the other initial values and saved notes', () => {
  const { outline } = createProject();
  outline.push({ id: 'measure', type: 'measure', data: createMeasureData({ cnt: 4, unit: 4 }) });
  const cursor = { blockId: outline[0].id };
  const before = structuredClone(outline);
  const faster = changeInitialTempo(outline, cursor, 1);
  const slower = changeInitialTempo(outline, cursor, -1);
  assert.equal(faster[0].data.tempo, 101);
  assert.equal(slower[0].data.tempo, 99);
  assert.equal(changeInitialTempo(faster, cursor, -1)[0].data.tempo, 100);
  assert.equal(faster[2], outline[2]);
  assert.deepEqual(faster[0].data.keySignature, outline[0].data.keySignature);
  assert.deepEqual(faster[0].data.timeSignature, outline[0].data.timeSignature);
  assert.deepEqual(outline, before);
});

test('tempo stops at 10 and 400 and can move back from either limit', () => {
  const { outline } = createProject();
  const cursor = { blockId: outline[0].id };
  outline[0].data.tempo = 11;
  const minimum = changeInitialTempo(outline, cursor, -1);
  assert.equal(minimum[0].data.tempo, 10);
  assert.equal(changeInitialTempo(minimum, cursor, -1), minimum);
  assert.equal(changeInitialTempo(minimum, cursor, 1)[0].data.tempo, 11);
  outline[0].data.tempo = 399;
  const maximum = changeInitialTempo(outline, cursor, 1);
  assert.equal(maximum[0].data.tempo, 400);
  assert.equal(changeInitialTempo(maximum, cursor, 1), maximum);
  assert.equal(changeInitialTempo(maximum, cursor, -1)[0].data.tempo, 399);
});

test('tempo editing requires focus on the initial-values block', () => {
  const { outline } = createProject();
  assert.equal(changeInitialTempo(outline, createOutlineCursor(outline), 1), outline);
  assert.equal(changeInitialTempo(outline, { blockId: 'missing' }, -1), outline);
});

test('meter horizontal selection stays within its group and stops at either edge', () => {
  for (const [unit, values] of [[4, [2, 3, 4]], [8, [3, 6, 9, 12]]]) {
    for (const [index, cnt] of values.entries()) {
      const { outline } = createProject();
      outline[0].data.timeSignature = { unit, cnt };
      const cursor = { blockId: outline[0].id };
      for (const [key, offset] of [['ArrowLeft', -1], ['ArrowRight', 1]]) {
        const next = changeInitialMeter(outline, cursor, key);
        const expected = values[index + offset];
        if (expected === undefined) assert.equal(next, outline);
        else assert.deepEqual(next[0].data.timeSignature, { unit, cnt: expected });
      }
      assert.deepEqual(outline[0].data.timeSignature, { unit, cnt });
    }
  }
});

test('meter up/down chooses the denominator group with corresponding beats', () => {
  for (const cnt of [2, 3, 4]) {
    const { outline } = createProject();
    outline[0].data.timeSignature = { unit: 4, cnt };
    const cursor = { blockId: outline[0].id };
    const down = changeInitialMeter(outline, cursor, 'ArrowDown');
    assert.deepEqual(down[0].data.timeSignature, { unit: 8, cnt: cnt * 3 });
    assert.deepEqual(changeInitialMeter(down, cursor, 'ArrowUp')[0].data.timeSignature, { unit: 4, cnt });
    assert.equal(changeInitialMeter(outline, cursor, 'ArrowUp'), outline);
    assert.equal(changeInitialMeter(down, cursor, 'ArrowDown'), down);
  }
  const { outline } = createProject();
  outline[0].data.timeSignature = { cnt: 3, unit: 8 };
  assert.deepEqual(changeInitialMeter(outline, { blockId: outline[0].id }, 'ArrowUp')[0].data.timeSignature, { cnt: 3, unit: 4 });
});

test('any measure blocks every meter edit, even an empty irregular measure; deleting the last measure enables it again', () => {
  const { outline } = createProject();
  outline.push({ id: 'empty-measure', type: 'measure', data: createMeasureData({ cnt: 1, unit: 4 }) });
  const before = structuredClone(outline);
  const cursor = { blockId: outline[0].id };
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
    assert.equal(changeInitialMeter(outline, cursor, key), outline);
  }
  assert.deepEqual(outline, before);
  const removed = deleteOutlineBlock(outline, { blockId: 'empty-measure' });
  assert.deepEqual(changeInitialMeter(removed.outline, cursor, 'ArrowDown')[0].data.timeSignature, { cnt: 12, unit: 8 });
});

test('meter edits require initial-block focus, preserve other values and determine the first new measure length', () => {
  const { outline } = createProject();
  const cursor = { blockId: outline[0].id };
  assert.equal(changeInitialMeter(outline, createOutlineCursor(outline), 'ArrowDown'), outline);
  assert.equal(changeInitialMeter(outline, cursor, 'Delete'), outline);
  const changed = changeInitialMeter(outline, cursor, 'ArrowLeft');
  assert.deepEqual(changed[0].data.timeSignature, { cnt: 3, unit: 4 });
  assert.equal(changed[0].data.tempo, outline[0].data.tempo);
  assert.deepEqual(changed[0].data.keySignature, outline[0].data.keySignature);
  const compound = changeInitialMeter(changed, cursor, 'ArrowDown');
  const added = addMeasureAfterCursor(compound, createOutlineCursor(compound));
  assert.deepEqual(added.outline.find(block => block.type === 'measure').data.length, { cnt: 9, unit: 8 });
});
