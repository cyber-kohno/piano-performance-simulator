<script lang="ts">
  import ScoreKey from "../domain/score/score-key.ts";

  import { onDestroy, untrack } from 'svelte';
  import type { ScoreProject } from "../domain/score/types.ts";
  import type { OutlineCursor } from '../state/outline-cursor';
  import { getSelectedOutlineBlocks } from '../state/outline-cursor';
  import { getMeasureBeatDisplay } from '../state/measure-beats';
  import InitialValues from './InitialValues.svelte';
  import OutlineView from '../state/outline-view.ts';


  let { outline, cursor, keyEditing = false, tempoEditing = false, meterEditing = false }: {
    outline: ScoreProject['outline'];
    cursor: OutlineCursor;
    keyEditing?: boolean;
    tempoEditing?: boolean;
    meterEditing?: boolean;
  } = $props();

  const initialValues = $derived(outline[0].data);
  const selectedBlocks = $derived(getSelectedOutlineBlocks(outline, cursor));
  const selectedBlockIds = $derived(new Set(selectedBlocks.length > 1 ? selectedBlocks.map(block => block.id) : []));
  let blocksViewport = $state<HTMLDivElement>();
  let scrollTop = $state(0);
  let viewportHeight = $state(0);
  let measuredHeights = $state<ReadonlyMap<string, number>>(new Map());
  const layout = $derived(OutlineView.layout(outline, measuredHeights));
  const visibleRows = $derived(OutlineView.visibleRows(layout, scrollTop, viewportHeight || 600, cursor.blockId));
  let scrollTimers: number[] = [];
  let scrollDestination: number | undefined;

  function syncScroll() { if (blocksViewport) scrollTop = blocksViewport.scrollTop; }
  $effect(() => {
    const viewport = blocksViewport;
    if (!viewport) return;
    let width = viewport.clientWidth;
    const resize = () => {
      viewportHeight = viewport.clientHeight;
      if (Math.abs(width - viewport.clientWidth) > 0.5) {
        width = viewport.clientWidth;
        measuredHeights = new Map();
      }
      syncScroll();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(viewport);
    resize();
    return () => observer.disconnect();
  });

  function measureRow(node: HTMLDivElement, blockId: string) {
    const observer = new ResizeObserver(() => {
      const height = node.getBoundingClientRect().height;
      if (height > 0 && Math.abs((measuredHeights.get(blockId) ?? 0) - height) > 0.5) {
        measuredHeights = new Map(measuredHeights).set(blockId, height);
      }
    });
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }

  function scrollFocusedBlockIntoView(blockId: string) {
    const viewport = blocksViewport;
    if (!viewport) return;
    const top = OutlineView.focusScrollTop(layout, blockId, viewport.clientHeight);
    if (top === undefined || (scrollDestination !== undefined && Math.abs(top - scrollDestination) < 0.5)) return;
    scrollDestination = top;

    for (const timer of scrollTimers) window.clearTimeout(timer);
    scrollTimers = [];
    if (Math.abs(top - viewport.scrollTop) < 1) return;

    // Match Scorehack's 15 increments at 10ms intervals for held-key navigation.
    const divisionCount = 15;
    const step = (top - viewport.scrollTop) / divisionCount;
    for (let division = 0; division < divisionCount; division += 1) {
      const timer = window.setTimeout(() => {
        if (division === divisionCount - 1) viewport.scrollTop = top;
        else viewport.scrollTop += step;
        syncScroll();
      }, division * 10);
      scrollTimers.push(timer);
    }
  }

  $effect(() => {
    const blockId = cursor.blockId;
    layout;
    viewportHeight;
    untrack(() => scrollFocusedBlockIntoView(blockId));
  });

  onDestroy(() => {
    for (const timer of scrollTimers) window.clearTimeout(timer);
  });

</script>

<aside class="outline-panel" aria-label="Outline panel">
  <section class="current-info" aria-labelledby="current-info-title">
    <h2 id="current-info-title" class="region-label">Current Context</h2>
    <div class="current-values">
      <InitialValues values={{ ...initialValues, keySignature: ScoreKey.forBlock(outline, cursor.blockId) }} />
    </div>
  </section>
  <section class="outline" aria-label="Outline">
    <div class="blocks" bind:this={blocksViewport} onscroll={syncScroll}>
      <div class="block-space" style={`height: ${layout.totalHeight + 15}px`}>
      {#each visibleRows as item (item.block.id)}
        {@const block = item.block}
        <div class="virtual-block" use:measureRow={block.id} style={`top: ${item.top}px; padding-top: ${item.gap}px`}>
        {#if block.type === 'init'}
          <section
            class="initial-block"
            class:range-selected={selectedBlockIds.has(block.id)}
            data-block-id={block.id}
            class:focused={cursor.blockId === block.id}
            aria-label="Initial values block"
            aria-current={cursor.blockId === block.id ? 'true' : undefined}
          >
            <h3>Initial Values</h3>
            <InitialValues values={block.data} keyEditing={keyEditing && cursor.blockId === block.id} tempoEditing={tempoEditing && cursor.blockId === block.id} meterEditing={meterEditing && cursor.blockId === block.id} />
          </section>
        {:else if block.type === 'section'}
          <section
            class="section-block"
            class:range-selected={selectedBlockIds.has(block.id)}
            data-block-id={block.id}
            class:focused={cursor.blockId === block.id}
            aria-label={`Section ${block.data.name}`}
            aria-current={cursor.blockId === block.id ? 'true' : undefined}
          >
            <h3>{block.data.name}</h3>
          </section>
        {:else if block.type === 'key-change'}
          <section class="key-change-block" data-block-id={block.id} class:focused={cursor.blockId === block.id}
            class:range-selected={selectedBlockIds.has(block.id)}
            aria-label="Key signature change" aria-current={cursor.blockId === block.id ? 'true' : undefined}>
            <h3>Key Change</h3>
            <InitialValues values={{ ...initialValues, keySignature: block.data.keySignature }} keyOnly
              keyEditing={keyEditing && cursor.blockId === block.id} />
          </section>
        {:else if block.type === 'measure'}
          {@const beats = getMeasureBeatDisplay(initialValues.timeSignature, block.data.length)}
          <section
            class="measure-block"
            class:range-selected={selectedBlockIds.has(block.id)}
            data-block-id={block.id}
            class:focused={cursor.blockId === block.id}
            aria-label={`Measure ${item.measureNumber}`}
            aria-current={cursor.blockId === block.id ? 'true' : undefined}
          >
            <div class="measure-heading">
              <h3>Measure {item.measureNumber}</h3>
              <span>Beats {beats.actualLabel}/{beats.standardBeats}</span>
            </div>
            <div class="beat-chips" role="img" aria-label={`${beats.actualLabel} of ${beats.standardBeats} beats`}>
              {#each beats.chips as fill, index (index)}
                <span class="beat-chip" style={`--beat-fill: ${fill * 100}%`} aria-hidden="true"></span>
              {/each}
            </div>
          </section>
        {/if}
        </div>
      {/each}
      </div>
    </div>
  </section>
</aside>

<style>
  .key-change-block { position: relative; padding: 8px 10px; border-left: 3px solid #8876a4; background: #e6e0ee; color: #40565c; }
  .outline-panel {
    display: grid;
    grid-template-rows: var(--outline-info-height) minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    border-right: 1px solid var(--border-color);
  }

  .current-info {
    overflow: hidden;
    border-bottom: 1px solid var(--border-color);
    background: #d5deef;
  }

  .current-info .region-label {
    padding: 10px 16px 5px;
  }

  .current-values {
    padding: 0 16px;
  }

  .outline {
    min-height: 0;
    overflow: hidden;
    background: #dce5eb;
  }

  .blocks {
    height: 100%;
    min-height: 0;
    overflow: hidden;
    padding: 0 12px 12px;
    overflow-anchor: none;
  }
  .block-space { position: relative; }
  .virtual-block { position: absolute; left: 0; right: 0; }

  .initial-block {
    padding: 12px;
    border: 1px solid #7caaa2;
    border-radius: 4px;
    background: #c5e3dc;
  }

  h3 {
    margin: 0 0 10px;
    font-size: 13px;
    font-weight: 600;
  }

  .section-block {
    padding: 8px 4px;
    border-bottom: 3px solid #497e77;
    color: #355f59;
    text-align: center;
  }

  .section-block h3 {
    margin: 0;
    font-size: 14px;
  }

  .measure-block {
    position: relative;
    padding: 8px 10px;
    border-left: 3px solid #8299a0;
    background: #e8edf0;
    color: #40565c;
  }

  .measure-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .beat-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
  }

  .beat-chip {
    flex: 0 0 14px;
    height: 7px;
    border: 1px solid #648d85;
    border-radius: 2px;
    background: linear-gradient(to right, #648d85 0%, #648d85 var(--beat-fill), transparent var(--beat-fill), transparent 100%);
  }

  .measure-block h3 {
    margin: 0;
    font-size: 12px;
  }

  .measure-block span {
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .initial-block,
  .section-block {
    position: relative;
  }

  .focused {
    isolation: isolate;
  }

  .focused::after {
    position: absolute;
    z-index: 1;
    inset: 0;
    background-color: #ffec3d2c;
    content: '';
    pointer-events: none;
  }
  .range-selected { position: relative; isolation: isolate; }
  .range-selected::after {
    position: absolute;
    z-index: 1;
    inset: 0;
    background: rgba(239, 68, 68, 0.23);
    content: '';
    pointer-events: none;
  }
  .range-selected.focused::after { background: rgba(239, 68, 68, 0.32); }
</style>
