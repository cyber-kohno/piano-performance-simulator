import type { OutlineBlock } from '../domain/score/types.ts';

export type OutlineRow = {
  block: OutlineBlock; index: number; measureNumber: number;
  top: number; height: number; gap: number;
};
export type OutlineLayout = { rows: OutlineRow[]; byId: Map<string, OutlineRow>; totalHeight: number };

namespace OutlineView {
  // Estimates include the old inter-block margins. Visible rows report their real
  // heights, including wrapped section titles and multiple rows of beat chips.
  const estimatedHeights = { init: 129, section: 52, 'key-change': 67, measure: 49 };
  export const tailSpace = 27;

  export function layout(outline: readonly OutlineBlock[], heights: ReadonlyMap<string, number> = new Map()): OutlineLayout {
    let top = 0, measureNumber = 0;
    const byId = new Map<string, OutlineRow>();
    const rows = outline.map((block, index) => {
      if (block.type === 'measure') measureNumber++;
      const height = heights.get(block.id) ?? estimatedHeights[block.type];
      const row = { block, index, measureNumber, top, height,
        gap: block.type === 'init' || block.type === 'section' ? 16 : 6 };
      top += height;
      byId.set(block.id, row);
      return row;
    });
    return { rows, byId, totalHeight: top };
  }

  export function visibleRows(layout: OutlineLayout, scrollTop: number, viewportHeight: number,
    focusedId?: string, overscan = 160) {
    const firstPosition = Math.max(0, scrollTop - overscan);
    const lastPosition = scrollTop + Math.max(1, viewportHeight) + overscan;
    const { rows } = layout;
    let low = 0, high = rows.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (rows[middle].top + rows[middle].height <= firstPosition) low = middle + 1;
      else high = middle;
    }
    const indices = new Set<number>();
    for (let i = low; i < rows.length && rows[i].top < lastPosition; i++) indices.add(i);
    const focus = focusedId === undefined ? undefined : layout.byId.get(focusedId);
    // Keep the focus mounted for section-name editing, even during a distant jump.
    if (focus) indices.add(focus.index);
    return [...indices].sort((a, b) => a - b).map(index => rows[index]);
  }

  export function focusScrollTop(layout: OutlineLayout, blockId: string, viewportHeight: number) {
    const row = layout.byId.get(blockId);
    if (!row) return undefined;
    const center = row.top + row.gap + (row.height - row.gap) / 2;
    return Math.max(0, Math.min(center - viewportHeight / 2, layout.totalHeight + tailSpace - viewportHeight));
  }
}
export default OutlineView;
