import Input from './score-authoring-input.ts';
import type { PianoNote, PianoPitch, PianoGraceNote, PianoTuplet, ScoreProject, MeasureBlock } from './types.ts';

/** The supported JSON Schema subset is shared with the generated Rust tool schema. */
export type EditSchema = {
  type?: 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean' | 'null';
  properties?: Record<string, EditSchema>; required?: string[]; additionalProperties?: boolean;
  items?: EditSchema; anyOf?: EditSchema[]; enum?: unknown[];
  minimum?: number; maximum?: number; minItems?: number; maxItems?: number;
  minLength?: number; maxLength?: number; pattern?: string; description?: string;
};
const str: EditSchema = { type: 'string', minLength: 1, maxLength: 256 };
const num = (minimum: number, maximum: number): EditSchema => ({ type: 'number', minimum, maximum });
const int = (minimum: number, maximum: number): EditSchema => ({ type: 'integer', minimum, maximum });
const en = (...values: string[]): EditSchema => ({ type: 'string', enum: values });
const arr = (items: EditSchema, minItems = 1, maxItems = 256): EditSchema => ({ type: 'array', items, minItems, maxItems });
const obj = (properties: Record<string, EditSchema>, required = Object.keys(properties)): EditSchema =>
  ({ type: 'object', properties, required, additionalProperties: false });
const nullable = (schema: EditSchema): EditSchema => ({ anyOf: [schema, { type: 'null' }] });
const value: EditSchema = { type: 'string', pattern: '^(1|2|4|8|16|32)\\.{0,2}$' };
const pitch: EditSchema = { type: 'string', pattern: '^([A-G])(bb|##|b|#)?(-1|[0-9])$' };
const pitches = arr(pitch, 1, 88);
const note = obj({ value, pitches, tie: { type: 'boolean' } }, ['value', 'pitches']);
const rest = obj({ value, rest: { type: 'boolean', enum: [true] } });
const simple: EditSchema = { anyOf: [note, rest] };
const event: EditSchema = { anyOf: [note, rest, obj({ tuplet: obj({ actual: int(2, 64), normal: int(1, 64), base: value, events: arr(simple, 2, 64) }) })] };
const length = arr(int(1, 256), 2, 2);
const measure = obj({ upper: arr(arr(event), 1, 3), lower: arr(arr(event), 1, 3), length }, []);
const measures = arr(measure, 1, 32);
const staff = en('upperStaff', 'lowerStaff');
const settings = obj({ meter: arr(int(1, 64), 2, 2), keyFifths: int(-7, 7), tempo: int(10, 400) });
const fraction = obj({ numerator: int(0, 1048576), denominator: int(1, 1048576) });
const position = obj({ measureId: str, offset: { ...fraction, description: 'Exact offset within the measure, measured in quarter notes. 1/2 is an eighth note. Only a stop event may use the score end.' } });
const staccato = obj({ type: en('normal', 'staccatissimo'), lengthRatio: num(0.1, 0.9) });
const accent = { ...obj({ velocityOffset: int(0, 50) }), description: 'Accent on an attacked note only (no incoming tie). velocityOffset is an integer 0–50 added to base velocity; UI default is 18. Playback caps velocity at 127.' };
const fermata = { ...obj({ lengthRatio: num(1, 4) }), description: 'Fermata on a pitched note/chord with no outgoing tie. All written durations and tuplets are allowed; rests and grace notes are not targets. lengthRatio is 1.0–4.0 in steps of 0.1; UI default is 2.0. Across all voices/staves, overlapping fermata note spans must share the same absolute end position. Their merged span runs from the earliest start to that common end; the lowest voice index supplies the ratio, with upper staff breaking ties. Written value or absolute timing edits remove affected fermatas, including shifted successors. Pitch/chord edits retain them. An explicit assignment after timing edits in a batch can reapply a valid fermata. Preview playback stretches the shared range globally, including other voices, rests and pedal events; the playback cursor slows by the same factor.' };
const arpeggio = obj({ type: en('normal', 'down'), spreadRatio: num(0.1, 1), timing: num(0, 1) });
const gracePerformance = obj({ spreadRatio: num(0.1, 1), timing: num(0, 1) });
const grace = obj({ id: str, value, pitch, slash: { type: 'boolean' }, fingering: int(1, 5), substitutionFingering: int(1, 5) }, ['value', 'pitch', 'slash']);
const op = (name: string, properties: Record<string, EditSchema>, required = Object.keys(properties)): EditSchema =>
  obj({ type: en(name), ...properties }, ['type', ...required]);

