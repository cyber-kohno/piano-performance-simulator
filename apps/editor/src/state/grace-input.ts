import { mapVoiceNotes, type PianoNote, type PianoGraceNote, type ScoreProject, type OutlineBlock } from '../model/project.ts';
import { getLocatedTimelineNote, getSelectedTimelineNotes, moveTimelineCursorPitch, type TimelineCursor, type LocatedTimelineNote } from './timeline-cursor.ts';

function parentAt(outline: readonly OutlineBlock[], cursor: TimelineCursor) {
  if (!cursor.focusedNoteId || getSelectedTimelineNotes(outline, cursor).length !== 1) return undefined;
  return getLocatedTimelineNote(outline, cursor.focusedNoteId, cursor.staff);
}
export function getFocusedGrace(outline: readonly OutlineBlock[], cursor: TimelineCursor) {
  const parent = parentAt(outline, cursor);
  const grace = parent?.note.beforeGraceNotes?.find(grace => grace.id === cursor.focusedGraceId);
  return parent && grace ? { parent, grace } : undefined;
}
function replaceParent(project: ScoreProject, cursor: TimelineCursor, parent: LocatedTimelineNote, note: PianoNote): ScoreProject {
  return { ...project, outline: project.outline.map(block => block.id !== parent.measure.id || block.type !== 'measure' ? block : {
    ...block, data: { ...block.data, [cursor.staff]: { ...block.data[cursor.staff],
      voices: block.data[cursor.staff].voices.map((voice, index) => index !== parent.voiceIndex ? voice :
        mapVoiceNotes(voice, current => current.id === note.id ? note : current)),
    } },
  }) as ScoreProject['outline'] };
}
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
  const parent = parentAt(project.outline, cursor);
  if (!parent || parent.note.pitches.length !== 1 || parent.note.value.type === '32nd') return undefined;
  const graces = parent.note.beforeGraceNotes ?? [];
  const selected = graces.findIndex(grace => grace.id === cursor.focusedGraceId);
  const pitch = (graces[selected]?.pitches[0].midi ?? parent.note.pitches[0].midi) - 1;
  if (pitch < 21) return undefined;
  const grace: PianoGraceNote = { id: `grace-${crypto.randomUUID()}`, pitches: [{ midi: pitch }], value: { type: 'eighth', dots: 0 }, slash: true };
  const beforeGraceNotes = [...graces];
  // Parent focus appends; grace focus inserts directly after that grace in performance order.
  beforeGraceNotes.splice(selected < 0 ? beforeGraceNotes.length : selected + 1, 0, grace);
  return { project: replaceParent(project, cursor, parent, { ...parent.note, beforeGraceNotes }),
    cursor: { ...cursor, focusedGraceId: grace.id, pitch, focusedPitchIndex: 0 } };
}
export function moveGracePitch(project: ScoreProject, cursor: TimelineCursor, direction: -1 | 1, diatonic = false, octave = false) {
  const selected = getFocusedGrace(project.outline, cursor);
  if (!selected) return undefined;
  const pitch = octave ? selected.grace.pitches[0].midi + direction * 12 : moveTimelineCursorPitch(
    { ...cursor, pitch: selected.grace.pitches[0].midi }, direction, diatonic ? project.outline[0].data.keySignature : undefined).pitch;
  if (pitch < 21 || pitch > 108 || pitch === selected.grace.pitches[0].midi) return undefined;
  const beforeGraceNotes = selected.parent.note.beforeGraceNotes!.map(grace => grace.id !== selected.grace.id ? grace : {
    ...grace, pitches: [{ ...grace.pitches[0], midi: pitch }],
  });
  return { project: replaceParent(project, cursor, selected.parent, { ...selected.parent.note, beforeGraceNotes }), cursor: { ...cursor, pitch } };
}
export function deleteFocusedGrace(project: ScoreProject, cursor: TimelineCursor) {
  const selected = getFocusedGrace(project.outline, cursor);
  if (!selected) return undefined;
  const beforeGraceNotes = selected.parent.note.beforeGraceNotes!.filter(grace => grace.id !== selected.grace.id);
  const note = { ...selected.parent.note };
  if (beforeGraceNotes.length) note.beforeGraceNotes = beforeGraceNotes;
  else delete note.beforeGraceNotes;
  return { project: replaceParent(project, cursor, selected.parent, note), cursor: focusGraceParent(project.outline, cursor) };
}

/** Fixed first-sixteenth display area, independent of the parent's written value. */
export function getGraceRollLayout(count: number, pixelsPerSixteenth: number) {
  const cell = pixelsPerSixteenth / (count + 1);
  const diameter = Math.max(4, Math.min(18 / Math.sqrt(Math.max(1, count)), cell - 2));
  return Array.from({ length: count }, (_, index) => ({ x: cell * (index + 1), diameter }));
}
