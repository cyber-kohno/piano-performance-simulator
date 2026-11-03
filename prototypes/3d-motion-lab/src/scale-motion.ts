import { fingers, pointsForPose, restPose, solveFinger } from './fingers';
import type { Finger, Hand, JointPose, Vec3 } from './fingers';
import type { HandFrame, Note } from './motion';
import { ease, handPointWorld } from './movement';
import { keys, contactRange, clearsBlackKeys } from './keyboard';

export type ScaleStep = { note:Note; target:Vec3; approach:number; release:number };
type Gesture = ScaleStep & { x:number; preparation:number; recovery:number; before:JointPose; after:JointPose; hoverBefore:number; hoverAfter:number };
export type StrikeStyle = 'smooth'|'legacy';
type Placement={y:number;z:number;thumbBias:number};
export type ScalePlan = { hand:Hand; steps:Gesture[]; tangents:number[]; y:number; z:number; strikeStyle:StrikeStyle; blendStart:number; blendEnd:number; placement?:Placement };
export type IdleFingerStyle = 'connected'|'reset';
const HOVER=0.018, TRAVEL=0.01, SETTLE=0.3;
const CONNECT_GAP=0.45, RELAX_TIME=0.18;
const whitePitches=[0,2,4,5,7,9,11];
const bias:Record<Finger,number>={1:0.035,2:0.025,3:0.005,4:-0.01,5:-0.025};

function interpolatePose(a:JointPose,b:JointPose,u:number):JointPose {
  return {spread:a.spread+(b.spread-a.spread)*u,proximal:a.proximal+(b.proximal-a.proximal)*u,distal:a.distal+(b.distal-a.distal)*u,
    opposition:(a.opposition??0)+((b.opposition??0)-(a.opposition??0))*u};
}

// Keep the tip above the white-key surface at the scale's palm height. The
// opposing proximal/distal angles give a curved finger without pressing a key.
function waitingPose(finger:Finger,raised=false):JointPose {
  return {...restPose(finger),spread:finger===1?0.4:restPose(finger).spread,
    proximal:raised?(finger===1?-0.6:-0.65):finger===1?-0.35:-0.45,distal:raised?0.35:finger===1?0.15:0.35};
}
const contactStart=(step:Gesture)=>step.note.time-step.approach;
const contactEnd=(step:Gesture)=>step.note.time+step.note.duration+step.release;

function connectedJoints(plan:ScalePlan,time:number):Record<Finger,JointPose> {
  return Object.fromEntries(fingers.map(finger=>{
    const events=plan.steps.filter(s=>s.note.finger===finger);
    const active=events.find(s=>time>=contactStart(s)&&time<contactEnd(s));
    if(active) {
      const pose=poseAt(plan,active,time,strokeAt(plan,active,time).height);
      if(!pose)throw new Error('音階の指姿勢が検証範囲外になりました。');
      return [finger,pose];
    }
    const previous=events.filter(s=>contactEnd(s)<=time).at(-1);
    const next=events.find(s=>contactStart(s)>time);
    const wait=waitingPose(finger,!!plan.placement);
    if(previous&&next) {
      const end=contactEnd(previous),start=contactStart(next),gap=start-end;
      if(gap<=CONNECT_GAP) {
        // Reuse this finger directly; there is no intervening neutral pose.
        const u=(time-end)/gap,direct=interpolatePose(previous.after,next.before,ease(u));
        return [finger,plan.placement?interpolatePose(direct,wait,16*u*u*(1-u)*(1-u)):direct];
      }
    }
    const relaxEnd=previous?contactEnd(previous)+Math.min(RELAX_TIME,next?(contactStart(next)-contactEnd(previous))/3:RELAX_TIME):-Infinity;
    if(previous&&time<relaxEnd)
      return [finger,interpolatePose(previous.after,wait,ease((time-contactEnd(previous))/(relaxEnd-contactEnd(previous))))];
    if(next) {
      const preparation=Math.max(next.preparation,relaxEnd);
      return [finger,interpolatePose(wait,next.before,ease((time-preparation)/(contactStart(next)-preparation)))];
    }
    return [finger,wait];
  })) as Record<Finger,JointPose>;
}

