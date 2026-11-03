<script lang="ts">
  import { onMount, tick } from 'svelte';
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
  import tiedScore from './data/tied-score.json';
  import { normalizePerformance, inputLength, tempoAt } from './score-input';
  import { fingers, spreadLimits } from './fingers';
  import type { Hand } from './fingers';
  import type { MotionStyle } from './movement';
  import { evaluate, validate, lengthOf, performancePlanFor, preparePerformance, heldPlansFor } from './motion';
  import { createScene } from './scene';
  let container: HTMLDivElement;
  let detailContainer: HTMLDivElement;
  let scene: ReturnType<typeof createScene> | undefined;
  // Validated note arrays are immutable cache keys. Keep their identity when
  // assigning UI state so rendering reuses the preparation done during load.
  const initialInput=normalizePerformance(scaleRight);
  let notes = $state.raw(validate(initialInput.notes));
  let inputInfo = $state.raw(initialInput);
  let preparationMs = $state<number|undefined>();
  let time = $state(0);
  let playing = $state(false);
  let speed = $state(1);
  let debug = $state(true);
  let scenario = $state('scale-right');
  let motionStyle = $state<MotionStyle>('scale');
  let connectIdleFingers = $state(true);
  let smoothStrike = $state(true);
  let moveWrist = $state(true);
  let showForearms = $state(true);
  const phaseLabels={waiting:'待機',travel:'移動・準備',approach:'接近',press:'押鍵・保持',release:'離鍵'};
  let manual = $state(false);
  let manualHand = $state<Hand>('right');
  let manualAngles = $state<Record<Hand,number[]>>({left:[0,0,0,0,0],right:[0,0,0,0,0]});
  let showDetail = $state(true);
  let error = $state('');
  let fatal = $state('');
  let loading = $state(false);
  const duration = $derived(Math.max(lengthOf(notes),inputLength(inputInfo)));
  const scoreTempo = $derived(tempoAt(inputInfo.tempos,time));
  const motionPlan = $derived(performancePlanFor(notes));
  const heldPlans = $derived(heldPlansFor(notes));
  const frame = $derived(evaluate(manual?[]:notes,time,motionStyle,connectIdleFingers?'connected':'reset',smoothStrike?'smooth':'legacy',moveWrist));
  async function load(value:unknown) {
    if(loading)return;
    loading=true;playing=false;
    await tick();
    // Show preparation feedback before the bounded geometric search starts.
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    try { const started=performance.now(),normalized=normalizePerformance(value),next=validate(normalized.notes); preparePerformance(next);
      preparationMs=performance.now()-started; inputInfo=normalized; notes=next; time=0; playing=false; manual=false;error=''; }
    catch(e) {error=e instanceof Error ? e.message : String(e);}
    finally {loading=false;}
  }
  async function changeScenario() {
    await load(scenario === 'basic' ? basic : scenario === 'black' ? black : scenario==='full' ? fullRange : scenario==='both'?both:scenario==='dyads'?dyads:scenario==='scale-right'?scaleRight:scenario==='scale-both'?scaleBoth:scenario==='scale-crossing'?scaleCrossing:scenario==='mixed'?mixedPhrases:scenario==='white-chords'?whiteChords:scenario==='mixed-key-chords'?mixedKeyChords:scenario==='mixed-key-scales'?mixedKeyScales:scenario==='held-legato'?heldLegato:scenario==='held-travel'?heldTravel:scenario==='legato-crossings'?legatoCrossings:scenario==='tied-score'?tiedScore:movement);
    if(scenario==='scale-crossing'){speed=0.25;motionStyle='scale';}
    if(['mixed','white-chords','mixed-key-chords','mixed-key-scales','held-legato','held-travel','legato-crossings','tied-score'].includes(scenario)){speed=0.5;motionStyle='scale';}
  }
  async function importJson(event:Event) {
    const input=event.currentTarget as HTMLInputElement;
    const file=input.files?.[0]; if (!file) return;
    try {await load(JSON.parse(await file.text()));} catch {error='JSONを読み取れませんでした。';}
    input.value='';
  }
  function toggle() {if(time>=duration)time=0; playing=!playing;}
  onMount(() => {
    try { scene=createScene(container,detailContainer); } catch(e) {fatal=`3D描画を開始できません: ${String(e)}`; return;}
    let last=performance.now(), id=0;
    function tick(now:number) {
      if (playing) {time=Math.min(duration,time+(now-last)/1000*speed); if(time>=duration)playing=false;}
      last=now; scene!.draw(notes,time,debug,manual?manualAngles:undefined,motionStyle,showForearms,connectIdleFingers?'connected':'reset',smoothStrike?'smooth':'legacy',moveWrist); id=requestAnimationFrame(tick);
    }
    id=requestAnimationFrame(tick);
    return () => {cancelAnimationFrame(id); scene?.dispose();};
  });
