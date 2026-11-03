import GraceNotes from '../domain/score/grace-notes.ts';

import ScoreKey from "../domain/score/score-key.ts";
import ScoreTimeline from "../domain/score/score-timeline.ts";
import { type ScoreProject, type OutlineBlock } from "../domain/score/types.ts";
import { getSelectedTimelineNotes, type TimelineCursor } from "./timeline-cursor.ts";

function parentAt(outline: readonly OutlineBlock[], cursor: TimelineCursor) {
  if (!cursor.focusedNoteId || getSelectedTimelineNotes(outline, cursor).length !== 1) return undefined;
  return ScoreTimeline.note(outline, cursor.focusedNoteId, cursor.staff);
}
export function getFocusedGrace(outline: readonly OutlineBlock[], cursor: TimelineCursor) {
  const parent = parentAt(outline, cursor);
  const grace = parent?.note.beforeGraceNotes?.find(grace => grace.id === cursor.focusedGraceId);
  return parent && grace ? { parent, grace } : undefined;
}
function target(cursor: TimelineCursor) { return { staff: cursor.staff, voiceIndex: cursor.voiceIndex, noteId: cursor.focusedNoteId!, pitchIndex: cursor.focusedPitchIndex }; }
export function focusGraceParent(outline: readonly OutlineBlock[], cursor: TimelineCursor): TimelineCursor {
  const parent = parentAt(outline, cursor);
  return { ...cursor, focusedGraceId: null, ...(parent ? { pitch: parent.note.pitches[0].midi, focusedPitchIndex: 0 } : {}) };
}
export function cycleGraceFocus(outline: readonly OutlineBlock[], cursor: TimelineCursor): TimelineCursor {
  const parent = parentAt(outline, cursor);
  const graces = parent?.note.beforeGraceNotes;
  if (!parent || !graces?.length) return cursor;
  const index = graces.findIndex(grace => grace.id === cursor.focusedGraceId);
  const next = graces[index + 1];
  return next ? { ...cursor, focusedGraceId: next.id, pitch: next.pitches[0].midi, focusedPitchIndex: 0 }
    : focusGraceParent(outline, cursor);
}
export function addBeforeGrace(project: ScoreProject, cursor: TimelineCursor) {
  if (!parentAt(project.outline, cursor)) return undefined;
  const result = GraceNotes.add(project, target(cursor), cursor.focusedGraceId ?? null);
  return result && { project: result.project, cursor: { ...cursor, focusedGraceId: result.graceId, pitch: result.pitch, focusedPitchIndex: 0 } };
}
export function moveGracePitch(project: ScoreProject, cursor: TimelineCursor, direction: -1 | 1, diatonic = false, octave = false) {
  const selected = getFocusedGrace(project.outline, cursor); if (!selected) return undefined;
  const result = GraceNotes.movePitch(project, target(cursor), selected.grace.id, direction, diatonic ? ScoreKey.forBlock(project.outline, selected.parent.measure.id) : undefined, octave);
  return result && { project: result.project, cursor: { ...cursor, pitch: result.pitch } };
}
export function deleteFocusedGrace(project: ScoreProject, cursor: TimelineCursor) {
  const selected = getFocusedGrace(project.outline, cursor); if (!selected) return undefined;
  const next = GraceNotes.remove(project, target(cursor), selected.grace.id);
  return next && { project: next, cursor: focusGraceParent(project.outline, cursor) };
}

/** Fixed first-sixteenth display area, independent of the parent's written value. */
export function getGraceRollLayout(count: number, pixelsPerSixteenth: number) {
  const cell = pixelsPerSixteenth / (count + 1);
  const diameter = Math.max(4, Math.min(18 / Math.sqrt(Math.max(1, count)), cell - 2));
  return Array.from({ length: count }, (_, index) => ({ x: cell * (index + 1), diameter }));
}
