import { test } from 'node:test';
import assert from 'node:assert/strict';
import basic from './data/basic.json';
import black from './data/black-keys.json';
import fullRange from './data/full-range.json';
import both from './data/both-hands.json';
import dyads from './data/dyads.json';
import movement from './data/movement.json';
import scaleRight from './data/scale-sixteenths-120-right.json';
import scaleBoth from './data/scale-sixteenths-120-both.json';
import scaleCrossing from './data/scale-crossing-right.json';
import mixedPhrases from './data/mixed-phrases.json';
import whiteChords from './data/white-chords.json';
import mixedKeyChords from './data/mixed-key-chords.json';
import mixedKeyScales from './data/mixed-key-scales.json';
import heldLegato from './data/held-legato.json';
import heldTravel from './data/held-travel.json';
import legatoCrossings from './data/legato-crossings.json';
import { contactRange, clearsBlackKeys } from './keyboard';
import { crossingDirection, scaleConnection, scaleWeight } from './scale-motion';
import { Box3, PerspectiveCamera, Vector3, Quaternion, Euler } from 'three';
import { transition, forearmEndpoints, handPointWorld, handPointLocal, WRIST, FOREARM_LENGTH, FULL_VIEW_MIN, FULL_VIEW_MAX } from './movement';
import { fitCamera } from './framing';
import { validate, evaluate, keys, TRAVEL, lengthOf, performancePlanFor, preparePerformance, heldPlansFor, keyDepth } from './motion';
import { fingerPoints, fingers, pointsForPose, restPose, specs } from './fingers';

test('レガートの3/4↔1と明示した指替えを入力から計画し、同音反復と区別する',()=>{
  const notes=validate(legatoCrossings),snapshot=structuredClone(notes),plans=heldPlansFor(notes);
  assert.equal(notes.length,88);
  for(const hand of ['left','right'] as const) {
    assert.equal(plans[hand].length,5);
    assert.equal(plans[hand].filter(p=>p.path?.crossings).length,3);
    assert.equal(plans[hand].filter(p=>p.events.some(e=>e.handoffFrom)).length,2);
    assert.equal(evaluate(notes,2.25)[hand].technique,'legato-crossing');
    assert.equal(evaluate(notes,14.8)[hand].technique,'substitution');
    const key=hand==='right'?64:48;
    assert.equal(keyDepth(evaluate(notes,20.6)[hand],key),0,'通常の同音反復は離鍵する');
    assert.equal(keyDepth(evaluate(notes,20.75)[hand],key),0,'次の音は深さ0から再打鍵');
    assert.equal(keyDepth(evaluate(notes,20.85)[hand],key),1);
    assert.equal(performancePlanFor(notes)[hand].length,1);
  }
  preparePerformance(notes);assert.deepEqual(notes,snapshot);
});

test('レガートの持ち替えは重なった2音の接触・鍵盤の深さ・関節範囲と黒鍵干渉を保つ',()=>{
  const notes=validate(legatoCrossings);
  for(const hand of ['left','right'] as const)for(const p of heldPlansFor(notes)[hand].filter(p=>p.path?.crossings)) {
    const path=p.path!;
    for(let t=path.times[0];t<path.times.at(-1)!;t+=0.0037) {
      const frame=evaluate(notes,t,'scale')[hand];
      const drops=new Map(frame.activeNotes.map((n,i)=>[n.midiNote,frame.depths![i]*TRAVEL]));
      for(const f of fingers) {
        const points=pointsForPose(hand,f,frame.joints[f]).map(v=>handPointWorld(frame.position,frame.rotation,v));
        assert.ok(clearsBlackKeys(points,new Set(),0,drops));
        for(let i=0;i<2;i++)assert.ok(Math.abs(Math.hypot(...points[i+1].map((v,j)=>v-points[i][j]))-specs[f].lengths[i])<1e-9);
        const j=frame.joints[f];assert.ok(j.proximal>=-0.7&&j.proximal<=1.1&&j.distal<=1.8&&j.distal-j.proximal<=1.7);
        if(!frame.activeNotes.some(n=>n.finger===f))assert.ok(points[2][1]>=0.003-1e-9);
      }
      for(const [i,n] of frame.activeNotes.entries()) {
        const target=frame.targets[i],key=keys.find(k=>k.midiNote===n.midiNote)!,range=contactRange(key,true);
        assert.ok(Math.abs(target[0]-key.target[0])<=key.width/2-0.003+1e-10);
        assert.ok(target[2]>=range[0]-1e-10&&target[2]<=range[1]+1e-10);
        const tip=handPointWorld(frame.position,frame.rotation,pointsForPose(hand,n.finger,frame.joints[n.finger])[2]);
        assert.ok(Math.abs(tip[0]-target[0])<1e-9&&Math.abs(tip[2]-target[2])<1e-9);
        if(t>=n.time&&t<n.time+n.duration)assert.ok(Math.abs(tip[1]-target[1]+keyDepth(frame,n.midiNote)*TRAVEL)<1e-9);
      }
    }
    for(const c of path.crossings!) {
      const a=p.events[c.from].note,b=p.events[c.to].note,t=b.time+0.035,frame=evaluate(notes,t)[hand];
      assert.ok(frame.activeNotes.includes(a)&&frame.activeNotes.includes(b));
      assert.equal(keyDepth(frame,a.midiNote),1);assert.ok(keyDepth(frame,b.midiNote)>0&&keyDepth(frame,b.midiNote)<1);
    }
  }
});

test('同一鍵の指替えで鍵盤を戻さず、別々の接触点へ着地してから元の指だけ離す',()=>{
  const notes=validate(legatoCrossings);
  for(const hand of ['left','right'] as const)for(const p of heldPlansFor(notes)[hand].filter(p=>p.events.some(e=>e.handoffFrom))) {
    const [a,b]=p.events,path=p.path!,key=a.note.midiNote;
    assert.equal(b.handoffFrom,a.note);assert.equal(a.handoffTo,b.note);
    assert.equal(path.targets[0][0],path.targets[1][0]);
    assert.ok(Math.abs(path.targets[0][2]-path.targets[1][2])>=0.014-1e-10);
    for(let t=a.note.time+0.06;t<=b.note.time+b.note.duration;t+=0.0037) {
      const frame=evaluate(notes,t)[hand];assert.equal(keyDepth(frame,key),1);
      for(const [i,n] of frame.activeNotes.entries()) {
        const tip=handPointWorld(frame.position,frame.rotation,pointsForPose(hand,n.finger,frame.joints[n.finger])[2]);
        assert.ok(tip[1]>=frame.targets[i][1]-TRAVEL-1e-9);
        if(t>=n.time&&t<=n.time+n.duration)assert.ok(Math.abs(tip[1]-frame.targets[i][1]+TRAVEL)<1e-9);
      }
    }
    const arriving=evaluate(notes,b.note.time)[hand];assert.equal(arriving.activeNotes.length,2);
    const lifting=evaluate(notes,a.note.time+a.note.duration+a.release/2)[hand];
    const sourceTip=handPointWorld(lifting.position,lifting.rotation,pointsForPose(hand,a.note.finger,lifting.joints[a.note.finger])[2]);
    const targetTip=handPointWorld(lifting.position,lifting.rotation,pointsForPose(hand,b.note.finger,lifting.joints[b.note.finger])[2]);
    assert.ok(sourceTip[1]>targetTip[1]+0.005);assert.equal(keyDepth(lifting,key),1);
    assert.ok(!evaluate(notes,a.note.time+a.note.duration+a.release+0.001)[hand].activeNotes.includes(a.note));
  }
});

test('持ち替え・指替え・空中接続は親指の対向量も含めて連続し、上下速度を保つ',()=>{
  const notes=validate(legatoCrossings),times=new Set<number>([4.1,4.5,9.1,9.5,13.1,13.5,15.82,16.3,18.82,19.4,21.22,21.6,21.88,22]);
  for(const hand of ['left','right'] as const)for(const p of heldPlansFor(notes)[hand]) {
    for(const t of p.path!.times)times.add(t);
    for(const e of p.events)for(const t of [e.note.time-e.approach-0.3,e.note.time-e.approach,e.note.time,e.note.time+Math.min(.06,e.note.duration),
      e.note.time+e.note.duration,e.note.time+e.note.duration+e.release*.65,e.note.time+e.note.duration+e.release,e.note.time+e.note.duration+e.release+.18])times.add(t);
  }
  for(const t of times)for(const style of ['linear','smooth','scale'] as const) {
    const a=evaluate(notes,t-1e-7,style),b=evaluate(notes,t+1e-7,style);
    for(const hand of ['left','right'] as const)for(const f of fingers) {
      const ap=pointsForPose(hand,f,a[hand].joints[f]).map(v=>handPointWorld(a[hand].position,a[hand].rotation,v));
      const bp=pointsForPose(hand,f,b[hand].joints[f]).map(v=>handPointWorld(b[hand].position,b[hand].rotation,v));
      ap.forEach((v,i)=>v.forEach((x,j)=>assert.ok(Math.abs(x-bp[i][j])<1e-5,`${t} ${style} ${hand} 指${f}`)));
      assert.ok(Math.abs((a[hand].joints[f].opposition??0)-(b[hand].joints[f].opposition??0))<1e-4);
    }
  }
  for(const hand of ['left','right'] as const)for(const p of heldPlansFor(notes)[hand])for(const e of p.events) {
    const n=e.note;
    for(const t of [n.time,n.time+n.duration]) {
      const a=evaluate(notes,t-1e-5)[hand],b=evaluate(notes,t+1e-5)[hand];
      const ay=handPointWorld(a.position,a.rotation,pointsForPose(hand,n.finger,a.joints[n.finger])[2])[1];
      const by=handPointWorld(b.position,b.rotation,pointsForPose(hand,n.finger,b.joints[n.finger])[2])[1];
      assert.ok(Math.abs(by-ay)/2e-5<1e-4);
    }
  }
});

test('持ち替え・指替えの鏡映・移調・入力順・比較設定と逆シークを再現する',()=>{
  const input=legatoCrossings.filter(n=>n.time<19),notes=validate(input),shuffled=validate([...input].reverse());
  const shifted=validate(input.map(n=>({...n,midiNote:n.midiNote+24}))),center=keys.find(k=>k.midiNote===56)!.target[0];
  for(const t of [1.95,2.25,2.65,6.65,7.05,11.3,11.7,14.65,14.8,15.25,17.8,18.25]) {
    const expected=evaluate(notes,t);
    evaluate(notes,0);evaluate(notes,30);assert.deepEqual(evaluate(notes,t),expected);assert.deepEqual(evaluate(shuffled,t),expected);
    assert.ok(Math.abs(expected.left.position[0]+expected.right.position[0]-2*center)<1e-8);
    for(const hand of ['left','right'] as const) {
      const moved=evaluate(shifted,t)[hand];assert.ok(Math.abs(moved.position[0]-expected[hand].position[0]-14*0.0235)<1e-8);
      assert.deepEqual(moved.depths,expected[hand].depths);
    }
    for(const style of ['linear','smooth','scale'] as const)for(const idle of ['connected','reset'] as const)
      for(const strike of ['smooth','legacy'] as const)for(const wrist of [true,false])assert.deepEqual(evaluate(notes,t,style,idle,strike,wrist),expected);
  }
});

test('短い受け取り保持と連続した指替えも、既存の鍵盤深さを継承してから離鍵する',()=>{
  const a={time:1,duration:1.1,midiNote:64,hand:'right',finger:3};
  const short=validate([a,{...a,time:2.09,duration:0.03,finger:4,action:'substitute'}]);
  assert.equal(keyDepth(evaluate(short,2.12).right,64),1);
  assert.ok(keyDepth(evaluate(short,2.120001).right,64)>0.999);
  const chain=validate([{...a,duration:1.2},{...a,time:1.7,duration:1.5,finger:4,action:'substitute'},
    {...a,time:2.7,duration:1.2,action:'substitute'}]);
  for(let t=1.06;t<3.9;t+=0.007)assert.equal(keyDepth(evaluate(chain,t).right,64),1);
  assert.equal(evaluate(chain,lengthOf(chain)).right.activeNotes.length,0);
});

test('指替えの明示漏れ・保持相手や長さの不整合・同一指・不正な奏法指定を拒否する',()=>{
  const a={time:1,duration:1.2,midiNote:64,hand:'right',finger:3},b={...a,time:1.7,duration:1,finger:4,action:'substitute'};
  for(const input of [[b],[a,{...b,action:undefined}],[a,{...b,midiNote:65}],[a,{...b,finger:3}],
    [a,{...b,time:1.05}],[a,{...b,duration:0.1}],[a,{...b,time:2.5}],[a,{...b,action:'tie'}]])assert.throws(()=>validate(input));
  assert.throws(()=>validate([a,b,{...b,time:1.8,finger:5}]),/重複|指替え/);
  assert.throws(()=>validate([{...a,time:1,duration:.5},{...a,time:1.4,midiNote:72,finger:1}]),/交差/);
});

test('持ち替え・指替え中も反対の手との同一鍵接触を、受け渡し全体の時間で拒否する',()=>{
  const a={time:1,duration:1.2,midiNote:64,hand:'right',finger:3},b={...a,time:1.7,duration:1,finger:4,action:'substitute'};
  assert.throws(()=>validate([a,b,{...a,time:2.5,duration:.2,hand:'left'}]),/左右の手/);
  const valid=validate([a,b,{...a,time:3.1,duration:.2,hand:'left'}]);assert.equal(evaluate(valid,3.2).left.depth,1);
});

test('保持中の掌移動を入力から計画し、固定保持・音階との混在と配列不変性を保つ',()=>{
  const notes=validate(heldTravel),snapshot=structuredClone(notes),plans=heldPlansFor(notes);
  assert.equal(notes.length,60);
  for(const hand of ['left','right'] as const) {
    assert.equal(plans[hand].length,4);assert.equal(plans[hand].filter(p=>p.path).length,3);
    assert.equal(performancePlanFor(notes)[hand].length,1);
    for(const p of plans[hand].filter(p=>p.path)) {
      const xs=p.path!.positions.map(v=>v[0]);assert.ok(Math.max(...xs)-Math.min(...xs)>0.015);
      for(const e of p.events)assert.ok(e.approach>0&&e.release>0);
    }
    assert.equal(evaluate(notes,2.2,'scale')[hand].technique,'held-travel');
    assert.equal(evaluate(notes,13.6,'scale')[hand].technique,'held');
    assert.ok(performancePlanFor(notes)[hand][0].legacy.steps.length>=4);
  }
  preparePerformance(notes);assert.deepEqual(notes,snapshot);
});

