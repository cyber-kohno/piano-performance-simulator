import { fingerPoints, curlForDrop, fingers, restPose } from './fingers';
import type { Vec3, Hand, Finger, JointPose } from './fingers';
import { planChord, chordPoses } from './chords';
import type { ChordPlan } from './chords';
import { transition } from './movement';
import type { MotionStyle, TravelStyle } from './movement';
import { applyScale } from './scale-motion';
import type { ScalePlan, IdleFingerStyle, StrikeStyle } from './scale-motion';
import { withWrist, wristAmount } from './wrist-motion';
import { planPerformance } from './performance-plan';
import type { PerformancePlan, PlannedRun } from './performance-plan';
import { keys } from './keyboard';
import { heldEvents, planHeld, heldFrame } from './held-motion';
import type { HeldPlan } from './held-motion';
import { normalizePerformance } from './score-input';
export { keys, WIDTH, KEYBOARD_WIDTH } from './keyboard';
export type { Vec3, Hand } from './fingers';
export type Note = { time:number; duration:number; midiNote:number; hand:Hand; finger:Finger; action?:'substitute';voice?:string };
export const TRAVEL=0.01, HOVER=0.018;
export const APPROACH=0.12, RELEASE=0.12, MOVE=0.3;
export const MIN_GAP=0.01;
type Group={notes:Note[]; approach:number; release:number; plan?:ChordPlan;held?:HeldPlan;independent?:boolean;windows?:{note:Note;start:number;end:number}[]};
const groupEnd=(group:Group)=>Math.max(...group.notes.map(n=>n.time+n.duration));
const groupCache=new WeakMap<Note[],Record<Hand,Group[]>>();
const performanceCache=new WeakMap<Note[],PerformancePlan>();
function groupsFor(notes:Note[]) {
  const cached=groupCache.get(notes);if(cached)return cached;
  const result:Record<Hand,Group[]>={left:[],right:[]};
  for(const note of notes) {
    const list=result[note.hand],last=list.at(-1);
    if(last?.notes[0].time===note.time)last.notes.push(note);else list.push({notes:[note],approach:APPROACH,release:RELEASE});
  }
  for(const hand of ['left','right'] as const) {
    const merged:Group[]=[];
    for(const group of result[hand]) {
      const previous=merged.at(-1);
      if(previous&&group.notes[0].time-groupEnd(previous)<MIN_GAP-1e-9) {
        previous.notes.push(...group.notes);previous.independent=true;
      } else merged.push({...group,independent:group.notes.some(n=>n.duration!==group.notes[0].duration||n.action==='substitute')});
    }
    result[hand]=merged;
  }
  for(const hand of ['left','right'] as const)for(const group of result[hand]) {
    if(group.notes.length>1&&!group.independent) {
      try {
        if(group.notes.length>5)throw new Error('片手の和音は最大5音まで対応しています。');
        for(let i=0;i<group.notes.length;i++)for(let j=i+1;j<group.notes.length;j++) {
          const a=group.notes[i],b=group.notes[j];
          if(a.finger===b.finger)throw new Error('同じ指に複数の音を指定できません。');
          if(a.midiNote===b.midiNote)throw new Error('同じ手の和音に同じ鍵盤を重複指定できません。');
          if(a.duration!==b.duration)throw new Error('和音は同時に離鍵する長さにしてください。');
          if((a.midiNote-b.midiNote)*(a.finger-b.finger)*(hand==='right'?1:-1)<0)throw new Error('指の順序が交差する和音には未対応です。');
        }
        group.plan=planChord(hand,group.notes.map(n=>({finger:n.finger,midiNote:n.midiNote,target:keys.find(k=>k.midiNote===n.midiNote)!.target})),HOVER,TRAVEL);
      } catch(error) {
        throw new Error(`${hand==='left'?'左手':'右手'} ${group.notes[0].time.toFixed(3)}秒（${group.notes.map(n=>`MIDI${n.midiNote}/指${n.finger}`).join(', ')}）: ${error instanceof Error?error.message:String(error)}`);
      }
    }
  }
  for(const hand of ['left','right'] as const) {
    const part=result[hand];
    for(let i=1;i<part.length;i++) {
      const previous=part[i-1],next=part[i];
      const gap=next.notes[0].time-groupEnd(previous);
      const scale=Math.min(1,Math.max(0,gap)/(RELEASE+MOVE+APPROACH));
      previous.release=RELEASE*scale;next.approach=APPROACH*scale;
    }
  }
  for(const hand of ['left','right'] as const)for(const group of result[hand])if(group.independent) {
    try {
      const events=heldEvents(group.notes,group.approach,group.release);
      group.held=planHeld(hand,events);group.plan=group.held.geometry;
      group.windows=events.map(e=>({note:e.note,start:e.note.time-e.approach,end:e.note.time+e.note.duration+e.release}));
    } catch(error) {
      throw new Error(`${hand==='left'?'左手':'右手'} ${group.notes[0].time.toFixed(3)}秒（保持区間）: ${error instanceof Error?error.message:String(error)}`);
    }
  }
  groupCache.set(notes,result);return result;
}
export function validate(input:unknown):Note[] {
  const notes=normalizePerformance(input).notes;
  const groups=groupsFor(notes);
  const timing=new Map<Note,{start:number;end:number}>();
  for(const group of [...groups.left,...groups.right])for(const note of group.notes)
    timing.set(note,group.windows?.find(w=>w.note===note)??{start:note.time-group.approach,end:note.time+note.duration+group.release});
  for(let i=0;i<notes.length;i++)for(let j=i+1;j<notes.length;j++) {
    if(notes[i].hand!==notes[j].hand && notes[i].midiNote===notes[j].midiNote && timing.get(notes[j])!.start<timing.get(notes[i])!.end&&timing.get(notes[i])!.start<timing.get(notes[j])!.end)
      throw new Error('左右の手で同じ鍵盤を同時に扱う入力には未対応です。');
  }
  return notes;
}
function anchor(n:Note):Vec3 {
  const target=keys.find(k=>k.midiNote===n.midiNote)!.target;
  const tip=fingerPoints(n.hand,n.finger,0)[2];
  return target.map((v,i)=>v-tip[i]+(i===1?HOVER:0)) as Vec3;
}
const defaultJoints=()=>Object.fromEntries(fingers.map(f=>[f,restPose(f)])) as Record<Finger,JointPose>;
function hoverJoints(group?:Group,atEnd=false) {
  const joints=defaultJoints();
  if(group?.held?.path) {
    const path=group.held.path;
    return heldFrame(group.held,group.notes[0].hand,atEnd?path.times.at(-1)!:path.times[0]).joints;
  }
  if(group?.plan) {
    Object.assign(joints,group.plan.idleJoints);
    const poses=chordPoses(group.plan,group.notes[0].hand,HOVER)!;
    group.plan.contacts.forEach((n,i)=>{joints[n.finger]=poses[i];});
  }
  return joints;
}
const groupAnchor=(group:Group,atEnd=false)=>group.held?.path?
  [...(atEnd?group.held.path.positions.at(-1)!:group.held.path.positions[0])] as Vec3:
  group.plan ? [...group.plan.position] as Vec3 : anchor(group.notes[0]);
