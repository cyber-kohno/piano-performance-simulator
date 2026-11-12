import ScoreFingerings, { type FingeringRules } from '../domain/score/score-fingerings.ts';
import type { PianoFingering } from '../domain/score/types.ts';

namespace FingeringInput {
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
