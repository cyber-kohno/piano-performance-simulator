<script lang="ts">
  import { onMount } from 'svelte';
  import basic from './data/basic.json';
  import black from './data/black-keys.json';
  import fullRange from './data/full-range.json';
  import both from './data/both-hands.json';
  import dyads from './data/dyads.json';
  import movement from './data/movement.json';
  import scaleRight from './data/scale-sixteenths-120-right.json';
  import scaleBoth from './data/scale-sixteenths-120-both.json';
  import { fingers, spreadLimits } from './fingers';
  import type { Hand } from './fingers';
  import type { MotionStyle } from './movement';
  import { evaluate, validate, lengthOf } from './motion';
  import { createScene } from './scene';
  let container: HTMLDivElement;
  let detailContainer: HTMLDivElement;
  let scene: ReturnType<typeof createScene> | undefined;
  let notes = $state(validate(scaleRight));
  let time = $state(0);
  let playing = $state(false);
  let speed = $state(1);
  let debug = $state(true);
  let scenario = $state('scale-right');
  let motionStyle = $state<MotionStyle>('smooth');
  let showForearms = $state(true);
  const phaseLabels={waiting:'待機',travel:'移動・準備',approach:'接近',press:'押鍵・保持',release:'離鍵'};
  let manual = $state(false);
  let manualHand = $state<Hand>('right');
  let manualAngles = $state<Record<Hand,number[]>>({left:[0,0,0,0,0],right:[0,0,0,0,0]});
  let showDetail = $state(true);
  let error = $state('');
  let fatal = $state('');
  const duration = $derived(lengthOf(notes));
  const frame = $derived(evaluate(manual?[]:notes,time,motionStyle));
  function load(value:unknown) {
    try { const next=validate(value); notes=next; time=0; playing=false; manual=false;error=''; }
    catch(e) {error=e instanceof Error ? e.message : String(e);}
  }
  function changeScenario() { load(scenario === 'basic' ? basic : scenario === 'black' ? black : scenario==='full' ? fullRange : scenario==='both'?both:scenario==='dyads'?dyads:scenario==='scale-right'?scaleRight:scenario==='scale-both'?scaleBoth:movement); }
  async function importJson(event:Event) {
    const input=event.currentTarget as HTMLInputElement;
    const file=input.files?.[0]; if (!file) return;
    try {load(JSON.parse(await file.text()));} catch {error='JSONを読み取れませんでした。';}
    input.value='';
  }
  function toggle() {if(time>=duration)time=0; playing=!playing;}
  onMount(() => {
    try { scene=createScene(container,detailContainer); } catch(e) {fatal=`3D描画を開始できません: ${String(e)}`; return;}
    let last=performance.now(), id=0;
    function tick(now:number) {
      if (playing) {time=Math.min(duration,time+(now-last)/1000*speed); if(time>=duration)playing=false;}
      last=now; scene!.draw(notes,time,debug,manual?manualAngles:undefined,motionStyle,showForearms); id=requestAnimationFrame(tick);
    }
    id=requestAnimationFrame(tick);
    return () => {cancelAnimationFrame(id); scene?.dispose();};
  });
</script>