export type HandFrame={position:Vec3; rotation:Vec3; lift:number; phase:'waiting'|'travel'|'approach'|'press'|'release'; active:Note|undefined; activeNotes:Note[]; targets:Vec3[]; depth:number; depths?:number[]; curl:number; joints:Record<Finger,JointPose>; technique?:'scale'|'thumb-under'|'finger-over'|'held'|'held-travel'|'legato-crossing'|'substitution'; strikeStyle?:StrikeStyle; wristMotion?:boolean;forearmGuide?:Vec3};
export const keyDepth=(frame:HandFrame,midiNote:number)=>Math.max(0,...frame.activeNotes.map((n,i)=>n.midiNote===midiNote?(frame.depths?.[i]??frame.depth):0));
function evaluateHand(notes:Note[],time:number,hand:Hand,style:TravelStyle):HandFrame {
  const part=groupsFor(notes)[hand];
  const home:Note={time:0,duration:1,midiNote:hand==='left'?48:60,hand,finger:3};
  let position=part[0]?groupAnchor(part[0]):anchor(home),joints=hoverJoints(part[0]);
  let rotation:Vec3=[0,0,0],lift=0;
  let phase:HandFrame['phase']='waiting';
  for(let i=0;i<part.length;i++) {
    const group=part[i],n=group.notes[0], end=groupEnd(group), base=groupAnchor(group);
    const {approach,release}=group;
    if(time<n.time-approach) {
      if(i>0) {
        const from=groupAnchor(part[i-1],true);
        const travel=transition(from,base,time,groupEnd(part[i-1])+part[i-1].release,n.time-approach,style);
        position=travel.position;rotation=travel.rotation;lift=travel.lift;
        phase=travel.moving?'travel':'waiting';
        const source=hoverJoints(part[i-1],true),destination=hoverJoints(group);
        joints=defaultJoints();
        for(const f of fingers)for(const field of ['spread','proximal','distal','opposition'] as const)
          joints[f][field]=(source[f][field]??0)+((destination[f][field]??0)-(source[f][field]??0))*travel.preparation;
      }
      break;
    }
    position=base;
    joints=hoverJoints(group);
    if(group.held) {
      if(time<end+release)return heldFrame(group.held,hand,time);
      position=groupAnchor(group,true);joints=hoverJoints(group,true);
      continue;
    }
    let drop=0,depth=0;
    if(time<n.time){phase='approach';drop=HOVER*(time-n.time+approach)/approach;}
    else if(time<end) {phase='press';depth=Math.min(1,(time-n.time)/0.06);drop=HOVER+depth*TRAVEL;}
    else if(time<end+release) {
      phase='release';
      const ratio=(time-end)/release;
      depth=Math.min(1,n.duration/0.06)*Math.max(0,1-ratio*2);
      drop=depth*TRAVEL+HOVER*(1-Math.max(0,ratio*2-1));
    } else continue;
    if(group.plan) {
      const poses=chordPoses(group.plan,hand,HOVER-drop);
      if(!poses)throw new Error('和音の指姿勢が許容範囲外になりました。');
      group.notes.forEach((note,index)=>{joints[note.finger]=poses[index];});
      return {position,rotation,lift,phase,active:n,activeNotes:group.notes,targets:group.plan.contacts.map(c=>c.target),depth,curl:0,joints};
    }
    const curl=curlForDrop(hand,n.finger,Math.max(0,drop));
    const rest=fingerPoints(hand,n.finger,0)[2], tip=fingerPoints(hand,n.finger,curl)[2];
    // Compensate the arc in the keyboard plane; palm height stays fixed during pressing.
    position[0]+=rest[0]-tip[0];position[2]+=rest[2]-tip[2];
    joints[n.finger]={...restPose(n.finger),proximal:-0.15+curl,distal:-0.1+curl*1.6};
    return {position,rotation,lift,phase,active:n,activeNotes:[n],targets:[keys.find(k=>k.midiNote===n.midiNote)!.target],depth,curl,joints};
  }
  return {position,rotation,lift,phase:phase==='travel'?'travel':'waiting',active:undefined,activeNotes:[],targets:[],depth:0,curl:0,joints};
}
export function evaluate(notes:Note[],time:number,style:MotionStyle='linear',idleStyle:IdleFingerStyle='connected',strikeStyle:StrikeStyle='smooth',wristMotion=false) {
  const travelStyle=style==='scale'?'smooth':style;
  const frame={left:evaluateHand(notes,time,'left',travelStyle),right:evaluateHand(notes,time,'right',travelStyle)};
  if(style==='scale') {
    const planned=performancePlanFor(notes);
    for(const hand of ['left','right'] as const)for(const plans of planned[hand]) {
      const plan=(strikeStyle==='smooth'?plans.smooth:undefined)??plans.legacy;
      if(time<=plan.blendStart||time>=plan.blendEnd)continue;
      frame[hand]=applyScale(plan,time,frame[hand],idleStyle);
      if(wristMotion) {
        const amount=wristAmountFor(notes,hand,plans);
        if(amount>0) {
          const adjusted=withWrist(plan,time,frame[hand],amount);
          if(!adjusted)throw new Error('手首の姿勢が検証範囲外になりました。');
          frame[hand]=adjusted;
        }
      }
    }
  }
  return frame;
}
// Build once per validated, immutable note array; seeks only evaluate this plan.
export function performancePlanFor(notes:Note[]):PerformancePlan {
  let plan=performanceCache.get(notes);
  if(!plan) {
    plan=planPerformance(groupsFor(notes),n=>keys.find(k=>k.midiNote===n.midiNote)!.target);
    performanceCache.set(notes,plan);
  }
  return plan;
}
function wristAmountFor(notes:Note[],hand:Hand,run:PlannedRun):number {
  if(run.wristAmount===undefined)run.wristAmount=wristAmount([run.legacy,run.smooth].filter((p):p is ScalePlan=>!!p),
    (p,t,idle)=>applyScale(p,t,evaluateHand(notes,t,hand,'smooth'),idle));
  return run.wristAmount;
}
// UI preparation includes optional wrist feasibility, so a later crossing does
// not trigger a geometric search in the middle of playback. API evaluation can
// still prepare lazily for callers that only need one pose.
export function preparePerformance(notes:Note[]):PerformancePlan {
  const plan=performancePlanFor(notes);
  for(const hand of ['left','right'] as const)for(const run of plan[hand])wristAmountFor(notes,hand,run);
  return plan;
}
export function heldPlansFor(notes:Note[]):Record<Hand,HeldPlan[]> {
  const groups=groupsFor(notes);
  return {left:groups.left.flatMap(g=>g.held?[g.held]:[]),right:groups.right.flatMap(g=>g.held?[g.held]:[])};
}
export const lengthOf=(notes:Note[])=>Math.max(...notes.map(n=>n.time+n.duration))+RELEASE+0.5;