test('掌が動いても全保持指の接触点・音別深さ・指長・黒鍵クリアランスを保つ',()=>{
  const notes=validate(heldTravel);
  for(const hand of ['left','right'] as const)for(const p of heldPlansFor(notes)[hand].filter(p=>p.path)) {
    const path=p.path!,held=p.events[0].note,tipPositions:number[][]=[],palmPositions:number[]=[];
    for(let t=path.times[0];t<path.times.at(-1)!;t+=0.0037) {
      const frame=evaluate(notes,t,'scale')[hand];assert.equal(frame.technique,'held-travel');
      const drops=new Map(frame.activeNotes.map((n,i)=>[n.midiNote,frame.depths![i]*TRAVEL]));
      for(const f of fingers) {
        const points=pointsForPose(hand,f,frame.joints[f]).map(v=>handPointWorld(frame.position,frame.rotation,v));
        assert.ok(clearsBlackKeys(points,new Set(),0,drops));
        for(let i=0;i<2;i++)assert.ok(Math.abs(Math.hypot(...points[i+1].map((v,j)=>v-points[i][j]))-specs[f].lengths[i])<1e-9);
        if(!frame.activeNotes.some(n=>n.finger===f))assert.ok(points[2][1]>=0.003-1e-9);
      }
      for(const [index,n] of frame.activeNotes.entries()) {
        const event=p.events.find(e=>e.note===n)!,target=path.targets[p.events.indexOf(event)];
        assert.deepEqual(frame.targets[index],target);
        const key=keys.find(k=>k.midiNote===n.midiNote)!,range=contactRange(key,true);
        assert.ok(target[2]>=range[0]-1e-10&&target[2]<=range[1]+1e-10);
        const tip=handPointWorld(frame.position,frame.rotation,pointsForPose(hand,n.finger,frame.joints[n.finger])[2]);
        assert.ok(Math.abs(tip[0]-target[0])<1e-9&&Math.abs(tip[2]-target[2])<1e-9);
        if(t>=n.time&&t<=n.time+n.duration)assert.ok(Math.abs(tip[1]-target[1]+keyDepth(frame,n.midiNote)*TRAVEL)<1e-9);
      }
      if(t>held.time+0.06&&t<held.time+held.duration) {
        tipPositions.push(handPointWorld(frame.position,frame.rotation,pointsForPose(hand,held.finger,frame.joints[held.finger])[2]));
        palmPositions.push(frame.position[0]);
      }
    }
    assert.ok(Math.max(...palmPositions)-Math.min(...palmPositions)>0.015);
    for(const tip of tipPositions)tip.forEach((v,i)=>assert.ok(Math.abs(v-tipPositions[0][i])<1e-9));
  }
});

test('移動する保持の節点・指の移動・区間の出入りが連続し、掌の速度が節点でゼロになる',()=>{
  const notes=validate(heldTravel),times=new Set<number>([0,4.2,4.5,8.4,8.8,12.3,12.8,13.18,14.82,15.3,15.88,16]);
  for(const hand of ['left','right'] as const)for(const p of heldPlansFor(notes)[hand].filter(p=>p.path)) {
    for(const t of p.path!.times)times.add(t);
    for(const e of p.events)for(const t of [e.note.time-e.approach-0.3,e.note.time-e.approach,e.note.time,e.note.time+0.06,
      e.note.time+e.note.duration,e.note.time+e.note.duration+e.release,e.note.time+e.note.duration+e.release+0.18])times.add(t);
    for(const t of p.path!.times) {
      const a=evaluate(notes,t-1e-5,'smooth')[hand],b=evaluate(notes,t+1e-5,'smooth')[hand];
      assert.ok(Math.abs(b.position[0]-a.position[0])/2e-5<1e-5,`${hand} ${t}`);
    }
  }
  for(const t of times)for(const style of ['linear','smooth','scale'] as const) {
    const a=evaluate(notes,t-1e-7,style),b=evaluate(notes,t+1e-7,style);
    for(const hand of ['left','right'] as const) {
      a[hand].position.forEach((v,i)=>assert.ok(Math.abs(v-b[hand].position[i])<1e-5));
      for(const f of fingers)for(const field of ['spread','proximal','distal'] as const)
        assert.ok(Math.abs(a[hand].joints[f][field]-b[hand].joints[f][field])<1e-4,`${t} ${style} ${hand} ${f} ${field}`);
    }
  }
});

test('移動保持は鏡映・移調・高速化・入力順と逆シークでも同じ接触計画を再現する',()=>{
  const input=heldTravel.filter(n=>n.time<12.1),notes=validate(input),shifted=validate(input.map(n=>({...n,midiNote:n.midiNote+24}))),shuffled=validate([...input].reverse());
  const center=keys.find(k=>k.midiNote===56)!.target[0];
  for(const t of [1.5,1.9,2.3,3,5.5,6.3,7,9.7,10.5,11.3]) {
    const expected=evaluate(notes,t);
    evaluate(notes,0);evaluate(notes,20);assert.deepEqual(evaluate(notes,t),expected);
    assert.deepEqual(evaluate(shuffled,t),expected);
    const a=expected.right,b=expected.left;
    assert.ok(Math.abs(a.position[0]+b.position[0]-2*center)<1e-8);
    for(const f of fingers)for(const field of ['spread','proximal','distal'] as const)assert.ok(Math.abs(a.joints[f][field]-b.joints[f][field])<1e-7);
    for(const hand of ['left','right'] as const) {
      const moved=evaluate(shifted,t)[hand],base=expected[hand];
      assert.ok(Math.abs(moved.position[0]-base.position[0]-14*0.0235)<1e-8);
      assert.deepEqual(moved.depths,base.depths);
    }
  }
  const fast=validate(input.map(n=>({...n,time:1+(n.time-1)/2,duration:n.duration/2})));
  for(const hand of ['left','right'] as const)for(const p of heldPlansFor(fast)[hand])for(const e of p.events) {
    const t=e.note.time+Math.min(0.06,e.note.duration),frame=evaluate(fast,t)[hand];
    const i=frame.activeNotes.indexOf(e.note),tip=handPointWorld(frame.position,frame.rotation,pointsForPose(hand,e.note.finger,frame.joints[e.note.finger])[2]);
    assert.ok(i>=0);tip.forEach((v,j)=>assert.ok(Math.abs(v-frame.targets[i][j]+(j===1?keyDepth(frame,e.note.midiNote)*TRAVEL:0))<1e-9));
  }
});

test('掌移動中の比較設定と音別時刻は共通で、離鍵した指の別鍵移動に空中時間を確保する',()=>{
  const notes=validate(heldTravel);
  for(const t of [1.5,2.1,5.5,6.4,9.7,10.5])for(const style of ['linear','smooth','scale'] as const)
    for(const idle of ['connected','reset'] as const)for(const strike of ['smooth','legacy'] as const)for(const wrist of [true,false])
      assert.deepEqual(evaluate(notes,t,style,idle,strike,wrist),evaluate(notes,t));
  for(const hand of ['left','right'] as const)for(const p of heldPlansFor(notes)[hand].filter(p=>p.path)) {
    for(const e of p.events) {
      assert.equal(keyDepth(evaluate(notes,e.note.time)[hand],e.note.midiNote),0);
      assert.equal(keyDepth(evaluate(notes,e.note.time+e.note.duration)[hand],e.note.midiNote),1);
    }
    for(let i=0;i<p.events.length;i++)for(let j=i+1;j<p.events.length;j++) {
      const a=p.events[i],b=p.events[j];
      if(a.note.finger===b.note.finger&&a.note.midiNote!==b.note.midiNote)
        assert.ok(a.note.time+a.note.duration+a.release<b.note.time-b.approach);
    }
  }
});

test('移動する保持でも同一指の重複・交差・届かない軌道・左右同一鍵を拒否する',()=>{
  const anchor={time:1,duration:2.8,midiNote:64,hand:'right',finger:3};
  const first={...anchor,time:1.3,duration:0.35,midiNote:60,finger:1};
  const next={...first,time:2.05,midiNote:62};
  assert.throws(()=>validate([anchor,first,{...next,time:1.5}]),/重複/);
  assert.throws(()=>validate([anchor,first,{...next,time:1.655}]),/音間不足/);
  assert.throws(()=>validate([anchor,first,{...next,midiNote:67}]),/交差/);
  assert.throws(()=>validate([anchor,first,{...next,midiNote:21}]),/届きません/);
  assert.throws(()=>validate([anchor,first,next,{...anchor,time:1.9,duration:0.2,hand:'left'}]),/左右の手/);
  assert.throws(()=>validate([anchor,first,{...next,time:1.5,midiNote:60,finger:2}]),/重複/);
});

test('保持音・5指レガート・部分離鍵を音符から計画し、後続の音階へ戻る',()=>{
  const notes=validate(heldLegato),snapshot=structuredClone(notes),plans=heldPlansFor(notes);
  assert.equal(notes.length,62);
  for(const hand of ['left','right'] as const) {
    assert.equal(plans[hand].length,4);assert.equal(performancePlanFor(notes)[hand].length,1);
    assert.equal(evaluate(notes,1.83,'scale')[hand].activeNotes.length,3);
    assert.equal(evaluate(notes,8.4,'scale')[hand].activeNotes.length,2);
    assert.equal(evaluate(notes,8.8,'scale')[hand].activeNotes.length,1);
    assert.ok(['scale','thumb-under','finger-over'].includes(evaluate(notes,14,'scale')[hand].technique!));
  }
  preparePerformance(notes);assert.deepEqual(notes,snapshot);
});

test('保持区間の全指が独立した鍵盤深さと固定接触点を保ち、黒鍵の下降も個別に反映する',()=>{
  const notes=validate(heldLegato),plans=heldPlansFor(notes);
  for(const hand of ['left','right'] as const)for(const plan of plans[hand]) {
    const start=plan.events[0].note.time-plan.events[0].approach;
    const end=Math.max(...plan.events.map(e=>e.note.time+e.note.duration+e.release));
    for(let t=start;t<end;t+=0.004) {
      const frame=evaluate(notes,t,'scale','connected','smooth',true)[hand];
      assert.equal(frame.technique,'held');assert.deepEqual(frame.position,plan.geometry.position);
      const drops=new Map(frame.activeNotes.map((n,i)=>[n.midiNote,frame.depths![i]*TRAVEL]));
      for(const f of fingers) {
        const points=pointsForPose(hand,f,frame.joints[f]).map(p=>handPointWorld(frame.position,frame.rotation,p));
        assert.ok(clearsBlackKeys(points,new Set(),0,drops));
        for(let i=0;i<2;i++)assert.ok(Math.abs(Math.hypot(...points[i+1].map((v,j)=>v-points[i][j]))-specs[f].lengths[i])<1e-10);
      }
      for(const [i,n] of frame.activeNotes.entries()) {
        const tip=handPointWorld(frame.position,frame.rotation,pointsForPose(hand,n.finger,frame.joints[n.finger])[2]);
        const target=frame.targets[i],key=keys.find(k=>k.midiNote===n.midiNote)!;
        const range=contactRange(key,plan.geometry.contacts.some(c=>keys.find(k=>k.midiNote===c.midiNote)!.black));
        assert.ok(target[2]>=range[0]-1e-10&&target[2]<=range[1]+1e-10);
        assert.ok(Math.abs(tip[0]-target[0])<1e-9&&Math.abs(tip[2]-target[2])<1e-9);
        assert.equal(keyDepth(frame,n.midiNote),frame.depths![i]);
        if(t>=n.time&&t<=n.time+n.duration)assert.ok(Math.abs(tip[1]-target[1]+keyDepth(frame,n.midiNote)*TRAVEL)<1e-9);
      }
    }
  }
  const partial=evaluate(notes,1.83).right;
  assert.equal(keyDepth(partial,60),1);assert.equal(keyDepth(partial,64),1);
  assert.ok(Math.abs(keyDepth(partial,67)-0.5)<1e-8);
  const release=evaluate(notes,8.23).right;
  assert.ok(keyDepth(release,61)>0&&keyDepth(release,61)<1);assert.equal(keyDepth(release,65),1);assert.equal(keyDepth(release,68),1);
});

test('保持中の指は他の指の押下・離鍵・再打鍵で動かず、指ごとの時間を変えない',()=>{
  const notes=validate(heldLegato);
  const tip=(t:number)=>{const f=evaluate(notes,t).right;return handPointWorld(f.position,f.rotation,pointsForPose('right',1,f.joints[1])[2]);};
  const held=tip(1.2);
  for(const t of [1.4,1.43,1.8,1.85,2.2,2.3,2.8,3.099])tip(t).forEach((v,i)=>assert.ok(Math.abs(v-held[i])<1e-10));
  for(const t of [10.6,10.85,11.05,11.3,11.5,11.75])assert.equal(keyDepth(evaluate(notes,t).right,61),1);
  assert.equal(keyDepth(evaluate(notes,10.99).right,65),0);
  for(const n of notes.filter(n=>n.time<12)) {
    assert.equal(keyDepth(evaluate(notes,n.time)[n.hand],n.midiNote),0);
    assert.equal(keyDepth(evaluate(notes,n.time+n.duration)[n.hand],n.midiNote),1);
  }
});

test('保持区間と基本動作・音階の接続は連続し、比較設定と逆シークでも再現する',()=>{
  const notes=validate(heldLegato),plans=heldPlansFor(notes);
  const times=new Set<number>([0,12.9,13.1,13.38,13.5,15.5,17]);
  for(const hand of ['left','right'] as const)for(const p of plans[hand])for(const e of p.events)
    for(const t of [e.note.time-e.approach,e.note.time,e.note.time+0.06,e.note.time+e.note.duration,e.note.time+e.note.duration+e.release])times.add(t);
  for(const style of ['linear','smooth','scale'] as const)for(const t of times) {
    const a=evaluate(notes,t-1e-7,style),b=evaluate(notes,t+1e-7,style),expected=evaluate(notes,t,style);
    evaluate(notes,20,style);evaluate(notes,0,style);assert.deepEqual(evaluate(notes,t,style),expected);
    for(const hand of ['left','right'] as const) {
      a[hand].position.forEach((v,i)=>assert.ok(Math.abs(v-b[hand].position[i])<1e-5));
      for(const f of fingers)for(const field of ['spread','proximal','distal'] as const)
        assert.ok(Math.abs(a[hand].joints[f][field]-b[hand].joints[f][field])<1e-4,`${style} ${hand} ${t} 指${f} ${field}`);
    }
  }
  for(const t of [1.83,4.65,8.23,11.1])for(const style of ['linear','smooth','scale'] as const)
    for(const idle of ['connected','reset'] as const)for(const strike of ['smooth','legacy'] as const)for(const wrist of [true,false])
      assert.deepEqual(evaluate(notes,t,style,idle,strike,wrist),evaluate(notes,t));
});

