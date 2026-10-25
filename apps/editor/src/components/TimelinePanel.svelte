<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { ScoreProject } from '../model/project';
  import type { OutlineCursor } from '../state/outline-cursor';
  import { isTimelinePlacementInvalid, type TimelineCursor } from '../state/timeline-cursor';

  let { outline, cursor, timelineCursor, mode }: {
    outline: ScoreProject['outline'];
    cursor: OutlineCursor;
    timelineCursor: TimelineCursor;
    mode: 'outline' | 'timeline';
  } = $props();

  let measureRow = $state<HTMLDivElement>();
  let pianoRollViewport = $state<HTMLElement>();
  let pitchScrollViewport = $state<HTMLDivElement>();
  let scrollTimers: number[] = [];
  let verticalScrollTimers: number[] = [];

  function animateTimelineScroll(left: number) {
    const header = measureRow;
    const roll = pianoRollViewport;
    if (!header || !roll) return;

    for (const timer of scrollTimers) window.clearTimeout(timer);
    scrollTimers = [];

    const divisionCount = 15;
    const step = (left - roll.scrollLeft) / divisionCount;
    for (let division = 0; division < divisionCount; division += 1) {
      const isTail = division === divisionCount - 1;
      const timer = window.setTimeout(() => {
        roll.scrollLeft += step;
        if (isTail) header.scrollLeft = roll.scrollLeft;
        else header.scrollLeft += step;
      }, division * 10);
      scrollTimers.push(timer);
    }
  }

  function animateTimelineVerticalScroll(rollTop: number, pitchTop: number) {
    const roll = pianoRollViewport;
    const pitch = pitchScrollViewport;
    if (!roll || !pitch) return;

    for (const timer of verticalScrollTimers) window.clearTimeout(timer);
    verticalScrollTimers = [];

    const divisionCount = 15;
    const rollStep = (rollTop - roll.scrollTop) / divisionCount;
    const pitchStep = (pitchTop - pitch.scrollTop) / divisionCount;
    for (let division = 0; division < divisionCount; division += 1) {
      const isTail = division === divisionCount - 1;
      const timer = window.setTimeout(() => {
        roll.scrollTop += rollStep;
        pitch.scrollTop += pitchStep;
        if (isTail) {
          roll.scrollTop = rollTop;
          pitch.scrollTop = pitchTop;
        }
      }, division * 10);
      verticalScrollTimers.push(timer);
    }
  }

  onDestroy(() => {
    for (const timer of scrollTimers) window.clearTimeout(timer);
    for (const timer of verticalScrollTimers) window.clearTimeout(timer);
  });

  const pitchClassNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const naturalPitchClasses = [0, 2, 4, 5, 7, 9, 11];
  const sharpOrder = [3, 0, 4, 1, 5, 2, 6];
  const flatOrder = [6, 2, 5, 1, 4, 0, 3];
  const pixelsPerQuarter = 120;
  const pixelsPerWhole = pixelsPerQuarter * 4;
  const pixelsPerSixteenth = pixelsPerWhole / 16;
  const pitchTopMargin = 60;
  const pitchRowHeight = 24;
  const cursorLineWidth = 10;
  const cursorPlacementInvalid = $derived(isTimelinePlacementInvalid(outline, timelineCursor));
  function isDiatonicMidi(midi: number) {
    const pitchClass = ((midi % 12) + 12) % 12;
    return pitches.find((pitch) => pitch.midi % 12 === pitchClass)?.isDiatonic ?? false;
  }
  const pixelsPerOperationUnit = $derived(
    pixelsPerWhole * timelineCursor.operationUnit.cnt / timelineCursor.operationUnit.unit,
  );
  const measures = $derived(outline.filter((block) => block.type === 'measure'));
  const focusedSectionPosition = $derived.by(() => {
    let position = 0;
    for (const block of outline) {
      if (block.id === cursor.blockId) {
        return block.type === 'section' ? position : null;
      }
      if (block.type === 'measure') {
        position += (block.data.length.cnt / block.data.length.unit) * pixelsPerWhole;
      }
    }
    return null;
  });
  const headerMeasures = $derived.by(() => {
    const meter = outline[0].data.timeSignature;
    const isCompoundMeter = meter.unit === 8 && meter.cnt >= 6 && meter.cnt % 3 === 0;
    const beatLength = isCompoundMeter ? 3 / 8 : 1 / meter.unit;
    const sixteenthLength = 1 / 16;

    return measures.map((measure, index) => {
      const length = measure.data.length.cnt / measure.data.length.unit;
      const width = length * pixelsPerWhole;
      const ticks: { position: number; kind: 'bar' | 'beat' | 'eighth' | 'sixteenth' }[] = [];

      for (let division = 0; division * sixteenthLength < length - 1e-8; division += 1) {
        const notePosition = division * sixteenthLength;
        const isBeat = Math.abs(notePosition / beatLength - Math.round(notePosition / beatLength)) < 1e-8;
        const kind = division === 0
          ? 'bar'
          : isBeat
            ? 'beat'
            : division % 2 === 0
              ? 'eighth'
              : 'sixteenth';
        ticks.push({ position: notePosition * pixelsPerWhole, kind });
      }

      return { id: measure.id, number: index + 1, width, ticks };
    });
  });
  $effect(() => {
    const selectedBlockId = cursor.blockId;
    const isTimelineMode = mode === 'timeline';
    const header = measureRow;
    const roll = pianoRollViewport;
    if (!header || !roll) return;

    let totalWidth = 0;
    let focusPosition = timelineCursor.positionSixteenths * pixelsPerSixteenth;
    if (!isTimelineMode) {
      focusPosition = 0;
      for (const block of outline) {
        if (block.id === selectedBlockId) {
          if (block.type === 'measure') {
            focusPosition = totalWidth +
              (block.data.length.cnt / block.data.length.unit) * pixelsPerWhole / 2;
          } else {
            focusPosition = totalWidth;
          }
          break;
        }
        if (block.type === 'measure') {
          totalWidth += (block.data.length.cnt / block.data.length.unit) * pixelsPerWhole;
        }
      }
    }
    totalWidth = measures.reduce(
      (width, measure) => width +
        (measure.data.length.cnt / measure.data.length.unit) * pixelsPerWhole,
      0,
    );

    const viewportWidth = Math.min(header.clientWidth, roll.clientWidth);
    const maxScrollLeft = Math.max(0, totalWidth + viewportWidth / 2 - viewportWidth);
    const scrollLeft = Math.max(
      0,
      Math.min(maxScrollLeft, focusPosition - viewportWidth / 2),
    );

    animateTimelineScroll(scrollLeft);
  });
  $effect(() => {
    if (mode !== 'timeline' || !pianoRollViewport || !pitchScrollViewport) return;

    const pitchIndex = 108 - timelineCursor.pitch;
    const pitchRowCenter = pitchIndex * pitchRowHeight + pitchRowHeight / 2;
    const rollTop = Math.max(
      0,
      Math.min(
        pianoRollViewport.scrollHeight - pianoRollViewport.clientHeight,
        pitchTopMargin + pitchRowCenter - pianoRollViewport.clientHeight / 2,
      ),
    );
    const pitchTop = Math.max(
      0,
      Math.min(
        pitchScrollViewport.scrollHeight - pitchScrollViewport.clientHeight,
        pitchTopMargin + pitchRowCenter - pitchScrollViewport.clientHeight / 2,
      ),
    );
    animateTimelineVerticalScroll(rollTop, pitchTop);
  });
  const pitches = $derived.by(() => {
    const fifths = outline[0].data.keySignature.fifths;
    const alteredSteps = fifths >= 0
      ? new Set(sharpOrder.slice(0, fifths))
      : new Set(flatOrder.slice(0, -fifths));
    const diatonicPitchClasses = new Set(
      naturalPitchClasses.map((pitchClass, step) => {
        const alteration = alteredSteps.has(step) ? Math.sign(fifths) : 0;
        return (pitchClass + alteration + 12) % 12;
      }),
    );

    return Array.from({ length: 88 }, (_, index) => {
      const midi = 108 - index;
      const pitchClass = midi % 12;
      const name = pitchClassNames[pitchClass];

      return {
        midi,
        label: `${name}${Math.floor(midi / 12) - 1}`,
        isSharp: name.includes('#'),
        isDiatonic: diatonicPitchClasses.has(pitchClass),
      };
    });
  });
