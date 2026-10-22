import type { Note, HandFrame } from './motion';
import { planChord } from './chords';
import type { ChordPlan } from './chords';
import { fingers, pointsForPose, solveFinger } from './fingers';
import type { Hand, JointPose, Vec3 } from './fingers';
import { keys, clearsBlackKeys } from './keyboard';
import { ease } from './movement';
import { movingHeldFrame, planHeldPath } from './held-path';
import type { HeldPath } from './held-path';

export type FingerEvent={note:Note;approach:number;release:number;handoffFrom?:Note;handoffTo?:Note;opposed?:boolean};
export type HeldPlan={geometry:ChordPlan;events:FingerEvent[];path?:HeldPath};
const HOVER=0.018,TRAVEL=0.01;
const endOf=(n:Note)=>n.time+n.duration;

// Each finger has its own contact window. A finger must leave before reuse;
// overlapping same-key contacts require an explicit substitution. Adjacent
// same-finger notes are not silently made a tie.
export function heldEvents(notes:Note[],approach:number,release:number):FingerEvent[] {
  const start=notes[0].time-approach,end=Math.max(...notes.map(endOf))+release;
  const events:FingerEvent[]=[...notes].sort((a,b)=>a.time-b.time||a.finger-b.finger).map(note=>({note,
    approach:Math.min(0.12,note.time-start),release:Math.min(0.12,end-endOf(note))}));
  for(const incoming of events)if(incoming.note.action==='substitute') {
    const sources=events.filter(e=>e.note.time<incoming.note.time&&e.note.midiNote===incoming.note.midiNote&&
      e.note.finger!==incoming.note.finger&&endOf(e.note)>=incoming.note.time&&!e.handoffTo);
    if(sources.length!==1)throw new Error('指替えには、同じ鍵を保持中の別の指を1つ指定できる時刻が必要です。');
    const source=sources[0];
    if(incoming.note.time<=source.note.time+0.06||endOf(incoming.note)<=endOf(source.note))
      throw new Error('指替えは押下完了後に開始し、受け取る指を渡す指より長く保持してください。');
    incoming.handoffFrom=source.note;source.handoffTo=incoming.note;
    incoming.approach=Math.min(incoming.approach,incoming.note.time-source.note.time-0.06);
    source.release=Math.min(source.release,(endOf(incoming.note)-endOf(source.note))/2);
  }
  for(let i=0;i<events.length;i++)for(let j=i+1;j<events.length;j++) {
    const a=events[i],b=events[j];
    const gap=b.note.time-endOf(a.note);
    // A released finger can clear a later crossed preparation in free air.
    // Do not let fixed 120ms tails turn fast, non-overlapping notes into a
    // simultaneous crossing constraint; musical press/hold times stay fixed.
    if(a.note.finger!==b.note.finger&&a.note.midiNote!==b.note.midiNote&&gap>0&&
      (a.note.midiNote-b.note.midiNote)*(a.note.finger-b.note.finger)*(a.note.hand==='right'?1:-1)<0) {
      a.release=Math.min(a.release,gap*0.4);b.approach=Math.min(b.approach,gap*0.4);
    }
    if(a.note.finger!==b.note.finger&&a.note.midiNote!==b.note.midiNote)continue;
    if(a.handoffTo===b.note)continue;
    if(gap<0.01-1e-9)throw new Error(`指${a.note.finger}・MIDI${a.note.midiNote}: ${gap<0?'重複する音':'再打鍵の音間不足'}です。同じ指・鍵盤の再使用には10ms以上の離鍵時間が必要です。`);
    const share=a.note.midiNote===b.note.midiNote?0.5:0.3;
    a.release=Math.min(a.release,gap*share);b.approach=Math.min(b.approach,gap*share);
  }
  return events;
}

export function fingerStroke(event:FingerEvent,time:number) {
  const n=event.note,end=endOf(n);
  if(event.handoffFrom) {
    if(time<n.time)return {height:-TRAVEL+(HOVER+TRAVEL)*(1-ease((time-n.time+event.approach)/event.approach)),depth:1};
    if(time<end)return {height:-TRAVEL,depth:1};
  }
  if(event.handoffTo&&time>=end)return {height:-TRAVEL+(HOVER+TRAVEL)*ease((time-end)/event.release),depth:1};
  if(time<n.time)return {height:HOVER*(1-ease((time-n.time+event.approach)/event.approach)),depth:0};
  const peak=event.handoffFrom?1:ease(Math.min(1,n.duration/0.06));
  if(time<end) {
    const depth=peak*ease((time-n.time)/Math.min(0.06,n.duration));
    return {height:-TRAVEL*depth,depth};
  }
  const u=(time-end)/event.release,depth=peak*(1-ease(u/0.65));
  return {height:-TRAVEL*depth+HOVER*ease((u-0.65)/0.35),depth};
}

