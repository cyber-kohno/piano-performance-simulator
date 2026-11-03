import type { NoteValue,TimeSignature } from './types.ts';
import WrittenValue from '../theory/written-value.ts';
import NotationGrid from './notation-grid.ts';
namespace RhythmSpelling {
  export function spell(position: number,length: number,meter: TimeSignature): NoteValue[]|undefined {
    const values: NoteValue[]=[
      { type: 'whole',dots: 0 },{ type: 'half',dots: 1 },{ type: 'half',dots: 0 },
      { type: 'quarter',dots: 1 },{ type: 'quarter',dots: 0 },{ type: 'eighth',dots: 1 },
      { type: 'eighth',dots: 0 },{ type: '16th',dots: 1 },{ type: '16th',dots: 0 },{ type: '32nd',dots: 0 },
    ];
    const compound=meter.unit===8&&meter.cnt>=6&&meter.cnt%3===0;
    const beat=compound? 6:16/meter.unit;
    const aligned=(at: number,unit: number) => Math.abs(at/unit-Math.round(at/unit))<1e-8;
    const memo=new Map<number,NoteValue[]>();
    const solve=(remaining: number): NoteValue[] => {
      if(remaining===0) return [];
      const cached=memo.get(remaining);
      if(cached) return cached;
      let best: NoteValue[]|undefined;
      const at=position+length-remaining;
      const beatOffset=at-Math.floor(at/beat+1e-8)*beat;
      const nextBeat=(Math.floor(at/beat+1e-8)+1)*beat;
      for(const value of values) {
        const steps=WrittenValue.sixteenths(value);
        if(steps>remaining) continue;
        const base=WrittenValue.sixteenths({ ...value,dots: 0 });
        // Sub-beat values align inside the beat; dotted compound beats align to their group.
        const basePosition=compound&&base<beat? beatOffset:at;
        const compoundBeatValue=compound&&aligned(steps,beat)&&aligned(at,steps);
        if(!aligned(basePosition,base)&&!compoundBeatValue) continue;
        // An offbeat prefix ends at the next beat before a larger value can begin.
        if(!aligned(at,beat)&&at+steps>nextBeat+1e-8) continue;
        if(compound&&steps>beat&&!aligned(steps,beat)) continue;
        const candidate=[value,...solve(remaining-steps)];
        // Fewest segments; prefer an undotted prefix on ties (7 = quarter + dotted eighth).
        if(!best||candidate.length<best.length||
          (candidate.length===best.length&&value.dots===0&&best[0].dots!==0)) best=candidate;
      }
      memo.set(remaining,best!);
      return best!;
    };
    return NotationGrid.contains(length)&&length>0? solve(length):undefined;
  }


}
export default RhythmSpelling;
