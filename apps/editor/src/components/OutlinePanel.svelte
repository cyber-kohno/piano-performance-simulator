<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { ScoreProject } from '../model/project';
  import type { OutlineCursor } from '../state/outline-cursor';
  import { getMeasureBeatDisplay } from '../state/measure-beats';
  import InitialValues from './InitialValues.svelte';

  let { outline, cursor, keyEditing = false, tempoEditing = false, meterEditing = false }: {
    outline: ScoreProject['outline'];
    cursor: OutlineCursor;
    keyEditing?: boolean;
    tempoEditing?: boolean;
    meterEditing?: boolean;
  } = $props();

  const initialValues = $derived(outline[0].data);
  let blocksViewport: HTMLDivElement;
  let scrollTimers: number[] = [];

  function scrollFocusedBlockIntoView(blockId: string) {
    const viewport = blocksViewport;
    const block = viewport?.querySelector<HTMLElement>(`[data-block-id="${blockId}"]`);
    if (!viewport || !block) return;

    const viewportRect = viewport.getBoundingClientRect();
    const blockRect = block.getBoundingClientRect();
    const requestedTop = viewport.scrollTop + blockRect.top - viewportRect.top
      - viewport.clientHeight / 2 + blockRect.height / 2;
    const top = Math.max(0, Math.min(requestedTop, viewport.scrollHeight - viewport.clientHeight));
    if (Math.abs(top - viewport.scrollTop) < 1) return;

    for (const timer of scrollTimers) window.clearTimeout(timer);
    scrollTimers = [];

    // Match Scorehack's 15 increments at 10ms intervals for held-key navigation.
    const divisionCount = 15;
    const step = (top - viewport.scrollTop) / divisionCount;
    for (let division = 0; division < divisionCount; division += 1) {
      const timer = window.setTimeout(() => {
        viewport.scrollTop += step;
      }, division * 10);
      scrollTimers.push(timer);
    }
  }

  $effect(() => {
    scrollFocusedBlockIntoView(cursor.blockId);
  });

  onDestroy(() => {
    for (const timer of scrollTimers) window.clearTimeout(timer);
  });

  function getMeasureNumber(blockId: string): number {
    const blockIndex = outline.findIndex((block) => block.id === blockId);
    return outline.slice(0, blockIndex + 1).filter((block) => block.type === 'measure').length;
  }
</script>

<aside class="outline-panel" aria-label="Outline panel">
  <section class="current-info" aria-labelledby="current-info-title">
    <h2 id="current-info-title" class="region-label">Current Context</h2>
    <div class="current-values">
      <InitialValues values={initialValues} />
    </div>
  </section>
  <section class="outline" aria-label="Outline">
    <div class="blocks" bind:this={blocksViewport}>
      {#each outline as block (block.id)}
        {#if block.type === 'init'}
          <section
            class="initial-block"
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
            data-block-id={block.id}
            class:focused={cursor.blockId === block.id}
            aria-label={`Section ${block.data.name}`}
            aria-current={cursor.blockId === block.id ? 'true' : undefined}
          >
            <h3>{block.data.name}</h3>
          </section>
        {:else if block.type === 'measure'}
          {@const beats = getMeasureBeatDisplay(initialValues.timeSignature, block.data.length)}
          <section
            class="measure-block"
            data-block-id={block.id}
            class:focused={cursor.blockId === block.id}
            aria-label={`Measure ${getMeasureNumber(block.id)}`}
            aria-current={cursor.blockId === block.id ? 'true' : undefined}
          >
            <div class="measure-heading">
              <h3>Measure {getMeasureNumber(block.id)}</h3>
              <span>Beats {beats.actualLabel}/{beats.standardBeats}</span>
            </div>
            <div class="beat-chips" role="img" aria-label={`${beats.actualLabel} of ${beats.standardBeats} beats`}>
              {#each beats.chips as fill, index (index)}
                <span class="beat-chip" style={`--beat-fill: ${fill * 100}%`} aria-hidden="true"></span>
              {/each}
            </div>
          </section>
        {/if}
      {/each}
    </div>
  </section>
</aside>

<style>
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
  }

  .blocks::after {
    display: block;
    height: 15px;
    content: '';
  }

  .initial-block {
    margin-top: 16px;
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
    margin-top: 16px;
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
    margin-top: 6px;
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
</style>
