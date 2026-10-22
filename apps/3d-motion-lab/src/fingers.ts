export type Vec3 = [number, number, number];
export type Hand = 'left' | 'right';
export type Finger = 1 | 2 | 3 | 4 | 5;
export const fingers: Finger[] = [1,2,3,4,5];
export const specs = {
  1: { x:-0.035, z:0.064, lengths:[0.025,0.025], spread:0.65 },
  2: { x:-0.022, z:0.045, lengths:[0.04,0.031], spread:0.04 },
  3: { x:0, z:0.045, lengths:[0.045,0.034], spread:0 },
  4: { x:0.021, z:0.048, lengths:[0.04,0.03], spread:-0.04 },
  5: { x:0.039, z:0.055, lengths:[0.032,0.025], spread:-0.12 },
};
export type JointPose = { spread:number; proximal:number; distal:number };
export const spreadLimits = (finger:Finger):[number,number] => finger===1 ? [-0.4,0.4] : [-0.55,0.55];
export function restPose(finger:Finger, spreadOffset=0):JointPose {
  return {spread:specs[finger].spread+spreadOffset,proximal:-0.15,distal:-0.1};
}
// Shared two-segment forward kinematics; thumb has its own base and splay.
export function fingerPoints(hand:Hand, finger:Finger, curl:number): [Vec3,Vec3,Vec3] {
  return pointsForPose(hand,finger,{spread:specs[finger].spread,proximal:-0.15+curl,distal:-0.1+curl*1.6});
}
export function pointsForPose(hand:Hand, finger:Finger, pose:JointPose): [Vec3,Vec3,Vec3] {
  const spec=specs[finger], mirror=hand==='right'?1:-1;
  const root:Vec3=[spec.x*mirror,0.028,spec.z];
  const points:[Vec3,Vec3,Vec3]=[root,[...root],[...root]];
  const angles=[pose.proximal,pose.distal];
  for(let i=0;i<2;i++) {
    const length=spec.lengths[i], angle=angles[i], previous=points[i];
    points[i+1]=[
      previous[0]-Math.sin(pose.spread)*mirror*length*Math.cos(angle),
      previous[1]-length*Math.sin(angle),
      previous[2]-Math.cos(pose.spread)*length*Math.cos(angle),
    ];
  }
  return points;
}
// Closed-form geometry for this two-segment prototype, with explicit angle limits.
export function solveFinger(hand:Hand,finger:Finger,target:Vec3):JointPose|undefined {
  const spec=specs[finger], root=pointsForPose(hand,finger,restPose(finger))[0];
  const dx=(target[0]-root[0])*(hand==='right'?1:-1), dz=root[2]-target[2], down=root[1]-target[1];
  if(dz<=0)return;
  const spread=Math.atan2(-dx,dz), offset=spread-spec.spread;
  const [min,max]=spreadLimits(finger);
  if(offset<min||offset>max)return;
  const radial=Math.hypot(dx,dz),[a,b]=spec.lengths;
  const cosine=(radial*radial+down*down-a*a-b*b)/(2*a*b);
  if(cosine< -1||cosine>1)return;
  const joint=Math.acos(cosine);
  const proximal=Math.atan2(down,radial)-Math.atan2(b*Math.sin(joint),a+b*Math.cos(joint));
  const distal=proximal+joint;
  if(proximal< -0.7||proximal>1.1||joint>1.7||distal>1.8)return;
  return {spread,proximal,distal};
}
export function curlForDrop(hand:Hand, finger:Finger, drop:number) {
  const restY=fingerPoints(hand,finger,0)[2][1];
  let low=0,high=0.8;
  for(let i=0;i<32;i++) {
    const mid=(low+high)/2;
    if(restY-fingerPoints(hand,finger,mid)[2][1]<drop)low=mid; else high=mid;
  }
  return (low+high)/2;
}