// Monotone cubic interpolation: the palm can move during a held note, with no
// reversal between ascending notes, no overshoot, and zero velocity at a turn.
export function scalePalm(plan:ScalePlan,time:number):Vec3 {
  const {steps,tangents}=plan;
  let x=steps[0].x;
  if(plan.placement) {
    // Leave room for both fingers' contact paths at a mixed-key crossing.
    // Both strike comparisons share this trajectory and the musical times.
    for(let i=1;i<steps.length;i++) {
      const a=steps[i-1],b=steps[i],end=a.note.time+a.note.duration,gap=b.note.time-end;
      const start=end+gap*0.3,arrival=b.note.time-gap*0.3;
      x=a.x+(b.x-a.x)*ease((time-start)/(arrival-start));
      if(time<arrival)break;
    }
    return [x,plan.y,plan.z];
  }
  if(time>=steps.at(-1)!.note.time)x=steps.at(-1)!.x;
  else for(let i=0;i<steps.length-1;i++) {
    const a=steps[i],b=steps[i+1];
    if(time<a.note.time||time>b.note.time)continue;
    const dt=b.note.time-a.note.time,u=(time-a.note.time)/dt;
    x=(2*u**3-3*u*u+1)*a.x+(u**3-2*u*u+u)*dt*tangents[i]
      +(-2*u**3+3*u*u)*b.x+(u**3-u*u)*dt*tangents[i+1];
    break;
  }
  return [x,plan.y,plan.z];
}

function poseAt(plan:ScalePlan,step:ScaleStep,time:number,lift:number) {
  const position=scalePalm(plan,time);
  const pose=solveFinger(plan.hand,step.note.finger,step.target.map((v,i)=>v-position[i]+(i===1?lift:0)) as Vec3,true);
  if(pose&&plan.placement&&!clearsBlackKeys(pointsForPose(plan.hand,step.note.finger,pose)
    .map(p=>p.map((v,i)=>v+position[i]) as Vec3),new Set([step.note.midiNote]),Math.max(0,-lift)))return;
  return pose;
}

function strokeAt(plan:ScalePlan,step:Gesture,time:number):{height:number;depth:number} {
  const n=step.note,end=n.time+n.duration;
  if(plan.strikeStyle==='smooth') {
    if(time<n.time)return {height:step.hoverBefore*(1-ease((time-n.time+step.approach)/step.approach)),depth:0};
    // Short notes turn at a partial depth with zero vertical velocity, without
    // forcing a full key stroke or continuing downward after release starts.
    const peak=ease(Math.min(1,n.duration/0.06));
    if(time<end) {
      const depth=peak*ease((time-n.time)/Math.min(0.06,n.duration));
      return {height:-depth*TRAVEL,depth};
    }
    const u=(time-end)/step.release;
    const depth=peak*(1-ease(u/0.65));
    return {height:-depth*TRAVEL+step.hoverAfter*ease((u-0.65)/0.35),depth};
  }
  if(time<n.time)return {height:HOVER*(n.time-time)/step.approach,depth:0};
  if(time<end) {
    const depth=Math.min(1,(time-n.time)/0.06);
    return {height:-depth*TRAVEL,depth};
  }
  const ratio=(time-end)/step.release;
  const depth=Math.min(1,n.duration/0.06)*Math.max(0,1-ratio*2);
  return {height:-depth*TRAVEL+HOVER*Math.max(0,ratio*2-1),depth};
}

export const isScaleNote=(note:Note)=>keys.some(k=>k.midiNote===note.midiNote);
export function crossingDirection(a:Note,b:Note):number {
  const direction=Math.sign(b.midiNote-a.midiNote)*(a.hand==='right'?1:-1);
  return direction===1&&[3,4].includes(a.finger)&&b.finger===1?1:
    direction===-1&&a.finger===1&&[3,4].includes(b.finger)?-1:0;
}
export function scaleConnection(a:Note,b:Note):'ordinary'|'crossing'|undefined {
  if(a.hand!==b.hand||!isScaleNote(a)||!isScaleNote(b)||b.time<=a.time||b.time-a.time>0.65)return;
  const distance=b.midiNote-a.midiNote;
  if(Math.abs(distance)<1||Math.abs(distance)>2)return;
  const direction=Math.sign(distance)*(a.hand==='right'?1:-1);
  if(crossingDirection(a,b))return 'crossing';
  if(b.finger-a.finger===direction)return 'ordinary';
}

