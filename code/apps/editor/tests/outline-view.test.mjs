import assert from 'node:assert/strict';
import { test } from 'node:test';
import OutlineView from '../src/state/outline-view.ts';
import { createProject, createMeasureData } from '../src/model/project.ts';
import { getSelectedOutlineBlocks } from '../src/state/outline-cursor.ts';

function fixture(count = 1000) {
  const { outline } = createProject();
  for (let i = 1; i <= count; i++) {
    outline.push({ id: `m${i}`, type: 'measure', data: createMeasureData({ cnt: 4, unit: 4 }) });
  }
  return outline;
}

test('mixed blocks retain continuous measure numbers after insertion, deletion and reordering', () => {
  const outline = fixture(4);
  outline.splice(3, 0, { id: 'key', type: 'key-change', data: { keySignature: { fifths: 1 } } },
    { id: 'section', type: 'section', data: { name: 'Second' } });
  outline.splice(outline.findIndex(block => block.id === 'm2'), 1);
  outline.splice(2, 0, outline.pop());
  const layout = OutlineView.layout(outline);
  assert.deepEqual(layout.rows.filter(row => row.block.type === 'measure').map(row =>
    [row.block.id, row.measureNumber]), [['m4', 1], ['m1', 2], ['m3', 3]]);
  for (let i = 1; i < layout.rows.length; i++) {
    assert.equal(layout.rows[i].top, layout.rows[i - 1].top + layout.rows[i - 1].height);
    assert.equal(layout.byId.get(layout.rows[i].block.id), layout.rows[i]);
  }
});

test('large outlines render only viewport and overscan, plus a distant focus once', () => {
  const layout = OutlineView.layout(fixture());
  const scrollTop = 14000, viewportHeight = 600, overscan = 160;
  const expected = layout.rows.filter(row => row.top + row.height > scrollTop - overscan &&
    row.top < scrollTop + viewportHeight + overscan);
  assert.deepEqual(OutlineView.visibleRows(layout, scrollTop, viewportHeight), expected);
  const visible = OutlineView.visibleRows(layout, scrollTop, viewportHeight, 'm1000');
  assert.deepEqual(visible, [...expected, layout.byId.get('m1000')]);
  assert.ok(visible.length < 25);
  assert.deepEqual(OutlineView.visibleRows(layout, scrollTop, viewportHeight, expected[0].block.id), expected);
});

test('measured wrapped rows update positions and viewport intersection', () => {
  const outline = fixture(6);
  const first = OutlineView.layout(outline);
  const heights = new Map([['m1', 120], ['m3', 75]]);
  const layout = OutlineView.layout(outline, heights);
  assert.equal(layout.byId.get('m2').top, first.byId.get('m2').top + 120 - first.byId.get('m1').height);
  assert.equal(layout.totalHeight, layout.rows.reduce((sum, row) => sum + row.height, 0));
  const row = layout.byId.get('m1');
  assert.deepEqual(OutlineView.visibleRows(layout, row.top, row.height, undefined, 0), [row]);
  assert.equal(OutlineView.visibleRows(layout, row.top + row.height, 1, undefined, 0)[0].block.id, 'm2');
});

test('focus can jump to unmounted blocks, centers correctly and clamps to both ends', () => {
  const outline = fixture();
  const layout = OutlineView.layout(outline);
  assert.equal(OutlineView.focusScrollTop(layout, outline[0].id, 600), 0);
  assert.equal(OutlineView.focusScrollTop(layout, 'm1000', 600), layout.totalHeight + OutlineView.tailSpace - 600);
  const top = OutlineView.focusScrollTop(layout, 'm500', 600);
  const row = layout.byId.get('m500');
  assert.equal(top + 300, row.top + row.gap + (row.height - row.gap) / 2);
  assert.ok(OutlineView.visibleRows(layout, top, 600).includes(row));
  assert.equal(OutlineView.focusScrollTop(layout, 'deleted', 600), undefined);
  assert.equal(OutlineView.focusScrollTop(OutlineView.layout(fixture(1)), 'm1', 600), 0);
});

test('range selection retains the full model range without mounting the selected offscreen rows', () => {
  const outline = fixture();
  const cursor = { blockId: 'm1000', selectionAnchorBlockId: 'm1' };
  assert.equal(getSelectedOutlineBlocks(outline, cursor).length, 1000);
  const layout = OutlineView.layout(outline);
  const top = OutlineView.focusScrollTop(layout, cursor.blockId, 600);
  const visible = OutlineView.visibleRows(layout, top, 600, cursor.blockId);
  assert.ok(visible.length < 25);
  assert.equal(visible.at(-1).block.id, 'm1000');
});
