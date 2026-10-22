import { fingerPoints, curlForDrop, fingers, restPose } from './fingers';
import type { Vec3, Hand, Finger, JointPose } from './fingers';
import { planDyad, dyadPoses } from './chords';
import type { DyadPlan } from './chords';
import { transition } from './movement';
import type { MotionStyle } from './movement';
export type { Vec3, Hand } from './fingers';
export type Note = { time:number; duration:number; midiNote:number; hand:Hand; finger:Finger };
export const WIDTH=0.0235, TRAVEL=0.01, HOVER=0.018;
export const APPROACH=0.12, RELEASE=0.12, MOVE=0.3;
export const MIN_GAP=0.01;
const blackPitches=[1,3,6,8,10];
let white=0;
export const KEYBOARD_WIDTH=52*WIDTH;
export const keys=Array.from({length:88},(_,index)=>{
  const midiNote=21+index, black=blackPitches.includes(midiNote%12);
  const x=(black?white-0.5:white++)*WIDTH-25.5*WIDTH;
  return {midiNote,black,target:[x,black?0.012:0,black?-0.043:0.025] as Vec3};
});
type Group={notes:Note[]; approach:number; release:number; plan?:DyadPlan};
const groupCache=new WeakMap<Note[],Record<Hand,Group[]>>();
function groupsFor(notes:Note[]) {
  const cached=groupCache.get(notes);if(cached)return cached;
  const result:Record<Hand,Group[]>={left:[],right:[]};
  for(const note of notes) {
    const list=result[note.hand],last=list.at(-1);
    if(last?.notes[0].time===note.time)last.notes.push(note);else list.push({notes:[note],approach:APPROACH,release:RELEASE});
  }
  for(const hand of ['left','right'] as const)for(const group of result[hand]) {
    if(group.notes.length>2)throw new Error('現段階は単音・2音和音のみ対応しています。');
    if(group.notes.length===2) {
      const [a,b]=group.notes;
      if(a.finger===b.finger)throw new Error('同じ指に複数の音を指定できません。');
      if(a.midiNote===b.midiNote)throw new Error('同じ手の和音に同じ鍵盤を重複指定できません。');
      if(a.duration!==b.duration)throw new Error('2音和音は同時に離鍵する長さにしてください。');
      if(group.notes.some(n=>keys.find(k=>k.midiNote===n.midiNote)!.black))throw new Error('2音和音は現在、白鍵のみ対応しています。黒鍵混在は次段階です。');
      if((a.midiNote-b.midiNote)*(a.finger-b.finger)*(hand==='right'?1:-1)<0)throw new Error('指の順序が交差する和音には未対応です。');
      group.plan=planDyad(hand,group.notes.map(n=>({finger:n.finger,target:keys.find(k=>k.midiNote===n.midiNote)!.target})),HOVER,TRAVEL);
    }
  }
  for(const hand of ['left','right'] as const) {
    const part=result[hand];
    for(let i=1;i<part.length;i++) {
      const previous=part[i-1],next=part[i];
      const gap=next.notes[0].time-previous.notes[0].time-previous.notes[0].duration;
      const scale=Math.min(1,Math.max(0,gap)/(RELEASE+MOVE+APPROACH));
      previous.release=RELEASE*scale;next.approach=APPROACH*scale;
    }
  }
  groupCache.set(notes,result);return result;
}
export function validate(input:unknown):Note[] {
  if(!Array.isArray(input)||!input.length)throw new Error('音符の配列が必要です。');
  const notes:Note[]=input.map((n,i)=>{
    if(!n || !Number.isFinite(n.time)||n.time<APPROACH || !Number.isFinite(n.duration)||n.duration<=0 || !Number.isFinite(n.time+n.duration) || !['left','right'].includes(n.hand) || !Number.isInteger(n.finger)||n.finger<1||n.finger>5 || !keys.some(k=>k.midiNote===n.midiNote))
      throw new Error(`音符${i+1}: time ≥ ${APPROACH}、duration > 0、handはleft/right、指1〜5・MIDI21〜108が必要です。`);
    return {...n};
  }).sort((a,b)=>a.time-b.time);
  const groups=groupsFor(notes);
  for(const hand of ['left','right'] as const) {
    const part=groups[hand].map(g=>g.notes[0]);
    for(let i=1;i<part.length;i++) {
      const gap=part[i].time-(part[i-1].time+part[i-1].duration);
      if(gap<0)throw new Error(`${hand}: 開始時刻が異なる音の重複には未対応です。`);
      if(gap<MIN_GAP-1e-9)throw new Error(`${hand}: 音間不足です（非レガート検証では${MIN_GAP}秒以上必要）。`);
    }
  }
  const timing=new Map<Note,Group>();
  for(const group of [...groups.left,...groups.right])for(const note of group.notes)timing.set(note,group);
  for(let i=0;i<notes.length;i++)for(let j=i+1;j<notes.length;j++) {
    if(notes[i].hand!==notes[j].hand && notes[i].midiNote===notes[j].midiNote && notes[j].time-timing.get(notes[j])!.approach<notes[i].time+notes[i].duration+timing.get(notes[i])!.release)
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
function hoverJoints(group?:Group) {
  const joints=defaultJoints();
  if(group?.plan) {
    const poses=dyadPoses(group.plan,group.notes[0].hand,HOVER)!;
    group.notes.forEach((n,i)=>{joints[n.finger]=poses[i];});
  }
  return joints;
}
const groupAnchor=(group:Group)=>group.plan ? [...group.plan.position] as Vec3 : anchor(group.notes[0]);
export type HandFrame={position:Vec3; rotation:Vec3; lift:number; phase:'waiting'|'travel'|'approach'|'press'|'release'; active:Note|undefined; activeNotes:Note[]; targets:Vec3[]; depth:number; curl:number; joints:Record<Finger,JointPose>};
function evaluateHand(notes:Note[],time:number,hand:Hand,style:MotionStyle):HandFrame {
  const part=groupsFor(notes)[hand];
  const home:Note={time:0,duration:1,midiNote:hand==='left'?48:60,hand,finger:3};
  let position=part[0]?groupAnchor(part[0]):anchor(home),joints=hoverJoints(part[0]);
  let rotation:Vec3=[0,0,0],lift=0;
  let phase:HandFrame['phase']='waiting';
  for(let i=0;i<part.length;i++) {
    const group=part[i],n=group.notes[0], end=n.time+n.duration, base=groupAnchor(group);
    const {approach,release}=group;
    if(time<n.time-approach) {
      if(i>0) {
        const previous=part[i-1].notes[0], from=groupAnchor(part[i-1]);
        const travel=transition(from,base,time,previous.time+previous.duration+part[i-1].release,n.time-approach,style);
        position=travel.position;rotation=travel.rotation;lift=travel.lift;
        phase=travel.moving?'travel':'waiting';
        const source=hoverJoints(part[i-1]),destination=hoverJoints(group);
        joints=defaultJoints();
        for(const f of fingers)for(const field of ['spread','proximal','distal'] as const)joints[f][field]=source[f][field]+(destination[f][field]-source[f][field])*travel.preparation;
      }
      break;
    }
    position=base;
    joints=hoverJoints(group);
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
      const poses=dyadPoses(group.plan,hand,HOVER-drop);
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
export function evaluate(notes:Note[],time:number,style:MotionStyle='linear') {
  return {left:evaluateHand(notes,time,'left',style),right:evaluateHand(notes,time,'right',style)};
}
export const lengthOf=(notes:Note[])=>Math.max(...notes.map(n=>n.time+n.duration))+RELEASE+0.5;
