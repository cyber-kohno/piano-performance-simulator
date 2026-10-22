import { fingers, pointsForPose, restPose, solveFinger } from './fingers';
import type { Hand, Finger, Vec3, JointPose } from './fingers';
import { keys, contactRange, clearsBlackKeys } from './keyboard';
export type Contact = {finger:Finger; midiNote:number; target:Vec3};
export type ChordPlan = {position:Vec3; contacts:Contact[]; idleJoints?:Partial<Record<Finger,JointPose>>};
export const WHITE_CONTACT_BACK=0.008,WHITE_CONTACT_FRONT=0.05;
export function chordPoses(plan:ChordPlan,hand:Hand,lift:number):JointPose[]|undefined {
  const poses=plan.contacts.map(c=>solveFinger(hand,c.finger,c.target.map((v,i)=>v-plan.position[i]+(i===1?lift:0)) as Vec3));
  if(poses.some(p=>!p))return;
  return poses as JointPose[];
}
// Search shared palm placements, checking samples along the press path.
// This is a bounded prototype model, not a claim about a human player's reach.
export function planChord(hand:Hand,contacts:Contact[],hover:number,travel:number):ChordPlan {
  // Canonical order makes the search independent of JSON note order. Keep the
  // caller's contact order in the returned plan for note/target correspondence.
  const ordered=[...contacts].sort((a,b)=>a.finger-b.finger);
  const rest=ordered.map(c=>pointsForPose(hand,c.finger,restPose(c.finger)));
  const surfaces=ordered.map(c=>keys.find(k=>k.midiNote===c.midiNote)!);
  const mixed=surfaces.some(k=>k.black),pressed=new Set(ordered.map(c=>c.midiNote));
  const mirror=mixed&&hand==='left'?-1:1;
  const centerX=ordered.reduce((sum,c,i)=>sum+c.target[0]-rest[i][0][0],0)/ordered.length;
  let best:ChordPlan|undefined, bestScore=Infinity;
  // Keep the earlier contact choice when it works. For denser chords, fingers
  // need independently chosen depths instead of their unbent tip projection.
  for(const flexible of mixed?[true]:[false,true]) {
    if(best)break;
    // Mixed configurations search a coarse grid first, then refine locally.
    // If coarse sampling finds no solution, retain the full fine-grid search.
    for(const spacing of mixed?[2,1]:[1]) {
      const focus:ChordPlan|undefined=mixed&&spacing===1?best:undefined;
      const fx=focus?Math.round((focus.position[0]-centerX)/(0.005*mirror)):0;
      const fz=focus?Math.round(focus.position[2]/0.005):0;
      const fy=focus?Math.round(focus.position[1]/0.005):0;
      for(let ix=focus?Math.max(-8,fx-1):-8;ix<=(focus?Math.min(8,fx+1):8);ix+=spacing)
      for(let iz=focus?Math.max(-14,fz-1):mixed?-14:0;iz<=(focus?Math.min(18,fz+1):18);iz+=spacing)
      for(let iy=focus?Math.max(-6,fy-1):-6;iy<=(focus?Math.min(4,fy+1):4);iy++) {
        const position:Vec3=[centerX+ix*0.005*mirror,iy*0.005,iz*0.005];
        const idleJoints:Partial<Record<Finger,JointPose>>={};
        let idleClear=true;
        if(mixed)for(const finger of fingers.filter(f=>!ordered.some(c=>c.finger===f))) {
          const idle=[restPose(finger),{...restPose(finger),proximal:-0.65,distal:0.35}].find(pose=>clearsBlackKeys(
            pointsForPose(hand,finger,pose).map(p=>p.map((v,i)=>v+position[i]) as Vec3),pressed,0));
          if(!idle){idleClear=false;break;}
          idleJoints[finger]=idle;
        }
        if(!idleClear)continue;
        // Mixed chords also allow rear white contacts and move the palm backward.
        // Key tops and contact ranges come from the displayed keyboard geometry.
        const adjusted:Contact[]=[];
        for(const [index,contact] of ordered.entries()) {
          const [back,front]=mixed?contactRange(surfaces[index],true):[WHITE_CONTACT_BACK,WHITE_CONTACT_FRONT];
          const preferred=Math.max(back,Math.min(front,position[2]+rest[index][2][2]));
          const depths=flexible?Array.from({length:Math.round((front-back)*1000)+1},(_,i)=>back+i*0.001):[preferred];
          const neutral=restPose(contact.finger);
          const clearAt=(pose:JointPose,height:number)=>clearsBlackKeys(
            pointsForPose(hand,contact.finger,pose).map(p=>p.map((v,i)=>v+position[i]) as Vec3),pressed,Math.max(0,-height));
          let chosen:Contact|undefined,chosenScore=Infinity;
          for(const z of depths) {
            const local:Vec3=[contact.target[0]-position[0],contact.target[1]-position[1]+hover,z-position[2]];
            const top=solveFinger(hand,contact.finger,local);
            const bottom=solveFinger(hand,contact.finger,[local[0],local[1]-hover-travel,local[2]]);
            if(!top||!bottom||mixed&&(!clearAt(top,hover)||!clearAt(bottom,-travel)))continue;
            const score=(top.spread-neutral.spread)**2+(top.proximal+0.15)**2+(top.distal+0.1)**2;
            if(score>=chosenScore-(mixed?1e-10:0))continue;
            let feasible=true;
            const samples=flexible?32:16;
            for(let i=1;i<samples;i++) {
              const height=hover-(hover+travel)*i/samples;
              const pose=solveFinger(hand,contact.finger,[local[0],local[1]-(hover+travel)*i/samples,local[2]]);
              if(!pose||mixed&&!clearAt(pose,height)){feasible=false;break;}
            }
            if(feasible){chosen={...contact,target:[contact.target[0],contact.target[1],z]};chosenScore=score;}
          }
          if(!chosen)break;
          adjusted.push(chosen);
        }
        if(adjusted.length!==ordered.length)continue;
        const plan:ChordPlan={position,contacts:adjusted,...(mixed?{idleJoints}:{})};
        const hoverPoses=chordPoses(plan,hand,hover);
        if(!hoverPoses)continue;
        const score=hoverPoses.reduce((sum,p,i)=>sum+(p.spread-restPose(ordered[i].finger).spread)**2+(p.proximal+0.15)**2+(p.distal+0.1)**2,0);
        if(score<bestScore-(mixed?1e-10:0)){best=plan;bestScore=score;}
      }
    }
  }
  if(!best)throw new Error(`この${contacts.length}音は簡易モデルの開き角・関節範囲${mixed?'・黒鍵との干渉制約':''}では同時に届きません。`);
  return {...best,contacts:contacts.map(c=>best!.contacts.find(p=>p.finger===c.finger)!)};
}