namespace ScoreEditContract {
  export const operations: EditSchema = arr({ anyOf: [
    op('create_score', { settings, measures }), op('append_measures', { measures }),
    op('insert_measures', { afterMeasureId: nullable(str), measures }),
    op('remove_measures', { measureIds: arr(str, 1, 32) }),
    op('replace_voice', { measureId: str, staff, voiceIndex: int(0, 2), events: arr(event) }),
    op('remove_voice', { measureId: str, staff, voiceIndex: int(0, 2) }),
    op('set_pitches', { noteId: str, pitches }),
    op('set_value', { elementId: str, value }),
    op('set_rest', { noteId: str }),
    op('set_grace_notes', { noteId: str, notes: arr(grace, 0, 64), performance: nullable(gracePerformance) }, ['noteId', 'notes']),
    op('set_note_expression', { noteId: str, staccato: nullable(staccato), accent: nullable(accent), fermata: nullable(fermata), arpeggio: nullable(arpeggio) }, ['noteId']),
    op('set_fingering', { noteId: str, graceNoteId: str, pitchIndex: int(0, 87), fingering: nullable(int(1, 5)), substitutionFingering: nullable(int(1, 5)) }, ['noteId', 'pitchIndex', 'fingering']),
    op('set_tie', { fromNoteId: str, toNoteId: nullable(str) }),
    op('set_slur', { slurId: str, startNoteId: str, endNoteId: str }, ['startNoteId', 'endNoteId']),
    op('remove_slur', { slurId: str }),
    { ...op('set_trill', { noteId: str, settings: nullable(obj({ auxiliary: en('diatonic', 'half', 'whole'), start: en('main', 'auxiliary'), attackCount: int(2, 128),
      fingerings: arr(int(1, 5), 2, 128) }, ['auxiliary', 'start', 'attackCount'])) }),
      description: 'Trill over a single-note tie chain. Optional settings.fingerings lists one finger (1–5) per attack in performance order; its length must equal attackCount. No substitutions. Omit fingerings to clear the sequence. Setting a trill clears ordinary pitch fingerings/substitutions across its chain. Use set_trill, not set_fingering, for its principal notes.' },
    op('set_pedal_event', { position, action: en('start', 'change', 'stop') }),
    op('remove_pedal_event', { position }),
    op('set_ottava_event', { position, staff, action: en('start', 'stop') }),
    op('remove_ottava_event', { position, staff }),
    op('set_tempo_change', { noteId: str, bpm: nullable(int(10, 400)) }),
    op('set_clef_change', { noteId: str, clef: nullable(en('treble', 'bass')) }),
    { ...op('set_dynamic_change', { noteId: str, level: nullable(en('ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff')), velocity: int(1, 127) }), description: 'Global dynamic state from this upper-staff voice-1 written note, including simultaneous attacks, until the next change. Tied notes, chords and tuplets are allowed; rests and grace notes are not anchors. null removes the change. velocity replaces absolute base preview velocity until the next change, independently of the notation level. Initial base velocity is 88. Deleted/rested anchors are removed automatically.' },
    op('set_initial_values', { settings }),
    op('set_measure_length', { measureId: str, length }),
    { ...op('set_key_change', { beforeMeasureId: str, afterBlockId: str, keyChangeId: str, keyFifths: nullable(int(-7, 7)) }, ['keyFifths']),
      description: 'Specify exactly one of beforeMeasureId, afterBlockId, or existing keyChangeId. null keyFifths removes the targeted change.' },
    { ...op('insert_section', { beforeMeasureId: str, afterBlockId: str, name: { type: 'string', maxLength: 256 } }, ['name']),
      description: 'Specify exactly one of beforeMeasureId or afterBlockId. afterBlockId can create a trailing empty section.' },
    op('rename_section', { sectionId: str, name: { type: 'string', maxLength: 256 } }),
    op('remove_section', { sectionId: str }),
  ] }, 1, 64);

