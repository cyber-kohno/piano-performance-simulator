import { test } from 'node:test';
import assert from 'node:assert/strict';
import basic from './data/basic.json';
import tiedScore from './data/tied-score.json';
import { normalizePerformance, inputLength, tempoAt } from './score-input';
import { evaluate, validate, keys, keyDepth, heldPlansFor, lengthOf, preparePerformance, TRAVEL } from './motion';
import { pointsForPose, fingers, specs } from './fingers';
import { handPointWorld } from './movement';
import { clearsBlackKeys } from './keyboard';

const note={time:1,duration:0.5,midiNote:60,hand:'right',finger:1};
const beatNote={beat:0,duration:1,midiNote:60,hand:'right',finger:1};
const score=(extra:Record<string,unknown>={})=>({version:1,timeUnit:'beats',leadIn:1,notes:[beatNote],...extra});

test('秒入力の既存形式を維持し、入力を変更せず声部と奏法を引き継ぐ',()=>{
  const input=[...basic,{...note,time:5,voice:'upper',action:'substitute'}],snapshot=structuredClone(input);
  const result=normalizePerformance(input);
  assert.deepEqual(result.notes,input);assert.notEqual(result.notes[0],input[0]);
  assert.deepEqual(result.origins,[[0],[1],[2],[3]]);assert.equal(result.tieChains,0);assert.equal(result.format,'seconds');
  assert.deepEqual(input,snapshot);
});

test('明示したタイを時刻順に結合し、元の音符との対応と全保持時間を保つ',()=>{
  const input=[{...note,time:2.25,duration:0.25,tie:'stop'},
    {...note,time:1.5,duration:0.75,tie:'continue'},{...note,tie:'start'}],snapshot=structuredClone(input);
  const data=normalizePerformance(input);
  assert.deepEqual(data.notes,[{...note,duration:1.5}]);assert.deepEqual(data.origins,[[2,1,0]]);
  assert.equal(data.tieChains,1);assert.deepEqual(input,snapshot);
  const notes=validate(input);
  for(const style of ['linear','smooth','scale'] as const)for(const t of [1.49999,1.5,1.50001,2.24999,2.25,2.25001])
    assert.equal(keyDepth(evaluate(notes,t,style).right,60),1);
  assert.equal(evaluate(notes,2.5).right.phase,'release');
});

test('短いタイ断片を再打鍵せず、一つの押鍵として通常の動作計算へ渡す',()=>{
  const tied=validate([{...note,duration:.02,tie:'start'},{...note,time:1.02,duration:.02,tie:'continue'},
    {...note,time:1.04,duration:.04,tie:'stop'}]);
  assert.ok(Math.abs(tied[0].duration-.08)<1e-12);
  const plain=validate([{...note,duration:tied[0].duration}]);
  for(const t of [0.9,1,1.02,1.04,1.06,1.07,1.08,1.13,1.2])assert.deepEqual(evaluate(tied,t),evaluate(plain,t));
  assert.equal(keyDepth(evaluate(tied,1.07).right,60),1);
});

test('未指定の隣接同音をタイへ変えず、通常の再打鍵と重複エラーを維持する',()=>{
  const input=[note,{...note,time:1.5}];assert.equal(normalizePerformance(input).notes.length,2);
  assert.throws(()=>validate(input),/音間不足/);
  const separated=validate([note,{...note,time:1.52}]);
  assert.equal(keyDepth(evaluate(separated,1.51).right,60),0);
  assert.equal(keyDepth(evaluate(separated,1.52).right,60),0);
  assert.equal(keyDepth(evaluate(separated,1.6).right,60),1);
});

test('タイの欠落・重複・隙間・指替え・音程や声部の違いを理由付きで拒否する',()=>{
  const a={...note,tie:'start'},b={...note,time:1.5,tie:'stop'};
  for(const input of [[a],[b],[a,{...b,tie:'start'}],[a,{...b,time:1.51}],[a,{...b,time:1.49}],
    [a,{...b,finger:2}],[a,{...b,midiNote:62}],[a,{...b,hand:'left'}],[a,{...b,voice:'other'}],
    [a,{...b,action:'substitute'}],[{...a,tie:'end'}],[a,{...b,tie:undefined}]])assert.throws(()=>normalizePerformance(input),/タイ|tie/);
});

