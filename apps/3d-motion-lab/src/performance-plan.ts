import type { Hand, Vec3 } from './fingers';
import type { Note } from './motion';
import { isScaleNote, planScale, scaleConnection } from './scale-motion';
import type { ScalePlan, ScaleStep } from './scale-motion';

export type TimedGroup={notes:Note[];approach:number;release:number;windows?:{note:Note;start:number;end:number}[]};
export type PlannedRun={legacy:ScalePlan;smooth?:ScalePlan;wristAmount?:number};
export type PerformancePlan=Record<Hand,PlannedRun[]>;

const startOf=(g:TimedGroup)=>g.notes[0].time-g.approach;
const endOf=(g:TimedGroup)=>Math.max(...g.notes.map(n=>n.time+n.duration))+g.release;

// Pure planning, independent of rendering and playback order. Maximal runs are
// separated at chords, jumps, rests and unsupported finger changes.
export function planPerformance(groups:Record<Hand,TimedGroup[]>,targetFor:(note:Note)=>Vec3):PerformancePlan {
  const result:PerformancePlan={left:[],right:[]};
  for(const hand of ['left','right'] as const) {
    const part=groups[hand];
    for(let from=0;from<part.length;) {
      if(part[from].notes.length!==1||!isScaleNote(part[from].notes[0])){from++;continue;}
      let to=from+1;
      while(to<part.length&&part[to].notes.length===1&&scaleConnection(part[to-1].notes[0],part[to].notes[0]))to++;
      const input:ScaleStep[]=part.slice(from,to).map(g=>({note:g.notes[0],target:targetFor(g.notes[0]),approach:g.approach,release:g.release}));
      const legacy=planScale(input,'legacy');
      if(legacy) {
        const smooth=planScale(input,'smooth',legacy);
        // Fit each blend inside free air travel. Reserve half of the gap for
        // each neighboring run, so overlays cannot overlap or alter contacts.
        for(const plan of [legacy,smooth])if(plan) {
          const start=startOf(part[from]),end=endOf(part[to-1]);
          if(from>0)plan.blendStart=Math.max(plan.blendStart,(endOf(part[from-1])+start)/2);
          if(to<part.length)plan.blendEnd=Math.min(plan.blendEnd,(end+startOf(part[to]))/2);
        }
        result[hand].push({legacy,smooth});
      }
      from=to;
    }
  }
  // Both hands may expand contact windows. Check each against the other hand's
  // longest possible windows, including its smooth plans, before enabling it.
  // This conservative, symmetric check is independent of the evaluation order.
  const windows:Record<Hand,{note:Note;start:number;end:number}[]>={left:[],right:[]};
  for(const hand of ['left','right'] as const) {
    windows[hand]=groups[hand].flatMap(g=>g.windows??g.notes.map(note=>({note,start:startOf(g),end:endOf(g)})));
    for(const run of result[hand])if(run.smooth)for(const step of run.smooth.steps) {
      const window=windows[hand].find(w=>w.note===step.note)!;
      window.start=Math.min(window.start,step.note.time-step.approach);
      window.end=Math.max(window.end,step.note.time+step.note.duration+step.release);
    }
  }
  for(const hand of ['left','right'] as const)for(const run of result[hand]) {
    if(run.smooth?.steps.some(s=>windows[hand==='left'?'right':'left'].some(w=>
      w.note.midiNote===s.note.midiNote&&w.start<s.note.time+s.note.duration+s.release&&s.note.time-s.approach<w.end)))run.smooth=undefined;
  }
  return result;
}