export function heldFrame(plan:HeldPlan,hand:Hand,time:number):HandFrame {
  if(plan.path)return movingHeldFrame(plan,hand,time);
  const {geometry,events}=plan;
  const active=events.filter(e=>time>=e.note.time-e.approach&&time<endOf(e.note)+e.release);
  const joints={...geometry.idleJoints} as Record<1|2|3|4|5,JointPose>;
  for(const contact of geometry.contacts) {
    const event=active.find(e=>e.note.finger===contact.finger);
    const height=event?fingerStroke(event,time).height:HOVER;
    const pose=solveFinger(hand,contact.finger,contact.target.map((v,i)=>v-geometry.position[i]+(i===1?height:0)) as Vec3);
    if(!pose)throw new Error('保持区間の指姿勢が検証範囲外になりました。');
    joints[contact.finger]=pose;
  }
  const depths=active.map(e=>fingerStroke(e,time).depth);
  const phase=active.some(e=>time>=e.note.time&&time<endOf(e.note))?'press':
    active.some(e=>time<e.note.time)?'approach':active.length?'release':'waiting';
  return {position:[...geometry.position],rotation:[0,0,0],lift:0,phase,
    active:active[0]?.note,activeNotes:active.map(e=>e.note),
    targets:active.map(e=>geometry.contacts.find(c=>c.finger===e.note.finger)!.target),
    depths,depth:Math.max(0,...depths),curl:0,joints,technique:'held',strikeStyle:'smooth'};
}

// Preserve fixed-palm passages; plan a trajectory when a finger changes keys or
// the complete passage cannot fit a single shared palm placement.
export function planHeld(hand:Hand,events:FingerEvent[]):HeldPlan {
  const contacts=new Map<number,Note>();
  let changesKey=false;
  for(const {note} of events) {
    const old=contacts.get(note.finger);
    if(old&&old.midiNote!==note.midiNote)changesKey=true;
    if(events.some(e=>e.note.finger!==note.finger&&e.note.midiNote===note.midiNote))changesKey=true;
    contacts.set(note.finger,note);
  }
  if(changesKey)return planHeldPath(hand,events);
  const ordered=[...contacts.values()].sort((a,b)=>a.finger-b.finger);
  for(let i=1;i<ordered.length;i++)if((ordered[i].midiNote-ordered[i-1].midiNote)*(hand==='right'?1:-1)<=0)
    return planHeldPath(hand,events);
  let geometry:ChordPlan;
  try {geometry=planChord(hand,ordered.map(n=>({finger:n.finger,midiNote:n.midiNote,target:keys.find(k=>k.midiNote===n.midiNote)!.target})),HOVER,TRAVEL);}
  catch {return planHeldPath(hand,events);}
  const used=new Set(ordered.map(n=>n.finger));
  // Fill all free fingers as well, preserving the chord planner's safe pose.
  for(const finger of fingers)if(!used.has(finger)) {
    const candidate=[geometry.idleJoints?.[finger],{spread:finger===1?1.05:0,proximal:-0.65,distal:0.35}]
      .filter((p):p is JointPose=>!!p).find(p=>clearsBlackKeys(pointsForPose(hand,finger,p).map(v=>v.map((x,i)=>x+geometry.position[i]) as Vec3),new Set(),0));
    if(!candidate)throw new Error('保持区間の非演奏指を黒鍵から離せません。');
    (geometry.idleJoints??={})[finger]=candidate;
  }
  const plan={geometry,events};
  const start=Math.min(...events.map(e=>e.note.time-e.approach)),end=Math.max(...events.map(e=>endOf(e.note)+e.release));
  const count=Math.ceil((end-start)/0.003);
  const times=new Set(Array.from({length:count+1},(_,i)=>start+(end-start)*i/count));
  for(const e of events)for(const t of [e.note.time-e.approach,e.note.time,e.note.time+Math.min(0.06,e.note.duration),endOf(e.note),endOf(e.note)+e.release*0.65,endOf(e.note)+e.release])times.add(t);
  for(const time of times) {
    const frame=heldFrame(plan,hand,time);
    const drops=new Map(frame.activeNotes.map((n,i)=>[n.midiNote,frame.depths![i]*TRAVEL]));
    for(const finger of fingers) {
      const points=pointsForPose(hand,finger,frame.joints[finger]).map(p=>p.map((v,i)=>v+geometry.position[i]) as Vec3);
      if(!clearsBlackKeys(points,new Set(),0,drops))throw new Error('保持区間の独立した打鍵経路が黒鍵と干渉します。');
    }
  }
  return plan;
}