test('保持区間の左右鏡映・移調・入力順によらない幾何と短音の部分押下を再現する',()=>{
  const base=heldLegato.filter(n=>n.hand==='right'&&n.time<12);
  const right=validate(base);
  for(const shift of [-24,24]) {
    const moved=validate(base.map(n=>({...n,midiNote:n.midiNote+shift})));
    for(const t of [1.83,4.65,8.23,11.1]) {
      const a=evaluate(right,t).right,b=evaluate(moved,t).right;
      assert.deepEqual(a.depths,b.depths);assert.ok(Math.abs(b.position[0]-a.position[0]-shift/12*7*0.0235)<1e-10);
      for(const f of fingers)for(const field of ['spread','proximal','distal'] as const)assert.ok(Math.abs(a.joints[f][field]-b.joints[f][field])<1e-8);
    }
  }
  const shuffled=validate([...base].reverse());
  for(const t of [1.83,4.65,8.23,11.1])assert.deepEqual(evaluate(right,t).right,evaluate(shuffled,t).right);
  const n={time:1,duration:0.8,midiNote:60,hand:'right',finger:1};
  const short=validate([n,{...n,time:1.2,duration:0.03,midiNote:64,finger:3}]);
  assert.ok(Math.abs(keyDepth(evaluate(short,1.23).right,64)-0.5)<1e-9);
  // D is a symmetry axis of both the white and black key layout.
  const reflected=validate(base.map(n=>({...n,hand:'left',midiNote:124-n.midiNote})));
  const center=keys.find(k=>k.midiNote===62)!.target[0];
  for(const t of [1.83,4.65]) {
    const a=evaluate(right,t).right,b=evaluate(reflected,t).left;
    assert.ok(Math.abs(a.position[0]+b.position[0]-2*center)<1e-9);
    for(const f of fingers)for(const field of ['spread','proximal','distal'] as const)assert.ok(Math.abs(a.joints[f][field]-b.joints[f][field])<1e-8);
  }
});

test('保持区間の重複指・同一鍵・指替えを拒否し、離鍵後の別鍵移動を扱う',()=>{
  const n={time:1,duration:1,midiNote:60,hand:'right',finger:1};
  assert.throws(()=>validate([n,{...n,time:1.2,midiNote:64}]),/重複/);
  assert.throws(()=>validate([n,{...n,time:1.2,finger:3}]),/重複/);
  assert.throws(()=>validate([n,{...n,time:2,midiNote:62}]),/音間不足/);
  assert.ok(heldPlansFor(validate([n,{...n,time:1.2,duration:0.2,midiNote:64,finger:3},{...n,time:1.7,duration:0.2,midiNote:65,finger:3}])).right[0].path);
  assert.throws(()=>validate([n,{...n,time:1.2,duration:0.2,midiNote:64,finger:3},{...n,time:1.3,duration:0.2,midiNote:64,finger:4}]),/重複/);
  assert.throws(()=>validate([n,{...n,time:1.2,midiNote:108,finger:5}]),/届きません/);
  assert.throws(()=>validate([n,{...n,time:1.2,midiNote:55,finger:5}]),/交差/);
});

test('保持区間の左右同一鍵への接触は各指の接近・離鍵を含めて検出する',()=>{
  const n={time:1,duration:1,midiNote:60,hand:'right',finger:1};
  const melody={...n,time:1.2,duration:0.2,midiNote:64,finger:3};
  assert.throws(()=>validate([n,melody,{...melody,time:1.45,hand:'left'}]),/左右の手/);
  const notes=validate([n,melody,{...melody,time:1.9,hand:'left'}]);
  assert.equal(evaluate(notes,2).left.depth,1);
});

test('白鍵・黒鍵で指定指先が沈んだ接触点に一致する', () => {
  for (const input of [basic,black,fullRange,both]) {
    const notes=validate(input);
    for(const note of notes) {
      const frame=evaluate(notes,note.time+0.1)[note.hand];
      const target=keys.find(k=>k.midiNote===note.midiNote)!.target;
      const tip=fingerPoints(note.hand,note.finger,frame.curl)[2];
      target.forEach((v,i)=> assert.ok(Math.abs(frame.position[i]+tip[i]-(v-(i===1?TRAVEL:0)))<1e-9));
      assert.equal(frame.depth,1);
    }
  }
});
test('2音の指先が共通の掌から鍵盤へ一致し、保持・離鍵とシークを再現する',()=>{
  const notes=validate(dyads);
  for(const hand of ['left','right'] as const) {
    const starts=[...new Set(notes.filter(n=>n.hand===hand).map(n=>n.time))];
    for(const start of starts) {
      const base=evaluate(notes,start-0.12)[hand];
      for(const offset of [-0.12,-0.06,0,0.03,0.1,0.5,0.8,0.83,0.86,0.89]) {
        const pose=evaluate(notes,start+offset)[hand];
        assert.deepEqual(pose.position,base.position,'和音中は掌を固定する');
        assert.equal(pose.activeNotes.length,2);
        for(const [index,note] of pose.activeNotes.entries()) {
          const tip=pointsForPose(hand,note.finger,pose.joints[note.finger])[2];
          const target=pose.targets[index];
          const key=keys.find(k=>k.midiNote===note.midiNote)!;
          assert.equal(target[0],key.target[0]);assert.equal(target[1],key.target[1]);
          assert.ok(target[2]>=0.008&&target[2]<=0.05);
          const lift=offset<0 ? -offset/0.12*0.018 : offset>0.86 ? (offset-0.86)/0.06*0.018 : -pose.depth*TRAVEL;
          target.forEach((v,i)=>assert.ok(Math.abs(pose.position[i]+tip[i]-v-(i===1?lift:0))<1e-8));
        }
      }
      const a=evaluate(notes,start+0.2); evaluate(notes,0); evaluate(notes,20);
      assert.deepEqual(evaluate(notes,start+0.2),a);
    }
  }
});
test('和音の切替で手と全指の姿勢が連続し、単音との混在でも接触する',()=>{
  const notes=validate([...dyads,{time:7.4,duration:0.5,midiNote:72,hand:'right',finger:3}]);
  for(const boundary of [0.88,1,1.06,1.8,1.86,1.92,2.22,2.48,3.52,3.82,4.08,5.12,5.42,5.68,5.8,6.6,6.72,7.02,7.28,7.4,8.02]) {
    const a=evaluate(notes,boundary-1e-7),b=evaluate(notes,boundary+1e-7);
    for(const hand of ['left','right'] as const) {
      a[hand].position.forEach((v,i)=>assert.ok(Math.abs(v-b[hand].position[i])<1e-5));
      for(const f of fingers)for(const field of ['spread','proximal','distal'] as const)assert.ok(Math.abs(a[hand].joints[f][field]-b[hand].joints[f][field])<1e-4);
    }
  }
});
test('和音の重複指・交差・範囲外を拒否し、離鍵差を扱う',()=>{
  const note={time:1,duration:0.8,midiNote:60,hand:'right',finger:2};
  assert.throws(()=>validate([note,{...note,midiNote:64}]),/同じ指/);
  assert.throws(()=>validate([note,{...note,finger:4}]),/同じ鍵盤/);
  assert.equal(heldPlansFor(validate([note,{...note,midiNote:64,finger:4,duration:1}])).right.length,1);
  assert.throws(()=>validate([note,{...note,midiNote:55,finger:4}]),/交差/);
  assert.throws(()=>validate([{...note,midiNote:21,finger:1},{...note,midiNote:108,finger:5}]),/届きません/);
});
test('手動の開き角が左右反転し、節長を保ちながら指先位置を変える',()=>{
  for(const f of fingers) {
    const before=pointsForPose('right',f,restPose(f));
    const right=pointsForPose('right',f,restPose(f,0.3));
    const left=pointsForPose('left',f,restPose(f,0.3));
    assert.ok(Math.abs(before[2][0]-right[2][0])>0.001);
    right.forEach((point,i)=>{assert.equal(point[0],-left[i][0]);assert.equal(point[1],left[i][1]);assert.equal(point[2],left[i][2]);});
    for(let i=0;i<2;i++) {
      const distance=(p:number[][])=>Math.hypot(...p[i+1].map((v,j)=>v-p[i][j]));
      assert.ok(Math.abs(distance(before)-distance(right))<1e-12);
    }
  }
});
test('シーク順序によらず同じ姿勢、保持終了後は離鍵する',()=>{
  const notes=validate(basic);
  const expected=evaluate(notes,1.2);
  evaluate(notes,4); evaluate(notes,0);
  assert.deepEqual(evaluate(notes,1.2),expected);
  assert.equal(evaluate(notes,1.63).right.depth,0);
  assert.equal(evaluate(notes,1).right.depth,0);
});
test('BPM120の16分音階JSONは125ms間隔で右手・両手とも再生できる',()=>{
  for(const input of [scaleRight,scaleBoth]) {
    const notes=validate(input);
    assert.equal(notes.length,input===scaleRight?15:30);
    for(const hand of ['left','right'] as const) {
      const part=notes.filter(n=>n.hand===hand);
      part.forEach((note,i)=>{
        assert.equal(note.time,1+i*0.125);assert.equal(note.duration,0.075);
        for(const style of ['linear','smooth'] as const) {
          const pose=evaluate(notes,note.time+0.065,style)[hand];
          assert.equal(pose.active,note);assert.equal(pose.depth,1);
          const tip=pointsForPose(hand,note.finger,pose.joints[note.finger])[2];
          const target=keys.find(k=>k.midiNote===note.midiNote)!.target;
          handPointWorld(pose.position,pose.rotation,tip).forEach((v,j)=>assert.ok(Math.abs(v-target[j]+(j===1?TRAVEL:0))<1e-9));
        }
      });
      if(part.length) {
        assert.equal(part[0].midiNote,part.at(-1)!.midiNote);
        assert.equal(part[7].midiNote,part[0].midiNote+12);
      }
    }
    const sample=evaluate(notes,1.112,'smooth');evaluate(notes,3,'smooth');
    assert.deepEqual(evaluate(notes,1.112,'smooth'),sample);
    assert.ok(sample.right.lift<0.005);
    assert.equal(evaluate(notes,lengthOf(notes),'smooth').right.activeNotes.length,0);
  }
});
test('短い音間の離鍵・移動・接近を通して姿勢が連続する',()=>{
  const notes=validate(scaleBoth);
  for(const style of ['linear','smooth'] as const)for(let t=0.9;t<3;t+=0.0009) {
    const a=evaluate(notes,t-1e-7,style),b=evaluate(notes,t+1e-7,style);
    for(const hand of ['left','right'] as const) {
      for(const value of [...a[hand].position,...a[hand].rotation,a[hand].depth])assert.ok(Number.isFinite(value));
      a[hand].position.forEach((v,i)=>assert.ok(Math.abs(v-b[hand].position[i])<0.0001));
      a[hand].rotation.forEach((v,i)=>assert.ok(Math.abs(v-b[hand].rotation[i])<0.0001));
      for(const f of fingers)for(const field of ['spread','proximal','distal'] as const)assert.ok(Math.abs(a[hand].joints[f][field]-b[hand].joints[f][field])<0.001);
    }
  }
});

test('音階方式は短い往復・1オクターブの全接触区間で押鍵時刻と接触を保つ',()=>{
  for(const input of [scaleCrossing,scaleRight,scaleBoth]) {
    const notes=validate(input);
    for(let t=0.85;t<lengthOf(notes);t+=0.0007) {
      const pose=evaluate(notes,t,'scale','connected','legacy').right,old=evaluate(notes,t,'smooth').right;
      assert.equal(pose.active,old.active);assert.equal(pose.depth,old.depth);
      if(!pose.active)continue;
      assert.ok(pose.technique,'対応する音階で従来方式へ戻らない');
      const tip=pointsForPose('right',pose.active.finger,pose.joints[pose.active.finger])[2];
      const world=handPointWorld(pose.position,pose.rotation,tip),target=pose.targets[0];
      assert.equal(target[0],keys.find(k=>k.midiNote===pose.active!.midiNote)!.target[0]);
      assert.ok(target[2]>=0.008-1e-12&&target[2]<=0.05);
      world.forEach((v,i)=>{
        if(i!==1)assert.ok(Math.abs(v-target[i])<1e-9);
      });
      if(pose.phase==='press'||pose.phase==='release'&&pose.depth>0)
        assert.ok(Math.abs(world[1]-target[1]+pose.depth*TRAVEL)<1e-9);
      else assert.ok(world[1]>=target[1]-1e-9,'空中で鍵盤を貫通しない');
    }
  }
});

test('音階の掌は上行・下行で逆行せず、従来の手全体の往復を減らす',()=>{
  const notes=validate(scaleRight);
  let previous=evaluate(notes,1,'scale').right.position[0],distance=0,oldDistance=0;
  let oldPrevious=evaluate(notes,1,'smooth').right.position[0];
  for(let t=1.0005;t<2.75;t+=0.0005) {
    const x=evaluate(notes,t,'scale').right.position[0],oldX=evaluate(notes,t,'smooth').right.position[0];
    assert.ok(t<=1.875?x>=previous-1e-12:x<=previous+1e-12);
    distance+=Math.abs(x-previous);oldDistance+=Math.abs(oldX-oldPrevious);
    previous=x;oldPrevious=oldX;
  }
  assert.ok(distance<oldDistance*0.8,`移動距離 ${distance} / 従来 ${oldDistance}`);
  const held=evaluate(notes,1.28,'scale').right;
  assert.equal(held.phase,'press');
  assert.notEqual(held.position[0],evaluate(notes,1.30,'scale').right.position[0]);
});

