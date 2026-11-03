import type { Note } from './motion';
import type { Hand } from './fingers';
import { keys } from './keyboard';

export type Tie='start'|'continue'|'stop';
export type SourceNote=Note&{tie?:Tie};
export type Tempo={beat:number;bpm:number;time:number};
export type Rest={time:number;duration:number;hand:Hand;voice?:string};
export type NormalizedPerformance={notes:Note[];sources:SourceNote[];origins:number[][];tempos:Tempo[];rests:Rest[];tieChains:number;format:'seconds'|'beats'};
const validHand=(value:unknown):value is Hand=>value==='left'||value==='right';
const validVoice=(v:unknown)=>v===undefined||typeof v==='string'&&v.trim().length>0;
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const identity=(n:{hand:Hand;voice?:string;midiNote:number})=>JSON.stringify([n.hand,n.voice??'',n.midiNote]);

function sourceNote(value:unknown,index:number):SourceNote {
  const n=value as Partial<SourceNote>|null;
  if(!n||!finite(n.time)||n.time<0.12||!finite(n.duration)||n.duration<=0||!finite(n.time+n.duration)||
    !validHand(n.hand)||!Number.isInteger(n.finger)||n.finger!<1||n.finger!>5||!keys.some(k=>k.midiNote===n.midiNote)||
    !validVoice(n.voice)||n.action!==undefined&&n.action!=='substitute'||n.tie!==undefined&&!['start','continue','stop'].includes(n.tie))
    throw new Error(`音符${index+1}: time ≥ 0.12、duration > 0、handはleft/right、指1〜5・MIDI21〜108が必要です。voiceは空でない文字列、actionはsubstitute、tieはstart/continue/stopか省略です。`);
  return {time:n.time,duration:n.duration,midiNote:n.midiNote!,hand:n.hand,finger:n.finger!,
    ...(n.voice===undefined?{}:{voice:n.voice}),...(n.action?{action:n.action}:{}),...(n.tie?{tie:n.tie}:{})};
}

// Quarter-note beats -> seconds. Integrating the tempo map at both endpoints
// handles changes during a held note, a tie segment, or a rest.
function beatInput(input:Record<string,unknown>):{sources:unknown[];tempos:Tempo[];rests:Rest[]} {
  if(input.version!==1||input.timeUnit!=='beats'||!Array.isArray(input.notes)||!input.notes.length)
    throw new Error('拍入力はversion:1、timeUnit:"beats"と、空でないnotes配列が必要です。');
  const leadIn=input.leadIn===undefined?1:input.leadIn;
  if(!finite(leadIn)||leadIn<0.12)throw new Error('leadInは0.12秒以上の有限値にしてください。');
  const raw=input.tempos===undefined?[{beat:0,bpm:120}]:input.tempos;
  if(!Array.isArray(raw)||!raw.length)throw new Error('temposは拍0から始まるテンポ配列が必要です。');
  const tempos:Tempo[]=raw.map((value,index)=>{
    if(!value||!finite(value.beat)||value.beat<0||!finite(value.bpm)||value.bpm<=0)
      throw new Error(`テンポ${index+1}: beat ≥ 0、bpm > 0の有限値が必要です。`);
    return {beat:value.beat,bpm:value.bpm,time:0};
  }).sort((a,b)=>a.beat-b.beat);
  if(tempos[0].beat!==0)throw new Error('最初のテンポはbeat:0にしてください。');
  for(let i=0;i<tempos.length;i++) {
    if(i&&tempos[i].beat===tempos[i-1].beat)throw new Error('同じ拍に複数のテンポを指定できません。');
    tempos[i].time=i?tempos[i-1].time+(tempos[i].beat-tempos[i-1].beat)*60/tempos[i-1].bpm:leadIn;
    if(!finite(tempos[i].time))throw new Error('テンポ変換後の時刻が有限範囲を超えています。');
  }
  const at=(beat:number)=>{
    let lo=0,hi=tempos.length;
    while(lo+1<hi){const mid=(lo+hi)>>1;if(tempos[mid].beat<=beat)lo=mid;else hi=mid;}
    const t=tempos[lo];return t.time+(beat-t.beat)*60/t.bpm;
  };
  const timing=(n:{beat?:unknown;duration?:unknown},label:string)=>{
    if(!n||!finite(n.beat)||n.beat<0||!finite(n.duration)||n.duration<=0||!finite(n.beat+n.duration))
      throw new Error(`${label}: beat ≥ 0、duration > 0の有限値が必要です。`);
    const time=at(n.beat),duration=at(n.beat+n.duration)-time;
    if(!finite(time)||!finite(duration)||duration<=0)throw new Error(`${label}: 秒へ変換できない時刻・長さです。`);
    return {time,duration};
  };
  const sources=input.notes.map((n,index)=>{
    if(n?.time!==undefined)throw new Error(`音符${index+1}: 拍入力に秒のtimeを混在させないでください。`);
    return {...n,...timing(n,`音符${index+1}`)};
  });
  if(input.rests!==undefined&&!Array.isArray(input.rests))throw new Error('restsは配列にしてください。');
  const rests:Rest[]=((input.rests??[]) as Record<string,unknown>[]).map((r,index)=>{
    if(!r||!validHand(r.hand)||!validVoice(r.voice))throw new Error(`休符${index+1}: handと有効なvoiceが必要です。`);
    return {...timing(r,`休符${index+1}`),hand:r.hand,...(r.voice===undefined?{}:{voice:r.voice as string})};
  });
  return {sources,tempos,rests};
}

