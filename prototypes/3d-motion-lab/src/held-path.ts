import { fingers, pointsForPose, restPose, solveFinger } from './fingers';
import type { Finger, Hand, JointPose, Vec3 } from './fingers';
import { keys, contactRange, clearsBlackKeys } from './keyboard';
import { ease } from './movement';
import { fingerStroke } from './held-motion';
import type { FingerEvent, HeldPlan } from './held-motion';
import type { HandFrame } from './motion';
import { crossingDirection, scaleConnection } from './scale-motion';

export type HeldPath={times:number[];positions:Vec3[];targets:Vec3[];crossings?:{from:number;to:number}[]};
type Range={low:number;high:number;target:Vec3};
const HOVER=0.018,TRAVEL=0.01;
const begin=(e:FingerEvent)=>e.note.time-e.approach;
const finish=(e:FingerEvent)=>e.note.time+e.note.duration+e.release;
const raised=(f:Finger):JointPose=>({...restPose(f),proximal:-0.65,distal:0.35});
const mixPose=(a:JointPose,b:JointPose,u:number):JointPose=>({spread:a.spread+(b.spread-a.spread)*u,
  proximal:a.proximal+(b.proximal-a.proximal)*u,distal:a.distal+(b.distal-a.distal)*u,
  opposition:(a.opposition??0)+((b.opposition??0)-(a.opposition??0))*u});

export function heldPalm(path:HeldPath,time:number):Vec3 {
  if(time<=path.times[0])return [...path.positions[0]];
  for(let i=1;i<path.times.length;i++)if(time<path.times[i]) {
    const u=ease((time-path.times[i-1])/(path.times[i]-path.times[i-1]));
    return path.positions[i-1].map((v,j)=>v+(path.positions[i][j]-v)*u) as Vec3;
  }
  return [...path.positions.at(-1)!];
}

function poseFor(hand:Hand,event:FingerEvent,target:Vec3,position:Vec3,height:number) {
  // Remove sub-picometer cancellation differences before reachability tests,
  // so mirrored/transposed grids choose the same feasible component.
  const local=target.map((v,i)=>Math.round((v-position[i]+(i===1?height:0))*1e12)/1e12) as Vec3;
  return solveFinger(hand,event.note.finger,local,!!event.opposed);
}

export function movingHeldFrame(plan:HeldPlan,hand:Hand,time:number):HandFrame {
  const {events}=plan,path=plan.path!,position=heldPalm(path,time);
  const active=events.map((event,index)=>({event,index})).filter(({event})=>time>=begin(event)&&time<finish(event));
  const joints={} as Record<Finger,JointPose>;
  for(const finger of fingers) {
    const sounding=active.find(({event})=>event.note.finger===finger);
    if(sounding) {
      const {event,index}=sounding;
      const pose=poseFor(hand,event,path.targets[index],position,fingerStroke(event,time).height);
      if(!pose)throw new Error('移動する保持区間で指が接触点へ届きません。');
      joints[finger]=pose;continue;
    }
    const indices=events.map((e,i)=>e.note.finger===finger?i:-1).filter(i=>i>=0);
    const previous=indices.filter(i=>finish(events[i])<=time).at(-1),next=indices.find(i=>begin(events[i])>time);
    const endpoint=(i:number,t:number)=>poseFor(hand,events[i],path.targets[i],heldPalm(path,t),fingerStroke(events[i],t).height)!;
    const wait=raised(finger);
    if(previous!==undefined&&next!==undefined) {
      const end=finish(events[previous]),start=begin(events[next]),u=(time-end)/(start-end);
      const direct=mixPose(endpoint(previous,end),endpoint(next,start),ease(u));
      joints[finger]=mixPose(direct,wait,16*u*u*(1-u)*(1-u));
    } else if(previous!==undefined) {
      const end=finish(events[previous]);joints[finger]=mixPose(endpoint(previous,end),wait,ease((time-end)/0.18));
    } else if(next!==undefined) {
      const start=begin(events[next]);joints[finger]=mixPose(wait,endpoint(next,start),ease((time-start+0.3)/0.3));
    } else joints[finger]=wait;
  }
  const depths=active.map(({event})=>fingerStroke(event,time).depth);
  const substituting=active.some(({event})=>event.handoffFrom);
  const crossing=path.crossings?.some(c=>time>=begin(events[c.from])&&time<finish(events[c.to]));
  return {position,rotation:[0,0,0],lift:0,phase:active.some(({event:e})=>time>=e.note.time&&time<e.note.time+e.note.duration)?'press':
    active.some(({event:e})=>time<e.note.time)?'approach':active.length?'release':'waiting',
    active:active[0]?.event.note,activeNotes:active.map(({event})=>event.note),targets:active.map(({index})=>path.targets[index]),
    depths,depth:Math.max(0,...depths),curl:0,joints,
    technique:substituting?'substitution':crossing?'legato-crossing':'held-travel',strikeStyle:'smooth'};
}