test('押鍵前から親指と中指を準備し、親指の付け根も内側へ運ぶ',()=>{
  const notes=validate(scaleRight);
  const early=evaluate(notes,1.1,'scale').right,ready=evaluate(notes,1.36,'scale').right;
  assert.equal(ready.technique,'thumb-under');
  assert.ok(ready.joints[1].spread<early.joints[1].spread-0.5);
  const thumb=pointsForPose('right',1,ready.joints[1]);
  assert.ok(thumb[2][0]>thumb[0][0],'親指先を小指側へ寄せる');
  const over=evaluate(notes,2.47,'scale').right;
  assert.equal(over.technique,'finger-over');
  assert.ok((over.joints[1].opposition??0)>0);
  assert.ok(Math.abs(over.joints[3].proximal-restPose(3).proximal)>0.1);
  const middle=handPointWorld(over.position,over.rotation,pointsForPose('right',3,over.joints[3])[2]);
  assert.ok(middle[1]>0.005,'次の中指は鍵盤より上で準備する');
});

test('音階の準備・接触・回復・折返しは連続し、逆方向シークでも同じ姿勢になる',()=>{
  for(const input of [scaleCrossing,scaleRight]) {
    const notes=validate(input);
    const boundaries=[0.58,0.88,1.875,lengthOf(notes)-0.5,lengthOf(notes)-0.2];
    for(const n of notes)boundaries.push(n.time,n.time+0.06,n.time+n.duration);
    for(let t=0.001;t<lengthOf(notes);t+=0.0009)boundaries.push(t);
    for(const t of boundaries) {
      const a=evaluate(notes,t-1e-7,'scale').right,b=evaluate(notes,t+1e-7,'scale').right;
      a.position.forEach((v,i)=>assert.ok(Number.isFinite(v)&&Math.abs(v-b.position[i])<0.00001));
      for(const f of fingers)for(const field of ['spread','proximal','distal','opposition'] as const)
        assert.ok(Math.abs((a.joints[f][field]??0)-(b.joints[f][field]??0))<0.0001,`${t}: 指${f} ${field}`);
    }
    const saved=evaluate(notes,1.32,'scale');evaluate(notes,4,'scale');evaluate(notes,0,'scale');
    assert.deepEqual(evaluate(notes,1.32,'scale'),saved);
  }
});

test('音階方式は左右独立に計画し、音階のない入力は従来方式を維持する',()=>{
  const notes=validate(scaleBoth);
  for(const hand of ['left','right'] as const) {
    const alone=validate(notes.filter(n=>n.hand===hand));
    for(let t=0;t<lengthOf(notes);t+=0.007)assert.deepEqual(evaluate(notes,t,'scale')[hand],evaluate(alone,t,'scale')[hand]);
  }
  for(const input of [basic,black,dyads,movement,fullRange]) {
    const other=validate(input);
    for(let t=0;t<lengthOf(other);t+=0.031)assert.deepEqual(evaluate(other,t,'scale'),evaluate(other,t,'smooth'));
  }
});

test('非演奏指の接続切替は両手の押鍵・接触・掌軌道を変えない',()=>{
  for(const input of [scaleCrossing,scaleRight,scaleBoth]) {
    const notes=validate(input);
    for(let t=0;t<lengthOf(notes);t+=0.0013) {
      const connected=evaluate(notes,t,'scale','connected'),reset=evaluate(notes,t,'scale','reset');
      for(const hand of ['left','right'] as const) {
        const a=connected[hand],b=reset[hand];
        assert.deepEqual({...a,joints:undefined},{...b,joints:undefined});
        if(a.active)assert.deepEqual(a.joints[a.active.finger],b.joints[a.active.finger]);
      }
    }
  }
  for(const input of [basic,black,dyads,movement]) {
    const notes=validate(input);
    for(const style of ['linear','smooth','scale'] as const)
      assert.deepEqual(evaluate(notes,1.3,style,'connected'),evaluate(notes,1.3,style,'reset'));
  }
});

test('すぐ再使用する指は次の準備へ直接つながり、基本姿勢への余分な往復を減らす',()=>{
  const notes=validate(scaleRight);
  // C's thumb has fully released; F's thumb has not started approaching yet.
  const start=1.1,end=1.35;
  const a=evaluate(notes,start,'scale').right.joints[1],b=evaluate(notes,end,'scale').right.joints[1];
  let previous=a;
  for(let t=start;t<end;t+=0.0005) {
    const pose=evaluate(notes,t,'scale').right.joints[1];
    for(const field of ['spread','proximal','distal','opposition'] as const) {
      const value=pose[field]??0,from=a[field]??0,to=b[field]??0;
      assert.ok(value>=Math.min(from,to)-1e-9&&value<=Math.max(from,to)+1e-9);
      assert.ok((value-(previous[field]??0))*(to-from)>=-1e-12,'次の準備へ逆戻りせず進む');
    }
    previous=pose;
  }
  const variations={connected:0,reset:0};
  for(const mode of ['connected','reset'] as const) {
    let before=evaluate(notes,1,'scale',mode).right;
    for(let t=1.001;t<=2.825;t+=0.001) {
      const pose=evaluate(notes,t,'scale',mode).right;
      for(const f of fingers)for(const field of ['spread','proximal','distal','opposition'] as const)
        variations[mode]+=Math.abs((pose.joints[f][field]??0)-(before.joints[f][field]??0));
      before=pose;
    }
  }
  assert.ok(variations.connected<variations.reset*0.85,JSON.stringify(variations));
});

test('使わない指は曲げて待機し、接続・回復・待機の境界でも連続して鍵盤上へ保つ',()=>{
  for(const input of [scaleCrossing,scaleRight]) {
    const notes=validate(input);
    for(let t=0.88;t<lengthOf(notes);t+=0.0009) {
      const frame=evaluate(notes,t,'scale').right;
      const before=evaluate(notes,t-1e-7,'scale').right,after=evaluate(notes,t+1e-7,'scale').right;
      for(const f of fingers) {
        for(const field of ['spread','proximal','distal','opposition'] as const)
          assert.ok(Math.abs((before.joints[f][field]??0)-(after.joints[f][field]??0))<0.0001,`${t}: 指${f} ${field}`);
        if(frame.active?.finger===f)continue;
        const tip=handPointWorld(frame.position,frame.rotation,pointsForPose('right',f,frame.joints[f])[2]);
        assert.ok(tip[1]>0.003,`${t}: 非演奏指${f}の高さ ${tip[1]}`);
      }
    }
  }
  // Ring and little finger are unused throughout the short crossing phrase.
  const idle=evaluate(validate(scaleCrossing),1.3,'scale').right;
  for(const f of [4,5] as const) {
    assert.ok(idle.joints[f].proximal< -0.3);
    assert.ok(idle.joints[f].distal>0.2);
  }
});

test('加減速打鍵は音符時刻と共通の掌・接触点を保ち、指先と鍵盤を同期する',()=>{
  for(const input of [scaleCrossing,scaleRight,scaleBoth]) {
    const notes=validate(input),part=notes.filter(n=>n.hand==='right');
    for(const note of part) {
      const before=evaluate(notes,note.time-1e-6,'scale').right,press=evaluate(notes,note.time,'scale').right;
      const held=evaluate(notes,note.time+note.duration-1e-6,'scale').right,released=evaluate(notes,note.time+note.duration,'scale').right;
      assert.equal(before.phase,'approach');assert.equal(press.phase,'press');
      assert.equal(held.phase,'press');assert.equal(released.phase,'release');
      assert.equal(press.active,note);assert.equal(released.active,note);
      assert.equal(press.depth,0);assert.equal(released.depth,1);
    }
    for(let t=0.85;t<lengthOf(notes);t+=0.0007) {
      const pose=evaluate(notes,t,'scale').right,legacy=evaluate(notes,t,'scale','connected','legacy').right;
      assert.deepEqual(pose.position,legacy.position);
      assert.deepEqual(pose.rotation,legacy.rotation);
      assert.deepEqual(evaluate(notes,t,'scale').left.position,evaluate(notes,t,'scale','connected','legacy').left.position);
      if(!pose.active)continue;
      assert.equal(pose.strikeStyle,'smooth');
      assert.ok(pose.depth>=0&&pose.depth<=1);
      const tip=handPointWorld(pose.position,pose.rotation,pointsForPose('right',pose.active.finger,pose.joints[pose.active.finger])[2]);
      const target=pose.targets[0];
      const common=evaluate(notes,pose.active.time+0.03,'scale','connected','legacy').right.targets[0];
      assert.deepEqual(target,common);
      assert.ok(Math.abs(tip[0]-target[0])<1e-9&&Math.abs(tip[2]-target[2])<1e-9);
      if(pose.depth>0||pose.phase==='press')assert.ok(Math.abs(tip[1]-target[1]+pose.depth*TRAVEL)<1e-9);
      else assert.ok(tip[1]>=target[1]-1e-9);
    }
  }
});

test('接近・押鍵底・離鍵開始・鍵盤復帰・指上げの上下速度が端点でゼロにつながる',()=>{
  for(const input of [scaleCrossing,scaleRight]) {
    const notes=validate(input),part=notes.filter(n=>n.hand==='right');
    for(const [i,note] of part.entries()) {
      const approach=i===0?0.12:input===scaleCrossing?0.03:0.025;
      const release=i===part.length-1?0.12:input===scaleCrossing?0.02:0.025;
      const end=note.time+note.duration;
      const y=(t:number)=>{
        const pose=evaluate(notes,t,'scale').right;
        return handPointWorld(pose.position,pose.rotation,pointsForPose('right',note.finger,pose.joints[note.finger])[2])[1];
      };
      for(const t of [note.time-approach,note.time,note.time+0.06,end,end+release*0.65,end+release]) {
        const h=1e-6,left=(y(t)-y(t-h))/h,right=(y(t+h)-y(t))/h;
        assert.ok(Math.abs(left)<0.002&&Math.abs(right)<0.002,`${t}: 上下速度 ${left}, ${right}`);
      }
    }
  }
});

test('短い音間は離鍵と接近へ配分し、指上げを抑えて鍵盤復帰の最大速度を下げる',()=>{
  for(const input of [scaleCrossing,scaleRight]) {
    const notes=validate(input),release=input===scaleCrossing?0.02:0.025;
    const boundary=1.075+release,h=1e-6;
    assert.equal(evaluate(notes,boundary-h,'scale').right.active?.midiNote,60);
    assert.equal(evaluate(notes,boundary+h,'scale').right.active?.midiNote,62);
    const pose=evaluate(notes,boundary,'scale').right;
    const tip=handPointWorld(pose.position,pose.rotation,pointsForPose('right',2,pose.joints[2])[2]);
    assert.ok(Math.abs(tip[1]-0.006)<1e-8);
    const speeds={smooth:0,legacy:0};
    for(const mode of ['smooth','legacy'] as const) {
      for(let t=1.075;t<1.105;t+=0.0001) {
        const a=evaluate(notes,t,'scale','connected',mode).right,b=evaluate(notes,t+0.0001,'scale','connected',mode).right;
        const depthA=a.active?.midiNote===60?a.depth:0,depthB=b.active?.midiNote===60?b.depth:0;
        speeds[mode]=Math.max(speeds[mode],Math.abs(depthB-depthA)*TRAVEL/0.0001);
      }
    }
    assert.ok(speeds.smooth<speeds.legacy*0.85,JSON.stringify(speeds));
  }
});

test('60ms未満の音は部分押下で滑らかに折り返し、シークと非演奏指の比較も再現する',()=>{
  for(const duration of [0.01,0.03,0.059]) {
    const notes=validate(scaleRight.map((n,i)=>i===0?{...n,duration}:n));
    const end=1+duration,pose=evaluate(notes,end,'scale').right;
    assert.equal(pose.strikeStyle,'smooth');assert.equal(pose.phase,'release');
    assert.ok(pose.depth>0&&pose.depth<1);
    const keyDepth=(t:number)=>evaluate(notes,t,'scale').right.depth;
    assert.ok(Math.abs((keyDepth(end)-keyDepth(end-1e-6))/1e-6)<0.01);
    assert.ok(Math.abs((keyDepth(end+1e-6)-keyDepth(end))/1e-6)<0.01);
    const saved=evaluate(notes,1.045,'scale');evaluate(notes,4,'scale');evaluate(notes,0,'scale');
    assert.deepEqual(evaluate(notes,1.045,'scale'),saved);
  }
});

test('時間拡張で左手との同一鍵接触が生じる入力は従来の打鍵に戻す',()=>{
  const notes=validate([...scaleRight,{time:1.21,duration:0.02,midiNote:60,hand:'left',finger:2}]);
  assert.equal(evaluate(notes,1.03,'scale').right.strikeStyle,'legacy');
  for(let t=0.85;t<1.5;t+=0.0007) {
    const frame=evaluate(notes,t,'scale');
    assert.deepEqual(frame,evaluate(notes,t,'scale','connected','legacy'));
    assert.ok(!frame.left.activeNotes.some(a=>frame.right.activeNotes.some(b=>a.midiNote===b.midiNote)));
  }
  for(const input of [basic,black,dyads,movement]) {
    const other=validate(input);
    for(const style of ['linear','smooth','scale'] as const)
      assert.deepEqual(evaluate(other,1.3,style,'connected','smooth'),evaluate(other,1.3,style,'connected','legacy'));
  }
});

test('手首回転の逆変換は描画と一致し、手首軸と指の節長を保つ',()=>{
  const position:[number,number,number]=[0.12,-0.027,0.03];
  for(const rotation of [[0,0,0],[0.15,0,-0.2],[-0.12,0,0.3]] as [number,number,number][]) {
    for(const f of fingers)for(const point of pointsForPose('right',f,{...restPose(f),opposition:f===1?0.4:0})) {
      const world=handPointWorld(position,rotation,point),local=handPointLocal(position,rotation,world);
      local.forEach((v,i)=>assert.ok(Math.abs(v-point[i])<1e-12));
      const expected=new Vector3(...point).sub(new Vector3(...WRIST)).applyQuaternion(new Quaternion().setFromEuler(new Euler(...rotation))).add(new Vector3(...WRIST)).add(new Vector3(...position));
      world.forEach((v,i)=>assert.ok(Math.abs(v-expected.getComponent(i))<1e-12));
    }
    assert.deepEqual(handPointWorld(position,rotation,WRIST),position.map((v,i)=>v+WRIST[i]));
  }
});

