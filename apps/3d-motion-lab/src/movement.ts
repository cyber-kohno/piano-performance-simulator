import type { Vec3, Hand } from './fingers';
export type MotionStyle='linear'|'smooth';
export const WRIST:Vec3=[0,0.028,0.1025];
export const FOREARM_LENGTH=0.245;
export const FULL_VIEW_MIN:Vec3=[-52*0.0235/2-0.18,-0.15,-0.13];
export const FULL_VIEW_MAX:Vec3=[52*0.0235/2+0.18,0.17,0.50];
export const clamp01=(v:number)=>Math.max(0,Math.min(1,v));
export const ease=(v:number)=>{const t=clamp01(v);return t*t*t*(t*(t*6-15)+10);};

export function transition(from:Vec3,to:Vec3,time:number,start:number,end:number,style:MotionStyle) {
  const distance=Math.hypot(to[0]-from[0],to[2]-from[2]);
  const available=Math.max(1e-9,end-start);
  const duration=style==='smooth'?Math.min(available,Math.max(0.3,0.22+distance/0.7)):Math.min(0.3,available);
  const departure=style==='smooth'?end-duration:start;
  const u=clamp01((time-departure)/duration);
  const progress=style==='smooth'?ease(u):u;
  // A zero-slope arch at both ends. Larger jumps receive more clearance.
  // Rapid scales have little time for a lift or wrist swing between every note.
  const arch=style==='smooth'?16*u*u*(1-u)*(1-u)*Math.min(1,available/0.3):0;
  const lift=arch*Math.min(0.065,0.008+distance*0.12);
  const position=from.map((v,i)=>v+(to[i]-v)*progress+(i===1?lift:0)) as Vec3;
  const rotation:Vec3=style==='smooth'?[0.12*arch,0,-Math.sign(to[0]-from[0])*0.13*arch]:[0,0,0];
  return {position,rotation,lift,progress,preparation:style==='smooth'?ease(u/0.75):u,moving:u>0&&u<1};
}

// Euler XYZ (Y=0), pivoted at the wrist. Shared with geometry tests.
export function handPointWorld(position:Vec3,rotation:Vec3,point:Vec3):Vec3 {
  const [x,y,z]=point.map((v,i)=>v-WRIST[i]);
  const cz=Math.cos(rotation[2]),sz=Math.sin(rotation[2]);
  const cx=Math.cos(rotation[0]),sx=Math.sin(rotation[0]);
  const rx=x*cz-y*sz,ry=x*sz+y*cz;
  return [position[0]+WRIST[0]+rx,position[1]+WRIST[1]+ry*cx-z*sx,position[2]+WRIST[2]+ry*sx+z*cx];
}
export function forearmEndpoints(position:Vec3,hand:Hand) {
  const wrist=position.map((v,i)=>v+WRIST[i]) as Vec3;
  // The elbow follows the wrist toward a body-side guide; the upper arm is not modeled.
  const toward:Vec3=[(hand==='left'?-0.15:0.15)-wrist[0],-0.07-wrist[1],0.30];
  const distance=Math.hypot(...toward);
  const elbow=wrist.map((v,i)=>v+toward[i]/distance*FOREARM_LENGTH) as Vec3;
  return {wrist,elbow};
}
