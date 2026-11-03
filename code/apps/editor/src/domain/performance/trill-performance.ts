
import ScoreTrill from "../score/score-trill.ts";
import type { TrillSettings } from '../score/types.ts';

namespace TrillPerformance {
  /** Even attacks, derived across the whole range. No metrical notes are inserted. */
  export function attacks(main:number, auxiliary:number, settings:TrillSettings, duration:number) {
    if(!ScoreTrill.validate(settings) || !Number.isFinite(duration) || duration<=0) return [];
    return Array.from({length:settings.attackCount},(_,index)=>({
      midi:(index%2===0)===(settings.start==='main') ? main : auxiliary,
      offset:index*duration/settings.attackCount,
      duration:duration/settings.attackCount,
    }));
  }
}
export default TrillPerformance;