test('指替えで受け取る音をタイで延ばせるが、タイの途中の指変更は認めない',()=>{
  const input=[{...note,midiNote:64,finger:3,duration:1.2},
    {...note,time:1.7,duration:.1,midiNote:64,finger:4,action:'substitute',tie:'start'},
    {...note,time:1.8,duration:1,midiNote:64,finger:4,tie:'stop'}];
  const data=normalizePerformance(input),notes=validate(input);
  assert.equal(notes.length,2);assert.equal(data.origins[1].length,2);assert.equal(notes[1].action,'substitute');
  for(let t=1.06;t<2.8;t+=.017)assert.equal(keyDepth(evaluate(notes,t).right,64),1);
});

test('声部が違うタイを混ぜず、同じ指・同じ鍵盤の物理的な競合も隠さない',()=>{
  const input=[{...note,tie:'start',voice:'a'},{...note,time:1.5,tie:'stop',voice:'a'},
    {...note,tie:'start',voice:'b'},{...note,time:1.5,tie:'stop',voice:'b'}];
  const data=normalizePerformance(input);assert.equal(data.notes.length,2);assert.equal(data.tieChains,2);
  assert.throws(()=>validate(input),/同じ指|重複/);
});

test('テンポを各区間で積分し、保持中の変更をまたぐ長さと境界のテンポを求める',()=>{
  const input=score({tempos:[{beat:5,bpm:180},{beat:0,bpm:120},{beat:2,bpm:60}],notes:[{...beatNote,beat:1,duration:5}]});
  const data=normalizePerformance(input);
  assert.equal(data.notes[0].time,1.5);assert.ok(Math.abs(data.notes[0].duration-(.5+3+1/3))<1e-12);
  assert.deepEqual(data.tempos.map(t=>t.time),[1,2,5]);
  assert.equal(tempoAt(data.tempos,0),120);assert.equal(tempoAt(data.tempos,1.999),120);
  assert.equal(tempoAt(data.tempos,2),60);assert.equal(tempoAt(data.tempos,5),180);assert.equal(tempoAt([],0),undefined);
  assert.equal(normalizePerformance(score()).tempos[0].bpm,120);
});

test('53音符の混在譜面を3本のタイを持つ48演奏へ変換し、テンポ境界と終わりの休符を保つ',()=>{
  const snapshot=structuredClone(tiedScore),data=normalizePerformance(tiedScore);
  assert.equal(data.sources.length,53);assert.equal(data.notes.length,48);assert.equal(data.tieChains,3);assert.equal(data.rests.length,12);
  assert.deepEqual(data.origins.filter(ids=>ids.length>1).map(ids=>ids.length),[3,3,2]);
  const bass=data.notes.find(n=>n.hand==='right'&&n.voice==='bass')!;
  assert.ok(Math.abs(bass.time-23/3)<1e-12);assert.ok(Math.abs(bass.time+bass.duration-(1+4+16/3+.8))<1e-12);
  assert.ok(Math.abs(inputLength(data)-16.153333333333332)<1e-12);
  assert.ok(inputLength(data)>lengthOf(data.notes)+.99);
  assert.deepEqual(tiedScore,snapshot);
});

test('休符と同じ手・声部の音符の重複を拒否し、他声部や別の手の保持を許可する',()=>{
  const rest={beat:0,duration:1,hand:'right',voice:'a'};
  assert.throws(()=>normalizePerformance(score({notes:[{...beatNote,voice:'a'}],rests:[rest]})),/休符/);
  assert.equal(normalizePerformance(score({notes:[{...beatNote,voice:'b'}],rests:[rest]})).rests.length,1);
  assert.equal(normalizePerformance(score({notes:[{...beatNote,voice:'a'}],rests:[{...rest,hand:'left'}]})).rests.length,1);
  assert.equal(normalizePerformance(score({notes:[{...beatNote,voice:'a'}],rests:[{...rest,beat:1}]})).rests.length,1);
});

test('不正な拍入力・単位混在・テンポ・休符・声部と数値範囲を拒否する',()=>{
  const invalid=[score({version:2}),score({timeUnit:'seconds'}),score({notes:[]}),score({leadIn:0}),score({leadIn:Infinity}),
    score({tempos:[]}),score({tempos:[{beat:1,bpm:120}]}),score({tempos:[{beat:0,bpm:0}]}),
    score({tempos:[{beat:0,bpm:120},{beat:0,bpm:90}]}),score({tempos:[{beat:NaN,bpm:120}]}),
    score({notes:[{...beatNote,beat:-1}]}),score({notes:[{...beatNote,duration:0}]}),score({notes:[{...beatNote,time:1}]}),
    score({notes:[{...beatNote,voice:''}]}),score({rests:{}}),score({rests:[{beat:0,duration:1}]}),
    score({rests:[{beat:0,duration:1,hand:'right',voice:''}]}),score({tempos:[{beat:0,bpm:1e-300}],notes:[{...beatNote,duration:1e308}]}),
    null,[],{},[{},note]];
  for(const input of invalid)assert.throws(()=>normalizePerformance(input));
});