// A local run of semitone/whole-tone steps with ordinary fingers and 3/4↔1.
// The phrase planner decides where to connect this run to other techniques.
export function planScale(input:ScaleStep[],strikeStyle:StrikeStyle='legacy',reference?:ScalePlan,releaseShare=0.5,placement?:Placement):ScalePlan|undefined {
  if(input.length<4||input.some(s=>!isScaleNote(s.note)))return;
  const hand=input[0].note.hand,mirror=hand==='right'?1:-1;
  let crossings=0;
  for(let i=1;i<input.length;i++) {
    const connection=scaleConnection(input[i-1].note,input[i].note);
    if(!connection)return;
    if(connection==='crossing')crossings++;
  }
  if(!crossings)return;
  const needsPlacement=input.some(s=>!whitePitches.includes(s.note.midiNote%12))||input.some((s,i)=>i>0&&
    crossingDirection(input[i-1].note,s.note)&&(s.note.finger===4||input[i-1].note.finger===4));
  if(needsPlacement&&!placement) {
    if(reference?.placement)return planScale(input,strikeStyle,reference,releaseShare,reference.placement);
    for(const y of [-0.015,-0.02,-0.01,-0.025,-0.005,0])for(const z of [0.005,0,-0.005,-0.01,0.01,-0.015,-0.02,0.015,-0.025,-0.03,-0.035,0.02])
      for(const thumbBias of [0.015,0.005,0.022,-0.005,0.03]) {
        const plan=planScale(input,strikeStyle,reference,releaseShare,{y,z,thumbBias});
        if(plan)return plan;
      }
    return;
  }
  const timing=input.map(s=>({...s}));
  if(strikeStyle==='smooth')for(let i=1;i<timing.length;i++) {
    const a=timing[i-1],b=timing[i];
    const gap=b.note.time-a.note.time-a.note.duration;
    const contactShare=placement?0.6:1;
    a.release=Math.min(0.12,gap*releaseShare*contactShare);
    b.approach=Math.min(0.12,gap*(1-releaseShare)*contactShare);
  }
  const steps:Gesture[]=timing.map((s,i)=>{
    const crossingThumb=s.note.finger===1&&([3,4].includes(input[i-1]?.note.finger??0)||[3,4].includes(input[i+1]?.note.finger??0));
    const afterThumb=[3,4].includes(s.note.finger)&&input[i-1]?.note.finger===1&&(s.note.midiNote-input[i-1].note.midiNote)*mirror<0;
    const under=i>0&&crossingDirection(input[i-1].note,s.note)===1;
    const over=i+1<input.length&&crossingDirection(s.note,input[i+1].note)===-1;
    const thumbBias=placement&&over&&!under?0.025:placement?.thumbBias??0.022;
    const lead=placement&&s.note.finger===4&&i+1<input.length&&crossingDirection(s.note,input[i+1].note)===1?0.015:0;
    return {...s,target:[s.target[0],s.target[1],s.note.finger===1?0.05:0.008],
      x:s.target[0]+mirror*((crossingThumb?thumbBias:afterThumb?(s.note.finger===4?0.005:placement?0.02:0.025):bias[s.note.finger])-lead),
      preparation:i?input[i-1].note.time:s.note.time-s.approach-SETTLE,
      recovery:Math.min(0.12,i+1<input.length?(input[i+1].note.time-s.note.time)/2:0.12),
      before:restPose(s.note.finger),after:restPose(s.note.finger),
      hoverBefore:strikeStyle==='smooth'?Math.max(0.006,HOVER*s.approach/0.12,placement?0.018-s.target[1]:0):HOVER,
      hoverAfter:strikeStyle==='smooth'?Math.max(0.006,HOVER*s.release/0.12,placement?0.018-s.target[1]:0):HOVER};
  });
  if(placement) {
    // Prepare the whole hand before a 4→1 crossing. Propagate a required palm
    // placement backward through an ascent instead of jerking back on finger 4.
    for(let from=0;from<steps.length-1;) {
      const direction=Math.sign(steps[from+1].note.midiNote-steps[from].note.midiNote)*mirror;
      let to=from+1;
      while(to+1<steps.length&&Math.sign(steps[to+1].note.midiNote-steps[to].note.midiNote)*mirror===direction)to++;
      if(direction>0)for(let i=to-1;i>=from;i--)steps[i].x=Math.min(steps[i].x*mirror,steps[i+1].x*mirror)*mirror;
      else for(let i=from+1;i<=to;i++)steps[i].x=Math.min(steps[i].x*mirror,steps[i-1].x*mirror)*mirror;
      from=to;
    }
  }
  const intervals=steps.slice(1).map((s,i)=>s.note.time-steps[i].note.time);
  const slopes=steps.slice(1).map((s,i)=>(s.x-steps[i].x)/intervals[i]);
  const tangents=steps.map((_,i)=>{
    if(i===0||i===steps.length-1||slopes[i-1]*slopes[i]<=0)return 0;
    const w1=2*intervals[i]+intervals[i-1],w2=intervals[i]+2*intervals[i-1];
    return (w1+w2)/(w1/slopes[i-1]+w2/slopes[i]);
  });
  const plan:ScalePlan={hand,steps,tangents,y:placement?.y??-0.028,z:placement?.z??0.031,strikeStyle,...(placement?{placement}:{}),
    blendStart:steps[0].note.time-steps[0].approach-SETTLE,
    blendEnd:steps.at(-1)!.note.time+steps.at(-1)!.note.duration+steps.at(-1)!.release+SETTLE};
  for(let i=0;i<steps.length;i++) {
    const previous=steps[i],next=steps.slice(i+1).find(s=>s.note.finger===previous.note.finger);
    if(!next)continue;
    const end=previous.note.time+previous.note.duration+previous.release;
    previous.recovery=Math.min(previous.recovery,(next.note.time-next.approach-end)/3);
    next.preparation=Math.max(next.preparation,end+previous.recovery);
  }
  // Check the whole run before enabling it, never switch inside a crossing.
  for(const [index,step] of steps.entries()) {
    const start=step.note.time-step.approach,end=step.note.time+step.note.duration+step.release;
    const boundaries=[...new Set([start,step.note.time,Math.min(step.note.time+0.06,step.note.time+step.note.duration),
      step.note.time+step.note.duration,end-step.release/2,step.note.time+step.note.duration+step.release*0.65,end])].sort((a,b)=>a-b);
    const samples=boundaries.flatMap((a,i)=>{
      if(i===0)return [a];
      const from=boundaries[i-1],count=Math.min(1024,Math.max(16,Math.ceil((a-from)/0.001)));
      return Array.from({length:count},(_,j)=>from+(a-from)*(j+1)/count);
    });
    let found=false;
    const key=keys.find(k=>k.midiNote===step.note.midiNote)!;
    const [back,front]=placement?contactRange(key,true):[0.008,0.05];
    const preferred=plan.z+(step.note.finger===1?0.025:-0.02);
    const depths=reference?[reference.steps[index].target[2]]:Array.from({length:Math.round((front-back)*1000)+1},(_,i)=>front-i*0.001);
    if(placement&&!reference)depths.sort((a,b)=>Math.abs(a-preferred)-Math.abs(b-preferred)||b-a);
    for(const z of depths) {
      // Keep the same contact point in both strike comparisons.
      step.target[2]=z;
      const before=poseAt(plan,step,start,step.hoverBefore),after=poseAt(plan,step,end,step.hoverAfter);
      if(!before||!after)continue;
      if(placement&&[step.note.time,step.note.time+Math.min(0.06,step.note.duration),step.note.time+step.note.duration]
        .some(t=>!poseAt(plan,step,t,strokeAt(plan,step,t).height)))continue;
      let feasible=true;
      for(const t of samples)if(!poseAt(plan,step,t,strokeAt(plan,step,t).height)){feasible=false;break;}
      if(!feasible)continue;
      step.before=before;step.after=after;found=true;break;
    }
    // At a tight turnaround the outgoing middle finger cannot follow the palm
    // quite as long. Try a 40:60 release/approach split using the same contacts
    // and palm trajectory before retaining the legacy strike for the phrase.
    if(!found)return strikeStyle==='smooth'&&releaseShare===0.5?planScale(input,strikeStyle,reference,0.4,placement):undefined;
  }
  if(placement&&!freePathClear(plan))return;
  return plan;
}

