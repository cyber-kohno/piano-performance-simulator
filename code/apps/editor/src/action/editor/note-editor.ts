import ScoreStaff from '../../domain/score/score-staff.ts';
import ScoreTimeline from '../../domain/score/score-timeline.ts';

import ScoreSlur from "../../domain/score/score-slur.ts";

import ScoreTempo from "../../domain/score/score-tempo.ts";

import ScoreTrill from "../../domain/score/score-trill.ts";

import ScoreClef from "../../domain/score/score-clef.ts";
import NoteExpressions from '../../domain/score/note-expressions.ts';
import NotePitches from '../../domain/score/note-pitches.ts';
import type { KeySignature, NoteValue, PianoFingering, PianoNote, ScoreProject, TrillSettings } from "../../domain/score/types.ts";
import { type Clef } from "../../domain/score/score-clef.ts";
import * as Timeline from '../../state/timeline-cursor.ts';
import * as Grace from '../../state/grace-input.ts';

import { validateExpressionDraft } from '../../state/expression-editor.ts';

import EditTransaction, { type NormalizedRange } from './edit-transaction.ts';
import ScorePassage, { type PassagePasteFailureReason, type ScorePassage as ScorePassageData } from '../../domain/score/score-passage.ts';

export type NoteEditResult = { project: ScoreProject; cursor: Timeline.TimelineCursor };
export type NoteSettings = Pick<PianoNote, 'staccato' | 'arpeggio'> & {
  trill?: TrillSettings;
  tempo?: { bpm: number | null };
  clef?: { value: Clef | null };
};
/** Application actions. Legacy pure editing algorithms remain in state until stage 2. */
namespace NoteEditor {
  function finish(before: ScoreProject, result: NoteEditResult | undefined, normalized?: NormalizedRange) {
    return result && { ...result, project: EditTransaction.commit(before, result.project, normalized) };
  }
  function normalizeResult(before: ScoreProject, cursor: Timeline.TimelineCursor, result: NoteEditResult | undefined) {
    return finish(before, result, cursor.focusedNoteId && result?.cursor.focusedNoteId
      ? { oldNoteId: cursor.focusedNoteId, newNoteId: result.cursor.focusedNoteId } : undefined);
  }
  export function add(project: ScoreProject, cursor: Timeline.TimelineCursor, position = cursor.positionSixteenths, pitch = cursor.pitch) {
    return finish(project, Timeline.addTimelineNoteAt(project, cursor, position, pitch));
  }
  export function remove(project: ScoreProject, cursor: Timeline.TimelineCursor, pitchOnly = false) {
    return finish(project, Timeline.deleteFocusedTimelineNote(project, cursor, pitchOnly));
  }
  export function move(project: ScoreProject, cursor: Timeline.TimelineCursor, direction: -1 | 1) {
    return finish(project, Timeline.moveFocusedTimelineNote(project, cursor, direction));
  }
  export function transpose(project: ScoreProject, cursor: Timeline.TimelineCursor, direction: -1 | 1, octave = false) {
    const selected = Timeline.getSelectedTimelineNotes(project.outline,cursor);
    const interval = direction * (octave ? 12 : 1);
    const next = NotePitches.transpose(project,cursor.staff,selected.map(entry=>entry.note.id),direction,octave);
    if (!next) return undefined;
    const focused = selected.find(entry=>entry.note.id===cursor.focusedNoteId)!;
    return finish(project,{project:next,cursor:{...cursor,focusedPitchIndex:null,pitch:focused.note.pitches[0].midi+interval}});
  }
  export function movePitch(project: ScoreProject, cursor: Timeline.TimelineCursor, direction: -1 | 1, key?: KeySignature, octave = false) {
    if (!cursor.focusedNoteId || cursor.focusedPitchIndex === null) return undefined;
    const result = NotePitches.move(project,{noteId:cursor.focusedNoteId,staff:cursor.staff,pitchIndex:cursor.focusedPitchIndex},direction,key,octave);
    return result && finish(project,{project:result.project,cursor:{...cursor,pitch:result.midi,focusedPitchIndex:result.pitchIndex}});
  }
  export function addPitch(project: ScoreProject, cursor: Timeline.TimelineCursor) {
    if (!cursor.focusedNoteId || cursor.focusedPitchIndex === null) return undefined;
    const result = NotePitches.add(project,{noteId:cursor.focusedNoteId,staff:cursor.staff,pitchIndex:cursor.focusedPitchIndex});
    return result && finish(project,{project:result.project,cursor:{...cursor,pitch:result.midi,focusedPitchIndex:result.pitchIndex}});
  }
  export function setPitchFingering(project: ScoreProject, cursor: Timeline.TimelineCursor,
    fingering: PianoFingering, substitutionFingering?: PianoFingering): ScoreProject {
    if (!cursor.focusedNoteId || cursor.focusedPitchIndex === null) return project;
    const next = NotePitches.setFingering(project, {
      noteId: cursor.focusedNoteId, staff: cursor.staff, pitchIndex: cursor.focusedPitchIndex,
    }, fingering, substitutionFingering);
    return next === project ? project : EditTransaction.commit(project, next);
  }
  export function setValue(project: ScoreProject, cursor: Timeline.TimelineCursor, value: NoteValue) {
    return finish(project, Timeline.setFocusedTimelineNoteValue(project, cursor, value));
  }
  export function toggleDot(project: ScoreProject, cursor: Timeline.TimelineCursor) {
    return finish(project, Timeline.toggleFocusedTimelineNoteDot(project, cursor));
  }
  export function resize(project: ScoreProject, cursor: Timeline.TimelineCursor, direction: -1 | 1) {
    return finish(project, Timeline.resizeFocusedTimelineNote(project, cursor, direction));
  }
  export function resizeTie(project: ScoreProject, cursor: Timeline.TimelineCursor, direction: -1 | 1) {
    return normalizeResult(project, cursor, Timeline.resizeFocusedTimelineTie(project, cursor, direction));
  }
  export function normalizeTie(project: ScoreProject, cursor: Timeline.TimelineCursor) {
    return normalizeResult(project, cursor, Timeline.normalizeFocusedTimelineTie(project, cursor));
  }
  export function appendTie(project: ScoreProject, cursor: Timeline.TimelineCursor) {
    return finish(project, Timeline.appendFocusedTimelineTie(project, cursor));
  }
  export function duplicate(project: ScoreProject, cursor: Timeline.TimelineCursor) {
    return finish(project, Timeline.duplicateFocusedTimelineNoteAfter(project, cursor));
  }
  export function copyPassage(project: ScoreProject, cursor: Timeline.TimelineCursor): ScorePassageData | undefined {
    return ScorePassage.copy(project.outline, cursor.staff, cursor.voiceIndex,
      Timeline.getSelectedTimelineNotes(project.outline, cursor));
  }
  export function pastePassage(project: ScoreProject, cursor: Timeline.TimelineCursor, passage: ScorePassageData) {
    const result = ScorePassage.paste(project, cursor.staff, cursor.voiceIndex, cursor.positionSixteenths, passage);
    if (!result.ok) return result;
    const committed = EditTransaction.commit(project, result.project);
    const pasted = ScoreTimeline.notes(committed.outline, cursor.staff, cursor.voiceIndex)
      .filter(entry => result.noteIds.includes(entry.note.id));
    const first = pasted[0], last = pasted.at(-1);
    if (!first || !last) return { ok: false as const, reason: 'invalid-passage' as PassagePasteFailureReason };
    const nextCursor: Timeline.TimelineCursor = {
      ...cursor,
      positionSixteenths: last.measureStartSixteenths + last.positionSixteenths,
      pitch: last.note.pitches[0]?.midi ?? cursor.pitch,
      focusedNoteId: last.note.id,
      focusedGraceId: null,
      focusedPitchIndex: null,
      selectionAnchorNoteId: first.note.id === last.note.id ? null : first.note.id,
    };
    return { ok: true as const, project: committed, cursor: nextCursor };
  }
  export function toggleTie(project: ScoreProject, cursor: Timeline.TimelineCursor) {
    const result = Timeline.toggleTieToAdjacentTimelineNote(project, cursor);
    return result && EditTransaction.commit(project, result);
  }
  export function convertTuplet(project: ScoreProject, cursor: Timeline.TimelineCursor) {
    return finish(project, Timeline.convertFocusedTimelineTuplet(project, cursor));
  }
  export function addVoice(project: ScoreProject, cursor: Timeline.TimelineCursor) {
    const measure=ScoreTimeline.measureAt(project.outline,cursor.positionSixteenths)?.measure;
    return measure?EditTransaction.commit(project,ScoreStaff.addVoice(project,measure.id,cursor.staff,cursor.voiceIndex)):project;
  }
  export function addGrace(project: ScoreProject, cursor: Timeline.TimelineCursor) {
    return finish(project, Grace.addBeforeGrace(project, cursor));
  }
  export function removeGrace(project: ScoreProject, cursor: Timeline.TimelineCursor) {
    return finish(project, Grace.deleteFocusedGrace(project, cursor));
  }
  export function moveGracePitch(project: ScoreProject, cursor: Timeline.TimelineCursor, direction: -1 | 1, diatonic = false, octave = false) {
    return finish(project, Grace.moveGracePitch(project, cursor, direction, diatonic, octave));
  }
  export function connectSlur(project: ScoreProject, noteIds: string[]) {
    return EditTransaction.commit(project, ScoreSlur.add(project, noteIds));
  }
  export function disconnectSlur(project: ScoreProject, noteIds: string[]) {
    return EditTransaction.commit(project, ScoreSlur.remove(project, noteIds));
  }
  /** All modal fields commit together; no intermediate setting update reaches reconciliation. */
  export function configure(project: ScoreProject, cursor: Timeline.TimelineCursor, settings: NoteSettings): ScoreProject {
    const id = cursor.focusedNoteId;
    if (!id) return project;
    const selected = Timeline.getSelectedTimelineNotes(project.outline,cursor);
    const note = selected[0]?.note;
    if (!note || selected.length !== 1 || Grace.getFocusedGrace(project.outline,cursor)) return project;
    const error = validateExpressionDraft({detail:null,row:0,draft:{
      ...(settings.staccato ? {staccato:{...settings.staccato}} : {}),
      ...(settings.arpeggio ? {arpeggio:{...settings.arpeggio}} : {}),
      ...(settings.trill ? {trill:{...settings.trill}} : {}),
    }},note);
    if (error || settings.trill && !ScoreTrill.canApply(project,id)) return project;
    if (settings.tempo && (!ScoreTempo.anchors(project).some(anchor=>anchor.noteId===id) ||
      settings.tempo.bpm !== null && (!Number.isInteger(settings.tempo.bpm) || settings.tempo.bpm<10 || settings.tempo.bpm>400))) return project;
    if (settings.clef && (!ScoreClef.anchors(project).some(anchor=>anchor.noteId===id) ||
      settings.clef.value !== null && !['treble','bass'].includes(settings.clef.value))) return project;
    let next = NoteExpressions.set(project,{noteId:id,staff:cursor.staff},settings);
    next = ScoreTrill.set(next, id, settings.trill);
    if (settings.tempo) next = ScoreTempo.set(next, id, settings.tempo.bpm);
    if (settings.clef) next = ScoreClef.set(next, id, settings.clef.value);
    return EditTransaction.commit(project, next);
  }
}
export default NoteEditor;
