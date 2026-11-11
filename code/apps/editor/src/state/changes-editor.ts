import { createTempoEditor, controlTempoEditor, type TempoEditor } from './tempo-editor.ts';
import type { Clef } from "../domain/score/score-clef.ts";
import ScoreDynamics from '../domain/score/score-dynamics.ts';
import type { DynamicLevel } from '../domain/score/types.ts';

export type ChangesEditor = { tempo: TempoEditor; clef: Clef | null; currentClef: Clef;
  velocity: number; dynamicRow: number; dynamic: DynamicLevel | null; currentDynamic: DynamicLevel; row: number; detail: 'tempo' | 'clef' | 'dynamic' | null };
export function createChangesEditor(bpm: number | undefined, currentTempo: number, clef: Clef | undefined, currentClef: Clef,
  dynamic?: DynamicLevel, currentDynamic: DynamicLevel = ScoreDynamics.defaultLevel, velocity?: number): ChangesEditor {
  return { tempo: createTempoEditor(bpm, currentTempo), clef: clef ?? null, currentClef,
    dynamic: dynamic ?? null, velocity: velocity ?? ScoreDynamics.defaultVelocities[dynamic ?? currentDynamic], dynamicRow: 0, currentDynamic, row: 0, detail: null };
}
export function controlChangesEditor(editor: ChangesEditor, key: string, tempoAvailable: boolean, clefAvailable: boolean, dynamicAvailable = tempoAvailable): ChangesEditor {
  if (!editor.detail) {
    if (key === 'ArrowUp' || key === 'ArrowDown') return { ...editor, row: Math.max(0, Math.min(2, editor.row + (key === 'ArrowUp' ? -1 : 1))) };
    const field = (['tempo', 'clef', 'dynamic'] as const)[editor.row];
    if (!(field === 'tempo' ? tempoAvailable : field === 'clef' ? clefAvailable : dynamicAvailable)) return editor;
    if (key === 'Enter') return field === 'tempo'
      ? { ...editor, detail: field, tempo: controlTempoEditor(editor.tempo, key) }
      : field === 'clef' ? { ...editor, detail: field, clef: editor.clef ?? editor.currentClef }
      : { ...editor, detail: field, dynamic: editor.dynamic ?? editor.currentDynamic };
    if (key === 'Delete') return field === 'tempo'
      ? { ...editor, tempo: controlTempoEditor(editor.tempo, key) } : field === 'clef' ? { ...editor, clef: null } : { ...editor, dynamic: null };
    return editor;
  }
  if (key === 'Backspace') return { ...editor, detail: null, tempo: { ...editor.tempo, detail: false } };
  if (editor.detail === 'tempo') return tempoAvailable ? { ...editor, tempo: controlTempoEditor(editor.tempo, key) } : editor;
  if (editor.detail === 'dynamic') {
    if (!dynamicAvailable) return editor;
    if (key === 'ArrowUp' || key === 'ArrowDown') return { ...editor, dynamicRow: key === 'ArrowUp' ? 0 : 1 };
    if (key !== 'ArrowLeft' && key !== 'ArrowRight') return editor;
    const delta = key === 'ArrowLeft' ? -1 : 1;
    if (editor.dynamicRow === 1) return { ...editor, velocity: Math.max(1, Math.min(127, editor.velocity + delta)) };
    const index = ScoreDynamics.levels.indexOf(editor.dynamic ?? editor.currentDynamic);
    const dynamic = ScoreDynamics.levels[Math.max(0, Math.min(ScoreDynamics.levels.length - 1, index + delta))];
    return { ...editor, dynamic, velocity: ScoreDynamics.defaultVelocities[dynamic] };
  }
  if (clefAvailable && (key === 'ArrowLeft' || key === 'ArrowRight')) return { ...editor, clef: key === 'ArrowLeft' ? 'treble' : 'bass' };
  return editor;
}
