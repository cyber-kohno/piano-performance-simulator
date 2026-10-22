import { fingers, pointsForPose, solveFinger } from './fingers';
import type { Vec3 } from './fingers';
import type { HandFrame } from './motion';
import type { ScalePlan } from './scale-motion';
import { scaleWeight, crossingDirection, scaleFrameClear } from './scale-motion';
import { ease, handPointLocal, handPointWorld } from './movement';

// A small gesture around a 3/4↔1 crossing, evaluated in absolute time. Overlapping
// up/down gestures blend continuously at the turnaround of the short phrase.
function wristGesture(plan:ScalePlan,time:number,amount:number) {
  const mirror=plan.hand==='right'?1:-1;
  let direction=0,total=0;
  for(let i=1;i<plan.steps.length;i++) {
    const a=plan.steps[i-1].note,b=plan.steps[i].note;
    const sign=crossingDirection(a,b);
    if(!sign)continue;
    const start=a.time-0.04,peak=b.time+0.015,end=b.time+0.15;
    const pulse=time<=peak?ease((time-start)/(peak-start)):1-ease((time-peak)/(end-peak));
    direction+=sign*pulse;total+=pulse;
  }
  const weight=amount*scaleWeight(plan,time);
  const forward=Math.tanh(direction)*weight,lift=Math.tanh(total)*weight;
  return {rotation:[0.022*lift,0,-0.055*forward*mirror] as Vec3,offset:[0,0.0015*lift,0.001*forward] as Vec3};
}

// Return undefined for an unreachable pose; planning checks a common amount for
// both strike styles and both idle-finger styles before enabling this gesture.
export function withWrist(plan:ScalePlan,time:number,base:HandFrame,amount:number):HandFrame|undefined {
  if(!base.technique)return base;
  const gesture=wristGesture(plan,time,amount);
  if(gesture.rotation.every(v=>v===0))return {...base,wristMotion:true,forearmGuide:[0,0,0]};
  const position=base.position.map((v,i)=>v+gesture.offset[i]) as Vec3;
  const rotation=base.rotation.map((v,i)=>v+gesture.rotation[i]) as Vec3;
  const joints={...base.joints};
  for(const finger of fingers) {
    const distance=Math.min(...plan.steps.filter(s=>s.note.finger===finger).map(s=>
      Math.max(s.note.time-s.approach-time,time-s.note.time-s.note.duration-s.release,0)));
    // Fade the contact correction within 25ms of approach/release, so a finger
    // already returning to its free resting pose can follow the hand rotation.
    const correction=1-ease(distance/0.025);
    if(correction===0)continue;
    const tip=pointsForPose(plan.hand,finger,base.joints[finger])[2];
    const original=handPointWorld(base.position,base.rotation,tip),rotated=handPointWorld(position,rotation,tip);
    const target=rotated.map((v,i)=>v+(original[i]-v)*correction) as Vec3;
    const pose=solveFinger(plan.hand,finger,handPointLocal(position,rotation,target),true,base.joints[finger].opposition??0);
    if(!pose)return;
    joints[finger]=pose;
  }
  const result={...base,position,rotation,joints,wristMotion:true,
    forearmGuide:[rotation[2]*0.12,-rotation[0]*0.08,0] as Vec3};
  return scaleFrameClear(plan,time,result)?result:undefined;
}

export function wristAmount(plans:ScalePlan[],frameAt:(plan:ScalePlan,time:number,idle:'connected'|'reset')=>HandFrame):number {
  for(const amount of [1,0.75,0.5,0.25]) {
    let feasible=true;
    outer:for(const plan of plans) {
      const windows=plan.steps.flatMap((s,i)=>{
        const previous=plan.steps[i-1]?.note,n=s.note;
        if(!previous||!crossingDirection(previous,n))return [];
        return [{start:previous.time-0.04,end:n.time+0.15,peak:n.time+0.015}];
      });
      const times=new Set(windows.flatMap(w=>{
        const count=Math.ceil((w.end-w.start)/0.002);
        return [w.peak,...Array.from({length:count+1},(_,i)=>w.start+(w.end-w.start)*i/count)];
      }));
      for(const s of plan.steps)for(const t of [plan.blendStart,plan.blendEnd,s.preparation,s.note.time-s.approach-0.025,s.note.time-s.approach,
        s.note.time,s.note.time+Math.min(0.06,s.note.duration),s.note.time+s.note.duration,
        s.note.time+s.note.duration+s.release,s.note.time+s.note.duration+s.release+0.025])
        if(windows.some(w=>t>=w.start&&t<=w.end))times.add(t);
      for(const t of times)for(const idle of ['connected','reset'] as const) {
        const result=withWrist(plan,t,frameAt(plan,t,idle),amount);
        if(!result){feasible=false;break outer;}
        for(const f of fingers)if(result.active?.finger!==f) {
          const tip=handPointWorld(result.position,result.rotation,pointsForPose(plan.hand,f,result.joints[f])[2]);
          if(tip[1]<0.003){feasible=false;break outer;}
        }
      }
    }
    if(feasible)return amount;
  }
  return 0;
}
