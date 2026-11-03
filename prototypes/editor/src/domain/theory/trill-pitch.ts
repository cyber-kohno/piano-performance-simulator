
import PitchSpelling from "./pitch-spelling.ts";
import type { KeySignature } from './notation-types.ts';

namespace TrillPitch {
  /** Auxiliary notation uses the next letter name above the main pitch. */
  export function above(main:number,key:KeySignature,mode:'diatonic'|'half'|'whole') {
    const names=['C','D','E','F','G','A','B'], naturals=[0,2,4,5,7,9,11];
    const spelling=PitchSpelling.forPreview(main,key), index=(names.indexOf(spelling.step)+1)%7;
    const octave=spelling.octave+(index===0?1:0), natural=(octave+1)*12+naturals[index];
    const order=key.fifths>=0 ? [3,0,4,1,5,2,6] : [6,2,5,1,4,0,3];
    const alter=mode==='diatonic' ? (order.slice(0,Math.abs(key.fifths)).includes(index) ? Math.sign(key.fifths) : 0)
      : main+(mode==='half'?1:2)-natural;
    return {midi:natural+alter,step:names[index],octave,alter};
  }
}
export default TrillPitch;
