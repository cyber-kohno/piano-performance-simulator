import ScoreOutline from '../domain/score/score-outline.ts';
import type { ScoreProject, OutlineBlock } from '../domain/score/types.ts';
/** Transient editing state, separate from the saved project data. */
export type OutlineCursor = {
  blockId: string;
};

export function createOutlineCursor(outline: ScoreProject['outline']): OutlineCursor {
  // Like Scorehack, start at the first section after the initial values.
  return { blockId: outline[1].id };
}

export function moveOutlineCursor(
  cursor: OutlineCursor,
  outline: readonly OutlineBlock[],
  direction: -1 | 1,
): OutlineCursor {
  const index = outline.findIndex((block) => block.id === cursor.blockId);
  if (index < 0) return cursor;

  const next = outline[index + direction];
  return next ? { blockId: next.id } : cursor;
}

export function moveOutlineSection(
  cursor: OutlineCursor,
  outline: readonly OutlineBlock[],
  direction: -1 | 1,
): OutlineCursor {
  const currentIndex = outline.findIndex((block) => block.id === cursor.blockId);
  if (currentIndex < 0) return cursor;

  let nextIndex = currentIndex;
  while (direction < 0 ? nextIndex > 0 : nextIndex < outline.length - 1) {
    nextIndex += direction;
    if (outline[nextIndex].type === 'section' || nextIndex === outline.length - 1) {
      return { blockId: outline[nextIndex].id };
    }
  }

  return cursor;
}

export function changeInitialKeySignature(outline: ScoreProject['outline'], cursor: OutlineCursor, direction: -1 | 1) {
  const result = ScoreOutline.changeInitialKey(outline, cursor.blockId, direction);
  return result;
}
export function changeOutlineKeySignature(outline: ScoreProject['outline'], cursor: OutlineCursor, direction: -1 | 1) {
  const result = ScoreOutline.changeKey(outline, cursor.blockId, direction);
  return result;
}
export function addKeyChangeAfterCursor(outline: ScoreProject['outline'], cursor: OutlineCursor) {
  const result = ScoreOutline.addKeyChange(outline, cursor.blockId);
  return { outline: result.outline, cursor: result.blockId === cursor.blockId ? cursor : { blockId: result.blockId } };
}
export function changeInitialTempo(outline: ScoreProject['outline'], cursor: OutlineCursor, direction: -1 | 1) {
  const result = ScoreOutline.changeTempo(outline, cursor.blockId, direction);
  return result;
}
export function changeInitialMeter(outline: ScoreProject['outline'], cursor: OutlineCursor, key: string) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) return outline;
  return ScoreOutline.changeMeter(outline, cursor.blockId, key === 'ArrowLeft' || key === 'ArrowRight' ? 'numerator' : 'denominator', key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1);
}
export function changeOutlineMeasureBeats(outline: ScoreProject['outline'], cursor: OutlineCursor, direction: -1 | 1) {
  const result = ScoreOutline.changeMeasureBeats(outline, cursor.blockId, direction);
  return result;
}
export function deleteOutlineBlock(outline: ScoreProject['outline'], cursor: OutlineCursor) {
  const result = ScoreOutline.remove(outline, cursor.blockId);
  return { outline: result.outline, cursor: result.blockId === cursor.blockId ? cursor : { blockId: result.blockId } };
}
export function addMeasureAfterCursor(outline: ScoreProject['outline'], cursor: OutlineCursor) {
  const result = ScoreOutline.addMeasure(outline, cursor.blockId);
  return { outline: result.outline, cursor: result.blockId === cursor.blockId ? cursor : { blockId: result.blockId } };
}
export function addSectionAfterCursor(outline: ScoreProject['outline'], cursor: OutlineCursor) {
  const result = ScoreOutline.addSection(outline, cursor.blockId);
  return result;
}
