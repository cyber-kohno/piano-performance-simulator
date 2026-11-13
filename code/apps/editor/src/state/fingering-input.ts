import ScoreFingerings, { type FingeringRules } from '../domain/score/score-fingerings.ts';
import type { PianoFingering } from '../domain/score/types.ts';

namespace FingeringInput {
  /** Empty input removes the optional sequence; undefined denotes invalid input. */
  export function parseTrill(value: string, attackCount: number): PianoFingering[] | null | undefined {
    if(value === '') return null;
    if(!Number.isInteger(attackCount)||attackCount<2||attackCount>128||value.length!==attackCount||!/^[1-5]+$/.test(value)) return undefined;
    return [...value].map(digit=>Number(digit) as PianoFingering);
  }
  export function parse(value: string, rules: FingeringRules): {
    fingering: PianoFingering; substitutionFingering?: PianoFingering;
  } | undefined {
    const match = /^([1-5])(?:-([1-5]))?$/.exec(value);
    if (!match) return undefined;
    const fingering = Number(match[1]) as PianoFingering;
    const substitutionFingering = match[2] === undefined ? undefined : Number(match[2]) as PianoFingering;
    if (!ScoreFingerings.allows(rules, fingering, substitutionFingering)) return undefined;
    return substitutionFingering === undefined ? { fingering } : { fingering, substitutionFingering };
  }
}

export default FingeringInput;
