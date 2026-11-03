import type { TimeSignature, MeasureLength } from './notation-types.ts';
namespace Meter {
  export function beatLength(meter: TimeSignature): MeasureLength {
    return { cnt: meter.unit === 8 && meter.cnt >= 6 && meter.cnt % 3 === 0 ? 3 : 1, unit: meter.unit };
  }

}
export default Meter;