</script>

<svelte:head><meta name="description" content="両手と簡易関節による指の押鍵を確認する、ピアノ演奏動作の検証アプリ"/></svelte:head>
<main>
  <header><div><p class="eyebrow">PIANO PERFORMANCE / MOTION LAB</p><h1>Motion Lab <span>3D検証</span></h1></div><span class="badge">88鍵 · 両手 · 区間ごとの動作</span></header>
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
      {#if loading}<p class="manual-hint" role="status">演奏の準備中…</p>{/if}
      <label>検証シナリオ<select bind:value={scenario} onchange={changeScenario} disabled={loading}><option value="tied-score">17 — タイ・複数声部・休符・テンポ変化</option><option value="legato-crossings">16 — レガートの持ち替え・押したままの指替え</option><option value="held-travel">15 — 保持しながら掌移動・指の別鍵移動</option><option value="held-legato">14 — 保持音・5指レガート・部分離鍵</option><option value="mixed-key-scales">13 — 白黒音階・3↔1／4↔1の持ち替え</option><option value="mixed-key-chords">12 — 白黒混在和音・黒鍵5音</option><option value="white-chords">11 — 三和音・転回形・四和音・5指</option><option value="mixed">10 — 両手音階・和音・黒鍵・跳躍の混在</option><option value="scale-right">07 — 右手音階・16分 / BPM120</option><option value="scale-both">08 — 両手音階・16分 / BPM120</option><option value="scale-crossing">09 — ドレミファ往復・持ち替え確認</option><option value="movement">06 — 近接・跳躍・和音切替</option><option value="dyads">05 — 指の開閉・白鍵2音和音</option><option value="both">04 — 両手・左手保持と右手旋律</option><option value="basic">01 — C4 → D4 → E4</option><option value="black">02 — 白鍵と黒鍵</option><option value="full">03 — 88鍵の両端と中央</option></select></label>
      {#if scenario==='scale-right'||scenario==='scale-both'}<p class="manual-hint">ハ長調1オクターブ往復。16分音符＝125ms、押鍵75ms・音間50msの非レガート検証です。0.5×でBPM60相当。両手の白鍵音階で持ち替えを計算します。</p>{/if}
      {#if scenario==='scale-crossing'}<p class="manual-hint">ドレミファミレド。選択時は0.25×。ミ→ファの親指の準備と、ファ→ミの中指の移動を右手拡大で確認できます。</p>{/if}
      {#if scenario==='mixed'}<p class="manual-hint">両手の音階→2音和音→黒鍵単音→跳躍→別音域の音階。選択時は0.5×。和音や跳躍を挟んでも、前後の音階では持ち替え動作に戻ります。</p>{/if}
      {#if scenario==='white-chords'}<p class="manual-hint">両手音階→三和音と転回形→四和音→5指の同時押鍵→単音→音階。選択時は0.5×。黄色の接触点が、和音のすべての指先と重なることを確認できます。同時押鍵・同時離鍵の白鍵和音に対応します。</p>{/if}
      {#if scenario==='mixed-key-chords'}<p class="manual-hint">両手音階→白黒混在の三和音・四和音・5指→黒鍵5音→白鍵和音→黒鍵単音→音階。選択時は0.5×。手を奥へ入れる動きと、白鍵・黒鍵それぞれの高さでの接触を確認できます。</p>{/if}
      {#if scenario==='tied-score'}<p class="manual-hint">拍単位の53音符を、3本のタイを結合した48件の演奏イベントへ変換。120→90→150→120 BPM。左右それぞれの保持音と旋律、黒鍵の指替え、休符、終わりの休みを確認できます。選択時0.5×。タイの境界では鍵を戻さず、指替えや同音反復と区別します。</p>{/if}
      {#if scenario==='legato-crossings'}<p class="manual-hint">3↔1・4↔1の往復レガート、黒鍵を含む持ち替え、白鍵・黒鍵の指替え、通常の同音反復、音階。選択時0.5×。指替えでは鍵を戻さず、別の指へ接触を引き継ぎます。表の「奏法」で同音反復と区別します。</p>{/if}
      {#if scenario==='held-travel'}<p class="manual-hint">中指を保持して親指をド→レ→ド、黒鍵の親指移動、小指をソ→シ→ラ、部分離鍵、音階。選択時0.5×。保持指の接触点を保ったまま掌を運び、離鍵した指を次の鍵へ移します。指が交差しない運指を中心に掌移動を確認できます。レガートの持ち替え・指替えは16で確認します。</p>{/if}
      {#if scenario==='held-legato'}<p class="manual-hint">保持音付き旋律→5指のレガート→白黒和音の部分離鍵→保持中の再打鍵→音階。選択時0.5×。共通の掌位置から届く範囲で、各指を独立に押鍵・離鍵します。持ち替えを含むレガートは後続の対象です。</p>{/if}
      {#if scenario==='mixed-key-scales'}<p class="manual-hint">ト長調→和音→ヘ長調→和音→ロ長調の両手音階。250ms間隔・押鍵120msの非レガート、選択時は0.5×。ヘ長調の右手とロ長調の左手で、薬指と親指の持ち替えも確認できます。</p>{/if}
      <p class="manual-hint">入力 {inputInfo.sources.length}音符 → 演奏 {notes.length}音符 / タイ {inputInfo.tieChains}本 / 休符 {inputInfo.rests.length}個{#if scoreTempo!==undefined} / 譜面テンポ {scoreTempo} BPM{/if}{#if preparationMs!==undefined} / 準備 {preparationMs.toFixed(0)} ms{/if}</p>
      <label>移動の比較<select bind:value={motionStyle}><option value="scale">区間ごとの動作計画（両手）</option><option value="smooth">従来の加減速・持ち上げ・手首</option><option value="linear">従来の直線・一定速度</option></select></label>
      {#if motionStyle==='scale'}<p class="manual-hint">両手の音階を音程と指順から見つけ、指くぐり・指またぎを計算します。和音や対応外の並びは基本動作でつなぎます。接触点の奥行きは方式ごとに異なります。</p>
        <p class="manual-hint">音階の計画：左手 {motionPlan.left.length}区間 / 右手 {motionPlan.right.length}区間</p>{/if}
      {#if motionStyle==='scale'}
        <label class="check"><input type="checkbox" bind:checked={moveWrist} disabled={manual||loading}/> 手首・前腕を持ち替えに連動</label>
        <p class="manual-hint">両手の音階区間の持ち替え前後で手首を小さく傾け、前腕も追従します。指先と鍵盤の接触は共通です。オフで前回の姿勢と比較できます。</p>
        <label class="check"><input type="checkbox" bind:checked={smoothStrike} disabled={manual}/> 打鍵に加減速をつける</label>
        <p class="manual-hint">オン：押鍵・離鍵・接近を滑らかにし、短い音間を離鍵と次の接近に配分。オフ：前回の打鍵。押鍵開始・離鍵開始の時刻は共通です。</p>
        <label class="check"><input type="checkbox" bind:checked={connectIdleFingers} disabled={manual}/> 非演奏指を次の音へつなぐ</label>
        <p class="manual-hint">オン：すぐ使う指は次の準備へ、ほかの指は軽く曲げて待機。オフ：従来どおり毎回基本姿勢へ戻します。両手の音階区間に適用します。</p>
      {/if}
      {#if heldPlans.left.length||heldPlans.right.length}<p class="manual-hint">保持区間の計画：左手 {heldPlans.left.length}区間 / 右手 {heldPlans.right.length}区間。うち掌移動：左手 {heldPlans.left.filter(p=>p.path).length}区間 / 右手 {heldPlans.right.filter(p=>p.path).length}区間。保持区間は各指の加減速打鍵を使い、比較チェックは音階区間に適用します。</p>{/if}
      <div class="buttons"><button class="primary" onclick={toggle} disabled={!!fatal||manual||loading}>{playing?'一時停止':'再生'}</button><button disabled={loading} onclick={()=>{playing=false;time=0;}}>停止・先頭</button></div>
      <label for="timeline">再生位置 <span>{time.toFixed(2)} / {duration.toFixed(2)} s</span></label>
      <input id="timeline" type="range" min="0" max={duration} step="0.001" bind:value={time} disabled={manual}/>
      <div class="buttons"><button onclick={()=>{playing=false;time=Math.max(0,time-1/60);}}>−1コマ</button><button onclick={()=>{playing=false;time=Math.min(duration,time+1/60);}}>＋1コマ</button></div>
      <label>再生速度<select bind:value={speed}><option value={0.25}>0.25×</option><option value={0.5}>0.5×</option><option value={1}>1×</option></select></label>
      <label class="check"><input type="checkbox" bind:checked={debug}/> 指先・接触点を表示</label>
      <label class="check"><input type="checkbox" bind:checked={showDetail}/> 左右の手元を拡大表示</label>
      <label class="check"><input type="checkbox" bind:checked={showForearms}/> 前腕を表示</label>
      <div class="readout">{#each ['left','right'] as side}{@const pose=side==='left'?frame.left:frame.right}<span>{side==='left'?'左手（青）':'右手（肌色）'} / {phaseLabels[pose.phase]}</span><strong>{pose.activeNotes.length ? `${pose.activeNotes.map((n,i)=>`${n.midiNote} (指${n.finger})${pose.depths?` ${(pose.depths[i]*100).toFixed(0)}%`:""}`).join(' + ')}${pose.depths?"":` / ${(pose.depth*100).toFixed(0)}%`}` : manual?'手動開閉の確認中':pose.phase==='travel'?`持ち上げ ${(pose.lift*1000).toFixed(0)} mm`:'待機中'}</strong>{/each}</div>
      {#if motionStyle==='scale'&&!manual}{#each ['left','right'] as side}{@const pose=side==='left'?frame.left:frame.right}
        <p class="manual-hint">{side==='left'?'左手':'右手'}：{pose.technique==='thumb-under'?'親指を内側へ準備・持ち替え':pose.technique==='finger-over'?'次の指を準備・指またぎ':pose.technique==='substitution'?'鍵を保持したまま指替え':pose.technique==='legato-crossing'?'レガートの指くぐり・指またぎ':pose.technique==='held-travel'?'保持を保って掌を移動':pose.technique==='held'?'保持・各指の独立した打鍵':pose.technique==='scale'?'音階の連続移動':'基本動作・待機'}</p>
        {#if pose.technique&&pose.technique!=='held'&&pose.technique!=='held-travel'&&pose.technique!=='legato-crossing'&&pose.technique!=='substitution'}<p class="manual-hint">打鍵：{pose.strikeStyle==='smooth'?'加減速あり':smoothStrike?'従来（この区間では加減速を適用できません）':'従来'} / 手首・前腕：{pose.wristMotion?'持ち替えに連動':moveWrist?'固定（この区間では連動を適用できません）':'固定'}</p>{/if}
      {/each}{/if}
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
      <label class="file">静的JSONを読み込む<input type="file" accept=".json,application/json" onchange={importJson} disabled={loading}/></label>
      {#if error}<p role="alert" class="error">{error}</p>{/if}
    </aside>
  </div>
  <section class="bottom"><div><p class="eyebrow">NOTE ACTIONS</p><h2>入力と現在の動作</h2><table><thead><tr><th>開始 s</th><th>保持 s</th><th>MIDI</th><th>手 / 指</th><th>声部 / 奏法</th></tr></thead><tbody>{#each notes as note,index}<tr class:active={frame.left.activeNotes.includes(note)||frame.right.activeNotes.includes(note)}><td>{note.time.toFixed(3)}</td><td>{note.duration.toFixed(3)}</td><td>{note.midiNote}</td><td>{note.hand==='left'?'左':'右'} / {note.finger}</td><td>{note.voice??'—'} / {note.action==='substitute'?'押したまま指替え':(inputInfo.origins[index]?.length??1)>1?`タイ ${(inputInfo.origins[index]?.length??1)}音符を保持`:'押鍵'}</td></tr>{/each}</tbody></table></div><div class="notes"><h2>この試作の前提</h2><p>音階の区間では、両手それぞれの移動と指の準備を計算します。白鍵方式は押鍵中も掌を進め、黒鍵を含む区間では接触を優先して音間で掌を運びます。音程と指順から親指を内側へ運ぶ動きや、中指／薬指への持ち替えを準備します。親指の付け根の移動と開き角による簡易表現で、人体の関節や衝突回避は未検証です。</p><p>「移動の比較」は同じ再生時刻で切替できます。従来方式も選択可能です。前腕は手首に追従する一定長の簡易表示で、上腕・人体の可動域は扱いません。</p><p>単音と白鍵・黒鍵を含む2〜5音和音に対応。保持区間では各指の接触を保ち、掌移動・離鍵した指の別鍵への移動・5指レガート・和音の部分離鍵を扱います。音階の持ち替えは半音・全音で進む3↔1・4↔1運指に対応し、レガートの持ち替えと明示した同一鍵の指替えにも対応します。拍入力はテンポを秒へ変換し、同じ手・指・声部・音程の明示したタイを結合します。人体の可動域・全面的な干渉回避・音声は未対応です。広い和音など、この簡易モデルで届かない配置は理由を表示します。</p></div></section>
</main>
