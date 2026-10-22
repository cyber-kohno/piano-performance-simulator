import type { Vec3 } from './fingers';

export const WIDTH=0.0235;
export const KEYBOARD_WIDTH=52*WIDTH;
const blackPitches=[1,3,6,8,10];
let white=0;
export const keys=Array.from({length:88},(_,index)=>{
  const midiNote=21+index,black=blackPitches.includes(midiNote%12);
  const x=(black?white-0.5:white++)*WIDTH-25.5*WIDTH;
  return {midiNote,black,target:[x,black?0.012:0,black?-0.043:0.025] as Vec3,
    width:WIDTH*(black?0.58:0.96),height:black?0.024:0.018,length:black?0.087:0.15,z:black?-0.043:-0.01};
});
export type Key=typeof keys[number];

// Inset contact ranges derived from the same boxes used by the renderer.
// Rear white contacts stay between black keys at the white key's center X.
export function contactRange(key:Key,rearWhite=false):[number,number] {
  const back=key.z-key.length/2,front=key.z+key.length/2;
  return key.black?[Math.ceil((back+0.015)*1000)/1000,Math.floor((front-0.01)*1000)/1000]:
    [rearWhite?Math.ceil((back+0.015)*1000)/1000:0.008,front-0.015];
}

function intersects(a:Vec3,b:Vec3,min:Vec3,max:Vec3) {
  let enter=0,leave=1;
  for(let i=0;i<3;i++) {
    const delta=b[i]-a[i];
    if(Math.abs(delta)<1e-12){if(a[i]<min[i]||a[i]>max[i])return false;continue;}
    const t1=(min[i]-a[i])/delta,t2=(max[i]-a[i])/delta;
    enter=Math.max(enter,Math.min(t1,t2));leave=Math.min(leave,Math.max(t1,t2));
    if(enter>leave)return false;
  }
  return true;
}

// A local centerline check for mixed chords, not a mesh/capsule collision model.
// Pressed black keys move with the chord; other black keys keep their rest top.
export function clearsBlackKeys(points:Vec3[],pressed:ReadonlySet<number>,drop:number,drops?:ReadonlyMap<number,number>):boolean {
  const epsilon=1e-7;
  const lowX=Math.min(...points.map(p=>p[0])),highX=Math.max(...points.map(p=>p[0]));
  for(const key of keys)if(key.black&&key.target[0]+key.width/2>lowX&&key.target[0]-key.width/2<highX) {
    const top=key.target[1]-(drops?.get(key.midiNote)??(pressed.has(key.midiNote)?drop:0));
    const min:Vec3=[key.target[0]-key.width/2+epsilon,top-key.height+epsilon,key.z-key.length/2+epsilon];
    const max:Vec3=[key.target[0]+key.width/2-epsilon,top-epsilon,key.z+key.length/2-epsilon];
    for(let i=1;i<points.length;i++)if(intersects(points[i-1],points[i],min,max))return false;
  }
  return true;
}
