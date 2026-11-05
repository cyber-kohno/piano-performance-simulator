import type { ScoreProject } from '../domain/score/types.ts';
import type { OutlineCursor } from './outline-cursor.ts';
import { reconcileTimelineCursorVoice, resetTimelineCursorForStaff, type TimelineCursor } from './timeline-cursor.ts';
import ScoreTimeline from '../domain/score/score-timeline.ts';
export type WorkspaceState = { project: ScoreProject; outlineCursor: OutlineCursor; timelineCursor: TimelineCursor; mode: 'outline' | 'timeline' };
namespace EditorNavigation {
  export function sync(outline: ScoreProject['outline'], outlineCursor: OutlineCursor, timelineCursor: TimelineCursor, position = timelineCursor.positionSixteenths) {
    const next = reconcileTimelineCursorVoice(outline, timelineCursor), block = ScoreTimeline.blockAt(outline, position);
    return { timelineCursor: next, outlineCursor: block && block.id !== outlineCursor.blockId ? { blockId: block.id } : outlineCursor };
  }
  export function toggle(state: WorkspaceState): WorkspaceState {
    if (state.mode === 'timeline') return { ...state, mode: 'outline', timelineCursor: { ...state.timelineCursor, selectionAnchorNoteId: null } };
    const focusedIndex = state.project.outline.findIndex(block => block.id === state.outlineCursor.blockId);
    if (focusedIndex < 0 || !state.project.outline.slice(focusedIndex).some(block => block.type === 'measure')) return state;
    const position = ScoreTimeline.outlinePosition(state.project.outline, state.outlineCursor.blockId);
    const timelineCursor = resetTimelineCursorForStaff(state.project.outline, { ...state.timelineCursor, positionSixteenths: position }, 'upperStaff');
    const block = ScoreTimeline.blockAt(state.project.outline, position);
    return { ...state, mode: 'timeline', timelineCursor, outlineCursor: block ? { blockId: block.id } : state.outlineCursor };
  }
}
export default EditorNavigation;
