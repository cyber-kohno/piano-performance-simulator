import { createMeasureData, type OutlineBlock, type ScoreProject } from '../model/project';

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

export function addMeasureAfterCursor(
  outline: ScoreProject['outline'],
  cursor: OutlineCursor,
): { outline: ScoreProject['outline']; cursor: OutlineCursor } {
  const cursorIndex = outline.findIndex((block) => block.id === cursor.blockId);
  if (cursorIndex < 0) return { outline, cursor };
  const initialValues = outline[0];

  // Keep the initial values first. If they are focused, add after the first section.
  const sectionIndex = outline.findIndex((block) => block.type === 'section');
  const insertionIndex = cursorIndex === 0
    ? sectionIndex + 1
    : cursorIndex + 1;

  let measureNumber = 1;
  while (outline.some((block) => block.id === `measure-${measureNumber}`)) {
    measureNumber += 1;
  }

  const previousMeasure = outline
    .slice(0, insertionIndex)
    .reverse()
    .find((block) => block.type === 'measure');
  const length = previousMeasure?.type === 'measure'
    ? previousMeasure.data.length
    : initialValues.data.timeSignature;
  const measure = {
    id: `measure-${measureNumber}`,
    type: 'measure' as const,
    data: createMeasureData(length),
  };

  const nextOutline = [...outline];
  nextOutline.splice(insertionIndex, 0, measure);

  return {
    outline: nextOutline as ScoreProject['outline'],
    cursor,
  };
}

export function addSectionAfterCursor(
  outline: ScoreProject['outline'],
  cursor: OutlineCursor,
): ScoreProject['outline'] {
  const cursorIndex = outline.findIndex((block) => block.id === cursor.blockId);
  if (cursorIndex < 0) return outline;

  // Keep the first section immediately after initial values.
  const firstSectionIndex = outline.findIndex((block) => block.type === 'section');
  const insertionIndex = cursorIndex === 0 ? firstSectionIndex + 1 : cursorIndex + 1;

  let sectionNumber = 1;
  while (outline.some((block) => block.id === `section-${sectionNumber}`)) {
    sectionNumber += 1;
  }

  const nextOutline = [...outline];
  nextOutline.splice(insertionIndex, 0, {
    id: `section-${sectionNumber}`,
    type: 'section',
    data: { name: 'section' },
  });

  return nextOutline as ScoreProject['outline'];
}