export function scaleWeight(plan:ScalePlan,time:number):number {
  const first=plan.steps[0],last=plan.steps.at(-1)!;
  const start=first.note.time-first.approach,end=last.note.time+last.note.duration+last.release;
  if(time<=plan.blendStart||time>=plan.blendEnd)return 0;
  return time<start?ease((time-plan.blendStart)/(start-plan.blendStart)):time>end?1-ease((time-end)/(plan.blendEnd-end)):1;
}

export function applyScale(plan:ScalePlan,time:number,base:HandFrame,idleStyle:IdleFingerStyle='connected'):HandFrame {
  const weight=scaleWeight(plan,time);
  if(weight===0)return base;
  const position=scalePalm(plan,time);
  const joints=scaleJoints(plan,time,idleStyle);
  const activeStep=plan.steps.find(s=>time>=contactStart(s)&&time<contactEnd(s));
  const depth=activeStep?strokeAt(plan,activeStep,time).depth:0;
  const phase=activeStep?(time<activeStep.note.time?'approach':time<activeStep.note.time+activeStep.note.duration?'press':'release'):base.phase;
  const technique=plan.steps.find((s,i)=>i>0&&time>=s.preparation&&time<s.note.time+s.note.duration&&
    crossingDirection(plan.steps[i-1].note,s.note));
  return {...base,position:position.map((v,i)=>base.position[i]+(v-base.position[i])*weight) as Vec3,
    rotation:base.rotation.map(v=>v*(1-weight)) as Vec3,lift:0,
    joints:Object.fromEntries(fingers.map(f=>[f,interpolatePose(base.joints[f],joints[f],weight)])) as Record<Finger,JointPose>,
    active:activeStep?.note,activeNotes:activeStep?[activeStep.note]:[],depth,phase,targets:activeStep?[activeStep.target]:[],strikeStyle:plan.strikeStyle,
    technique:technique?(technique.note.finger===1?'thumb-under':'finger-over'):'scale'};
}

