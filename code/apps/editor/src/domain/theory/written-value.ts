import type { NoteValue } from './notation-types.ts';
namespace WrittenValue {
  const VALUE_SIXTEENTHS: Record<NoteValue['type'], number> = {
    whole: 16, half: 8, quarter: 4, eighth: 2, '16th': 1, '32nd': 0.5,
  };

  export function sixteenths(value: NoteValue): number {
    return VALUE_SIXTEENTHS[value.type] * (2 - 2 ** -value.dots);
  }

  export function label(value: NoteValue): string {
    return `1/${16 / VALUE_SIXTEENTHS[value.type]}${'.'.repeat(value.dots)}`;
  }

  export function entries() { return Object.entries(VALUE_SIXTEENTHS) as [NoteValue['type'],number][]; }

}
export default WrittenValue;
