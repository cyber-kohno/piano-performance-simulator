import ScoreTimeline from '../domain/score/score-timeline.ts';
import ScoreTrill from '../domain/score/score-trill.ts';
import ScoreTempo from '../domain/score/score-tempo.ts';
import ScoreClef from '../domain/score/score-clef.ts';
import MusicalTime from '../domain/theory/musical-time.ts';
import type { ScoreProject, PianoStaffName } from '../domain/score/types.ts';
import { getSelectedTimelineNotes, type TimelineCursor } from './timeline-cursor.ts';
import { getFocusedGrace } from './grace-input.ts';
import { createChangesEditor, controlChangesEditor, type ChangesEditor } from './changes-editor.ts';
import { createExpressionEditor, controlExpressionEditor, validateExpressionDraft, staccatoFromDraft, arpeggioFromDraft, gracePerformanceFromDraft, trillFromDraft, type ExpressionEditor } from './expression-editor.ts';
export type NoteSettingsState = {
  target: { noteId: string; measureNumber: number; staff: PianoStaffName; voice: number; trillNoteCount: number };
  expression: ExpressionEditor; changes: ChangesEditor; tab: 'expression' | 'changes';
};
export type NoteSettingsKey = { key: string; shiftKey: boolean; repeat: boolean; isComposing: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean };
namespace NoteSettings {
  export function open(project: ScoreProject, cursor: TimelineCursor): NoteSettingsState | undefined {
    const selected = getSelectedTimelineNotes(project.outline, cursor);
    const focusedGrace = getFocusedGrace(project.outline, cursor);
    if (!focusedGrace && selected.length !== 1) return undefined;
    const target = focusedGrace?.parent ?? selected[0], position = MusicalTime.addNumbers(target.measureStartSixteenths, target.positionSixteenths);
    return {      
tab: 'expression',
      target: {        
noteId: target.note.id, staff: cursor.staff, voice: target.voiceIndex + 1, trillNoteCount: ScoreTrill.chain(project, target.note.id).length,
        measureNumber: project.outline.filter(block => block.type === 'measure').findIndex(block => block.id === target.measure.id) + 1      
},
      expression: createExpressionEditor(target.note, ScoreTrill.forNote(project, target.note.id)?.settings),
      changes: createChangesEditor(project.tempoChanges?.find(change => change.noteId === target.note.id)?.bpm, ScoreTempo.at(project, position),
        project.clefChanges?.find(change => change.noteId === target.note.id)?.clef, ScoreClef.at(project, cursor.staff, position))    
};
  }
  function settings(editor: NoteSettingsState) {
    return {      
staccato: staccatoFromDraft(editor.expression), arpeggio: arpeggioFromDraft(editor.expression),
      gracePerformance: gracePerformanceFromDraft(editor.expression), trill: trillFromDraft(editor.expression),
      ...(editor.target.staff === 'upperStaff' && editor.target.voice === 1 ? { tempo: { bpm: editor.changes.tempo.bpm } } : {}),
      ...(editor.target.voice === 1 ? { clef: { value: editor.changes.clef } } : {})    
};
  }
  export function control(project: ScoreProject, editor: NoteSettingsState, input: NoteSettingsKey): { editor: NoteSettingsState | null; commit?: ReturnType<typeof settings> } {
    const unchanged = { editor };
    if (input.isComposing || input.altKey || input.ctrlKey || input.metaKey) return unchanged;
    if (input.key === 'Escape') return { editor: null };
    if (input.key === 'Tab') return input.repeat ? unchanged : { editor: { ...editor, tab: editor.tab === 'expression' ? 'changes' : 'expression' } };
    const selected = ScoreTimeline.note(project.outline, editor.target.noteId, editor.target.staff);
    if (!selected) return { editor: { ...editor, expression: { ...editor.expression, error: 'The selected note is no longer available.' } } };
    if (input.shiftKey && input.key === 'Enter') {
      if (input.repeat) return unchanged;
      const error = validateExpressionDraft(editor.expression, selected.note);
      return error ? { editor: { ...editor, expression: { ...editor.expression, error } } } : { editor: null, commit: settings(editor) };
    }
    if (input.shiftKey || (input.repeat && !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(input.key))) return unchanged;
    return {      
editor: editor.tab === 'expression' ? { ...editor, expression: controlExpressionEditor(editor.expression, selected.note, input.key) } :
        { ...editor, changes: controlChangesEditor(editor.changes, input.key, editor.target.staff === 'upperStaff' && editor.target.voice === 1, editor.target.voice === 1) }    
};
  }
}
export default NoteSettings;
