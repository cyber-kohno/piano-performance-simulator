import type { ArpeggioSettings, PianoNote, StaccatoSettings, TrillSettings } from '../model/project.ts';
import { DEFAULT_TRILL, isValidTrill } from '../model/trill.ts';
import { canApplyArpeggio, isValidArpeggio } from '../model/arpeggio.ts';

type FieldValue = string | number | boolean;
export type ExpressionValues = Record<string, FieldValue>;
export type ExpressionDraft = Record<string, ExpressionValues | undefined>;
export type ExpressionEditor = { draft: ExpressionDraft; detail: string | null; row: number; error?: string };
export type ExpressionField = {
  id: string; label: string;
  kind: 'choice' | 'flag' | 'number';
  choices?: { value: string; label: string }[];
  min?: number; max?: number; step?: number;
};
export type ExpressionDefinition = {
  id: string; label: string; fields: ExpressionField[];
  available: (note: PianoNote, draft: ExpressionDraft) => boolean;
  unavailableReason: (note: PianoNote, draft: ExpressionDraft) => string;
  create: () => ExpressionValues;
  afterChange?: (values: ExpressionValues, fieldId: string) => ExpressionValues;
};
export const expressionDefinitions: ExpressionDefinition[] = [{
  id: 'staccato', label: 'Staccato',
  available: (note,draft) => !note.tieTo && !draft.arpeggio,
  unavailableReason: note => note.tieTo ? 'Unavailable: this note is tied to a following note.' : 'Remove Arpeggio before using Staccato.',
  create: () => ({ type: 'normal', lengthRatio: 0.5 }),
  fields: [
    { id: 'type', label: 'Type', kind: 'choice', choices: [{value:'normal',label:'Normal'},{value:'staccatissimo',label:'Staccatissimo'}] },
    { id: 'lengthRatio', label: 'Length ratio', kind: 'number', min: 0.1, max: 0.9, step: 0.1 },
  ],
  afterChange: (values, fieldId) => fieldId === 'type'
    ? { ...values, lengthRatio: values.type === 'normal' ? 0.5 : 0.3 } : values,
}, {
  id:'arpeggio', label:'Arpeggio',
  available:(note,draft) => canApplyArpeggio(note) && !draft.staccato,
  unavailableReason: (note,draft) => note.pitches.length < 2 ? 'Unavailable: select a chord with at least two pitches.'
    : note.value.type === '32nd' ? 'Unavailable: arpeggio cannot be used on a 32nd note.'
    : note.tieFrom ? 'Unavailable: this note is tied from a preceding note.' : draft.staccato ? 'Remove Staccato before using Arpeggio.' : '',
  create:() => ({type:'normal',spreadRatio:0.5,timing:1}),
  fields:[
    {id:'type',label:'Type',kind:'choice',choices:[{value:'normal',label:'Normal'},{value:'down',label:'Down'}]},
    {id:'spreadRatio',label:'Spread ratio',kind:'number',min:0.1,max:1,step:0.1},
    {id:'timing',label:'Timing',kind:'number',min:0,max:1,step:0.1},
  ],
}, {
  id:'trill', label:'Trill',
  available:note=>note.pitches.length===1,
  unavailableReason:()=> 'Unavailable: Trill requires a single pitch throughout the tie chain.',
  create:()=>({...DEFAULT_TRILL}),
  fields:[
    {id:'auxiliary',label:'Auxiliary note',kind:'choice',choices:[{value:'diatonic',label:'Follow key signature'},{value:'half',label:'Semitone above'},{value:'whole',label:'Whole tone above'}]},
    {id:'start',label:'Start note',kind:'choice',choices:[{value:'main',label:'Main'},{value:'auxiliary',label:'Auxiliary'}]},
    {id:'attackCount',label:'Attack count',kind:'number',min:2,max:128,step:1},
  ],
}];
export function createExpressionEditor(note: PianoNote, trill?: TrillSettings): ExpressionEditor {
  return { draft: { ...(note.staccato ? {staccato:{...note.staccato}} : {}),
    ...(note.arpeggio ? {arpeggio:{...note.arpeggio}} : {}),
    ...(trill ? {trill:{...trill}} : {}) }, detail: null, row: 0 };
}
export function getExpressionRows(editor: ExpressionEditor, note: PianoNote) {
  const definition = expressionDefinitions.find(item => item.id === editor.detail);
  if (!definition) return expressionDefinitions.map(item => ({ id:item.id, label:item.label,
    value: editor.draft[item.id] ? 'On' : 'Off', disabled: !item.available(note,editor.draft), parent:true }));
  const values = editor.draft[definition.id] ?? {};
  return definition.fields.map(field => ({ id:field.id, label:field.label,
    value: field.kind === 'choice' ? field.choices?.find(choice => choice.value === values[field.id])?.label ?? '—'
      : field.kind === 'flag' ? values[field.id] ? 'On' : 'Off' : typeof values[field.id] === 'number' ? Number(values[field.id]).toFixed(field.step === 1 ? 0 : 1) : '—',
    disabled: !definition.available(note,editor.draft), parent:false }));
}
/** Shared choice/flag/number editing; changes never mutate the original values. */
export function changeExpressionField(field: ExpressionField, value: FieldValue, direction: -1 | 1): FieldValue {
  if (field.kind === 'flag') return direction === 1;
  if (field.kind === 'choice') {
    const choices = field.choices ?? [];
    const index = choices.findIndex(choice => choice.value === value);
    return choices[Math.max(0,Math.min(choices.length-1,index+direction))]?.value ?? value;
  }
  if (typeof value !== 'number') return value;
  const min=field.min ?? 0, max=field.max ?? 1, step=field.step ?? 1;
  const index=Math.max(0,Math.min(Math.round((max-min)/step),Math.round((value-min)/step)+direction));
  return Number((min+index*step).toFixed(10));
}
export function controlExpressionEditor(editor: ExpressionEditor, note: PianoNote, key: string): ExpressionEditor {
  const rows=getExpressionRows(editor,note);
  if (key === 'ArrowUp' || key === 'ArrowDown') return { ...editor, row:Math.max(0,Math.min(rows.length-1,editor.row+(key==='ArrowUp'?-1:1))) };
  if (key === 'Backspace') return editor.detail ? { ...editor, detail:null,
    row:Math.max(0,expressionDefinitions.findIndex(item=>item.id===editor.detail)), error:undefined } : editor;
  const definition=expressionDefinitions.find(item=>item.id===(editor.detail ?? rows[editor.row]?.id));
  if (!definition || !definition.available(note,editor.draft)) return editor;
  if (!editor.detail) {
    if (key === 'Delete') {
      const draft={...editor.draft};delete draft[definition.id];
      return { ...editor,draft,error:undefined };
    }
    if (key === 'Enter') return { ...editor,
      draft:{...editor.draft,[definition.id]:editor.draft[definition.id] ?? definition.create()},
      detail:definition.fields.length ? definition.id : null,row:definition.fields.length ? 0 : editor.row,error:undefined };
    return editor;
  }
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return editor;
  const field=definition.fields[editor.row], previous=editor.draft[definition.id];
  if (!field || !previous) return editor;
  const next=changeExpressionField(field,previous[field.id],key==='ArrowLeft'?-1:1);
  if (next===previous[field.id]) return editor;
  let values={...previous,[field.id]:next};
  if (definition.afterChange) values=definition.afterChange(values,field.id);
  return { ...editor,draft:{...editor.draft,[definition.id]:values},error:undefined };
}
/** Validation boundary: only valid, independent notation/performance settings reach the score. */
export function validateExpressionDraft(editor: ExpressionEditor, note: PianoNote): string | undefined {
  if (Object.keys(editor.draft).some(id=>!expressionDefinitions.some(item=>item.id===id))) return 'Unknown expression setting.';
  const trill=trillFromDraft(editor);
  if(trill && (note.pitches.length!==1 || !isValidTrill(trill))) return 'Invalid or unavailable trill settings.';
  const arpeggio=arpeggioFromDraft(editor);
  if (arpeggio && editor.draft.staccato) return 'Staccato and Arpeggio cannot be used together.';
  if (arpeggio && (!canApplyArpeggio(note) || !isValidArpeggio(arpeggio))) return 'Invalid or unavailable arpeggio settings.';
  const values=editor.draft.staccato;
  if (!values) return note.tieTo && note.staccato ? 'Staccato cannot be changed while this note has an outgoing tie.' : undefined;
  if (!['normal','staccatissimo'].includes(String(values.type)) || typeof values.lengthRatio !== 'number' ||
    values.lengthRatio<0.1 || values.lengthRatio>0.9 || !Number.isFinite(values.lengthRatio) ||
    Math.abs(values.lengthRatio*10-Math.round(values.lengthRatio*10))>1e-8) return 'Invalid staccato settings.';
  if (note.tieTo && (values.type!==note.staccato?.type || values.lengthRatio!==note.staccato?.lengthRatio)) return 'Staccato cannot be changed while this note has an outgoing tie.';
}
export function staccatoFromDraft(editor: ExpressionEditor): StaccatoSettings | undefined {
  const values=editor.draft.staccato;
  return values ? { type:values.type as StaccatoSettings['type'],lengthRatio:values.lengthRatio as number } : undefined;
}
export function arpeggioFromDraft(editor: ExpressionEditor): ArpeggioSettings | undefined {
  const values=editor.draft.arpeggio;
  return values ? { type:values.type as ArpeggioSettings['type'], spreadRatio:values.spreadRatio as number, timing:values.timing as number } : undefined;
}
export function trillFromDraft(editor: ExpressionEditor): TrillSettings | undefined {
  const value=editor.draft.trill;
  return value ? {auxiliary:value.auxiliary as TrillSettings['auxiliary'],start:value.start as TrillSettings['start'],attackCount:value.attackCount as number} : undefined;
}