<svelte:head><meta name="description" content="両手と簡易関節による指の押鍵を確認する、ピアノ演奏動作の検証アプリ"/></svelte:head>
<main>
  <header><div><p class="eyebrow">PIANO PERFORMANCE / EXPERIMENT 04</p><h1>Motion Lab <span>3D検証</span></h1></div><span class="badge">88鍵 · 移動の自然さ · 前腕</span></header>
  <div class="layout">
    <div class="stage">
    <section class="preview" aria-label="3Dプレビュー">
      <div class="viewport" bind:this={container}></div>
      <div class="view-tools"><button onclick={()=>scene?.view(false)}>斜め上（全鍵）</button><button onclick={()=>scene?.view(true)}>真上（全鍵）</button></div>
      <p class="hint">A0〜C8 / 88鍵 · ドラッグで回転 · ホイールで拡大 · ボタンで全鍵表示に戻る</p>
      {#if fatal}<p class="fatal" role="alert">{fatal}</p>{/if}
    </section>
    <section class="detail-panel" class:collapsed={!showDetail} aria-label="左右の手元拡大">
      <div class="detail-labels"><span>左手 · 接触と指の曲げ</span><span>右手 · 接触と指の曲げ</span></div>
      <div class="detail-viewport" bind:this={detailContainer}></div>
    </section>
    </div>
    <aside>
      <p class="eyebrow">PLAYBACK</p><h2>動きを観察する</h2>
      <label>検証シナリオ<select bind:value={scenario} onchange={changeScenario}><option value="scale-right">07 — 右手音階・16分 / BPM120</option><option value="scale-both">08 — 両手音階・16分 / BPM120</option><option value="movement">06 — 近接・跳躍・和音切替</option><option value="dyads">05 — 指の開閉・白鍵2音和音</option><option value="both">04 — 両手・左手保持と右手旋律</option><option value="basic">01 — C4 → D4 → E4</option><option value="black">02 — 白鍵と黒鍵</option><option value="full">03 — 88鍵の両端と中央</option></select></label>
      {#if scenario==='scale-right'||scenario==='scale-both'}<p class="manual-hint">ハ長調1オクターブ往復。16分音符＝125ms、押鍵75ms・音間50msの非レガート検証です。0.5×でBPM60相当。指くぐりは手全体の移動による近似です。</p>{/if}
      <label>移動の比較<select bind:value={motionStyle}><option value="smooth">加減速・持ち上げ・手首あり</option><option value="linear">従来の直線・一定速度</option></select></label>
      <div class="buttons"><button class="primary" onclick={toggle} disabled={!!fatal||manual}>{playing?'一時停止':'再生'}</button><button onclick={()=>{playing=false;time=0;}}>停止・先頭</button></div>
      <label for="timeline">再生位置 <span>{time.toFixed(2)} / {duration.toFixed(2)} s</span></label>
      <input id="timeline" type="range" min="0" max={duration} step="0.001" bind:value={time} disabled={manual}/>
      <div class="buttons"><button onclick={()=>{playing=false;time=Math.max(0,time-1/60);}}>−1コマ</button><button onclick={()=>{playing=false;time=Math.min(duration,time+1/60);}}>＋1コマ</button></div>
      <label>再生速度<select bind:value={speed}><option value={0.25}>0.25×</option><option value={0.5}>0.5×</option><option value={1}>1×</option></select></label>
      <label class="check"><input type="checkbox" bind:checked={debug}/> 指先・接触点を表示</label>
      <label class="check"><input type="checkbox" bind:checked={showDetail}/> 左右の手元を拡大表示</label>
      <label class="check"><input type="checkbox" bind:checked={showForearms}/> 前腕を表示</label>
      <div class="readout">{#each ['left','right'] as side}{@const pose=side==='left'?frame.left:frame.right}<span>{side==='left'?'左手（青）':'右手（肌色）'} / {phaseLabels[pose.phase]}</span><strong>{pose.activeNotes.length ? `${pose.activeNotes.map(n=>`${n.midiNote} (指${n.finger})`).join(' + ')} / ${(pose.depth*100).toFixed(0)}%` : manual?'手動開閉の確認中':pose.phase==='travel'?`持ち上げ ${(pose.lift*1000).toFixed(0)} mm`:'待機中'}</strong>{/each}</div>
      <div class="manual-panel">
        <label class="check"><input type="checkbox" bind:checked={manual} onchange={()=>{playing=false;time=0;}}/> 手動で指の開閉を確認</label>
        {#if manual}
          <label>調整する手<select bind:value={manualHand}><option value="right">右手</option><option value="left">左手</option></select></label>
          <p class="manual-hint">演奏を停止して付け根の開き角を調整します。左右とも＋で親指側、−で小指側へ動きます。</p>
          {#each fingers as finger}
            <label for={`spread-${finger}`}>指{finger}{finger===1?'（親指）':''}<span>{manualAngles[manualHand][finger-1].toFixed(0)}°</span></label>
            <input id={`spread-${finger}`} type="range" min={Math.ceil(spreadLimits(finger)[0]*180/Math.PI)} max={Math.floor(spreadLimits(finger)[1]*180/Math.PI)} step="1" bind:value={manualAngles[manualHand][finger-1]}/>
          {/each}
          <button onclick={()=>{manualAngles={left:[0,0,0,0,0],right:[0,0,0,0,0]};}}>左右の開き角をリセット</button>
        {/if}
      </div>
      <label class="file">静的JSONを読み込む<input type="file" accept=".json,application/json" onchange={importJson}/></label>
      {#if error}<p role="alert" class="error">{error}</p>{/if}
    </aside>
  </div>
  <section class="bottom"><div><p class="eyebrow">NOTE ACTIONS</p><h2>入力と現在の動作</h2><table><thead><tr><th>開始 s</th><th>保持 s</th><th>MIDI</th><th>手 / 指</th></tr></thead><tbody>{#each notes as note}<tr class:active={frame.left.activeNotes.includes(note)||frame.right.activeNotes.includes(note)}><td>{note.time.toFixed(3)}</td><td>{note.duration.toFixed(3)}</td><td>{note.midiNote}</td><td>{note.hand==='left'?'左':'右'} / {note.finger}</td></tr>{/each}</tbody></table></div><div class="notes"><h2>この試作の前提</h2><p>離鍵を終えてから手を持ち上げ、加減速しながら次の音へ移動します。指の準備は到着前に完了。移動中だけ手首を傾け、接近前に戻すため、保持中の指先位置と押鍵時刻は従来どおりです。</p><p>「移動の比較」は同じ再生時刻で切替できます。前腕は手首に追従する一定長の簡易表示です。肘の位置は身体側の目安から求め、上腕・人体の可動域は未検証です。</p><p>単音と白鍵2音の同時押鍵・同時離鍵に対応。3音以上・黒鍵和音・音声・衝突回避は次段階です。持ち上げ軌道でも、他の指や手同士の干渉は保証しません。</p></div></section>
</main>
