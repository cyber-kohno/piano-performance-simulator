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
import { Box3, PerspectiveCamera, Vector3, Quaternion, Euler } from 'three';
import { transition, forearmEndpoints, handPointWorld, WRIST, FOREARM_LENGTH, FULL_VIEW_MIN, FULL_VIEW_MAX } from './movement';
import { fitCamera } from './framing';
import { validate, evaluate, keys, TRAVEL, lengthOf } from './motion';
import { fingerPoints, fingers, pointsForPose, restPose } from './fingers';

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
test('和音の重複指・長さ違い・交差・範囲外・黒鍵混在・3音を拒否',()=>{
  const note={time:1,duration:0.8,midiNote:60,hand:'right',finger:2};
  assert.throws(()=>validate([note,{...note,midiNote:64}]),/同じ指/);
  assert.throws(()=>validate([note,{...note,finger:4}]),/同じ鍵盤/);
  assert.throws(()=>validate([note,{...note,midiNote:64,finger:4,duration:1}]),/同時に離鍵/);
  assert.throws(()=>validate([note,{...note,midiNote:55,finger:4}]),/交差/);
  assert.throws(()=>validate([{...note,midiNote:21,finger:1},{...note,midiNote:108,finger:5}]),/届きません/);
  assert.throws(()=>validate([note,{...note,midiNote:63,finger:4}]),/白鍵のみ/);
  assert.throws(()=>validate([note,{...note,midiNote:64,finger:3},{...note,midiNote:67,finger:5}]),/2音和音のみ/);
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
test('重複・移動不足・不正入力を拒否する',()=>{
  assert.throws(()=>validate([{...basic[0]}, {...basic[1],time:1.2}]),/重複/);
  assert.throws(()=>validate([{...basic[0]}, {...basic[1],time:1.505}]),/音間不足/);
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
  assert.throws(()=>validate([{...basic[0],hand:'left'},{...basic[1],hand:'left',time:1.2}]),/重複/);
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