// Find a conservative interval of palm X positions that reaches the whole
// vertical stroke. Contact Z remains fixed for this event for its entire life.
function contactRangeFor(hand:Hand,event:FingerEvent,y:number,z:number,zone?:[number,number],xOffset=0):Range|undefined {
  const key=keys.find(k=>k.midiNote===event.note.midiNote)!,finger=event.note.finger;
  const range=contactRange(key,true),back=Math.max(range[0],zone?.[0]??-Infinity),front=Math.min(range[1],zone?.[1]??Infinity);
  if(back>front)return;
  const root=pointsForPose(hand,finger,restPose(finger))[0];
  const center=key.target[0]+xOffset-root[0],preferred=z+pointsForPose(hand,finger,restPose(finger))[2][2];
  const depths=[Math.max(back,Math.min(front,preferred)),...Array.from({length:Math.ceil((front-back)/0.006)+1},(_,i)=>Math.min(front,back+i*0.006))];
  let best:Range|undefined,score=-Infinity;
  for(const depth of depths) {
    const target:Vec3=[key.target[0]+xOffset,key.target[1],depth];
    const reachable=(x:number)=>[-TRAVEL,0,0.009,HOVER].every(height=>!!poseFor(hand,event,target,[x,y,z],height));
    const mirror=hand==='right'?1:-1;
    let first:number|undefined;
    for(let i=0;i<=40;i++) {
      const x=center+mirror*(-0.08+i*0.004),valid=reachable(x);
      if(valid&&first===undefined)first=x;
      if(first!==undefined&&(!valid||i===40)) {
        const last=valid?x:x-mirror*0.004;
        let a=Math.min(first,last),b=Math.max(first,last);
        if(a===b){first=undefined;continue;}
        // Stay inside the sampled component; dense validation checks the path.
        a+=0.0002;b-=0.0002;
        const value=b-a-0.02*Math.abs(depth-preferred);
        if(value>score+1e-10){best={low:a,high:b,target};score=value;}
        first=undefined;
      }
    }
  }
  return best;
}

function pathFor(events:FingerEvent[],ranges:Range[],y:number,z:number):HeldPath|undefined {
  const times=[...new Set(events.flatMap(e=>[begin(e),finish(e)]))].sort((a,b)=>a-b);
  const bounds=times.map(t=>{
    const touching=events.map((e,i)=>begin(e)<=t+1e-9&&finish(e)>=t-1e-9?i:-1).filter(i=>i>=0);
    return {low:Math.max(...touching.map(i=>ranges[i].low)),high:Math.min(...touching.map(i=>ranges[i].high))};
  });
  if(bounds.some(b=>b.low>b.high))return;
  // Minimize neighboring movement with box constraints. Looking both ways lets
  // the hand prepare while an earlier finger is still holding its own key.
  const xs=bounds.map(b=>(b.low+b.high)/2),preferred=[...xs];
  for(let pass=0;pass<120;pass++)for(let offset=0;offset<xs.length;offset++) {
    const i=pass%2?xs.length-1-offset:offset,b=bounds[i];
    let sum=preferred[i]*0.03,weight=0.03;
    for(const j of [i-1,i+1])if(j>=0&&j<xs.length) {
      const w=1/Math.max(0.01,Math.abs(times[i]-times[j]));sum+=xs[j]*w;weight+=w;
    }
    xs[i]=Math.max(b.low,Math.min(b.high,sum/weight));
  }
  return {times,positions:xs.map(x=>[x,y,z]),targets:ranges.map(r=>r.target)};
}