function scaleJoints(plan:ScalePlan,time:number,idleStyle:IdleFingerStyle):Record<Finger,JointPose> {
  if(idleStyle==='connected')return connectedJoints(plan,time);
  const resting=(finger:Finger)=>plan.placement?waitingPose(finger,true):restPose(finger);
  const joints=Object.fromEntries(fingers.map(f=>[f,resting(f)])) as Record<Finger,JointPose>;
  for(const step of plan.steps) {
    const n=step.note,start=contactStart(step),end=contactEnd(step);
    if(time<step.preparation||time>end+step.recovery)continue;
    if(time<start)joints[n.finger]=interpolatePose(resting(n.finger),step.before,ease((time-step.preparation)/(start-step.preparation)));
    else if(time<end) {
      const pose=poseAt(plan,step,time,strokeAt(plan,step,time).height);
      if(!pose)throw new Error('音階の指姿勢が検証範囲外になりました。');
      joints[n.finger]=pose;
    } else joints[n.finger]=interpolatePose(step.after,resting(n.finger),ease((time-end)/step.recovery));
  }
  return joints;
}

export function scaleFrameClear(plan:ScalePlan,time:number,frame:Pick<HandFrame,'position'|'rotation'|'joints'|'active'|'depth'>):boolean {
  if(!plan.placement||scaleWeight(plan,time)<1-1e-12)return true;
  const pressed=new Set(frame.active?[frame.active.midiNote]:[]);
  for(const f of fingers) {
    const points=pointsForPose(plan.hand,f,frame.joints[f]).map(p=>handPointWorld(frame.position,frame.rotation,p));
    if(!clearsBlackKeys(points,pressed,frame.depth*TRAVEL))return false;
    if(frame.active?.finger!==f&&points[2][1]<0.003)return false;
  }
  return true;
}

function freePathClear(plan:ScalePlan):boolean {
  const start=contactStart(plan.steps[0]),end=contactEnd(plan.steps.at(-1)!);
  const count=Math.ceil((end-start)/0.003);
  const times=new Set(Array.from({length:count+1},(_,i)=>start+(end-start)*i/count));
  for(const s of plan.steps)for(const t of [s.preparation,contactStart(s),s.note.time,s.note.time+s.note.duration,contactEnd(s)])
    if(t>=start&&t<=end)times.add(t);
  try {
    for(const t of times)for(const idle of ['connected','reset'] as const) {
      const active=plan.steps.find(s=>t>=contactStart(s)&&t<contactEnd(s));
      if(!scaleFrameClear(plan,t,{position:scalePalm(plan,t),rotation:[0,0,0],joints:scaleJoints(plan,t,idle),
        active:active?.note,depth:active?strokeAt(plan,active,t).depth:0}))return false;
    }
  } catch {return false;}
  return true;
}
