import { changeExpressionField } from './expression-editor.ts';

export type TempoEditor = { bpm: number | null; detail: boolean; currentTempo: number };
export function createTempoEditor(bpm: number | undefined, currentTempo: number): TempoEditor {
  return { bpm: bpm ?? null, currentTempo, detail: false };
}
/** Optional parent + detail editing follows the existing expression editor. */
export function controlTempoEditor(editor: TempoEditor, key: string): TempoEditor {
  if (!editor.detail) {
    if (key === 'Enter') return { ...editor, bpm: editor.bpm ?? editor.currentTempo, detail: true };
    if (key === 'Delete') return { ...editor, bpm: null };
    return editor;
  }
  if (key === 'Backspace') return { ...editor, detail: false };
  if (editor.bpm !== null && (key === 'ArrowLeft' || key === 'ArrowRight')) {
    return { ...editor, bpm: changeExpressionField({ id: 'bpm', label: 'BPM', kind: 'number', min: 10, max: 400, step: 1 },
      editor.bpm, key === 'ArrowLeft' ? -1 : 1) as number };
  }
  return editor;
}