test('手首連動の全比較設定で両手の音符時刻・深さ・指先接触を保つ',()=>{
  for(const input of [scaleCrossing,scaleRight,scaleBoth]) {
    const notes=validate(input);
    for(const idle of ['connected','reset'] as const)for(const strike of ['smooth','legacy'] as const) {
      let moving=false;
      for(let t=0.88;t<lengthOf(notes);t+=0.0011) {
        const off=evaluate(notes,t,'scale',idle,strike,false),on=evaluate(notes,t,'scale',idle,strike,true);
        for(const hand of ['left','right'] as const) {
          const a=on[hand],b=off[hand];
          assert.equal(a.active,b.active);assert.equal(a.depth,b.depth);assert.equal(a.phase,b.phase);
          assert.deepEqual(a.targets,b.targets);assert.equal(a.strikeStyle,b.strikeStyle);
          assert.equal(a.position[0],b.position[0]);
          assert.ok(Math.abs(a.position[1]-b.position[1])<=0.0015+1e-12);
          assert.ok(Math.abs(a.position[2]-b.position[2])<=0.001+1e-12);
          if(a.rotation.some(v=>Math.abs(v)>0.01))moving=true;
          if(!a.active)continue;
          const f=a.active.finger;
          const before=handPointWorld(b.position,b.rotation,pointsForPose(hand,f,b.joints[f])[2]);
          const after=handPointWorld(a.position,a.rotation,pointsForPose(hand,f,a.joints[f])[2]);
          after.forEach((v,i)=>assert.ok(Math.abs(v-before[i])<1e-9,`${t}: 指${f} ${i}`));
        }
      }
      assert.ok(moving,'対応する音階では連動が有効になる');
    }
  }
});

test('手首・指・前腕の持ち替えは連続し、接触の上下速度とシーク再現を保つ',()=>{
  for(const input of [scaleCrossing,scaleRight]) {
    const notes=validate(input),times=[1.21,1.335,1.39,1.515,1.525,1.65,2.335,2.515,2.65];
    for(const n of notes)times.push(n.time,n.time+0.06,n.time+n.duration);
    for(let t=0.88;t<lengthOf(notes);t+=0.0011)times.push(t);
    for(const idle of ['connected','reset'] as const)for(const strike of ['smooth','legacy'] as const) {
      for(const t of times) {
        const a=evaluate(notes,t-1e-7,'scale',idle,strike,true).right,b=evaluate(notes,t+1e-7,'scale',idle,strike,true).right;
        for(const field of ['position','rotation'] as const)
          a[field].forEach((v,i)=>assert.ok(Number.isFinite(v)&&Math.abs(v-b[field][i])<0.00001,`${t}: ${field}`));
        for(const f of fingers)for(const field of ['spread','proximal','distal','opposition'] as const)
          assert.ok(Math.abs((a.joints[f][field]??0)-(b.joints[f][field]??0))<0.0005,`${t}: 指${f} ${field}`);
        const armA=forearmEndpoints(a.position,'right',a.forearmGuide),armB=forearmEndpoints(b.position,'right',b.forearmGuide);
        armA.elbow.forEach((v,i)=>assert.ok(Math.abs(v-armB.elbow[i])<0.00001));
      }
    }
    for(const n of notes)for(const t of [n.time,n.time+0.06,n.time+n.duration]) {
      const y=(time:number)=>{
        const pose=evaluate(notes,time,'scale','connected','smooth',true).right;
        return handPointWorld(pose.position,pose.rotation,pointsForPose('right',n.finger,pose.joints[n.finger])[2])[1];
      };
      const h=1e-6;
      assert.ok(Math.abs((y(t)-y(t-h))/h)<0.002&&Math.abs((y(t+h)-y(t))/h)<0.002);
    }
    const saved=evaluate(notes,1.39,'scale','connected','smooth',true);
    evaluate(notes,4,'scale','reset','legacy',true);evaluate(notes,0,'scale','connected','smooth',true);
    assert.deepEqual(evaluate(notes,1.39,'scale','connected','smooth',true),saved);
  }
});

test('連動中の指の高さ・節長・前腕長と両端音域の全鍵表示範囲を保つ',()=>{
  const bounds=new Box3(new Vector3(...FULL_VIEW_MIN),new Vector3(...FULL_VIEW_MAX));
  for(const shift of [-36,0,36]) {
    const notes=validate(scaleRight.map(n=>({...n,midiNote:n.midiNote+shift})));
    for(let t=0.88;t<lengthOf(notes);t+=0.0031) {
      const pose=evaluate(notes,t,'scale','connected','smooth',true).right;
      const arm=forearmEndpoints(pose.position,'right',pose.forearmGuide);
      assert.ok(Math.abs(Math.hypot(...arm.wrist.map((v,i)=>v-arm.elbow[i]))-FOREARM_LENGTH)<1e-12);
      assert.deepEqual(arm.wrist,handPointWorld(pose.position,pose.rotation,WRIST));
      for(const point of [arm.wrist,arm.elbow])for(const axis of [0,1,2])
        assert.ok(point[axis]-0.026>=FULL_VIEW_MIN[axis]&&point[axis]+0.026<=FULL_VIEW_MAX[axis]);
      for(const f of fingers) {
        const points=pointsForPose('right',f,pose.joints[f]).map(p=>handPointWorld(pose.position,pose.rotation,p));
        for(const point of points)assert.ok(bounds.containsPoint(new Vector3(...point)));
        for(let i=0;i<2;i++)assert.ok(Math.abs(Math.hypot(...points[i].map((v,j)=>v-points[i+1][j]))-specs[f].lengths[i])<1e-12);
        if(pose.active?.finger!==f)assert.ok(points[2][1]>0.003);
      }
    }
  }
  const notes=validate(scaleRight),up=evaluate(notes,1.39,'scale','connected','smooth',true).right;
  const down=evaluate(notes,2.515,'scale','connected','smooth',true).right;
  assert.ok(up.rotation[2]< -Math.PI/180&&down.rotation[2]>Math.PI/180,'持ち替え方向に合わせて傾きを反転する');
  const off=evaluate(notes,1.39,'scale','connected','smooth',false).right;
  const a=forearmEndpoints(up.position,'right',up.forearmGuide),b=forearmEndpoints(off.position,'right');
  assert.ok(Math.hypot(...a.elbow.map((v,i)=>v-b.elbow[i]))>0.001,'前腕も連動する');
});

test('手首連動のオフと対応外入力は前回の姿勢を再現する',()=>{
  const notes=validate(scaleRight),before=evaluate(notes,1.39,'scale');
  evaluate(notes,1.39,'scale','connected','smooth',true);
  assert.deepEqual(evaluate(notes,1.39,'scale','connected','smooth',false),before);
  for(const t of [1.05,2.74]) {
    const on=evaluate(notes,t,'scale','connected','smooth',true).right,off=evaluate(notes,t,'scale').right;
    assert.deepEqual(on.position,off.position);assert.deepEqual(on.rotation,off.rotation);assert.deepEqual(on.joints,off.joints);
  }
  for(const input of [basic,black,fullRange,dyads,movement]) {
    const other=validate(input);
    for(const style of ['linear','smooth','scale'] as const)
      assert.deepEqual(evaluate(other,1.39,style,'connected','smooth',true),evaluate(other,1.39,style));
  }
});
test('混在した譜面から両手の音階区間を計画し、和音・黒鍵・跳躍が全体へ波及しない',()=>{
  const notes=validate(mixedPhrases),snapshot=structuredClone(notes),plan=performancePlanFor(notes);
  assert.equal(performancePlanFor(notes),plan,'音符配列ごとに計画を再利用する');
  for(const hand of ['left','right'] as const) {
    assert.equal(plan[hand].length,2);
    assert.deepEqual(plan[hand].map(r=>r.legacy.steps.length),[15,15]);
    assert.deepEqual(plan[hand].map(r=>r.legacy.steps[0].note.time),[1,5]);
    assert.ok(plan[hand].every(r=>r.smooth&&r.legacy.hand===hand));
    assert.ok(evaluate(notes,1.65,'scale')[hand].technique);
    assert.equal(evaluate(notes,3.25,'scale')[hand].technique,undefined);
    assert.equal(evaluate(notes,3.85,'scale')[hand].technique,undefined);
    assert.equal(evaluate(notes,4.30,'scale')[hand].technique,undefined);
    assert.ok(evaluate(notes,5.65,'scale')[hand].technique);
  }
  assert.deepEqual(notes,snapshot,'入力音符の時刻・運指を変更しない');
  // A single unsupported fingering no longer disables a later valid run.
  const changed=validate(scaleRight.map((n,i)=>({...n,finger:i===3?2:n.finger})));
  assert.equal(evaluate(changed,1.4,'scale').right.technique,undefined);
  assert.ok(evaluate(changed,2.52,'scale').right.technique);
});

test('混在譜面の全比較設定で両手の接触を保ち、基本動作の接触へ補間を混ぜない',()=>{
  const notes=validate(mixedPhrases),plan=performancePlanFor(notes);
  const planned=new Set([...plan.left,...plan.right].flatMap(r=>r.legacy.steps.map(s=>s.note)));
  for(const idle of ['connected','reset'] as const)for(const strike of ['smooth','legacy'] as const)for(const wrist of [false,true]) {
    let fallbackContacts=0,scaleContacts=0;
    for(let t=0.85;t<lengthOf(notes);t+=0.0031) {
      const result=evaluate(notes,t,'scale',idle,strike,wrist),base=evaluate(notes,t,'smooth');
      for(const hand of ['left','right'] as const) {
        const pose=result[hand];
        if(base[hand].active&&!planned.has(base[hand].active)) {
          assert.deepEqual(pose,base[hand]);fallbackContacts++;continue;
        }
        if(!pose.active)continue;
        assert.ok(pose.technique);scaleContacts++;
        const n=pose.active,target=pose.targets[0];
        const tip=handPointWorld(pose.position,pose.rotation,pointsForPose(hand,n.finger,pose.joints[n.finger])[2]);
        assert.ok(Math.abs(tip[0]-target[0])<1e-9&&Math.abs(tip[2]-target[2])<1e-9);
        assert.equal(target[0],keys.find(k=>k.midiNote===n.midiNote)!.target[0]);
        if(pose.phase==='press'||pose.depth>0)assert.ok(Math.abs(tip[1]-target[1]+pose.depth*TRAVEL)<1e-9);
        else assert.ok(tip[1]>=target[1]-1e-9);
      }
    }
    assert.ok(fallbackContacts>100&&scaleContacts>500);
    for(const n of notes) {
      const at=evaluate(notes,n.time,'scale',idle,strike,wrist)[n.hand];
      const release=evaluate(notes,n.time+n.duration,'scale',idle,strike,wrist)[n.hand];
      assert.ok(at.activeNotes.includes(n));assert.equal(at.phase,'press');assert.equal(at.depth,0);
      assert.ok(release.activeNotes.includes(n));assert.equal(release.phase,'release');
    }
  }
});

test('区間の出入り・隣接した音階・短い音間でも姿勢が連続し、逆シークで再現する',()=>{
  const close=[...scaleCrossing,...scaleCrossing.map(n=>({...n,time:n.time+0.835,midiNote:n.midiNote+12}))];
  for(const input of [mixedPhrases,close]) {
    const notes=validate(input),plan=performancePlanFor(notes);
    for(const hand of ['left','right'] as const)for(const run of plan[hand]) {
      const previous=plan[hand][plan[hand].indexOf(run)-1];
      if(previous)assert.ok(previous.legacy.blendEnd<=run.legacy.blendStart);
    }
    const times=[...Array.from({length:Math.ceil(lengthOf(notes)/0.003)},(_,i)=>i*0.003)];
    for(const hand of ['left','right'] as const)for(const r of plan[hand])for(const p of [r.legacy,r.smooth])if(p) {
      times.push(p.blendStart,p.blendEnd);
      for(const s of p.steps)times.push(s.note.time-s.approach,s.note.time,s.note.time+s.note.duration,s.note.time+s.note.duration+s.release);
    }
    for(const idle of ['connected','reset'] as const)for(const strike of ['smooth','legacy'] as const)for(const wrist of [false,true]) {
      for(const t of times) {
        const a=evaluate(notes,t-1e-8,'scale',idle,strike,wrist),b=evaluate(notes,t+1e-8,'scale',idle,strike,wrist);
        for(const hand of ['left','right'] as const) {
          for(const field of ['position','rotation'] as const)a[hand][field].forEach((v,i)=>assert.ok(Number.isFinite(v)&&Math.abs(v-b[hand][field][i])<1e-5,`${t}: ${hand} ${field}`));
          for(const f of fingers)for(const field of ['spread','proximal','distal','opposition'] as const)
            assert.ok(Math.abs((a[hand].joints[f][field]??0)-(b[hand].joints[f][field]??0))<1e-4,`${t}: ${hand} 指${f} ${field}`);
          const armA=forearmEndpoints(a[hand].position,hand,a[hand].forearmGuide),armB=forearmEndpoints(b[hand].position,hand,b[hand].forearmGuide);
          armA.elbow.forEach((v,i)=>assert.ok(Math.abs(v-armB.elbow[i])<1e-5));
        }
      }
      const saved=evaluate(notes,1.39,'scale',idle,strike,wrist);
      evaluate(notes,7,'scale',idle,strike,wrist);evaluate(notes,0,'scale',idle,strike,wrist);
      assert.deepEqual(evaluate(notes,1.39,'scale',idle,strike,wrist),saved);
    }
  }
});

test('左手音階は右手を鏡映した幾何計算で指くぐり・手首・前腕を再現する',()=>{
  const right=validate(scaleRight),left=validate(scaleRight.map(n=>({...n,hand:'left',midiNote:124-n.midiNote})));
  const axisSum=2*keys.find(k=>k.midiNote===62)!.target[0];
  for(const idle of ['connected','reset'] as const)for(const strike of ['smooth','legacy'] as const) {
    let thumb=false,over=false,moving=false;
    for(let t=0.88;t<2.945;t+=0.0031) {
      const a=evaluate(right,t,'scale',idle,strike,true).right,b=evaluate(left,t,'scale',idle,strike,true).left;
      assert.equal(a.technique,b.technique);assert.equal(a.phase,b.phase);assert.equal(a.depth,b.depth);
      if(b.technique==='thumb-under')thumb=true;if(b.technique==='finger-over')over=true;
      if(Math.abs(b.rotation[2])>0.01)moving=true;
      for(const field of ['position','rotation'] as const)a[field].forEach((v,i)=>{
        const expected=field==='position'&&i===0?axisSum-v:field==='rotation'&&i===2?-v:v;
        assert.ok(Math.abs(expected-b[field][i])<1e-9);
      });
      for(const f of fingers)for(const field of ['spread','proximal','distal','opposition'] as const)
        assert.ok(Math.abs((a.joints[f][field]??0)-(b.joints[f][field]??0))<1e-9);
      const arm=forearmEndpoints(b.position,'left',b.forearmGuide);
      assert.ok(Math.abs(Math.hypot(...arm.wrist.map((v,i)=>v-arm.elbow[i]))-FOREARM_LENGTH)<1e-12);
      for(const f of fingers)if(b.active?.finger!==f)
        assert.ok(handPointWorld(b.position,b.rotation,pointsForPose('left',f,b.joints[f])[2])[1]>0.003);
    }
    assert.ok(thumb&&over&&moving);
  }
});