</script>

<section class="timeline" aria-label="Timeline panel">
  <div class="corner" aria-hidden="true"></div>
  <section class="time-header" aria-label="Time header">
    <div class="event-row" aria-label="Event row"></div>
    <div class="measure-row" aria-label="Measure row" bind:this={measureRow}>
      {#each headerMeasures as measure (measure.id)}
        <div
          class="measure-header-block"
          class:focused={cursor.blockId === measure.id}
          aria-current={cursor.blockId === measure.id ? 'true' : undefined}
          style={`width: ${measure.width}px`}
        >
          <div class="measure-start" aria-hidden="true"></div>
          <span class="measure-number">{measure.number}</span>
          {#each measure.ticks as tick (tick.position)}
            {#if tick.position > 0}
              <div
                class="beat-tick"
                class:beat={tick.kind === 'beat'}
                class:eighth={tick.kind === 'eighth'}
                class:sixteenth={tick.kind === 'sixteenth'}
                style={`left: ${tick.position}px`}
                aria-hidden="true"
              ></div>
            {/if}
          {/each}
        </div>
      {/each}
    </div>
  </section>
  <section class="pitch-list" aria-label="Piano pitch range">
    <div class="pitch-scroll" role="list" aria-label="88-key piano range, C8 to A0" bind:this={pitchScrollViewport}>
      <div class="pitch-margin top" aria-hidden="true"></div>
      {#each pitches as pitch (pitch.midi)}
        <div
          class="pitch-row"
          class:sharp={pitch.isSharp}
          class:cursor-pitch={mode === 'timeline' && timelineCursor.pitch === pitch.midi}
          role="listitem"
        >
          {pitch.label}
        </div>
      {/each}
      <div class="pitch-margin bottom" aria-hidden="true"></div>
    </div>
  </section>
  <section class="piano-roll" aria-label="Piano roll" bind:this={pianoRollViewport}>
    <div class="measure-track" aria-label="Measure timeline">
      {#if mode === 'timeline' && timelineCursor.focusedNoteId === null}
        <div
          class="timeline-cursor"
          class:invalid={cursorPlacementInvalid}
          style={`left: ${timelineCursor.positionSixteenths * pixelsPerSixteenth}px`}
          aria-hidden="true"
        >
          <div class="timeline-cursor-line"></div>
          <div
            class="timeline-cursor-note"
            style={`top: ${pitchTopMargin + (108 - timelineCursor.pitch) * pitchRowHeight}px; width: ${Math.max(0, pixelsPerOperationUnit - cursorLineWidth)}px`}
          >
            <span class="operation-unit-badge">
              {timelineCursor.operationUnit.cnt}/{timelineCursor.operationUnit.unit}
            </span>
          </div>
        </div>
      {/if}
      {#if mode === 'timeline' && timelineCursor.focusedNoteId !== null}
        <span
          class="operation-unit-badge note-focused-operation-badge"
          style={`left: ${timelineCursor.positionSixteenths * pixelsPerSixteenth + 4}px; top: ${pitchTopMargin + (108 - timelineCursor.pitch) * pitchRowHeight - 52}px`}
          aria-hidden="true"
        >
          {timelineCursor.operationUnit.cnt}/{timelineCursor.operationUnit.unit}
        </span>
      {/if}
      {#if focusedSectionPosition !== null}
        <div
          class="section-focus-line"
          style={`left: ${focusedSectionPosition}px`}
          aria-hidden="true"
        ></div>
      {/if}
      {#each measures as measure, index (measure.id)}
        <div
          class="measure-region"
          class:focused={mode !== 'timeline' && cursor.blockId === measure.id}
          aria-label={`Measure ${index + 1} timeline region`}
          aria-current={cursor.blockId === measure.id ? 'true' : undefined}
          style={`width: ${(measure.data.length.cnt / measure.data.length.unit) * pixelsPerWhole}px`}
        >
          <div class="pitch-margin top" aria-hidden="true"></div>
          {#each pitches as pitch (pitch.midi)}
            <div
              class="pitch-lane"
              class:diatonic={pitch.isDiatonic}
              class:chromatic={!pitch.isDiatonic}
              aria-hidden="true"
            ></div>
          {/each}
          <div class="pitch-margin bottom" aria-hidden="true"></div>
          {#each headerMeasures[index].ticks as tick (tick.position)}
            <div
              class="roll-gridline"
              class:bar={tick.kind === 'bar'}
              class:beat={tick.kind === 'beat'}
              class:eighth={tick.kind === 'eighth'}
              class:sixteenth={tick.kind === 'sixteenth'}
              style={`left: ${tick.position}px`}
              aria-hidden="true"
            ></div>
          {/each}
          {#each measure.data.upperStaff.voices[0]?.notes ?? [] as note (note.id)}
            {#if mode === 'timeline' && timelineCursor.focusedNoteId === note.id}
              <div
                class="note-focus-column"
                style={`left: ${note.positionSixteenths * pixelsPerSixteenth}px; width: ${(note.duration.cnt / note.duration.unit) * pixelsPerWhole}px`}
                aria-hidden="true"
              ></div>
            {/if}
            {#each note.pitches as pitch (`${note.id}-${pitch.midi}`)}
              <div
                class="score-note-pitch"
                class:diatonic={isDiatonicMidi(pitch.midi)}
                class:chromatic={!isDiatonicMidi(pitch.midi)}
                aria-label={`Note ${note.id}`}
                aria-current={mode === 'timeline' && timelineCursor.focusedNoteId === note.id ? 'true' : undefined}
                style={`left: ${note.positionSixteenths * pixelsPerSixteenth}px; top: ${pitchTopMargin + (108 - pitch.midi) * pitchRowHeight}px; width: ${(note.duration.cnt / note.duration.unit) * pixelsPerWhole}px`}
              ></div>
            {/each}
          {/each}
        </div>
      {/each}
    </div>
  </section>
</section>

<style>
  .timeline {
    display: grid;
    grid-template-columns: var(--pitch-width) minmax(0, 1fr);
    grid-template-rows: var(--timeline-header-height) minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
  }

  .corner {
    border-right: 1px solid var(--border-color);
    border-bottom: 1px solid var(--border-color);
    background: #d4e7ed;
  }

  .time-header {
    display: grid;
    grid-template-rows: 50px 40px;
    min-width: 0;
    overflow: hidden;
    container-type: inline-size;
  }

  .event-row {
    background: #93bbc1;
  }

  .measure-row {
    display: flex;
    min-width: 0;
    overflow: hidden;
    background: #b6dfdb;
  }

  .measure-row::after {
    flex: 0 0 50cqw;
    content: '';
  }

  .measure-header-block {
    position: relative;
    flex: 0 0 auto;
    height: 40px;
  }

  .measure-header-block.focused {
    background: #f6be224f;
  }

  .measure-start {
    position: absolute;
    top: 0;
    left: 0;
    width: 4px;
    height: 20px;
    background: #f75c5c;
  }

  .measure-number {
    position: absolute;
    top: 19px;
    left: 1.5px;
    transform: translateX(-50%);
    color: #f24747;
    font-size: 14px;
    font-weight: 600;
    line-height: 16px;
    font-variant-numeric: tabular-nums;
  }

  .measure-header-block:first-child .measure-start {
    left: 4px;
  }

  .measure-header-block:first-child .measure-number {
    left: 5.5px;
  }

  .beat-tick {
    position: absolute;
    top: 0;
    background: #78989b;
  }

  .beat-tick.sixteenth {
    width: 1px;
    height: 10px;
  }

  .beat-tick.eighth {
    width: 2px;
    height: 13px;
  }

  .beat-tick.beat {
    width: 2px;
    height: 18px;
  }

  .pitch-list {
    min-height: 0;
    overflow: hidden;
    border-right: 1px solid var(--border-color);
    background: #bdd9e6;
  }

  .pitch-scroll {
    min-height: 0;
    height: 100%;
    overflow: hidden;
  }

  .pitch-margin {
    flex: 0 0 auto;
    width: 100%;
  }

  .pitch-margin.top {
    height: var(--pitch-top-margin);
    background: #a6d2d8;
  }

  .pitch-margin.bottom {
    height: var(--pitch-bottom-margin);
    background: #a6d2d8;
  }

  .pitch-row {
    display: flex;
    align-items: center;
    height: var(--pitch-row-height);
    padding-inline: 9px 4px;
    border-bottom: 1px solid #8eabb4;
    background: #d4e6ec;
    color: #344e56;
    font-size: 12px;
    font-weight: 600;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .pitch-row.sharp {
    background: #aac8d2;
  }

  .pitch-row.cursor-pitch {
    background: #78d77b;
    color: #203f27;
  }

  .piano-roll {
    position: relative;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: #edf0df;
    container-type: inline-size;
  }

  .measure-track {
    position: absolute;
    top: 0;
    left: 0;
    display: flex;
    width: max-content;
    background: #edf0df;
  }

  .measure-track::after {
    flex: 0 0 50cqw;
    content: '';
  }

  .section-focus-line {
    position: absolute;
    z-index: 3;
    top: var(--pitch-top-margin);
    bottom: var(--pitch-bottom-margin);
    width: 20px;
    background: #d90000;
    pointer-events: none;
  }

  .timeline-cursor {
    position: absolute;
    z-index: 4;
    top: 0;
    bottom: 0;
    width: 0;
    pointer-events: none;
  }

  .timeline-cursor-line {
    position: absolute;
    top: var(--pitch-top-margin);
    bottom: var(--pitch-bottom-margin);
    left: 0;
    width: 10px;
    background: #35b94a;
    opacity: 0.9;
  }

  .timeline-cursor.invalid .timeline-cursor-line,
  .timeline-cursor.invalid .timeline-cursor-note {
    background: #d90000;
  }

  .timeline-cursor-note {
    position: absolute;
    left: 10px;
    height: var(--pitch-row-height);
    border-radius: 0 8px 8px 0;
    background: #5bd66c;
  }

  .operation-unit-badge {
    position: absolute;
    top: -52px;
    left: 4px;
    z-index: 2;
    padding: 0 6px;
    border-radius: 4px;
    background: rgba(75, 0, 0, 0.7);
    color: #fff;
    font-size: 14px;
    font-weight: 600;
    line-height: 24px;
    white-space: nowrap;
  }

  .note-focused-operation-badge {
    z-index: 6;
  }

  .measure-region {
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 0 0 auto;
  }

  .pitch-lane {
    flex: 0 0 var(--pitch-row-height);
    height: var(--pitch-row-height);
    border-bottom: 1px solid #d2d9cb;
  }

  .pitch-lane.diatonic {
    background: #dce9dc;
  }

  .pitch-lane.chromatic {
    background: #e5dfd7;
  }

  .score-note-pitch {
    position: absolute;
    z-index: 5;
    height: var(--pitch-row-height);
    border-radius: 2px 8px 8px 2px;
    opacity: 0.92;
  }

  .score-note-pitch.diatonic {
    border: 1px solid #256b32;
    background: linear-gradient(#85ec84, #32bd47);
  }

  .score-note-pitch.chromatic {
    border: 1px solid #806a4e;
    background: linear-gradient(#d8c3a1, #ab8a61);
  }

  .note-focus-column {
    position: absolute;
    z-index: 2;
    top: var(--pitch-top-margin);
    bottom: var(--pitch-bottom-margin);
    background: rgba(255, 242, 0, 0.121);
    pointer-events: none;
  }

  .roll-gridline {
    position: absolute;
    z-index: 1;
    top: 0;
    bottom: 0;
    background: rgba(48, 71, 77, 0.2);
    pointer-events: none;
  }

  .roll-gridline.sixteenth {
    width: 1px;
  }

  .roll-gridline.eighth {
    width: 2px;
    background: rgba(48, 71, 77, 0.24);
  }

  .roll-gridline.beat {
    width: 3px;
    background: rgba(48, 71, 77, 0.3);
  }

  .roll-gridline.bar {
    width: 6px;
    background: rgba(48, 71, 77, 0.36);
  }

  .measure-region.focused::after {
    position: absolute;
    z-index: 2;
    inset: 0;
    background: #ffec3d2c;
    content: '';
    pointer-events: none;
  }

</style>
