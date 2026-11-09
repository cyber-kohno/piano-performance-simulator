import PitchSpelling from '../theory/pitch-spelling.ts';
import type { KeySignature, NoteValue, PianoPitch } from './types.ts';

export type AuthoringNote = { value: string; pitches: string[]; tie?: boolean };
export type AuthoringRest = { value: string; rest: true };
export type AuthoringTuplet = { tuplet: { actual: number; normal: number; base: string; events: (AuthoringNote | AuthoringRest)[] } };
export type AuthoringEvent = AuthoringNote | AuthoringRest | AuthoringTuplet;
export type AuthoringMeasure = { upper?: AuthoringEvent[][]; lower?: AuthoringEvent[][]; length?: [number, number] };
export type AuthoringSettings = { meter: [number, number]; keyFifths: number; tempo: number };
export type AuthoringOperation =
  | { type: 'create_score'; settings: AuthoringSettings; measures: AuthoringMeasure[] }
  | { type: 'append_measures'; measures: AuthoringMeasure[] };

export class AuthoringError extends Error {
  code: string;
  constructor(code: string, path: string, message: string) {
    super(`${path}: ${message}`);
    this.code = code;
  }
}

namespace ScoreAuthoringInput {
  export function fail(path: string, message: string, code = 'INVALID_SCORE_INPUT'): never {
    throw new AuthoringError(code, path, message);
  }
  export function record(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'Expected an object.');
    const result = value as Record<string, unknown>;
    for (const key of Object.keys(result)) if (!keys.includes(key)) fail(`${path}.${key}`, 'Unsupported field.');
    return result;
  }
  export function integer(value: unknown, min: number, max: number, path: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
      fail(path, `Expected an integer from ${min} to ${max}.`);
    return value;
  }
  export function array(value: unknown, min: number, max: number, path: string): unknown[] {
    if (!Array.isArray(value) || value.length < min || value.length > max)
      fail(path, `Expected an array with ${min}–${max} items.`);
    return value;
  }
  export function noteValue(value: unknown, path: string): NoteValue {
    if (typeof value !== 'string' || !/^(1|2|4|8|16|32)\.{0,2}$/.test(value))
      fail(path, 'Expected 1, 2, 4, 8, 16 or 32 followed by zero to two dots.');
    const types: Record<string, NoteValue['type']> = { '1': 'whole', '2': 'half', '4': 'quarter', '8': 'eighth', '16': '16th', '32': '32nd' };
    return { type: types[value.replaceAll('.', '')], dots: value.split('.').length - 1 };
  }
  export function pitch(value: unknown, key: KeySignature, path: string): PianoPitch {
    const match = typeof value === 'string' ? /^([A-G])(bb|##|b|#)?(-1|[0-9])$/.exec(value) : null;
    if (!match) fail(path, 'Expected an absolute pitch such as C4, F#4 or Bb3.');
    const alter = ({ bb: -2, b: -1, '#': 1, '##': 2 } as Record<string, number>)[match[2]] ?? 0;
    const natural = ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as Record<string, number>)[match[1]];
    const midi = (Number(match[3]) + 1) * 12 + natural + alter;
    integer(midi, 21, 108, path);
    for (const direction of [undefined, 'up', 'down'] as const) {
      const spelling = PitchSpelling.forPreview(midi, key, direction);
      if (spelling.step === match[1] && spelling.alter === alter && spelling.octave === Number(match[3]))
        return direction ? { midi, spellingDirection: direction } : { midi };
    }
    return fail(path, 'This spelling cannot be preserved by the current score model.', 'UNSUPPORTED_SPELLING');
  }
}
export default ScoreAuthoringInput;