test('同一鍵への接触拡張が競合した区間だけ打鍵を戻し、左右対称に判定する',()=>{
  const input=[...scaleRight,...scaleRight.map(n=>({...n,time:n.time+4})),{time:1.21,duration:0.02,midiNote:60,hand:'left',finger:2}];
  for(const mirrored of [false,true]) {
    const notes=validate(mirrored?input.map(n=>({...n,hand:n.hand==='right'?'left':'right',midiNote:124-n.midiNote})):input);
    const hand=mirrored?'left':'right',plan=performancePlanFor(notes)[hand];
    assert.equal(plan.length,2);assert.equal(plan[0].smooth,undefined);assert.ok(plan[1].smooth);
    assert.equal(evaluate(notes,1.03,'scale')[hand].strikeStyle,'legacy');
    assert.equal(evaluate(notes,5.03,'scale')[hand].strikeStyle,'smooth');
    for(let t=0.85;t<lengthOf(notes);t+=0.0023) {
      const frame=evaluate(notes,t,'scale','connected','smooth',true);
      assert.ok(!frame.left.activeNotes.some(a=>frame.right.activeNotes.some(b=>a.midiNote===b.midiNote)));
    }
  }
});

test('3〜5音の白鍵和音は全指が接近・保持・離鍵を通して固定接触点へ一致する',()=>{
  const shapes=[[[60,1],[64,3],[67,5]],[[64,1],[67,2],[72,5]],[[67,1],[72,3],[76,5]],
    [[60,1],[64,2],[67,4],[69,5]],[[60,1],[62,2],[64,3],[65,4],[67,5]]];
  for(const hand of ['left','right'] as const)for(const shift of [-24,0,24])for(const shape of shapes) {
    const notes=validate(shape.map(([midiNote,finger])=>({time:1,duration:0.3,midiNote:midiNote+shift,hand,finger:hand==='right'?finger:6-finger})));
    const anchor=evaluate(notes,1)[hand].position;
    let lastContact:typeof notes[number][]=[];
    for(let t=0.88;t<1.42-1e-9;t+=0.0009) {
      const pose=evaluate(notes,t,'scale')[hand];
      assert.deepEqual(pose.position,anchor);assert.equal(pose.activeNotes.length,shape.length);
      assert.deepEqual(pose.activeNotes,notes);lastContact=pose.activeNotes;
      const height=t<1?(1-t)/0.12*0.018:t<1.3?-pose.depth*TRAVEL:t<1.36?-pose.depth*TRAVEL:(t-1.36)/0.06*0.018;
      for(const [i,n] of pose.activeNotes.entries()) {
        const target=pose.targets[i],joint=pose.joints[n.finger],local=pointsForPose(hand,n.finger,joint);
        const tip=handPointWorld(pose.position,pose.rotation,local[2]);
        assert.equal(target[0],keys.find(k=>k.midiNote===n.midiNote)!.target[0]);
        assert.equal(target[1],0);assert.ok(target[2]>=0.008-1e-12&&target[2]<=0.05+1e-12);
        target.forEach((v,j)=>assert.ok(Math.abs(tip[j]-v-(j===1?height:0))<1e-9));
        assert.ok(joint.proximal>=-0.7&&joint.proximal<=1.1);
        assert.ok(joint.distal<=1.8&&joint.distal-joint.proximal<=1.7);
        const offset=joint.spread-restPose(n.finger).spread,limit=n.finger===1?0.4:0.55;
        assert.ok(Math.abs(offset)<=limit+1e-12);
        for(let segment=0;segment<2;segment++)assert.ok(Math.abs(Math.hypot(...local[segment].map((v,j)=>v-local[segment+1][j]))-specs[n.finger].lengths[segment])<1e-12);
      }
      assert.deepEqual(pose,evaluate(notes,t,'smooth')[hand]);
      assert.deepEqual(pose,evaluate(notes,t,'linear')[hand]);
    }
    assert.equal(lastContact.length,shape.length);
    assert.equal(evaluate(notes,1.421)[hand].activeNotes.length,0);
  }
});

test('和音の入力順によらず同じ計画となり、左右の鏡映と指・接触点の対応を保つ',()=>{
  const input=whiteChords.filter(n=>n.hand==='right'&&n.time>=3&&n.time<8);
  const original=validate(input),reversed=validate([...input].reverse());
  const mirrored=validate(input.map(n=>({...n,hand:'left',midiNote:124-n.midiNote})));
  const axisSum=2*keys.find(k=>k.midiNote===62)!.target[0];
  for(let t=2.9;t<7.62;t+=0.0071) {
    const a=evaluate(original,t,'scale').right,b=evaluate(reversed,t,'scale').right,c=evaluate(mirrored,t,'scale').left;
    assert.deepEqual(a.position,b.position);
    for(const f of fingers)assert.deepEqual(a.joints[f],b.joints[f]);
    a.position.forEach((v,i)=>assert.ok(Math.abs((i===0?axisSum-v:v)-c.position[i])<1e-10));
    a.rotation.forEach((v,i)=>assert.ok(Math.abs((i===2?-v:v)-c.rotation[i])<1e-10));
    assert.equal(a.depth,c.depth);
    for(const f of fingers)for(const field of ['spread','proximal','distal'] as const)
      assert.ok(Math.abs(a.joints[f][field]-c.joints[f][field])<1e-10);
    for(const [index,n] of b.activeNotes.entries()) {
      const tip=handPointWorld(b.position,b.rotation,pointsForPose('right',n.finger,b.joints[n.finger])[2]);
      assert.ok(Math.abs(tip[0]-b.targets[index][0])<1e-10);
      assert.equal(b.targets[index][0],keys.find(k=>k.midiNote===n.midiNote)!.target[0]);
    }
  }
});

test('多音和音の後方の重複指・鍵盤・交差と6音を見落とさない',()=>{
  const chord=[60,64,67,69].map((midiNote,i)=>({time:1,duration:0.35,midiNote,hand:'right',finger:[1,2,4,5][i]}));
  for(const [last,reason] of [
    [{...chord[3],finger:4},/同じ指/],
    [{...chord[3],midiNote:67},/同じ鍵盤/],
    [{...chord[3],midiNote:65},/交差/],
  ] as const)assert.throws(()=>validate([...chord.slice(0,3),last]),reason);
  assert.throws(()=>validate([60,62,64,65,67,69].map((midiNote,i)=>({...chord[0],midiNote,finger:i%5+1}))),/最大5音/);
  assert.throws(()=>validate([{...chord[0],midiNote:21},{...chord[1],midiNote:60},{...chord[3],midiNote:108}]),error=>{
    assert.ok(error instanceof Error);
    assert.match(error.message,/右手 1\.000秒/);assert.match(error.message,/MIDI21\/指1/);assert.match(error.message,/MIDI108\/指5/);
    assert.match(error.message,/届きません/);return true;
  });
  assert.throws(()=>validate(chord.map((n,i)=>({...n,midiNote:[60,64,67,71][i]}))),/届きません/,'実際の人間の到達範囲まで保証しない');
});

test('多音和音・単音・音階の切替と短い音間・部分押下でも連続し、シークを再現する',()=>{
  const rapid=whiteChords.filter(n=>n.time>=3&&n.time<8).map(n=>({...n,time:1+(n.time-3.15)*0.05,duration:0.03}));
  for(const input of [whiteChords,rapid]) {
    const notes=validate(input),snapshot=structuredClone(notes);
    const plan=performancePlanFor(notes);
    if(input===whiteChords)for(const hand of ['left','right'] as const)assert.equal(plan[hand].length,2);
    const times=new Set(Array.from({length:Math.ceil(lengthOf(notes)/0.005)},(_,i)=>i*0.005));
    for(const n of notes)for(const t of [n.time,n.time+n.duration])times.add(t);
    for(const style of ['linear','smooth','scale'] as const)for(const t of times) {
      const a=evaluate(notes,t-1e-8,style,'connected','smooth',true),b=evaluate(notes,t+1e-8,style,'connected','smooth',true);
      for(const hand of ['left','right'] as const) {
        for(const field of ['position','rotation'] as const)a[hand][field].forEach((v,i)=>assert.ok(Number.isFinite(v)&&Math.abs(v-b[hand][field][i])<1e-5,`${t}: ${hand} ${field}`));
        assert.ok(Math.abs(a[hand].depth-b[hand].depth)<1e-4);
        for(const f of fingers)for(const field of ['spread','proximal','distal','opposition'] as const)
          assert.ok(Math.abs((a[hand].joints[f][field]??0)-(b[hand].joints[f][field]??0))<1e-4,`${t}: ${hand} 指${f} ${field}`);
      }
    }
    for(const n of notes) {
      const on=evaluate(notes,n.time,'scale')[n.hand],off=evaluate(notes,n.time+n.duration,'scale')[n.hand];
      assert.ok(on.activeNotes.includes(n));assert.equal(on.phase,'press');assert.equal(on.depth,0);
      assert.ok(off.activeNotes.includes(n));assert.equal(off.phase,'release');
      if(n.duration<0.06)assert.ok(off.depth>0&&off.depth<1);
    }
    const saved=evaluate(notes,1.03,'scale','connected','smooth',true);
    evaluate(notes,30,'scale','reset','legacy');evaluate(notes,0,'scale');
    assert.deepEqual(evaluate(notes,1.03,'scale','connected','smooth',true),saved);
    assert.deepEqual(notes,snapshot);
  }
});

test('多音和音は左右独立に評価し、両端音域でも全鍵表示と前腕長を保つ',()=>{
  const notes=validate(whiteChords);
  for(const hand of ['left','right'] as const) {
    const alone=validate(notes.filter(n=>n.hand===hand));
    for(let t=0;t<lengthOf(notes);t+=0.011) {
      const together=evaluate(notes,t,'scale','connected','smooth',true)[hand];
      assert.deepEqual(together,evaluate(alone,t,'scale','connected','smooth',true)[hand]);
    }
  }
  for(const shift of [-36,36])for(const hand of ['left','right'] as const) {
    const input=[60,62,64,65,67].map((midiNote,i)=>({time:1,duration:0.35,midiNote:midiNote+shift,hand,finger:hand==='right'?i+1:5-i}));
    const notes=validate(input);
    for(let t=0.88;t<1.47;t+=0.005) {
      const pose=evaluate(notes,t,'scale')[hand],arm=forearmEndpoints(pose.position,hand);
      assert.ok(Math.abs(Math.hypot(...arm.wrist.map((v,i)=>v-arm.elbow[i]))-FOREARM_LENGTH)<1e-12);
      const points=fingers.flatMap(f=>pointsForPose(hand,f,pose.joints[f]).map(p=>handPointWorld(pose.position,pose.rotation,p)));
      for(const p of [...points,arm.elbow,arm.wrist])for(const i of [0,1,2])assert.ok(p[i]>=FULL_VIEW_MIN[i]&&p[i]<=FULL_VIEW_MAX[i]);
    }
  }
});

test('接触域は描画鍵盤の内側にあり、黒鍵中心線の干渉判定は押下量を反映する',()=>{
  for(const key of keys)for(const rear of [false,true]) {
    const [back,front]=contactRange(key,rear);
    assert.ok(back>key.z-key.length/2&&front<key.z+key.length/2);
    assert.ok(front>back);
    assert.ok(key.target[2]>=back&&key.target[2]<=front);
    assert.equal(key.target[1],key.black?0.012:0);
    assert.ok(Math.abs((key.target[1]-key.height/2)-(key.black?0:-0.009))<1e-12);
  }
  const black=keys.find(k=>k.midiNote===61)!,x=black.target[0];
  assert.equal(clearsBlackKeys([[x-0.015,0.006,-0.04],[x+0.015,0.006,-0.04]],new Set(),0),false,'端点が外でも節が黒鍵を横切れば拒否');
  assert.equal(clearsBlackKeys([[x,0.006,-0.04],[x,0.004,-0.04]],new Set(),0),false);
  assert.equal(clearsBlackKeys([[x,0.006,-0.04],[x,0.004,-0.04]],new Set([61]),0.01),true,'押した黒鍵上方の線分を拒否しない');
  assert.equal(clearsBlackKeys([[x,0.006,0.01],[x,0.004,0.01]],new Set(),0),true,'黒鍵前方は通過できる');
  assert.equal(clearsBlackKeys([[x,0.03,-0.04],[x,0.02,-0.04]],new Set(),0),true);
});

test('白黒混在・黒鍵のみの2〜5音で全接触と高さを保ち、非演奏指も黒鍵を横切らない',()=>{
  const extra=[60,63].flatMap((_,index)=>['left','right'].map(hand=>({time:1,duration:0.35,midiNote:[60,63][index]+(hand==='left'?-12:0),hand,finger:hand==='right'?[1,4][index]:[5,2][index]})));
  const chordInput=mixedKeyChords.filter(n=>n.time>=3&&n.time<8);
  const inputs=[extra,chordInput,...[-24,24].map(shift=>chordInput.filter(n=>n.time===3.15).map(n=>({...n,midiNote:n.midiNote+shift})))];
  for(const input of inputs) {
    const notes=validate(input),starts=[...new Set(notes.map(n=>n.time))];
    for(const start of starts)for(let t=start-0.12;t<start+0.47-1e-9;t+=0.0013) {
      const result=evaluate(notes,t,'scale','connected','smooth',true);
      for(const hand of ['left','right'] as const) {
        const pose=result[hand];
        if(!pose.active)continue;
        assert.equal(pose.activeNotes.length,notes.filter(n=>n.hand===hand&&n.time===start).length);
        const pressed=new Set(pose.activeNotes.map(n=>n.midiNote));
        const height=t<start?(start-t)/0.12*0.018:t<start+0.35?-pose.depth*TRAVEL:t<start+0.41?-pose.depth*TRAVEL:(t-start-0.41)/0.06*0.018;
        for(const [i,n] of pose.activeNotes.entries()) {
          const key=keys.find(k=>k.midiNote===n.midiNote)!,target=pose.targets[i];
          const [back,front]=contactRange(key,true);
          assert.equal(target[0],key.target[0]);assert.equal(target[1],key.target[1]);
          assert.ok(target[2]>=back-1e-12&&target[2]<=front+1e-12);
          const tip=handPointWorld(pose.position,pose.rotation,pointsForPose(hand,n.finger,pose.joints[n.finger])[2]);
          tip.forEach((v,j)=>assert.ok(Math.abs(v-target[j]-(j===1?height:0))<1e-9));
        }
        for(const finger of fingers) {
          const points=pointsForPose(hand,finger,pose.joints[finger]).map(p=>handPointWorld(pose.position,pose.rotation,p));
          assert.ok(clearsBlackKeys(points,pressed,pose.depth*TRAVEL),`${hand} ${t}: 指${finger}の中心線`);
          for(let i=0;i<2;i++)assert.ok(Math.abs(Math.hypot(...points[i].map((v,j)=>v-points[i+1][j]))-specs[finger].lengths[i])<1e-12);
          if(!pose.activeNotes.some(n=>n.finger===finger))assert.ok(points[2][1]>0,'非演奏指を鍵盤下へ下げない');
        }
        assert.deepEqual(pose,evaluate(notes,t,'linear')[hand]);
      }
    }
  }
});

