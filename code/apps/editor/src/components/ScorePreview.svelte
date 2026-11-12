<script lang="ts">
  import PreviewMusicXml from '../infra/musicxml/preview-musicxml.ts';
  import ScorePreviewRenderer from '../infra/notation/score-preview-renderer.ts';
  import type { ScoreProject } from '../domain/score/types.ts';

  let { playbackActive = false, getPlayingNoteIds = () => [], outline, activeIndex, trills, tempoChanges, clefChanges, slurs, dynamicChanges, selectedNoteIds = [] }: { playbackActive?: boolean; getPlayingNoteIds?: () => readonly string[]; outline: ScoreProject['outline']; activeIndex: number; trills?: ScoreProject['trills']; tempoChanges?: ScoreProject['tempoChanges']; clefChanges?: ScoreProject['clefChanges']; dynamicChanges?: ScoreProject['dynamicChanges']; slurs?: ScoreProject['slurs']; selectedNoteIds?: string[] } = $props();
  let host = $state<HTMLDivElement>();
  let message = $state<string | null>(null);
  let paintSelection = $state<((ids: readonly string[], color?: string) => void) | null>(null);
  $effect(() => {
    const painter = paintSelection;
    if (!playbackActive) { painter?.(selectedNoteIds); return; }
    if (!painter) return;
    const read = getPlayingNoteIds;
    let frame = 0;
    const update = () => { painter(read(), '#e65100'); frame = requestAnimationFrame(update); };
    update();
    return () => cancelAnimationFrame(frame);
  });
  $effect(() => {
    // Capture dependencies now, but defer preparation as well as rendering.
    // Held-key edits cancel the entire pending preview calculation.
    const target=host, score=outline, index=activeIndex, ornaments=trills,
      tempos=tempoChanges, clefs=clefChanges, curves=slurs, dynamics=dynamicChanges;
    paintSelection=null;
    if(!target)return;
    const controller=new AbortController();
    const timer=window.setTimeout(async()=>{
      try {
        const document=PreviewMusicXml.create(score,index,ornaments,tempos,clefs,curves,dynamics);
        if (!document) { target.replaceChildren(); message='No measures'; return; }
        const painter=await ScorePreviewRenderer.render(target,document,controller.signal);
        if(controller.signal.aborted)return;
        paintSelection=painter??null;
        message=null;
      } catch(error) {
        if(controller.signal.aborted)return;
        target.replaceChildren();
        message='Score preview unavailable';
        console.error('Score preview:',error);
      }
    },80);
    return ()=>{controller.abort();window.clearTimeout(timer);};
  });
</script>

<aside class="score-preview" aria-label="Score preview">
  <div class="preview-heading">Score preview <span>Measure {activeIndex >= 0 ? activeIndex + 1 : '—'}</span></div>
  <div class="preview-viewport">
    <div class="preview-render" bind:this={host}></div>
    {#if message}<div class="preview-message" role="status">{message}</div>{/if}
  </div>
</aside>

<style>
  .score-preview {
    grid-column: 2;
    grid-row: 2;
    position: relative;
    z-index: 40;
    align-self: start;
    justify-self: end;
    box-sizing: border-box;
    width: 480px;
    height: 240px;
    margin: 8px;
    overflow: hidden;
    border: 1px solid #899ca2;
    border-radius: 4px;
    background: #fffef8;
    pointer-events: none;
    opacity: 0.85;
  }
  .preview-heading {
    display: flex;
    justify-content: space-between;
    box-sizing: border-box;
    height: 26px;
    padding: 3px 8px;
    background: #edf2ef;
    color: #354c55;
    font-size: 12px;
    font-weight: 600;
    line-height: 20px;
  }
  .preview-viewport {
    position: relative;
    width: 478px;
    height: 212px;
    overflow: hidden;
  }
  .preview-render {
    width: 100%;
    height: 100%;
  }
  .preview-message {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: #586a71;
    font-size: 12px;
  }
</style>
