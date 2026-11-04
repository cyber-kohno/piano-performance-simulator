import type { ScoreProject, OttavaEvent, PianoStaffName } from '../domain/score/types.ts';
import { moveOttavaCursor, type OttavaCursor } from './ottava.ts';
import { TIMELINE_CURSOR_UNITS } from './timeline-cursor.ts';
import { resolveTimelineNumberInput } from './number-input.ts';

export type OttavaKey = { key: string; code: string; shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean; isComposing: boolean };
export type OttavaCommand = { type: 'add'; position: number; staff: PianoStaffName; action: OttavaEvent['action'] } | { type: 'remove'; position: number; staff: PianoStaffName };
export type OttavaInputResult = { cursor: OttavaCursor; handled: boolean; exit?: boolean; outlineBlockId?: string; command?: OttavaCommand };
namespace OttavaInput {
  export function control(project: ScoreProject, cursor: OttavaCursor, staff: PianoStaffName, input: OttavaKey): OttavaInputResult {
    if (input.ctrlKey || input.altKey || input.metaKey || input.isComposing) return { cursor, handled: false };
    const key = input.key.toLowerCase(), number = resolveTimelineNumberInput(input, false);
    if (key === 'escape') return { cursor, handled: true, exit: true };
    if (key === 'arrowleft' || key === 'arrowright') {
      const next = moveOttavaCursor(project, cursor, key === 'arrowleft' ? -1 : 1);
      const measure = project.outline.filter(entry => entry.type === 'measure');
      let start = 0;
      const owner = measure.find(item => { const end = start + item.data.length.cnt * 16 / item.data.length.unit; const contains = next.position < end; start = end; return contains; }) ?? measure.at(-1);
      return { cursor: next, handled: true, outlineBlockId: owner?.id };
    }
    if (number) {
      const unit = TIMELINE_CURSOR_UNITS.find(unit => unit.key === number.key)!;
      return { cursor: { ...cursor, value: { type: unit.type, dots: 0 } }, handled: true };
    }
    if (key === 'a' || key === 's') return { cursor, handled: true, command: { type: 'add', position: cursor.position, staff, action: key === 'a' ? 'start' : 'stop' } };
    if (key === 'delete') return { cursor, handled: true, command: { type: 'remove', position: cursor.position, staff } };
    return { cursor, handled: true };
  }
}
export default OttavaInput;