test('黒鍵和音の入力順・左右鏡映・移調で接触と計画の再現性を保つ',()=>{
  const input=mixedKeyChords.filter(n=>n.hand==='right'&&n.time>=3&&n.time<8);
  const notes=validate(input),reversed=validate([...input].reverse());
  const mirrored=validate(input.map(n=>({...n,midiNote:124-n.midiNote,hand:'left'})));
  const axisSum=2*keys.find(k=>k.midiNote===62)!.target[0];
  for(let t=3.03;t<7.62;t+=0.0073) {
    const a=evaluate(notes,t,'scale').right,b=evaluate(reversed,t,'scale').right,c=evaluate(mirrored,t,'scale').left;
    assert.deepEqual(a.position,b.position);assert.deepEqual(a.joints,b.joints);
    a.position.forEach((v,i)=>assert.ok(Math.abs((i===0?axisSum-v:v)-c.position[i])<1e-9));
    a.rotation.forEach((v,i)=>assert.ok(Math.abs((i===2?-v:v)-c.rotation[i])<1e-9));
    assert.equal(a.depth,c.depth);
    for(const f of fingers)for(const field of ['spread','proximal','distal'] as const)assert.ok(Math.abs(a.joints[f][field]-c.joints[f][field])<1e-9);
    for(const [i,n] of b.activeNotes.entries())assert.equal(b.targets[i][0],keys.find(k=>k.midiNote===n.midiNote)!.target[0]);
  }
});

test('白黒和音・単音・音階の境界、短い音間、比較切替と逆シークを再現する',()=>{
  const rapid=mixedKeyChords.filter(n=>n.time>=3&&n.time<8).map(n=>({...n,time:1+(n.time-3.15)*0.05,duration:0.03}));
  for(const input of [mixedKeyChords,rapid]) {
    const notes=validate(input),snapshot=structuredClone(notes),planned=performancePlanFor(notes);
    if(input===mixedKeyChords)for(const hand of ['left','right'] as const)assert.equal(planned[hand].length,2);
    const times=new Set(Array.from({length:Math.ceil(lengthOf(notes)/0.004)},(_,i)=>i*0.004));
    for(const n of notes)for(const t of [n.time,n.time+n.duration])times.add(t);
    for(const style of ['linear','smooth','scale'] as const)for(const t of times) {
      const a=evaluate(notes,t-1e-8,style,'connected','smooth',true),b=evaluate(notes,t+1e-8,style,'connected','smooth',true);
      for(const hand of ['left','right'] as const) {
        for(const field of ['position','rotation'] as const)a[hand][field].forEach((v,i)=>assert.ok(Number.isFinite(v)&&Math.abs(v-b[hand][field][i])<1e-5));
        assert.ok(Math.abs(a[hand].depth-b[hand].depth)<1e-4);
        for(const f of fingers)for(const field of ['spread','proximal','distal','opposition'] as const)
          assert.ok(Math.abs((a[hand].joints[f][field]??0)-(b[hand].joints[f][field]??0))<1e-4,`${t} ${hand} 指${f}`);
      }
    }
    for(const n of notes) {
      const on=evaluate(notes,n.time,'scale')[n.hand],off=evaluate(notes,n.time+n.duration,'scale')[n.hand];
      assert.equal(on.phase,'press');assert.equal(on.depth,0);assert.ok(on.activeNotes.includes(n));
      assert.equal(off.phase,'release');assert.ok(off.activeNotes.includes(n));
      if(n.duration<0.06)assert.ok(off.depth>0&&off.depth<1);
    }
    const saved=evaluate(notes,1.03,'scale','connected','smooth',true);
    evaluate(notes,30,'scale','reset','legacy');evaluate(notes,0,'scale');
    assert.deepEqual(evaluate(notes,1.03,'scale','connected','smooth',true),saved);assert.deepEqual(notes,snapshot);
  }
});

test('黒鍵和音の不正運指・到達不能・左右同一鍵を拒否し、離鍵差を扱う',()=>{
  const note={time:1,duration:0.35,midiNote:61,hand:'right',finger:1};
  assert.throws(()=>validate([note,{...note,midiNote:65}]),/同じ指/);
  assert.throws(()=>validate([note,{...note,finger:3}]),/同じ鍵盤/);
  assert.equal(heldPlansFor(validate([note,{...note,midiNote:65,finger:3,duration:0.4}])).right.length,1);
  assert.throws(()=>validate([note,{...note,midiNote:60,finger:3}]),/交差/);
  assert.throws(()=>validate([{...note,midiNote:21},{...note,midiNote:61,finger:3},{...note,midiNote:108,finger:5}]),/黒鍵との干渉制約.*届きません/);
  assert.throws(()=>validate([note,{...note,midiNote:65,finger:3},{...note,hand:'left',finger:5}]),/左右の手/);
});

test('黒鍵音階と3/4↔1を音程・運指から区間化し、和音を挟んでも左右3区間ずつ計画する',()=>{
  const notes=validate(mixedKeyScales),snapshot=structuredClone(notes),planned=performancePlanFor(notes);
  assert.equal(notes.length,102);assert.equal(performancePlanFor(notes),planned);
  assert.equal(preparePerformance(notes),planned);
  const amounts=[...planned.left,...planned.right].map(r=>r.wristAmount);
  assert.ok(amounts.every(v=>v!==undefined&&v>0));
  for(const hand of ['left','right'] as const) {
    assert.equal(planned[hand].length,3);
    assert.deepEqual(planned[hand].map(r=>r.legacy.steps.length),[15,15,15]);
    assert.deepEqual(planned[hand].map(r=>r.legacy.steps[0].note.time),[1,5.5,10]);
    assert.ok(planned[hand].every(r=>r.legacy.placement&&r.smooth));
    for(const t of [1.8,6.6,11.1])assert.ok(evaluate(notes,t,'scale')[hand].technique);
    for(const t of [5.0,9.5])assert.equal(evaluate(notes,t,'scale')[hand].technique,undefined);
  }
  const right=planned.right[1].legacy.steps,left=planned.left[2].legacy.steps;
  assert.equal(right[3].note.finger,4);assert.equal(right[4].note.finger,1);
  assert.equal(crossingDirection(right[3].note,right[4].note),1);
  assert.equal(left[3].note.finger,1);assert.equal(left[4].note.finger,4);
  assert.equal(crossingDirection(left[3].note,left[4].note),-1);
  assert.equal(evaluate(notes,6.53,'scale').right.technique,'thumb-under');
  assert.equal(evaluate(notes,11.03,'scale').left.technique,'finger-over');
  assert.deepEqual(notes,snapshot);
  preparePerformance(notes);
  assert.deepEqual([...planned.left,...planned.right].map(r=>r.wristAmount),amounts);
});

test('白黒音階の全比較設定で時刻・接触域・全指の黒鍵中心線クリアランスを保つ',()=>{
  const notes=validate(mixedKeyScales),planned=performancePlanFor(notes);
  for(const idle of ['connected','reset'] as const)for(const strike of ['legacy','smooth'] as const)for(const wrist of [false,true]) {
    let black=0,white=0;
    for(let t=0.88;t<lengthOf(notes);t+=0.0031) {
      const result=evaluate(notes,t,'scale',idle,strike,wrist);
      for(const hand of ['left','right'] as const) {
        const pose=result[hand];
        const plan=planned[hand].map(r=>strike==='smooth'&&r.smooth?r.smooth:r.legacy).find(p=>t>p.blendStart&&t<p.blendEnd);
        if(!pose.technique){assert.deepEqual(pose,evaluate(notes,t,'smooth')[hand]);continue;}
        if(pose.active) {
          const n=pose.active,key=keys.find(k=>k.midiNote===n.midiNote)!,target=pose.targets[0];
          assert.equal(pose.activeNotes.length,1);assert.equal(target[0],key.target[0]);assert.equal(target[1],key.target[1]);
          const [back,front]=contactRange(key,true);assert.ok(target[2]>=back-1e-12&&target[2]<=front+1e-12);
          const tip=handPointWorld(pose.position,pose.rotation,pointsForPose(hand,n.finger,pose.joints[n.finger])[2]);
          assert.ok(Math.abs(tip[0]-target[0])<1e-9&&Math.abs(tip[2]-target[2])<1e-9);
          if(pose.phase==='press'||pose.depth>0)assert.ok(Math.abs(tip[1]-target[1]+pose.depth*TRAVEL)<1e-9);
          else assert.ok(tip[1]>=target[1]-1e-9);
          if(key.black)black++;else white++;
        }
        if(plan&&scaleWeight(plan,t)===1)for(const f of fingers) {
          const points=pointsForPose(hand,f,pose.joints[f]).map(p=>handPointWorld(pose.position,pose.rotation,p));
          assert.ok(clearsBlackKeys(points,new Set(pose.active?[pose.active.midiNote]:[]),pose.depth*TRAVEL),`${t}: ${hand} 指${f}`);
          if(pose.active?.finger!==f)assert.ok(points[2][1]>=0.003-1e-9);
        }
      }
    }
    assert.ok(black>300&&white>1000);
    for(const n of notes) {
      const on=evaluate(notes,n.time,'scale',idle,strike,wrist)[n.hand],off=evaluate(notes,n.time+n.duration,'scale',idle,strike,wrist)[n.hand];
      assert.ok(on.activeNotes.includes(n));assert.equal(on.phase,'press');assert.equal(on.depth,0);
      assert.ok(off.activeNotes.includes(n));assert.equal(off.phase,'release');
    }
  }
});

test('黒鍵音階の接触・音間の掌移動・区間境界は連続し、逆方向シークも同じ姿勢になる',()=>{
  const notes=validate(mixedKeyScales),planned=performancePlanFor(notes);
  const times=new Set(Array.from({length:Math.ceil(lengthOf(notes)/0.0041)},(_,i)=>i*0.0041));
  for(const hand of ['left','right'] as const)for(const run of planned[hand])for(const plan of [run.legacy,run.smooth])if(plan) {
    times.add(plan.blendStart);times.add(plan.blendEnd);
    for(const [i,s] of plan.steps.entries()) {
      const end=s.note.time+s.note.duration;
      for(const t of [s.preparation,s.note.time-s.approach,s.note.time,s.note.time+0.06,end,end+s.release])times.add(t);
      const next=plan.steps[i+1];
      if(next){times.add(end+(next.note.time-end)*0.3);times.add(next.note.time-(next.note.time-end)*0.3);}
    }
  }
  for(const idle of ['connected','reset'] as const)for(const strike of ['legacy','smooth'] as const)for(const wrist of [false,true]) {
    for(const t of times) {
      const a=evaluate(notes,t-1e-8,'scale',idle,strike,wrist),b=evaluate(notes,t+1e-8,'scale',idle,strike,wrist);
      for(const hand of ['left','right'] as const) {
        for(const field of ['position','rotation'] as const)a[hand][field].forEach((v,i)=>assert.ok(Number.isFinite(v)&&Math.abs(v-b[hand][field][i])<1e-5,`${t}: ${hand} ${field}`));
        assert.ok(Math.abs(a[hand].depth-b[hand].depth)<1e-4);
        for(const f of fingers)for(const field of ['spread','proximal','distal','opposition'] as const)
          assert.ok(Math.abs((a[hand].joints[f][field]??0)-(b[hand].joints[f][field]??0))<1e-4,`${t}: ${hand} 指${f} ${field}`);
        const armA=forearmEndpoints(a[hand].position,hand,a[hand].forearmGuide),armB=forearmEndpoints(b[hand].position,hand,b[hand].forearmGuide);
        armA.elbow.forEach((v,i)=>assert.ok(Math.abs(v-armB.elbow[i])<1e-5));
      }
    }
    const saved=evaluate(notes,6.53,'scale',idle,strike,wrist);evaluate(notes,30,'scale',idle,strike,wrist);evaluate(notes,0,'scale');
    assert.deepEqual(evaluate(notes,6.53,'scale',idle,strike,wrist),saved);
  }
});

test('黒鍵音階の加減速と手首の切替は共通の掌軌道・接触点・押鍵時刻を保つ',()=>{
  const notes=validate(mixedKeyScales),planned=performancePlanFor(notes);
  for(const hand of ['left','right'] as const)for(const run of planned[hand]) {
    assert.ok(run.smooth);
    const a=run.legacy,b=run.smooth;
    assert.deepEqual(a.steps.map(s=>s.target),b.steps.map(s=>s.target));
    for(let t=a.steps[0].note.time;t<a.steps.at(-1)!.note.time+0.12;t+=0.0037) {
      const legacy=evaluate(notes,t,'scale','connected','legacy')[hand],smooth=evaluate(notes,t,'scale','connected','smooth')[hand];
      assert.deepEqual(legacy.position,smooth.position);
      const on=evaluate(notes,t,'scale','connected','smooth',true)[hand];
      assert.equal(on.active,smooth.active);assert.equal(on.depth,smooth.depth);assert.equal(on.phase,smooth.phase);
      assert.deepEqual(on.targets,smooth.targets);assert.equal(on.position[0],smooth.position[0]);
      if(on.active) {
        const f=on.active.finger;
        const before=handPointWorld(smooth.position,smooth.rotation,pointsForPose(hand,f,smooth.joints[f])[2]);
        const after=handPointWorld(on.position,on.rotation,pointsForPose(hand,f,on.joints[f])[2]);
        after.forEach((v,i)=>assert.ok(Math.abs(v-before[i])<1e-9));
      }
    }
    assert.ok(run.wristAmount!==undefined&&run.wristAmount>0&&run.wristAmount<=1);
  }
  const knot=planned.right[1].smooth!.steps[4];
  const tipY=(time:number)=>{
    const frame=evaluate(notes,time,'scale','connected','smooth',true).right;
    return handPointWorld(frame.position,frame.rotation,pointsForPose('right',knot.note.finger,frame.joints[knot.note.finger])[2])[1];
  };
  for(const t of [knot.note.time,knot.note.time+0.06,knot.note.time+knot.note.duration]) {
    assert.ok(Math.abs((tipY(t)-tipY(t-1e-6))/1e-6)<0.002);
    assert.ok(Math.abs((tipY(t+1e-6)-tipY(t))/1e-6)<0.002);
  }
});

