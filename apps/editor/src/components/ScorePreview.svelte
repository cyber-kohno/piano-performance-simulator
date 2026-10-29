<script lang="ts">
  import { createScorePreview, getScorePreviewViewBox } from '../model/score-preview';
  import { drawPreviewPedals } from '../model/score-preview-pedal';
  import type { ScoreProject } from '../model/project';

  let { outline, activeIndex }: { outline: ScoreProject['outline']; activeIndex: number } = $props();
  let host = $state<HTMLDivElement>();
  let message = $state<string | null>(null);
  const preview = $derived(createScorePreview(outline, activeIndex));
  const xml = $derived(preview?.xml ?? null);
  const activeOffset = $derived(preview?.activeOffset ?? 0);

  $effect(() => {
    const target = host;
    const source = xml;
    const offset = activeOffset;
    const pedalEvents = preview?.pedals ?? [];
    if (!target) return;
    if (!source) {
      target.replaceChildren();
      message = 'No measures';
      return;
    }
    let cancelled = false;
    let stage: HTMLDivElement | undefined;
    const timer = window.setTimeout(async () => {
      try {
        const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
        if (cancelled) return;
        stage = document.createElement('div');
        stage.style.cssText = 'position:absolute;width:1200px;visibility:hidden;pointer-events:none';
        target.append(stage);
        const renderer = new OpenSheetMusicDisplay(stage, {
          backend: 'svg', autoResize: false, disableCursor: true,
          drawTitle: false, drawSubtitle: false, drawComposer: false,
          drawLyricist: false, drawCredits: false, drawPartNames: false,
          drawPartAbbreviations: false, drawMeasureNumbers: true, useXMLMeasureNumbers: true,
          renderSingleHorizontalStaffline: true, autoBeam: true, alignRests: 2,
          newSystemFromXML: false, newPageFromXML: false,
        });
        renderer.setLogLevel('warn');
        renderer.EngravingRules.RenderPedals = false;
        await renderer.load(source);
        if (cancelled) return;
        renderer.render();
        const svg = stage.querySelector('svg');
        const measure = renderer.GraphicSheet.MeasureList[offset]?.[0];
        if (!svg || !measure) throw new Error('Missing rendered measure');
        drawPreviewPedals(svg, renderer, pedalEvents);
        // OSMD positions use staff-space units; its default SVG uses ten pixels per unit.
        const box = measure.PositionAndShape;
        const left = (box.AbsolutePosition.x + box.BorderLeft) * 10;
        const width = box.Size.width * 10;
        const bounds = svg.getBBox();
        const viewportWidth = 478;
        const viewportHeight = 212;
        const view = getScorePreviewViewBox(left, width, bounds.y, bounds.height);
        svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.width} ${view.height}`);
        svg.setAttribute('width', String(viewportWidth));
        svg.setAttribute('height', String(viewportHeight));
        svg.style.display = 'block';
        const highlight = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        highlight.setAttribute('x', String(left));
        highlight.setAttribute('y', String(view.y));
        highlight.setAttribute('width', String(width));
        highlight.setAttribute('height', String(view.height));
        highlight.setAttribute('fill', '#fff3b5');
        svg.prepend(highlight);
        target.replaceChildren(svg);
        message = null;
      } catch (error) {
        if (!cancelled) {
          target.replaceChildren();
          message = 'Score preview unavailable';
          console.error('Score preview:', error);
        }
      } finally {
        stage?.remove();
      }
    }, 80);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      stage?.remove();
    };
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
    z-index: 20;
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
