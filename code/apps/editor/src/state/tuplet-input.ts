import TupletNotes from '../domain/score/tuplet-notes.ts';
import NotePitches from '../domain/score/note-pitches.ts';
import ScoreTimeline from '../domain/score/score-timeline.ts';
import WrittenValue from '../domain/theory/written-value.ts';
import type { OutlineBlock, ScoreProject, NoteValue } from '../domain/score/types.ts';
import type { TimelineCursor } from './timeline-cursor.ts';
function target(cursor: TimelineCursor) { return { staff: cursor.staff, voiceIndex: cursor.voiceIndex, position: cursor.positionSixteenths, noteId: cursor.focusedNoteId }; }
function apply(cursor: TimelineCursor, result: { project: ScoreProject; position: number } | undefined) {
  return result && { project: result.project, cursor: { ...cursor, positionSixteenths: result.position } };
}
export function getTupletContexts(outline: readonly OutlineBlock[], cursor: TimelineCursor) { return TupletNotes.contexts(outline, target(cursor)); }
export function getTupletContext(outline: readonly OutlineBlock[], cursor: TimelineCursor, position = cursor.positionSixteenths, useFocus = true) { return TupletNotes.context(outline, target(cursor), position, useFocus); }
export const isFullTupletSelection = TupletNotes.selectionCoversEdges;
export function getTupletPlacement(outline: readonly OutlineBlock[], cursor: TimelineCursor, position = cursor.positionSixteenths) { return TupletNotes.placement(outline, target(cursor), position); }
export function convertFocusedTimelineTuplet(project: ScoreProject, cursor: TimelineCursor) {
  if (cursor.selectionAnchorNoteId !== null && cursor.selectionAnchorNoteId !== cursor.focusedNoteId) return undefined;
  return apply(cursor, TupletNotes.convert(project, target(cursor)));
}
export function addTupletTimelineNote(project: ScoreProject, cursor: TimelineCursor, position: number, pitch: number) {
  const focusedPitch = cursor.focusedNoteId
    ? ScoreTimeline.note(project.outline, cursor.focusedNoteId, cursor.staff)?.note.pitches[cursor.focusedPitchIndex ?? 0]
    : undefined;
  const inputPitch = focusedPitch?.midi ?? pitch;
  const spellingDirection = focusedPitch ? focusedPitch.spellingDirection : cursor.spellingDirection;
  const result = TupletNotes.add(project, target(cursor), position, inputPitch);
  if (!result) return undefined;
  const nextProject = spellingDirection ? NotePitches.setSpellingDirection(result.project,
    { noteId: result.noteId, staff: cursor.staff, pitchIndex: 0 }, spellingDirection) : result.project;
  return { project: nextProject, cursor: { ...cursor, positionSixteenths: result.position, focusedNoteId: result.noteId, focusedPitchIndex: 0, selectionAnchorNoteId: null, pitch: inputPitch } };
}
export function setTupletNoteValue(project: ScoreProject, cursor: TimelineCursor, value: NoteValue) { return apply(cursor, TupletNotes.setValue(project, target(cursor), value)); }
export function resizeTupletNote(project: ScoreProject, cursor: TimelineCursor, direction: -1 | 1) { return apply(cursor, TupletNotes.resize(project, target(cursor), direction)); }
export function moveTupletSelection(project: ScoreProject, cursor: TimelineCursor, ids: ReadonlySet<string>, direction: -1 | 1) { return apply(cursor, TupletNotes.move(project, target(cursor), ids, direction, WrittenValue.sixteenths(cursor.placementValue))); }