test('黒鍵音階の鏡映・移調・高速化でも節長と接触を保ち、両端の表示範囲内に収まる',()=>{
  const rightInput=mixedKeyScales.filter(n=>n.hand==='right'),right=validate(rightInput);
  const left=validate(rightInput.map(n=>({...n,hand:'left',midiNote:124-n.midiNote})));
  const axisSum=2*keys.find(k=>k.midiNote===62)!.target[0];
  for(let t=0.88;t<lengthOf(right);t+=0.0091) {
    const a=evaluate(right,t,'scale','connected','smooth',true).right,b=evaluate(left,t,'scale','connected','smooth',true).left;
    assert.equal(a.technique,b.technique);assert.equal(a.depth,b.depth);assert.equal(a.phase,b.phase);
    a.position.forEach((v,i)=>assert.ok(Math.abs((i===0?axisSum-v:v)-b.position[i])<1e-9));
    a.rotation.forEach((v,i)=>assert.ok(Math.abs((i===2?-v:v)-b.rotation[i])<1e-9));
    for(const f of fingers)for(const field of ['spread','proximal','distal','opposition'] as const)
      assert.ok(Math.abs((a.joints[f][field]??0)-(b.joints[f][field]??0))<1e-9);
  }
  for(const shift of [-24,24]) {
    const notes=validate(mixedKeyScales.map(n=>({...n,midiNote:n.midiNote+shift,time:1+(n.time-1)/2,duration:0.075})));
    const planned=performancePlanFor(notes);assert.equal(planned.left.length,3);assert.equal(planned.right.length,3);
    for(let t=0.88;t<lengthOf(notes);t+=0.0073)for(const hand of ['left','right'] as const) {
      const frame=evaluate(notes,t,'scale','connected','smooth',true)[hand];
      const arm=forearmEndpoints(frame.position,hand,frame.forearmGuide);
      assert.ok(Math.abs(Math.hypot(...arm.wrist.map((v,i)=>v-arm.elbow[i]))-FOREARM_LENGTH)<1e-12);
      for(const point of [arm.wrist,arm.elbow])for(const i of [0,1,2])assert.ok(point[i]-0.026>=FULL_VIEW_MIN[i]&&point[i]+0.026<=FULL_VIEW_MAX[i]);
      for(const f of fingers) {
        const points=pointsForPose(hand,f,frame.joints[f]).map(p=>handPointWorld(frame.position,frame.rotation,p));
        for(const p of points)for(const i of [0,1,2])assert.ok(p[i]>=FULL_VIEW_MIN[i]&&p[i]<=FULL_VIEW_MAX[i]);
        for(let i=0;i<2;i++)assert.ok(Math.abs(Math.hypot(...points[i].map((v,j)=>v-points[i+1][j]))-specs[f].lengths[i])<1e-12);
        const active=frame.activeNotes.find(n=>n.finger===f);
        if(active&&frame.technique&&(frame.phase==='press'||frame.depth>0))assert.ok(Math.abs(points[2][1]-keys.find(k=>k.midiNote===active.midiNote)!.target[1]+frame.depth*TRAVEL)<1e-9);
      }
    }
  }
});

test('非対応の音程・5↔1・同一鍵の競合は区間単位で扱い、無理に新方式へ変えない',()=>{
  for(const [pitches,fingering] of [
    [[60,61,63,64],[5,1,2,3]],[[60,60,62,64],[1,2,3,4]],[[60,64,65,67],[3,1,2,3]],
  ]) {
    const notes=validate(pitches.map((midiNote,i)=>({time:1+i*0.25,duration:0.12,midiNote,hand:'right',finger:fingering[i]})));
    assert.equal(performancePlanFor(notes).right.length,0);
    for(let t=0.88;t<2.3;t+=0.013)assert.deepEqual(evaluate(notes,t,'scale','connected','smooth',true),evaluate(notes,t,'smooth'));
    assert.equal(scaleConnection(notes[0],notes[1]),undefined);
  }
  const input=[...mixedKeyScales.filter(n=>n.hand==='right'),{time:1.27,duration:0.02,midiNote:67,hand:'left',finger:2}];
  const notes=validate(input),planned=performancePlanFor(notes).right;
  assert.equal(planned.length,3);assert.equal(planned[0].smooth,undefined);assert.ok(planned[1].smooth&&planned[2].smooth);
  for(let t=0.88;t<lengthOf(notes);t+=0.0053) {
    const frame=evaluate(notes,t,'scale','connected','smooth',true);
    assert.ok(!frame.left.activeNotes.some(a=>frame.right.activeNotes.some(b=>a.midiNote===b.midiNote)));
  }
});

test('重複・移動不足・不正入力を拒否する',()=>{
  assert.equal(heldPlansFor(validate([{...basic[0]}, {...basic[1],time:1.2}])).right.length,1);
  assert.equal(heldPlansFor(validate([{...basic[0]}, {...basic[1],time:1.505}])).right.length,1);
  for (const invalid of [[],null,[{...basic[0],hand:'unknown'}],[{...basic[0],finger:6}],[{...basic[0],midiNote:20}],[{...basic[0],midiNote:109}],[{...basic[0],duration:0}]]) assert.throws(()=>validate(invalid));
});
test('88鍵の範囲と白鍵52・黒鍵36の配置',()=>{
  assert.equal(keys.length,88);
  assert.equal(keys.filter(k=>!k.black).length,52);
  assert.equal(keys.filter(k=>k.black).length,36);
  assert.equal(keys[0].midiNote,21); assert.equal(keys.at(-1)!.midiNote,108);
  for(let i=1;i<keys.length;i++) assert.ok(keys[i].target[0]>keys[i-1].target[0]);
  assert.ok(Math.abs(keys[0].target[0]+keys.at(-1)!.target[0])<1e-9);
});
test('横長・縦長の両視点で88鍵と手の範囲が画面内に収まる',()=>{
  const bounds=new Box3(new Vector3(...FULL_VIEW_MIN),new Vector3(...FULL_VIEW_MAX));
  for(const aspect of [0.5,1,1.7,3]) for(const top of [false,true]) {
    const camera=new PerspectiveCamera(40,aspect,0.001,10);
    fitCamera(camera,bounds,top);
    for(const x of [bounds.min.x,bounds.max.x]) for(const y of [bounds.min.y,bounds.max.y]) for(const z of [bounds.min.z,bounds.max.z]) {
      const projected=new Vector3(x,y,z).project(camera);
      assert.ok(Math.abs(projected.x)<=0.901 && Math.abs(projected.y)<=0.901);
      assert.ok(projected.z>=-1 && projected.z<=1);
    }
  }
});
test('自然な移動は両端で速度がゼロに近づき、大きい跳躍ほど持ち上げる',()=>{
  const from:[number,number,number]=[0,0,0],to:[number,number,number]=[0.3,0.01,0];
  const start=1,end=2;
  const before=transition(from,to,start,start,end,'smooth');
  const after=transition(from,to,end,start,end,'smooth');
  assert.deepEqual(before.position,from);assert.deepEqual(after.position,to);
  assert.equal(before.lift,0);assert.equal(after.lift,0);
  assert.deepEqual(before.rotation,[0,0,-0]);assert.ok(after.rotation.every(v=>v===0));
  const duration=Math.max(0.3,0.22+0.3/0.7),departure=end-duration;
  const h=1e-6;
  const beginning=transition(from,to,departure+h,start,end,'smooth');
  const ending=transition(from,to,end-h,start,end,'smooth');
  beginning.position.forEach((v,i)=>assert.ok(Math.abs((v-from[i])/h)<0.01));
  ending.position.forEach((v,i)=>assert.ok(Math.abs((to[i]-v)/h)<0.01));
  const middle=transition(from,to,end-duration/2,start,end,'smooth');
  const near=transition(from,[0.02,0,0],end-0.3/2,start,end,'smooth');
  assert.ok(middle.lift>near.lift);assert.ok(middle.rotation.some(v=>v!==0));
  const ready=transition(from,to,departure+duration*0.8,start,end,'smooth');
  assert.equal(ready.preparation,1);assert.ok(ready.progress<1);
  assert.equal(transition(from,to,departure,start,end,'linear').lift,0);
});
test('比較切替でも単音・黒鍵・和音の接触区間と時刻は変わらない',()=>{
  for(const input of [basic,black,fullRange,both,dyads,movement]) {
    const notes=validate(input);
    for(const note of notes)for(const time of [note.time-0.1,note.time,note.time+0.03,note.time+note.duration-0.001,note.time+note.duration+0.03]) {
      const linear=evaluate(notes,time,'linear')[note.hand],smooth=evaluate(notes,time,'smooth')[note.hand];
      assert.deepEqual(smooth,linear);
      assert.ok(smooth.rotation.every(v=>v===0));
    }
    const saved=evaluate(notes,2.01,'smooth');evaluate(notes,20,'smooth');evaluate(notes,0,'smooth');
    assert.deepEqual(evaluate(notes,2.01,'smooth'),saved);
  }
});
test('新しい移動の開始・終了・和音切替で手と指の姿勢が連続する',()=>{
  const notes=validate(movement);
  // Dense sampling catches departures whose time is derived from jump distance.
  for(let time=0.001;time<lengthOf(notes);time+=0.003) {
    const a=evaluate(notes,time-1e-6,'smooth'),b=evaluate(notes,time+1e-6,'smooth');
    for(const side of ['left','right'] as const) {
      a[side].position.forEach((v,i)=>assert.ok(Math.abs(v-b[side].position[i])<0.0001));
      a[side].rotation.forEach((v,i)=>assert.ok(Math.abs(v-b[side].rotation[i])<0.0001));
      for(const f of fingers)for(const field of ['spread','proximal','distal'] as const)assert.ok(Math.abs(a[side].joints[f][field]-b[side].joints[f][field])<0.001);
    }
  }
});
test('手首軸の回転が描画変換と一致し、前腕長と全体表示の範囲を保つ',()=>{
  const bounds=new Box3(new Vector3(...FULL_VIEW_MIN),new Vector3(...FULL_VIEW_MAX));
  for(const input of [movement,fullRange]) {
    const notes=validate(input);
    for(let time=0;time<=lengthOf(notes);time+=0.03)for(const side of ['left','right'] as const) {
      const pose=evaluate(notes,time,'smooth')[side];
      const {wrist,elbow}=forearmEndpoints(pose.position,side);
      assert.ok(Math.abs(Math.hypot(...wrist.map((v,i)=>v-elbow[i]))-FOREARM_LENGTH)<1e-12);
      assert.deepEqual(handPointWorld(pose.position,pose.rotation,WRIST),wrist);
      for(const p of [wrist,elbow])for(const axis of [0,1,2]) {
        assert.ok(p[axis]-0.026>=FULL_VIEW_MIN[axis]);assert.ok(p[axis]+0.026<=FULL_VIEW_MAX[axis]);
      }
      for(const f of fingers)for(const point of pointsForPose(side,f,pose.joints[f])) {
        const world=handPointWorld(pose.position,pose.rotation,point);
        const expected=new Vector3(...point).sub(new Vector3(...WRIST)).applyQuaternion(new Quaternion().setFromEuler(new Euler(...pose.rotation))).add(new Vector3(...WRIST)).add(new Vector3(...pose.position));
        world.forEach((v,i)=>assert.ok(Math.abs(v-expected.getComponent(i))<1e-12));
        assert.ok(bounds.containsPoint(new Vector3(...world)));
      }
    }
  }
});
test('左手保持中の右手押鍵・離鍵は左手に影響せず、両手の終了まで再生できる',()=>{
  const notes=validate(both);
  const left=evaluate(notes,1.2).left;
  for(const time of [1.6,2.3,2.8,3.6]) assert.deepEqual(evaluate(notes,time).left,left);
  assert.equal(evaluate(notes,1.2).right.depth,1);
  assert.equal(evaluate(notes,1.7).right.depth,0);
  const long=validate([{...basic[0],hand:'left',midiNote:48,duration:10},basic[1]]);
  assert.ok(lengthOf(long)>11);
  assert.equal(evaluate(validate(basic),1.2).left.curl,0);
});
test('両手の同時演奏は許可し、同一鍵への同時接触は拒否する',()=>{
  assert.equal(validate([{...basic[0],hand:'left',midiNote:48},basic[0]]).length,2);
  assert.throws(()=>validate([{...basic[0],hand:'left'},basic[0]]),/同じ鍵盤/);
  assert.equal(heldPlansFor(validate([{...basic[0],hand:'left',midiNote:62},{...basic[1],hand:'left',midiNote:60,time:1.2}])).left.length,1);
});
test('左右全指・白黒鍵で保持中の指先接触と掌高さ、押鍵・離鍵の連続性を確認',()=>{
  for(const hand of ['left','right'] as const) for(const finger of fingers) for(const midiNote of [60,61]) {
    const notes=validate([{time:1,duration:0.5,midiNote,hand,finger}]);
    const before=evaluate(notes,0.87)[hand];
    for(const time of [1,1.03,1.1,1.499,1.5,1.53]) {
      const pose=evaluate(notes,time)[hand], tip=fingerPoints(hand,finger,pose.curl)[2];
      const target=keys.find(k=>k.midiNote===midiNote)!.target;
      assert.ok(Math.abs(before.position[1]-pose.position[1])<1e-12);
      target.forEach((v,i)=>assert.ok(Math.abs(pose.position[i]+tip[i]-(v-(i===1?pose.depth*TRAVEL:0)))<1e-9));
    }
    for(const boundary of [0.88,1,1.06,1.5,1.56,1.62]) {
      const a=evaluate(notes,boundary-1e-7)[hand],b=evaluate(notes,boundary+1e-7)[hand];
      assert.ok(Math.abs(a.curl-b.curl)<1e-5);
      a.position.forEach((v,i)=>assert.ok(Math.abs(v-b.position[i])<1e-6));
    }
  }
});