function pathClear(plan:HeldPlan,hand:Hand):boolean {
  const path=plan.path!,start=path.times[0],end=path.times.at(-1)!,count=Math.ceil((end-start)/0.003);
  const times=new Set([...path.times,...Array.from({length:count+1},(_,i)=>start+(end-start)*i/count)]);
  for(const e of plan.events)for(const t of [e.note.time,e.note.time+Math.min(0.06,e.note.duration),e.note.time+e.note.duration,
    e.note.time+e.note.duration+e.release*0.65,begin(e)-0.3,finish(e)+0.18])if(t>=start&&t<=end)times.add(t);
  try {
    for(const t of times) {
      const frame=movingHeldFrame(plan,hand,t),drops=new Map(frame.activeNotes.map((n,i)=>[n.midiNote,frame.depths![i]*TRAVEL]));
      for(const f of fingers) {
        const points=pointsForPose(hand,f,frame.joints[f]).map(p=>p.map((v,i)=>v+frame.position[i]) as Vec3);
        if(!clearsBlackKeys(points,new Set(),0,drops)||!frame.activeNotes.some(n=>n.finger===f)&&points[2][1]<0.003)return false;
      }
    }
  } catch {return false;}
  return true;
}

export function planHeldPath(hand:Hand,events:FingerEvent[]):HeldPlan {
  const crossings:{from:number;to:number}[]=[];
  for(let i=0;i<events.length;i++)for(let j=i+1;j<events.length;j++) {
    const a=events[i],b=events[j];
    if(a.note.finger!==b.note.finger&&begin(a)<=finish(b)&&begin(b)<=finish(a)&&
      (a.note.midiNote-b.note.midiNote)*(a.note.finger-b.note.finger)*(hand==='right'?1:-1)<0)
      {
        if(scaleConnection(a.note,b.note)!=='crossing'||!crossingDirection(a.note,b.note))
          throw new Error('この指順が交差する保持区間には未対応です。半音・全音の3↔1／4↔1の持ち替えが必要です。');
        (a.note.finger===1?a:b).opposed=true;crossings.push({from:i,to:j});
      }
  }
  // Substituting fingers use distinct depths on the same key, rather than
  // assigning both fingertips the same point. Longer fingers take the rear.
  const zones=events.map(e=>{
    const peers=[...new Set(events.filter(p=>p.note.midiNote===e.note.midiNote).map(p=>p.note.finger))]
      .sort((a,b)=>{const length=(f:Finger)=>{const p=pointsForPose(hand,f,restPose(f));return Math.hypot(...p[2].map((v,i)=>v-p[0][i]));};return length(b)-length(a)||a-b;});
    if(peers.length<2)return;
    const key=keys.find(k=>k.midiNote===e.note.midiNote)!,center=key.target[2]+(peers.indexOf(e.note.finger)-(peers.length-1)/2)*0.018;
    return [center-0.002,center+0.002] as [number,number];
  });
  const offsets=events.map(()=>0),counts=events.map(()=>0);
  for(const {from,to} of crossings)for(const [i,j] of [[from,to],[to,from]]) {
    const key=keys.find(k=>k.midiNote===events[i].note.midiNote)!;
    offsets[i]+=Math.sign(events[j].note.midiNote-events[i].note.midiNote)*(key.width/2-0.003);counts[i]++;
  }
  for(const factor of crossings.length?[0,0.5,1]:[0])
  for(const y of [-0.025,-0.02,-0.015,-0.01,-0.005,0,-0.03])for(const z of [0.03,0.02,0.01,0,-0.01,-0.02,-0.03,-0.04,0.04]) {
    const ranges=events.map((e,i)=>contactRangeFor(hand,e,y,z,zones[i],factor*offsets[i]/Math.max(1,counts[i])));
    if(ranges.some(r=>!r))continue;
    const path=pathFor(events,ranges as Range[],y,z);if(!path)continue;
    if(crossings.length)path.crossings=crossings;
    const plan:HeldPlan={events,path,geometry:{position:path.positions[0],contacts:[]}};
    if(pathClear(plan,hand))return plan;
  }
  throw new Error('保持した指と次の打鍵へ連続して届きません。この簡易モデルの関節範囲・黒鍵との干渉制約で掌軌道が見つかりません。');
}
