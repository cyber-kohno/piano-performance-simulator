import type { ScoreProject, PedalEvent } from '../domain/score/types.ts';
import ScoreTimeline from '../domain/score/score-timeline.ts';
import { movePedalCursor, type PedalCursor } from './pedal.ts';
import { TIMELINE_CURSOR_UNITS } from './timeline-cursor.ts';
import { resolveTimelineNumberInput } from './number-input.ts';
export type PedalKey = { key: string; code: string; shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean; isComposing: boolean };
export type PedalCommand = { type: 'add'; position: number; action: PedalEvent['action'] } | { type: 'remove'; position: number };
export type PedalInputResult = { cursor: PedalCursor; handled: boolean; exit?: boolean; outlineBlockId?: string; command?: PedalCommand };
namespace PedalInput {
  export function control(project: ScoreProject, cursor: PedalCursor, input: PedalKey): PedalInputResult {
    if (input.ctrlKey || input.altKey || input.metaKey || input.isComposing) return { cursor, handled: false };
    const key = input.key.toLowerCase(), number = resolveTimelineNumberInput(input, false);
    if (key === 'escape') return { cursor, handled: true, exit: true };
    if (key === 'arrowleft' || key === 'arrowright') {
      const next = movePedalCursor(project, cursor, key === 'arrowleft' ? -1 : 1);
      const block = ScoreTimeline.blockAt(project.outline, next.position) ?? project.outline.filter(block => block.type === 'measure').at(-1);
      return { cursor: next, handled: true, outlineBlockId: block?.id };
    }
    if (number) {
      const unit = TIMELINE_CURSOR_UNITS.find(unit => unit.key === number.key)!;
      return { cursor: { ...cursor, value: { type: unit.type, dots: 0 } }, handled: true };
    }
    if (key === 'a' || key === 's') return { cursor, handled: true, command: { type: 'add', position: cursor.position, action: key === 'a' ? 'start' : input.shiftKey ? 'change' : 'stop' } };
    if (key === 'delete') return { cursor, handled: true, command: { type: 'remove', position: cursor.position } };
    return { cursor, handled: true };
  }
}
export default PedalInput;
