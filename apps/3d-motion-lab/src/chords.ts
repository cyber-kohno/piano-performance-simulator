import { pointsForPose, restPose, solveFinger } from './fingers';
import type { Hand, Finger, Vec3, JointPose } from './fingers';
export type Contact = {finger:Finger; target:Vec3};
export type DyadPlan = {position:Vec3; contacts:Contact[]};
export const WHITE_CONTACT_BACK=0.008,WHITE_CONTACT_FRONT=0.05;
export function dyadPoses(plan:DyadPlan,hand:Hand,lift:number):JointPose[]|undefined {
  const poses=plan.contacts.map(c=>solveFinger(hand,c.finger,c.target.map((v,i)=>v-plan.position[i]+(i===1?lift:0)) as Vec3));
  if(poses.some(p=>!p))return;
  return poses as JointPose[];
}
// Search shared palm placements, checking samples along the press path.
// This is a bounded prototype model, not a claim about a human player's reach.
export function planDyad(hand:Hand,contacts:Contact[],hover:number,travel:number):DyadPlan {
  const centerX=contacts.reduce((sum,c)=>sum+c.target[0]-pointsForPose(hand,c.finger,restPose(c.finger))[0][0],0)/2;
  let best:DyadPlan|undefined, bestScore=Infinity;
  for(let ix=-8;ix<=8;ix++)for(let iz=0;iz<=18;iz++)for(let iy=-6;iy<=4;iy++) {
    const position:Vec3=[centerX+ix*0.005,iy*0.005,iz*0.005];
    // White keys permit different contact depths for short and long fingers.
    // Stay in front of the black-key ends and away from the front edge.
    const adjusted=contacts.map(c=>({finger:c.finger,target:[c.target[0],c.target[1],Math.max(WHITE_CONTACT_BACK,Math.min(WHITE_CONTACT_FRONT,position[2]+pointsForPose(hand,c.finger,restPose(c.finger))[2][2]))] as Vec3}));
    const plan={position,contacts:adjusted};
    const hoverPoses=dyadPoses(plan,hand,hover);
    if(!hoverPoses||!dyadPoses(plan,hand,-travel))continue;
    let feasible=true;
    for(let i=1;i<16;i++)if(!dyadPoses(plan,hand,hover-(hover+travel)*i/16)) {feasible=false;break;}
    if(!feasible)continue;
    const score=hoverPoses.reduce((sum,p,i)=>sum+(p.spread-restPose(contacts[i].finger).spread)**2+(p.proximal+0.15)**2+(p.distal+0.1)**2,0);
    if(score<bestScore){best=plan;bestScore=score;}
  }
  if(!best)throw new Error('この2音は簡易モデルの開き角・関節範囲では同時に届きません。');
  return best;
}
