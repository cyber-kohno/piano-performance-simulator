import { createTempoEditor, controlTempoEditor, type TempoEditor } from './tempo-editor.ts';
import type { Clef } from '../model/clef.ts';

export type ChangesEditor = { tempo: TempoEditor; clef: Clef | null; currentClef: Clef; row: number; detail: 'tempo' | 'clef' | null };
export function createChangesEditor(bpm: number | undefined, currentTempo: number, clef: Clef | undefined, currentClef: Clef): ChangesEditor {
  return { tempo: createTempoEditor(bpm, currentTempo), clef: clef ?? null, currentClef, row: 0, detail: null };
}
export function controlChangesEditor(editor: ChangesEditor, key: string, tempoAvailable: boolean, clefAvailable: boolean): ChangesEditor {
  if (!editor.detail) {
    if (key === 'ArrowUp' || key === 'ArrowDown') return { ...editor, row: key === 'ArrowUp' ? 0 : 1 };
    const field = editor.row === 0 ? 'tempo' : 'clef';
    if (!(field === 'tempo' ? tempoAvailable : clefAvailable)) return editor;
    if (key === 'Enter') return field === 'tempo'
      ? { ...editor, detail: field, tempo: controlTempoEditor(editor.tempo, key) }
      : { ...editor, detail: field, clef: editor.clef ?? editor.currentClef };
    if (key === 'Delete') return field === 'tempo'
      ? { ...editor, tempo: controlTempoEditor(editor.tempo, key) } : { ...editor, clef: null };
    return editor;
  }
  if (key === 'Backspace') return { ...editor, detail: null, tempo: { ...editor.tempo, detail: false } };
  if (editor.detail === 'tempo') return tempoAvailable ? { ...editor, tempo: controlTempoEditor(editor.tempo, key) } : editor;
  if (clefAvailable && (key === 'ArrowLeft' || key === 'ArrowRight')) return { ...editor, clef: key === 'ArrowLeft' ? 'treble' : 'bass' };
  return editor;
}
