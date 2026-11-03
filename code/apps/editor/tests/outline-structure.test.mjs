import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProject } from '../src/model/project.ts';
import { addMeasureAfterCursor, addSectionAfterCursor, deleteOutlineBlock } from '../src/state/outline-cursor.ts';

function assertSectionCoverage(outline) {
  assert.equal(outline[0].type, 'init');
  assert.equal(outline[1].type, 'section');
  let section;
  for (const block of outline) {
    if (block.type === 'section') section = block.id;
    if (block.type === 'measure') assert.ok(section, 'every measure must follow a section');
  }
}

test('S at init inserts directly below it, ahead of the initially generated section', () => {
  const { outline } = createProject();
  const before = structuredClone(outline);
  const inserted = addSectionAfterCursor(outline, { blockId: outline[0].id });
  assert.equal(inserted[0], outline[0]);
  assert.equal(inserted[1].type, 'section');
  assert.notEqual(inserted[1].id, outline[1].id);
  assert.equal(inserted[2], outline[1]);
  assert.deepEqual(outline, before);
  assertSectionCoverage(inserted);
});

test('A at init does nothing, while A at a section inserts directly below that section', () => {
  const { outline } = createProject();
  const cursor = { blockId: outline[0].id };
  const rejected = addMeasureAfterCursor(outline, cursor);
  assert.equal(rejected.outline, outline);
  assert.equal(rejected.cursor, cursor);
  const sections = addSectionAfterCursor(outline, cursor);
  const sectionCursor = { blockId: sections[1].id };
  const inserted = addMeasureAfterCursor(sections, sectionCursor);
  assert.equal(inserted.outline[1].id, sectionCursor.blockId);
  assert.equal(inserted.outline[2].type, 'measure');
  assert.equal(inserted.outline[3].id, outline[1].id);
  assert.equal(inserted.cursor, sectionCursor);
  assertSectionCoverage(inserted.outline);
});

test('the initially generated section can be deleted after another section is placed ahead of it', () => {
  const { outline } = createProject();
  const withMeasure = addMeasureAfterCursor(outline, { blockId: outline[1].id }).outline;
  const inserted = addSectionAfterCursor(withMeasure, { blockId: outline[0].id });
  const deleted = deleteOutlineBlock(inserted, { blockId: outline[1].id });
  assert.equal(deleted.outline.some(block => block.id === outline[1].id), false);
  assert.equal(deleted.outline[1].id, inserted[1].id);
  assert.deepEqual(deleted.outline[2], withMeasure[2]);
  assert.equal(deleted.cursor.blockId, inserted[1].id);
  assertSectionCoverage(deleted.outline);
});

test('the first section can be removed if an adjacent section immediately replaces it', () => {
  const { outline } = createProject();
  const inserted = addSectionAfterCursor(outline, { blockId: outline[0].id });
  const deleted = deleteOutlineBlock(inserted, { blockId: inserted[1].id });
  assert.deepEqual(deleted.outline, outline);
  assert.equal(deleted.cursor.blockId, outline[0].id);
  assertSectionCoverage(deleted.outline);
});

test('deleting the first section is rejected if it would leave measures before the next section', () => {
  const { outline } = createProject();
  const inserted = addSectionAfterCursor(outline, { blockId: outline[0].id });
  const withMeasure = addMeasureAfterCursor(inserted, { blockId: inserted[1].id }).outline;
  const before = structuredClone(withMeasure);
  const cursor = { blockId: inserted[1].id };
  const rejected = deleteOutlineBlock(withMeasure, cursor);
  assert.equal(rejected.outline, withMeasure);
  assert.equal(rejected.cursor, cursor);
  assert.deepEqual(withMeasure, before);
  const withoutMeasure = deleteOutlineBlock(withMeasure, { blockId: withMeasure[2].id }).outline;
  assertSectionCoverage(deleteOutlineBlock(withoutMeasure, cursor).outline);
});

test('init and the last section remain protected, including when no measures exist', () => {
  const { outline } = createProject();
  for (const block of outline) assert.equal(deleteOutlineBlock(outline, { blockId: block.id }).outline, outline);
  assert.equal(deleteOutlineBlock(outline, { blockId: 'missing' }).outline, outline);
});

test('ordinary section insertions remain directly below focus and deleting markers preserves measures', () => {
  const { outline } = createProject();
  const withMeasure = addMeasureAfterCursor(outline, { blockId: outline[1].id }).outline;
  const afterMeasure = addSectionAfterCursor(withMeasure, { blockId: withMeasure[2].id });
  assert.equal(afterMeasure[3].type, 'section');
  const withSecond = addMeasureAfterCursor(afterMeasure, { blockId: afterMeasure[3].id }).outline;
  const deleted = deleteOutlineBlock(withSecond, { blockId: afterMeasure[3].id });
  assert.deepEqual(deleted.outline.filter(block => block.type === 'measure'),
    withSecond.filter(block => block.type === 'measure'));
  assertSectionCoverage(deleted.outline);
});