  export const names = operations.items!.anyOf!.map(schema => schema.properties!.type.enum![0] as string);

  // Adding a persisted notation field now requires an explicit MCP coverage decision.
  export const fieldCoverage = {
    note: { id: ['create_score'], kind: ['create_score', 'set_rest'], value: ['set_value'], pitches: ['set_pitches'],
      tieFrom: ['set_tie'], tieTo: ['set_tie'], beforeGraceNotes: ['set_grace_notes'], gracePerformance: ['set_grace_notes'],
      staccato: ['set_note_expression'], accent: ['set_note_expression'], fermata: ['set_note_expression'], arpeggio: ['set_note_expression'] },
    pitch: { midi: ['set_pitches'], spellingDirection: ['set_pitches'], fingering: ['set_fingering'], substitutionFingering: ['set_fingering'] },
    grace: { id: ['set_grace_notes'], pitches: ['set_grace_notes'], value: ['set_grace_notes'], slash: ['set_grace_notes'] },
    tuplet: { id: ['replace_voice'], kind: ['replace_voice'], actual: ['replace_voice'], normal: ['replace_voice'], baseType: ['replace_voice'], elements: ['replace_voice'] },
    project: { outline: ['append_measures', 'insert_measures', 'remove_measures', 'insert_section', 'set_key_change'],
      slurs: ['set_slur', 'remove_slur'], trills: ['set_trill'], clefChanges: ['set_clef_change'], tempoChanges: ['set_tempo_change'], dynamicChanges: ['set_dynamic_change'] },
    measure: { length: ['set_measure_length'], upperStaff: ['replace_voice'], lowerStaff: ['replace_voice'],
      pedalEvents: ['set_pedal_event', 'remove_pedal_event'], ottavaEvents: ['set_ottava_event', 'remove_ottava_event'] },
  } satisfies { note: Record<keyof PianoNote, string[]>; pitch: Record<keyof PianoPitch, string[]>; grace: Record<keyof PianoGraceNote, string[]>;
    tuplet: Record<keyof PianoTuplet, string[]>; project: Record<keyof ScoreProject, string[]>; measure: Record<keyof MeasureBlock['data'], string[]> };

  export function validate(value: unknown, schema: EditSchema = operations, path = 'operations'): void {
    if (schema.anyOf) {
      // Operation discriminator gives useful field diagnostics instead of a generic union failure.
      const type = value && typeof value === 'object' ? (value as Record<string, unknown>).type : undefined;
      const selected = schema.anyOf.find(candidate => candidate.properties?.type?.enum?.includes(type));
      if (selected) return validate(value, selected, path);
      const actualType = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
      const matchingTypes = schema.anyOf.filter(candidate => candidate.type === actualType);
      if (matchingTypes.length === 1) return validate(value, matchingTypes[0], path);
      for (const candidate of schema.anyOf) {
        try { validate(value, candidate, path); return; } catch { /* try the next shape */ }
      }
      Input.fail(path, 'Unsupported operation or event shape.');
    }
    if (schema.enum && !schema.enum.includes(value)) Input.fail(path, `Expected one of ${JSON.stringify(schema.enum)}.`);
    if (schema.type === 'object') {
      const record = Input.record(value, Object.keys(schema.properties ?? {}), path);
      for (const key of schema.required ?? []) if (!(key in record)) Input.fail(`${path}.${key}`, 'Required field.');
      for (const [key, child] of Object.entries(record)) validate(child, schema.properties![key], `${path}.${key}`);
    } else if (schema.type === 'array') {
      Input.array(value, schema.minItems ?? 0, schema.maxItems ?? 10000, path)
        .forEach((child, i) => validate(child, schema.items!, `${path}[${i}]`));
    } else if (schema.type === 'string') {
      if (typeof value !== 'string' || value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity) ||
        schema.pattern && !new RegExp(schema.pattern).test(value)) Input.fail(path, 'Invalid string.');
    } else if (schema.type === 'integer' || schema.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value) || schema.type === 'integer' && !Number.isSafeInteger(value) ||
        value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) Input.fail(path, 'Invalid number.');
    } else if (schema.type === 'boolean' && typeof value !== 'boolean' || schema.type === 'null' && value !== null) Input.fail(path, `Expected ${schema.type}.`);
  }
}
export default ScoreEditContract;