export function normalizePerformance(input:unknown):NormalizedPerformance {
  let raw:unknown[],tempos:Tempo[]=[],rests:Rest[]=[],format:'seconds'|'beats'='seconds';
  if(Array.isArray(input))raw=input;
  else if(input&&typeof input==='object') {
    ({sources:raw,tempos,rests}=beatInput(input as Record<string,unknown>));format='beats';
  } else throw new Error('秒単位の音符配列、または拍単位の譜面オブジェクトが必要です。');
  if(!raw.length)throw new Error('音符の配列が必要です。');
  const sources=raw.map(sourceNote),notes:Note[]=[],origins:number[][]=[];
  const open=new Map<string,{index:number;last:SourceNote}>();
  let tieChains=0;
  for(const {n,source} of sources.map((n,source)=>({n,source})).sort((a,b)=>a.n.time-b.n.time)) {
    const key=identity(n),chain=open.get(key);
    if(n.tie==='continue'||n.tie==='stop') {
      if(!chain)throw new Error(`音符${source+1}: 同じ手・声部・音程で始まるタイがありません。`);
      if(n.finger!==chain.last.finger||n.action!==undefined)throw new Error(`音符${source+1}: タイの途中で指や奏法を変えられません。指替えは別の音として明示してください。`);
      if(Math.abs(n.time-chain.last.time-chain.last.duration)>1e-9)throw new Error(`音符${source+1}: タイの音符は休符や重複なしで連続させてください。`);
      const first=notes[chain.index];first.duration=n.time+n.duration-first.time;
      if(!finite(first.duration)||first.duration<=0)throw new Error(`音符${source+1}: タイの合計長を扱えません。`);
      origins[chain.index].push(source);chain.last=n;
      if(n.tie==='stop')open.delete(key);
      continue;
    }
    if(chain)throw new Error(`音符${source+1}: 同じ音のタイが終わっていません。`);
    const {tie:_,...note}=n;
    const index=notes.push({...note})-1;origins.push([source]);
    if(n.tie==='start'){open.set(key,{index,last:n});tieChains++;}
  }
  if(open.size)throw new Error('stopで閉じられていないタイがあります。');
  for(const rest of rests)for(const n of sources)if(rest.hand===n.hand&&(rest.voice??'')===(n.voice??'')&&
    Math.max(rest.time,n.time)<Math.min(rest.time+rest.duration,n.time+n.duration)-1e-9)
    throw new Error(`${rest.hand==='left'?'左手':'右手'}・声部${rest.voice??'既定'}: 休符と音符が重なっています。`);
  return {notes,sources,origins,tempos,rests,tieChains,format};
}

export function tempoAt(tempos:Tempo[],time:number):number|undefined {
  if(!tempos.length)return;
  for(let i=tempos.length-1;i>=0;i--)if(tempos[i].time<=time)return tempos[i].bpm;
  return tempos[0].bpm;
}

export const inputLength=(input:NormalizedPerformance)=>Math.max(...input.notes.map(n=>n.time+n.duration),...input.rests.map(r=>r.time+r.duration))+0.62;