test('混在譜面の全保持指がタイ境界・テンポ変更・声部の打鍵に影響されず接触を保つ',()=>{
  const notes=validate(tiedScore),plans=heldPlansFor(notes);preparePerformance(notes);
  assert.equal(plans.left.length,4);assert.equal(plans.right.length,5);
  for(let t=.88;t<15;t+=.0091)for(const hand of ['left','right'] as const) {
    const frame=evaluate(notes,t,'scale','connected','smooth',true)[hand];
    const drops=new Map(frame.activeNotes.map((n,i)=>[n.midiNote,(frame.depths?.[i]??frame.depth)*TRAVEL]));
    for(const f of fingers) {
      const points=pointsForPose(hand,f,frame.joints[f]).map(v=>handPointWorld(frame.position,frame.rotation,v));
      if(frame.technique)assert.ok(clearsBlackKeys(points,new Set(),0,drops));
      for(let i=0;i<2;i++)assert.ok(Math.abs(Math.hypot(...points[i+1].map((v,j)=>v-points[i][j]))-specs[f].lengths[i])<1e-9);
    }
    for(const [i,n] of frame.activeNotes.entries())if(t>=n.time&&t<n.time+n.duration) {
      const tip=handPointWorld(frame.position,frame.rotation,pointsForPose(hand,n.finger,frame.joints[n.finger])[2]);
      tip.forEach((v,j)=>assert.ok(Math.abs(v-frame.targets[i][j]+(j===1?keyDepth(frame,n.midiNote)*TRAVEL:0))<1e-9));
    }
  }
  const data=normalizePerformance(tiedScore);
  for(const t of data.sources.filter(n=>n.tie==='continue'||n.tie==='stop').map(n=>n.time)) {
    const n=data.sources.find(n=>n.time===t&&(n.tie==='continue'||n.tie==='stop'))!;
    assert.equal(keyDepth(evaluate(notes,t)[n.hand],n.midiNote),1);
  }
});

test('150BPMの音列では離鍵済みの指と後の準備が交差する区間に空中時間を確保する',()=>{
  const notes=validate(tiedScore),p=heldPlansFor(notes).right.find(p=>p.events[0].note.time>11&&p.events[0].note.time<12)!;
  let count=0;
  for(const a of p.events)for(const b of p.events)if(a.note.finger===2&&b.note.finger===1&&
    b.note.time>a.note.time+a.note.duration&&b.note.midiNote>a.note.midiNote) {
    assert.ok(a.note.time+a.note.duration+a.release<b.note.time-b.approach);count++;
  }
  assert.ok(count>0);
  for(const e of p.events) {
    const source=normalizePerformance(tiedScore).sources.find(n=>n.time===e.note.time&&n.hand==='right')!;
    assert.equal(e.note.duration,source.duration);
  }
});

test('入力順・正規化後の秒入力・逆シークでも混在譜面の姿勢と深さを再現する',()=>{
  const data=normalizePerformance(tiedScore),notes=validate(data.notes),direct=validate(tiedScore);
  const shuffled=validate({...tiedScore,notes:[...tiedScore.notes].reverse(),tempos:[...tiedScore.tempos].reverse()});
  for(const t of [1.6,2,3,5.9,6.4,8.7,10.333333333333334,11.6,12.3,13.9,15.3]) {
    const expected=evaluate(notes,t);evaluate(notes,0);evaluate(notes,20);assert.deepEqual(evaluate(notes,t),expected);
    assert.deepEqual(evaluate(direct,t),expected);
    const reversed=evaluate(shuffled,t);
    for(const hand of ['left','right'] as const) {
      expected[hand].position.forEach((v,i)=>assert.ok(Math.abs(v-reversed[hand].position[i])<1e-9));
      for(const f of fingers)for(const field of ['spread','proximal','distal','opposition'] as const)
        assert.ok(Math.abs((expected[hand].joints[f][field]??0)-(reversed[hand].joints[f][field]??0))<1e-9);
      for(const key of keys)assert.equal(keyDepth(expected[hand],key.midiNote),keyDepth(reversed[hand],key.midiNote));
    }
  }
});
