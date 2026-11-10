<script lang="ts">
  import { onDestroy } from 'svelte';
  import ScoreSlur from "../domain/score/score-slur.ts";

  import ScoreTrill from "../domain/score/score-trill.ts";

  import ScoreTimeline from "../domain/score/score-timeline.ts";
  import ScoreVoice from '../domain/score/score-voice.ts';
  import WrittenValue from "../domain/theory/written-value.ts";
  import TimelineView from '../state/timeline-view.ts';
  import ScoreKey from "../domain/score/score-key.ts";

  import { getFocusedGrace, getGraceRollLayout } from '../state/grace-input';
  import type { PedalCursor } from '../state/pedal';
  import type { OttavaCursor } from '../state/ottava.ts';
  import ScorePedal from '../domain/score/score-pedal.ts';
  import ScoreOttava from '../domain/score/score-ottava.ts';
  import ScorePreview from './ScorePreview.svelte';
  import PlaybackPosition from './PlaybackPosition.svelte';

  import { type ScoreProject } from "../domain/score/types.ts";
  import type { OutlineCursor } from '../state/outline-cursor';
  import { getSelectedOutlineBlocks } from '../state/outline-cursor';
  import {
    getTimelineFixedInputContext,
    getTimelineInputValue,
    getTimelineInputSixteenths,
    getSelectedTimelineNotes,
    isTimelinePlacementInvalid,
    type TimelineCursor,
  } from "../state/timeline-cursor";

  let { outline, cursor, timelineCursor, mode, pedalMode = false, pedalCursor, ottavaMode = false, ottavaCursor, playbackPosition = null, playbackActive = false, expressionModalOpen = false, trills = [], tempoChanges = [], clefChanges = [], dynamicChanges = [], slurs = [] }: {
    slurs?: ScoreProject['slurs'];
    dynamicChanges?: ScoreProject['dynamicChanges'];
    tempoChanges?: ScoreProject['tempoChanges'];
    clefChanges?: ScoreProject['clefChanges'];
    outline: ScoreProject['outline'];
    trills?: ScoreProject['trills'];
    cursor: OutlineCursor;
    timelineCursor: TimelineCursor;
    mode: 'outline' | 'timeline';
    pedalMode?: boolean;
    ottavaMode?: boolean;
    expressionModalOpen?: boolean;
    pedalCursor: PedalCursor;
    ottavaCursor: OttavaCursor;
    playbackPosition?: number | null;
    playbackActive?: boolean;
  } = $props();
  const trillNotes=$derived(new Map(trills.flatMap(span=>ScoreTrill.chain({outline},span.startNoteId).map((note,index)=>[note.id,index===0] as const))));

  let measureRow = $state<HTMLDivElement>();
  let pianoRollViewport = $state<HTMLElement>();
  let pitchScrollViewport = $state<HTMLDivElement>();
  let pedalViewport = $state<HTMLElement>();
  let timelineScrollLeft = $state(0);
  let timelineScrollTop = $state(0);
  let timelineViewportWidth = $state(0);
  let timelineViewportHeight = $state(0);
  let scrollTimers: number[] = [];
  let verticalScrollTimers: number[] = [];
  const pedalEvents = $derived(ScorePedal.events({ outline }));
  const pedalSpans = $derived(ScorePedal.spans({ outline }, { splitAtChanges: true }));
  const pedalChangePositions = $derived(new Set(pedalEvents.filter(event => event.action === 'change').map(event => event.position)));
  const ottavaEvents = $derived(ScoreOttava.events({ outline }, timelineCursor.staff));
  const ottavaSpans = $derived(ScoreOttava.spans({ outline }, timelineCursor.staff));
  function syncTimelineScroll() {
    const roll = pianoRollViewport;
    if (!roll) return;
    const left = roll.scrollLeft;
    const top = roll.scrollTop;
    if (measureRow && Math.abs(measureRow.scrollLeft - left) > 1) measureRow.scrollLeft = left;
    if (pedalViewport && Math.abs(pedalViewport.scrollLeft - left) > 1) pedalViewport.scrollLeft = left;
    if (pitchScrollViewport && Math.abs(pitchScrollViewport.scrollTop - top) > 1) pitchScrollViewport.scrollTop = top;
    timelineScrollLeft = left;
    timelineScrollTop = top;
    timelineViewportWidth = roll.clientWidth;
    timelineViewportHeight = roll.clientHeight;
  }
  $effect(() => {
    const roll = pianoRollViewport;
    if (!roll) return;
    const observer = new ResizeObserver(syncTimelineScroll);
    observer.observe(roll);
    syncTimelineScroll();
    return () => observer.disconnect();
  });

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
        timelineScrollLeft = roll.scrollLeft;
        if (isTail || Math.abs(header.scrollLeft - roll.scrollLeft) > 1) header.scrollLeft = roll.scrollLeft;
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
  const pixelsPerQuarter = 120;
  const pixelsPerWhole = pixelsPerQuarter * 4;
  const pixelsPerSixteenth = pixelsPerWhole / 16;
  const independentNoteGapPixels = 4;
  const pitchTopMargin = 60;
  const pitchRowHeight = 24;
  const cursorLineWidth = 10;
  const cursorPlacementInvalid = $derived(isTimelinePlacementInvalid(outline, timelineCursor));
  const inputValue = $derived(getTimelineInputValue(timelineCursor, outline));
  const inputTuplet = $derived(getTimelineFixedInputContext(timelineCursor, outline));
  const cursorWidth = $derived(getTimelineInputSixteenths(timelineCursor, outline) * pixelsPerSixteenth);
  const measureKeyCache = $derived(ScoreKey.buildMeasureCache(outline));
  const measures = $derived(outline.filter((block) => block.type === 'measure'));
  const selectedOutlineBlocks = $derived(mode === 'outline' ? getSelectedOutlineBlocks(outline, cursor) : []);
  const selectedOutlineMeasureIds = $derived(new Set(selectedOutlineBlocks.length > 1
    ? selectedOutlineBlocks.filter(block => block.type === 'measure').map(block => block.id) : []));
  const timelineIndex = $derived(ScoreTimeline.index(outline));
  const statusEntry = $derived(timelineIndex.measureAt(playbackPosition !== null
    ? playbackPosition : mode === 'timeline'
      ? timelineCursor.positionSixteenths : timelineIndex.blockPositions.get(cursor.blockId) ?? 0));
  const statusMeasure = $derived(statusEntry?.measure);
  const statusMeasureNumber = $derived(statusEntry ? statusEntry.index + 1 : null);
  const previewActiveIndex = $derived.by(() => {
    if (statusMeasureNumber !== null) return statusMeasureNumber - 1;
    if (mode !== 'outline' || !measures.length) return -1;
    const focusedIndex = outline.findIndex(block => block.id === cursor.blockId);
    const focusedBlock = outline[focusedIndex];
    const hasFollowingMeasure = focusedIndex >= 0 && outline.slice(focusedIndex).some(block => block.type === 'measure');
    return focusedBlock?.type === 'section' && !hasFollowingMeasure ? measures.length - 1 : -1;
  });
  const staffNames = ['upperStaff', 'lowerStaff'] as const;
  const locatedNotes = $derived(ScoreTimeline.notes(outline, timelineCursor.staff, timelineCursor.voiceIndex));
  const selectedNotes = $derived(getSelectedTimelineNotes(outline, timelineCursor));
  const selectedNoteIds = $derived(new Set(selectedNotes.map(({ note }) => note.id)));
  const notesWithVisualGap = $derived(TimelineView.visualGaps(outline));
  const focusedNote = $derived(locatedNotes.find(({ note }) => note.id === timelineCursor.focusedNoteId));
  const slurPaths = $derived(ScoreSlur.ranges({ outline, slurs }).map(span => {
    const x1 = (span.first.start + 0.25) * pixelsPerSixteenth;
    const x2 = (span.last.start + 0.25) * pixelsPerSixteenth;
    const highest = Math.max(...span.members.flatMap(entry => entry.note.pitches.map(pitch => pitch.midi)));
    const y = pitchTopMargin + (108 - highest) * pitchRowHeight - 8;
    return { id: span.id, x1, x2, active: !pedalMode && span.first.staff === timelineCursor.staff && span.first.voiceIndex === timelineCursor.voiceIndex,
      path: `M ${x1} ${y} Q ${(x1 + x2) / 2} ${y - 28} ${x2} ${y}` };
  }));
  const focusedGrace = $derived(getFocusedGrace(outline, timelineCursor));
  const focusedGraceX = $derived.by(() => {
    if (!focusedGrace) return 0;
    const graces = focusedGrace.parent.note.beforeGraceNotes!;
    const index = graces.findIndex(grace => grace.id === focusedGrace.grace.id);
    return getGraceRollLayout(graces.length, pixelsPerSixteenth)[index]?.x ?? 0;
  });
  const tiePaths = $derived.by(() => {
    const notes = locatedNotes;
    const byId = new Map(notes.map((entry) => [entry.note.id, entry]));
    return notes.flatMap(({ note, measureStartSixteenths, positionSixteenths, lengthSixteenths }) => {
      const next = note.tieTo ? byId.get(note.tieTo) : undefined;
      if (!next || next.note.tieFrom !== note.id) return [];
      const x1 = (measureStartSixteenths + positionSixteenths + lengthSixteenths / 2) * pixelsPerSixteenth;
      const x2 = (next.measureStartSixteenths + next.positionSixteenths + next.lengthSixteenths / 2) * pixelsPerSixteenth;
      return note.pitches.map((pitch) => {
        const y = pitchTopMargin + (108 - pitch.midi) * pitchRowHeight + pitchRowHeight / 2;
        return { id: `${note.id}-${next.note.id}-${pitch.midi}`, x1, x2, path: `M ${x1} ${y} Q ${(x1 + x2) / 2} ${y + pitchRowHeight} ${x2} ${y}` };
      });
    });
  });
  const focusedBoundary = $derived.by(() => {
    let position = 0;
    for (const block of outline) {
      if (block.id === cursor.blockId) {
        return block.type === 'section' || block.type === 'key-change'
          ? { position, keyChange: block.type === 'key-change' } : null;
      }
      if (block.type === 'measure') {
        position += (block.data.length.cnt / block.data.length.unit) * pixelsPerWhole;
      }
    }
    return null;
  });
  const headerMeasures = $derived(TimelineView.layout(outline, pixelsPerWhole));
  const totalTimelineWidth = $derived(headerMeasures.length
    ? headerMeasures.at(-1)!.start + headerMeasures.at(-1)!.width : 0);
  const requiredMeasureIndices = $derived(statusMeasureNumber === null ? [] : [statusMeasureNumber - 1]);
  const visibleMeasureIndices = $derived(TimelineView.visibleMeasureIndices(
    headerMeasures, timelineScrollLeft, Math.max(1, timelineViewportWidth || 960),
    Math.max(480, timelineViewportWidth), requiredMeasureIndices,
  ));
  const visiblePitchBounds = $derived.by(() => {
    const viewportHeight = timelineViewportHeight || 720;
    return {
      min: Math.min(108, Math.max(21, 108 - Math.ceil((timelineScrollTop + viewportHeight - pitchTopMargin) / pitchRowHeight) - 1)),
      max: Math.max(21, Math.min(108, 108 - Math.floor((timelineScrollTop - pitchTopMargin) / pitchRowHeight) + 1)),
    };
  });
  const visibleMeasures = $derived.by(() => visibleMeasureIndices.map(index => {
    const measure = measures[index];
    const layout = headerMeasures[index];
    const notes = TimelineView.notesForMeasure(measure, notesWithVisualGap, independentNoteGapPixels, pixelsPerSixteenth)
      .filter(entry => entry.note.pitches.some(pitch => pitch.midi >= visiblePitchBounds.min && pitch.midi <= visiblePitchBounds.max) ||
        (entry.note.beforeGraceNotes ?? []).some(grace => grace.pitches.some(pitch => pitch.midi >= visiblePitchBounds.min && pitch.midi <= visiblePitchBounds.max)));
    const voice = measure.data[timelineCursor.staff].voices[timelineCursor.voiceIndex];
    const tuplets = voice ? ScoreVoice.locate(voice, measure.data.length)
      .filter(entry => entry.element.kind === 'tuplet')
      .map(entry => ({ start: entry.positionSixteenths, length: entry.lengthSixteenths, id: entry.element.id })) : [];
    return { index, measure, layout, notes, tuplets, ticks: TimelineView.ticks(layout, outline[0].data.timeSignature, pixelsPerWhole) };
  }));
  const visibleTimelineStart = $derived(Math.max(0, timelineScrollLeft - Math.max(480, timelineViewportWidth)));
  const visibleTimelineEnd = $derived(timelineScrollLeft + Math.max(1, timelineViewportWidth || 960) + Math.max(480, timelineViewportWidth));
  const visibleTiePaths = $derived(tiePaths.filter(path => path.x2 >= visibleTimelineStart && path.x1 <= visibleTimelineEnd));
  const visibleSlurPaths = $derived(slurPaths.filter(path => path.x2 >= visibleTimelineStart && path.x1 <= visibleTimelineEnd));
  const visiblePedalEvents = $derived(pedalEvents.filter(event => {
    const x = event.position * pixelsPerSixteenth;
    return x >= visibleTimelineStart && x <= visibleTimelineEnd;
  }));
  const visiblePedalSpans = $derived(pedalSpans.filter(span =>
    span.end * pixelsPerSixteenth >= visibleTimelineStart && span.start * pixelsPerSixteenth <= visibleTimelineEnd));
  const visibleOttavaEvents = $derived(ottavaEvents.filter(event => {
    const x = event.position * pixelsPerSixteenth;
    return x >= visibleTimelineStart && x <= visibleTimelineEnd;
  }));
  const visibleOttavaSpans = $derived(ottavaSpans.filter(span =>
    span.end * pixelsPerSixteenth >= visibleTimelineStart && span.start * pixelsPerSixteenth <= visibleTimelineEnd));
  $effect(() => {
    const selectedBlockId = cursor.blockId;
    const isTimelineMode = mode === 'timeline';
    const header = measureRow;
    const roll = pianoRollViewport;
    if (!header || !roll) return;

    let focusPosition = timelineCursor.positionSixteenths * pixelsPerSixteenth + (pedalMode ? 0 : focusedGraceX);
    if (!isTimelineMode || playbackActive) {
      const position = timelineIndex.blockPositions.get(selectedBlockId) ?? 0;
      const entry = timelineIndex.measureAt(position);
      focusPosition = position * pixelsPerSixteenth;
      if (entry?.measure.id === selectedBlockId) focusPosition += entry.lengthSixteenths * pixelsPerSixteenth / 2;
    }

    const viewportWidth = Math.min(header.clientWidth, roll.clientWidth);
    const maxScrollLeft = Math.max(0, totalTimelineWidth + viewportWidth / 2 - viewportWidth);
    const scrollLeft = Math.max(0, Math.min(maxScrollLeft, focusPosition - viewportWidth / 2));
    animateTimelineScroll(scrollLeft);
  });
  $effect(() => {
    if (mode !== 'timeline' || !pianoRollViewport || !pitchScrollViewport) return;

    const pitchIndex = 108 - timelineCursor.pitch;
    const pitchRowCenter = pitchIndex * pitchRowHeight + pitchRowHeight / 2;
    const rollTop = Math.max(0, Math.min(
      pianoRollViewport.scrollHeight - pianoRollViewport.clientHeight,
      pitchTopMargin + pitchRowCenter - pianoRollViewport.clientHeight / 2,
    ));
    const pitchTop = Math.max(0, Math.min(
      pitchScrollViewport.scrollHeight - pitchScrollViewport.clientHeight,
      pitchTopMargin + pitchRowCenter - pitchScrollViewport.clientHeight / 2,
    ));
    animateTimelineVerticalScroll(rollTop, pitchTop);
  });

  function pitchLaneBackground(measureId: string) {
    const pitchClasses = measureKeyCache.get(measureId)?.pitchClasses;
    const stops: string[] = [];
    for (let index = 0; index < 12; index += 1) {
      const midi = 108 - index;
      const color = pitchClasses?.has(((midi % 12) + 12) % 12) ? '#f2f2f2' : '#e4e4e4';
      const top = index * 24;
      stops.push(`${color} ${top}px`, `${color} ${top + 23}px`, `#d2d9cb ${top + 23}px`, `#d2d9cb ${top + 24}px`);
    }
    return `repeating-linear-gradient(to bottom, ${stops.join(', ')})`;
  }
  const pitches = $derived.by(() => {

    return Array.from({ length: 88 }, (_, index) => {
      const midi = 108 - index;
      const pitchClass = midi % 12;
      const name = pitchClassNames[pitchClass];

      return {
        midi,
        label: `${name}${Math.floor(midi / 12) - 1}`,
        isSharp: name.includes('#'),
      };
    });
  });
</script>

<section class="timeline" class:pedal-mode={pedalMode || ottavaMode} class:expression-modal-open={expressionModalOpen} aria-label="Timeline panel">
  <div class="corner" aria-hidden="true"></div>
  <section class="time-header" aria-label="Time header">
    <div class="event-row" aria-label="Event row"></div>
    <div class="measure-row" aria-label="Measure row" bind:this={measureRow}>
      <div class="measure-row-spacer" style={`width: ${totalTimelineWidth}px`}></div>
      {#each visibleMeasures as item (item.measure.id)}
        {@const measure = item.measure}
        <div
          class="measure-header-block"
          class:range-selected={selectedOutlineMeasureIds.has(measure.id)}
          class:first-measure={item.layout.number === 1}
          class:focused={cursor.blockId === measure.id}
          aria-current={cursor.blockId === measure.id ? 'true' : undefined}
          style={`left: ${item.layout.start}px; width: ${item.layout.width}px`}
        >
          <div class="measure-start" aria-hidden="true"></div>
          <span class="measure-number">{item.layout.number}</span>
          {#each item.ticks as tick (tick.position)}
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
          class:cursor-pitch={playbackPosition === null && mode === 'timeline' && !ottavaMode && timelineCursor.pitch === pitch.midi}
          role="listitem"
        >
          {pitch.label}
        </div>
      {/each}
      <div class="pitch-margin bottom" aria-hidden="true"></div>
    </div>
  </section>
  <section class="piano-roll" aria-label="Piano roll" bind:this={pianoRollViewport} onscroll={syncTimelineScroll}>
    <div class="measure-track" class:playback-active={playbackPosition !== null} aria-label="Measure timeline">
      <div class="measure-track-spacer" style={`width: ${totalTimelineWidth}px`}></div>
      {#if playbackPosition !== null}
        <PlaybackPosition position={playbackPosition} {pixelsPerSixteenth} />
      {/if}
      {#if playbackPosition === null && mode === 'timeline' && !pedalMode && !ottavaMode && timelineCursor.focusedNoteId === null}
        <div
          class="timeline-cursor"
          class:invalid={cursorPlacementInvalid}
          style={`left: ${timelineCursor.positionSixteenths * pixelsPerSixteenth}px`}
          aria-hidden="true"
        >
          <div class="timeline-cursor-line"></div>
          <div
            class="timeline-cursor-note"
            style={`top: ${pitchTopMargin + (108 - timelineCursor.pitch) * pitchRowHeight}px; width: ${Math.max(0, cursorWidth - cursorLineWidth)}px`}
          ></div>
        </div>
        <span
          class="note-value-badge"
          style={`left: ${timelineCursor.positionSixteenths * pixelsPerSixteenth + cursorLineWidth + 4}px; top: ${pitchTopMargin + (108 - timelineCursor.pitch) * pitchRowHeight - 52}px`}
          aria-hidden="true"
        >
          <span class:fixed-input={inputTuplet !== undefined}>Input {WrittenValue.label(inputValue)}{inputTuplet ? ' T' : ''}</span>
        </span>
      {/if}
      {#if playbackPosition === null && mode === 'timeline' && !pedalMode && !ottavaMode && focusedNote}
        <span
          class="note-value-badge note-focused-value-badge"
          style={`left: ${(focusedNote.measureStartSixteenths + focusedNote.positionSixteenths) * pixelsPerSixteenth + focusedGraceX + 4}px; top: ${pitchTopMargin + (108 - timelineCursor.pitch) * pitchRowHeight - 52}px`}
          aria-hidden="true"
        >
          <span class="focused-note-value">{focusedGrace ? 'Grace' : 'Note'} {WrittenValue.label(focusedGrace?.grace.value ?? focusedNote.note.value)}{!focusedGrace && focusedNote.tuplet ? ' T' : ''}</span>
          {#if playbackPosition === null}
            <span class:fixed-input={inputTuplet !== undefined}>Input {WrittenValue.label(inputValue)}{inputTuplet ? ' T' : ''}</span>
          {/if}
        </span>
      {/if}
      {#if focusedBoundary !== null}
        <div
          class="section-focus-line"
          class:key-change-focus-line={focusedBoundary.keyChange}
          style={`left: ${focusedBoundary.position}px`}
          aria-hidden="true"
        ></div>
      {/if}
      {#each visibleMeasures as item (item.measure.id)}
        {@const measure = item.measure}
        {@const index = item.index}
        <div
          class="measure-region"
          class:range-selected={selectedOutlineMeasureIds.has(measure.id)}
          class:focused={mode !== 'timeline' && cursor.blockId === measure.id}
          aria-label={`Measure ${index + 1} timeline region`}
          aria-current={cursor.blockId === measure.id ? 'true' : undefined}
          style={`left: ${item.layout.start}px; width: ${item.layout.width}px`}
        >
          <div class="pitch-margin top" aria-hidden="true"></div>
          <div class="pitch-lanes" style={`background-image: ${pitchLaneBackground(measure.id)}`} aria-hidden="true"></div>
          <div class="pitch-margin bottom" aria-hidden="true"></div>
          {#each item.tuplets as tuplet (tuplet.id)}
            <div class="tuplet-column" style={`left: ${tuplet.start * pixelsPerSixteenth}px; width: ${tuplet.length * pixelsPerSixteenth}px`} aria-hidden="true"></div>
          {/each}
          {#each item.ticks as tick (tick.position)}
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
          {#each item.notes as entry (entry.note.id)}
            {@const note = entry.note}
            {#if trillNotes.has(note.id)}
              <div class="trill-mark" role="img" aria-label="Trill"
                class:inactive={pedalMode || mode === 'outline' || entry.staff !== timelineCursor.staff || entry.voiceIndex !== timelineCursor.voiceIndex}
                style={`left: ${entry.position*pixelsPerSixteenth}px; top: ${pitchTopMargin+(108-note.pitches[0].midi)*pitchRowHeight-21}px; width:${entry.length*pixelsPerSixteenth}px`}>
                {#if trillNotes.get(note.id)}<span>tr</span>{/if}<span class="trill-wave"></span>
              </div>
            {/if}
            {@const activeNoteHeight = entry.length % 4 === 0 ? 24 : entry.length % 2 === 0 ? 18 : 14}
            {@const noteTempo = entry.staff === 'upperStaff' && entry.voiceIndex === 0 ? tempoChanges?.find(change => change.noteId === note.id) : undefined}
            {@const noteDynamic = entry.staff === 'upperStaff' && entry.voiceIndex === 0 ? dynamicChanges.find(change => change.noteId === note.id) : undefined}
            {#if noteDynamic}
              <span class="dynamic-mark" aria-label={`Dynamics ${noteDynamic.level}`} style={`left: ${entry.position * pixelsPerSixteenth + 4}px; top: ${pitchTopMargin + (108 - note.pitches[note.pitches.length - 1].midi) * pitchRowHeight + pitchRowHeight + 8}px`}>{noteDynamic.level}</span>
            {/if}
            {#if noteTempo}
              <span class="tempo-mark" style={`left: ${entry.position * pixelsPerSixteenth}px; top: ${pitchTopMargin + (108 - note.pitches[0].midi) * pitchRowHeight - 38}px`}>Tempo {noteTempo.bpm}</span>
            {/if}
            {#if playbackPosition === null && mode === 'timeline' && !pedalMode && entry.staff === timelineCursor.staff && entry.voiceIndex === timelineCursor.voiceIndex}
              <div
                class="note-focus-column"
                class:focused={selectedNoteIds.has(note.id) && !focusedGrace}
                class:range-selected={selectedNoteIds.has(note.id) && selectedNotes.length > 1}
                class:range-endpoint={selectedNotes.length > 1 && timelineCursor.focusedNoteId === note.id}
                style={`left: ${entry.position * pixelsPerSixteenth}px; width: ${entry.length * pixelsPerSixteenth}px`}
                aria-hidden="true"
              ></div>
            {/if}
            {#each note.pitches as pitch, pitchIndex (`${note.id}-${pitch.midi}`)}
              {@const pitchInactive = pedalMode || mode === 'outline' || entry.staff !== timelineCursor.staff || entry.voiceIndex !== timelineCursor.voiceIndex}
              <div
                class="score-note-pitch"
                data-fingering-pitch={`${note.id}:${pitchIndex}`}
                id={pitchIndex === note.pitches.length - 1 ? `note-menu-anchor-${note.id}` : undefined}
                class:inactive={pitchInactive}
                class:timeline-inactive={mode === 'timeline' && pitchInactive}
                class:lower-staff={entry.staff === 'lowerStaff'}
                class:spelling-default={!pitch.spellingDirection}
                class:spelling-up={pitch.spellingDirection === 'up'}
                class:spelling-down={pitch.spellingDirection === 'down'}
                class:unselected={mode === 'timeline' && entry.staff === timelineCursor.staff && selectedNotes.length <= 1 && timelineCursor.focusedNoteId === note.id && timelineCursor.focusedPitchIndex !== pitchIndex}
                aria-label={`${entry.staff === 'upperStaff' ? 'Upper' : 'Lower'} staff note ${note.id}`}
                aria-current={mode === 'timeline' && !pedalMode && !ottavaMode && !focusedGrace && entry.staff === timelineCursor.staff && timelineCursor.focusedNoteId === note.id && timelineCursor.focusedPitchIndex === pitchIndex ? 'true' : undefined}
                style={`left: ${entry.position * pixelsPerSixteenth}px; top: ${pitchTopMargin + (108 - pitch.midi) * pitchRowHeight}px; width: ${entry.displayLength * pixelsPerSixteenth}px; --active-note-height: ${activeNoteHeight}px`}
              >{#if note.staccato && pitchIndex === 0}<span class="staccato-mark" aria-label={note.staccato.type === 'normal' ? 'Staccato' : 'Staccatissimo'}>{note.staccato.type === 'normal' ? '•' : '▾'}</span>{/if}{#if note.accent && pitchIndex === 0}<span class="accent-mark" aria-label="Accent">&gt;</span>{/if}{#if note.fermata && pitchIndex === 0}<span class="fermata-mark" style:top={note.staccato || note.accent ? "-36px" : "-22px"} aria-label="Fermata">𝄐</span>{/if}</div>
              {#if pitch.fingering !== undefined}
                <span class="fingering-badge" aria-hidden="true"
                  style={`left: ${entry.position * pixelsPerSixteenth - 2}px; top: ${pitchTopMargin + (108 - pitch.midi) * pitchRowHeight + (pitchInactive ? pitchRowHeight * 0.75 : (pitchRowHeight + activeNoteHeight) / 2) + 12}px; transform: translateY(-100%)`}
                >{pitch.fingering}{pitch.substitutionFingering === undefined ? '' : `-${pitch.substitutionFingering}`}</span>
              {/if}
            {/each}
            {#if note.arpeggio && note.pitches.length >= 2}
              {@const topPitch = Math.max(...note.pitches.map(pitch=>pitch.midi))}
              {@const bottomPitch = Math.min(...note.pitches.map(pitch=>pitch.midi))}
              {@const markHeight = (topPitch-bottomPitch+1)*pitchRowHeight-4}
              {@const waveHeight = markHeight-(note.arpeggio.type === 'down' ? 8 : 0)}
              <svg class="arpeggio-mark" role="img" aria-label={note.arpeggio.type === 'normal' ? 'Arpeggio normal' : 'Arpeggio down'}
                class:inactive={mode === 'outline' || pedalMode || entry.staff !== timelineCursor.staff || entry.voiceIndex !== timelineCursor.voiceIndex}
                width="10" height={markHeight} viewBox={`0 0 10 ${markHeight}`}
                style={`left: ${entry.position*pixelsPerSixteenth+2}px; top: ${pitchTopMargin+(108-topPitch)*pitchRowHeight+2}px`}>
                <path d={`M 5 1 ${Array.from({length:Math.floor(waveHeight/6)},(_,index)=>`q ${index%2 ? 5 : -5} 3 0 6`).join(' ')}`}></path>
                {#if note.arpeggio.type === 'down'}<path d={`M 1 ${markHeight-7} L 5 ${markHeight-1} L 9 ${markHeight-7}`}></path>{/if}
              </svg>
            {/if}
            {@const graceLayout = getGraceRollLayout(note.beforeGraceNotes?.length ?? 0, pixelsPerSixteenth)}
            {#each note.beforeGraceNotes ?? [] as grace, graceIndex (grace.id)}
              {@const geometry = graceLayout[graceIndex]}
              {@const graceSelected = playbackPosition === null && mode === 'timeline' && !pedalMode && entry.staff === timelineCursor.staff &&
                entry.voiceIndex === timelineCursor.voiceIndex && focusedGrace?.grace.id === grace.id}
              {#if graceSelected}
                <div class="note-focus-column focused" aria-hidden="true"
                  style={`left: ${entry.position * pixelsPerSixteenth + geometry.x - geometry.diameter / 2}px; width: ${geometry.diameter}px`}></div>
              {/if}
              {#each grace.pitches as pitch, pitchIndex (`${grace.id}-${pitch.midi}`)}
                <div class="score-grace-note" role="img"
                  class:spelling-default={!pitch.spellingDirection} class:spelling-up={pitch.spellingDirection === 'up'} class:spelling-down={pitch.spellingDirection === 'down'}
                  class:inactive={pedalMode || mode === 'outline' || entry.staff !== timelineCursor.staff || entry.voiceIndex !== timelineCursor.voiceIndex}
                  class:lower-staff={entry.staff === 'lowerStaff'}
                  class:timeline-inactive={mode === 'timeline' && (pedalMode || entry.staff !== timelineCursor.staff || entry.voiceIndex !== timelineCursor.voiceIndex)}
                  aria-label={`${entry.staff === 'upperStaff' ? 'Upper' : 'Lower'} staff grace ${graceIndex + 1} of ${note.id}, MIDI ${pitch.midi}`}
                  aria-current={graceSelected && pitchIndex === 0 ? 'true' : undefined}
                  style={`left: ${entry.position * pixelsPerSixteenth + geometry.x - geometry.diameter / 2}px; top: ${pitchTopMargin + (108 - pitch.midi) * pitchRowHeight + (pitchRowHeight - geometry.diameter) / 2}px; width: ${geometry.diameter}px; height: ${geometry.diameter}px`}></div>
              {/each}
            {/each}
          {/each}
          {#if mode === 'timeline' && !pedalMode && timelineCursor.voiceIndex > 0 && !measure.data[timelineCursor.staff].voices[timelineCursor.voiceIndex]}
            <div class="missing-voice-blind" aria-hidden="true"></div>
          {/if}
        </div>
      {/each}
      {#if mode === 'timeline' && visibleTiePaths.length > 0}
        <svg class="tie-links" width="100%" height="100%" aria-hidden="true">
          {#each visibleTiePaths as tie (tie.id)}
            <path d={tie.path}></path>
          {/each}
        </svg>
      {/if}
      {#if mode === 'timeline' && visibleSlurPaths.length > 0}
        <svg class="tie-links slur-links" width="100%" height="100%" aria-label="Slurs" role="img">
          {#each visibleSlurPaths as slur (slur.id)}<path d={slur.path} class:inactive={!slur.active}></path>{/each}
        </svg>
      {/if}
    </div>
  </section>
  {#if pedalMode}
    <div class="pedal-label">Pedal</div>
    <section class="pedal-lane" aria-label="Pedal editing lane" bind:this={pedalViewport}>
      <div class="pedal-track">
        <div class="pedal-ruler">
          <div class="pedal-ruler-spacer" style={`width: ${totalTimelineWidth}px`}></div>
          {#each visibleMeasures as item (item.measure.id)}
            <div class="pedal-measure" style={`left: ${item.layout.start}px; width: ${item.layout.width}px`}>
              <span>{item.layout.number}</span>
              {#each item.ticks as tick (tick.position)}
                <i class:major={tick.kind === 'bar' || tick.kind === 'beat'} style={`left: ${tick.position}px`}></i>
              {/each}
            </div>
          {/each}
        </div>
        {#if playbackPosition === null}
          <div class="pedal-unit-range" aria-hidden="true"
            style={`left: ${pedalCursor.position * pixelsPerSixteenth}px; width: ${WrittenValue.sixteenths(pedalCursor.value) * pixelsPerSixteenth}px`}></div>
        {/if}
        {#each visiblePedalSpans as span (span.start)}
          {@const startInset = pedalChangePositions.has(span.start) ? 2 : 0}
          {@const endInset = pedalChangePositions.has(span.end) ? 2 : 0}
          <div class="pedal-span" style={`left: ${span.start * pixelsPerSixteenth + startInset}px; width: ${Math.max(0, (span.end - span.start) * pixelsPerSixteenth - startInset - endInset)}px`}></div>
        {/each}
        {#each visiblePedalEvents as event (event.id)}
          <span class="pedal-event" class:release={event.action === 'stop'} class:retake={event.action === 'change'}
            role="img"
            aria-label={`Pedal ${event.action} at ${event.position}`}
            style={`left: ${event.position * pixelsPerSixteenth}px`}></span>
        {/each}
        {#if playbackPosition === null}
          <div class="pedal-cursor" style={`left: ${pedalCursor.position * pixelsPerSixteenth}px`}>
            <span class="note-value-badge pedal-input-badge">Input {WrittenValue.label(pedalCursor.value)}</span>
          </div>
        {/if}
      </div>
    </section>
  {/if}
  {#if ottavaMode}
    <div class="pedal-label ottava-label"><span>{timelineCursor.staff === 'upperStaff' ? 'Upper' : 'Lower'}</span><span>{timelineCursor.staff === 'upperStaff' ? '8va' : '8vb'}</span></div>
    <section class="pedal-lane ottava-lane" aria-label={`${timelineCursor.staff === 'upperStaff' ? 'Upper staff 8va' : 'Lower staff 8vb'} editing lane`} bind:this={pedalViewport}>
      <div class="pedal-track">
        <div class="pedal-ruler">
          <div class="pedal-ruler-spacer" style={`width: ${totalTimelineWidth}px`}></div>
          {#each visibleMeasures as item (item.measure.id)}
            <div class="pedal-measure" style={`left: ${item.layout.start}px; width: ${item.layout.width}px`}>
              <span>{item.layout.number}</span>
              {#each item.ticks as tick (tick.position)}<i class:major={tick.kind === 'bar' || tick.kind === 'beat'} style={`left: ${tick.position}px`}></i>{/each}
            </div>
          {/each}
        </div>
        {#if playbackPosition === null}
          <div class="pedal-unit-range" aria-hidden="true" style={`left: ${ottavaCursor.position * pixelsPerSixteenth}px; width: ${WrittenValue.sixteenths(ottavaCursor.value) * pixelsPerSixteenth}px`}></div>
        {/if}
        {#each visibleOttavaSpans as span (`${span.start}-${span.end}`)}
          <div class="ottava-span" style={`left: ${span.start * pixelsPerSixteenth}px; width: ${Math.max(0, (span.end - span.start) * pixelsPerSixteenth)}px`}>
            <span>{timelineCursor.staff === 'upperStaff' ? '8va' : '8vb'}</span>
          </div>
        {/each}
        {#each visibleOttavaEvents as event (event.id)}
          <span class="pedal-event" class:release={event.action === 'stop'} role="img" aria-label={`Ottava ${event.action} at ${event.position}`} style={`left: ${event.position * pixelsPerSixteenth}px`}></span>
        {/each}
        {#if playbackPosition === null}
          <div class="pedal-cursor" style={`left: ${ottavaCursor.position * pixelsPerSixteenth}px`}>
            <span class="note-value-badge pedal-input-badge">Input {WrittenValue.label(ottavaCursor.value)}</span>
          </div>
        {/if}
      </div>
    </section>
  {/if}
  {#if mode === 'timeline' && !expressionModalOpen}
  <aside class="selection-status" aria-label="Current measure, staff and voice">
    <div class="selection-status-measure">Measure {statusMeasureNumber ?? '—'}</div>
    {#each staffNames as staff (staff)}
      {@const active = mode === 'timeline' && !pedalMode && timelineCursor.staff === staff}
      <div class="selection-status-row" class:upper={staff === 'upperStaff'} class:lower={staff === 'lowerStaff'} class:active>
        <span class="selection-status-staff" class:active aria-current={active ? 'true' : undefined}>
          {staff === 'upperStaff' ? 'Upper' : 'Lower'}
        </span>
        {#each statusMeasure?.data[staff].voices ?? [] as voice, index (voice.id)}
          <span class="selection-status-voice" class:active={active && timelineCursor.voiceIndex === index}
            aria-current={active && timelineCursor.voiceIndex === index ? 'true' : undefined}>{index + 1}</span>
        {/each}
      </div>
    {/each}
  </aside>
  {/if}
  {#if !expressionModalOpen}
    <ScorePreview {outline} {trills} {tempoChanges} {clefChanges} {slurs} {dynamicChanges}
      selectedNoteIds={mode !== 'timeline' || playbackPosition !== null || pedalMode || ottavaMode ? [] : selectedNotes.map(entry => entry.note.id)} activeIndex={previewActiveIndex} />
  {/if}
</section>

<style>
  .slur-links path { stroke: #426078; stroke-width: 2; fill: none; }
  .slur-links path.inactive { opacity: 0.4; }
  .dynamic-mark { position: absolute; z-index: 8; color: #243b45; font: bold italic 18px Georgia, serif; line-height: 20px; pointer-events: none; }
  .tempo-mark { position: absolute; z-index: 8; white-space: nowrap; font-size: 12px; color: #304b55; background: #edf3f3d9; border-radius: 2px; padding: 2px 4px; pointer-events: none; }
  .trill-mark { position:absolute; z-index:7; height:18px; display:flex; align-items:center; color:#243b45; pointer-events:none; font:bold italic 16px Georgia,serif; }
  .trill-mark.inactive { opacity:0.7; }
  .trill-wave { flex:1; height:8px; background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3Cpath d='M0 4 Q2 0 4 4 T8 4' fill='none' stroke='%23243b45' stroke-width='1.5'/%3E%3C/svg%3E") repeat-x center; }
  .staccato-mark { position: absolute; left: 50%; top: -16px; transform: translateX(-50%); font-size: 20px; line-height: 14px; color: #243b45; pointer-events: none; }
  .fermata-mark { position: absolute; left: 50%; transform: translateX(-50%); font-family: 'Segoe UI Symbol', 'Noto Music', serif; font-size: 22px; line-height: 20px; color: #243b45; pointer-events: none; }
  .accent-mark { position: absolute; left: 50%; top: -18px; transform: translateX(-50%); font-size: 18px; font-weight: 700; line-height: 14px; color: #243b45; pointer-events: none; }
  .arpeggio-mark { position: absolute; z-index: 7; overflow: visible; fill: none; stroke: #243b45; stroke-width: 1.8px; pointer-events: none; }
  .arpeggio-mark.inactive { opacity: 0.6; }
  .timeline {
    position: relative;
    display: grid;
    grid-template-columns: var(--pitch-width) minmax(0, 1fr);
    grid-template-rows: var(--timeline-header-height) minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
  }
  .timeline.expression-modal-open::after { content: ''; position: absolute; inset: 0; z-index: 90; background: rgba(0, 0, 0, 0.55); }

  .timeline.pedal-mode { grid-template-rows: var(--timeline-header-height) minmax(0, 1fr) 64px; }
  .pedal-label { grid-row: 3; grid-column: 1; padding: 8px; background: #c2d9db; border-top: 1px solid #829fa2; }
  .ottava-label { display: flex; flex-direction: column; justify-content: center; gap: 3px; line-height: 1.15; }
  .pedal-lane { grid-row: 3; grid-column: 2; overflow: hidden; background: #e0eded; border-top: 1px solid #829fa2; min-width: 0; container-type: inline-size; }
  .pedal-track { position: relative; width: max-content; min-width: 100%; height: 64px; padding-right: 50cqw; }
  .pedal-ruler { position: relative; display: block; height: 20px; }
  .pedal-ruler-spacer { height: 1px; }
  .pedal-measure { position: absolute; top: 0; height: 20px; font-size: 10px; }
  .pedal-measure span { position: absolute; left: 3px; top: 0; }
  .pedal-measure i { position: absolute; bottom: 0; height: 5px; width: 1px; background: #91acaf; }
  .pedal-measure i.major { height: 10px; background: #617e81; }
  .pedal-unit-range { position: absolute; top: 0; height: 20px; background: rgba(245, 149, 48, 0.22); pointer-events: none; }
  .pedal-span { position: absolute; top: 50px; height: 10px; background: linear-gradient(to right, rgb(88, 124, 136), rgba(88, 124, 136, 0.3)); }
  .ottava-span { position: absolute; top: 32px; height: 18px; border-top: 2px solid #587c88; border-right: 2px solid #587c88; border-left: 2px solid #587c88; box-sizing: border-box; color: #304b55; font: italic 600 13px Georgia, serif; }
  .ottava-span span { position: absolute; left: 4px; top: -17px; padding: 0 3px; background: #e0eded; }
  .pedal-event { position: absolute; top: 33px; width: 10px; height: 16px; transform: translateX(-50%); background: #d93636; z-index: 4; }
  .pedal-event.release { background: #3478d4; }
  .pedal-event.retake { background: #ebc532; }
  .pedal-cursor { position: absolute; top: 20px; bottom: 0; width: 2px; background: #d93636; z-index: 5; }
  .pedal-cursor .pedal-input-badge { top: -4px; left: 14px; opacity: 0.9; }

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
    position: relative;
    display: flex;
    min-width: 0;
    overflow: hidden;
    background: #b6dfdb;
  }

  .measure-row::after {
    flex: 0 0 50cqw;
    content: '';
  }

  .measure-row-spacer { height: 1px; flex: 0 0 auto; }

  .measure-header-block {
    position: absolute;
    top: 0;
    flex: 0 0 auto;
    height: 40px;
  }

  .measure-header-block.focused {
    background: #f6be224f;
  }
  .measure-header-block.range-selected { background: rgba(239, 68, 68, 0.23); }
  .measure-header-block.range-selected.focused { background: rgba(239, 68, 68, 0.32); }

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

  .measure-header-block.first-measure .measure-start {
    left: 4px;
  }

  .measure-header-block.first-measure .measure-number {
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
    grid-column: 2;
    grid-row: 2;
    position: relative;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: #edf0df;
    container-type: inline-size;
  }

  .selection-status {
    box-sizing: border-box;
    width: 170px;
    grid-column: 2;
    grid-row: 2;
    position: relative;
    z-index: 20;
    align-self: start;
    justify-self: start;
    margin: 8px;
    padding: 5px;
    border: 1px solid #899ca2;
    border-radius: 4px;
    background: rgba(242, 247, 245, 0.95);
    color: #354c55;
    font-size: 12px;
    line-height: 20px;
    pointer-events: none;
  }

  .selection-status-measure {
    padding: 0 5px 3px;
    font-weight: 600;
  }

  .selection-status-row {
    display: flex;
    gap: 3px;
    margin-top: 2px;
    padding: 2px 0;
  }

  .selection-status-staff,
  .selection-status-voice {
    padding: 0 5px;
    border-radius: 2px;
  }

  .selection-status-voice {
    min-width: 20px;
    text-align: center;
  }

  .selection-status-staff {
    min-width: 45px;
  }

  .selection-status-row.upper {
    color: #244b88;
  }

  .selection-status-row.lower {
    color: #963e3e;
  }

  .selection-status-row.upper.active {
    background: rgba(0, 0, 100, 0.6);
  }

  .selection-status-row.lower.active {
    background: rgba(100, 0, 0, 0.6);
  }

  .selection-status-row.active {
    color: #fff;
    font-weight: 700;
  }

  .selection-status-voice.active {
    background: rgba(255, 241, 173, 0.5);
    /* color: #453d20; */
  }

  .measure-track {
    position: absolute;
    top: 0;
    left: 0;
    display: flex;
    width: max-content;
    background: #edf0df;
  }

  .measure-track-spacer {
    flex: 0 0 auto;
    height: calc(var(--pitch-top-margin) + 2112px + var(--pitch-bottom-margin));
  }

  .measure-track.playback-active::before {
    position: absolute;
    z-index: 3;
    inset: 0;
    background: rgba(0, 0, 0, 0.16);
    content: '';
    pointer-events: none;
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
  .section-focus-line.key-change-focus-line { background: #2563d9; }

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

  .note-value-badge {
    position: absolute;
    top: -52px;
    left: 4px;
    z-index: 9;
    padding: 0 6px;
    border-radius: 4px;
    background: rgba(75, 0, 0, 0.7);
    color: #fff;
    font-size: 14px;
    font-weight: 600;
    line-height: 24px;
    white-space: nowrap;
    pointer-events: none;
  }

  .note-focused-value-badge {
    z-index: 9;
    display: flex;
    gap: 10px;
  }

  .focused-note-value {
    color: #ffe0ad;
  }

  .fixed-input {
    color: #9ee8ff;
  }

  .tie-links {
    position: absolute;
    z-index: 7;
    top: 0;
    left: 0;
    overflow: visible;
    pointer-events: none;
    fill: none;
    stroke: #334f3c;
    stroke-width: 2;
  }

  .measure-region {
    position: absolute;
    top: 0;
    display: flex;
    flex-direction: column;
    flex: 0 0 auto;
    height: 100%;
  }

  .missing-voice-blind {
    position: absolute;
    inset: 0;
    z-index: 8;
    background: #000;
    opacity: 0.4;
    pointer-events: none;
  }

  .pitch-lanes {
    flex: 0 0 2112px;
    height: 2112px;
    background-repeat: repeat-y;
    background-size: 100% 288px;
  }

  .score-note-pitch {
    position: absolute;
    z-index: 5;
    height: var(--pitch-row-height);
    border-radius: 2px 8px 8px 2px;
    opacity: 0.92;
  }

  .score-grace-note { position: absolute; z-index: 8; border-radius: 50%; opacity: 0.92; pointer-events: none; }
  .score-grace-note.spelling-default { border: 1px solid #256b32; background: linear-gradient(#85ec84, #32bd47); }
  .score-grace-note.spelling-up { border: 1px solid #9a7a00; background: linear-gradient(#ffe477, #f2c230); }
  .score-grace-note.spelling-down { border: 1px solid #a64b00; background: linear-gradient(#ffb264, #ed7d24); }
  .score-grace-note.inactive { border: 0; background: linear-gradient(to bottom, rgb(0, 0, 100), rgb(60, 60, 165) 50%, rgb(0, 0, 100)); opacity: 0.8; }
  .score-grace-note.inactive.lower-staff { background: linear-gradient(to bottom, rgb(100, 0, 0), rgb(165, 60, 60) 50%, rgb(100, 0, 0)); }
  .score-grace-note.timeline-inactive { opacity: 0.6; }

  .score-note-pitch.spelling-default {
    border: 1px solid #256b32;
    background: linear-gradient(#85ec84, #32bd47);
  }

  .score-note-pitch.spelling-up {
    border: 1px solid #9a7a00;
    background: linear-gradient(#ffe477, #f2c230);
  }

  .score-note-pitch.spelling-down {
    border: 1px solid #a64b00;
    background: linear-gradient(#ffb264, #ed7d24);
  }

  .score-note-pitch.unselected {
    opacity: 1;
  }

  .score-note-pitch.unselected.spelling-default {
    border-color: rgba(37, 107, 50, 0.35);
    background: linear-gradient(rgba(133, 236, 132, 0.35), rgba(50, 189, 71, 0.35));
  }

  .score-note-pitch.unselected.spelling-up {
    border-color: rgba(154, 122, 0, 0.35);
    background: linear-gradient(rgba(255, 228, 119, 0.35), rgba(242, 194, 48, 0.35));
  }

  .score-note-pitch.unselected.spelling-down {
    border-color: rgba(166, 75, 0, 0.35);
    background: linear-gradient(rgba(255, 178, 100, 0.35), rgba(237, 125, 36, 0.35));
  }

  .score-note-pitch.inactive {
    height: calc(var(--pitch-row-height) / 2);
    margin-top: calc(var(--pitch-row-height) / 4);
    border: 0;
    border-radius: 0;
    background: linear-gradient(to bottom, rgb(0, 0, 100), rgb(60, 60, 165) 50%, rgb(0, 0, 100));
    opacity: 0.8;
  }

  .score-note-pitch.inactive.lower-staff {
    background: linear-gradient(to bottom, rgb(100, 0, 0), rgb(165, 60, 60) 50%, rgb(100, 0, 0));
  }

  .score-note-pitch.timeline-inactive {
    opacity: 0.6;
  }

  .score-note-pitch:not(.inactive) {
    z-index: 6;
    height: var(--active-note-height);
    margin-top: calc((var(--pitch-row-height) - var(--active-note-height)) / 2);
  }

  .fingering-badge {
    position: absolute;
    z-index: 30;
    padding: 3px 7px;
    border-radius: 3px;
    background: #152157c6;
    color: #fff;
    font-size: 12px;
    font-weight: 600;
    line-height: 12px;
    white-space: nowrap;
    pointer-events: none;
  }

  .note-focus-column {
    position: absolute;
    z-index: 0;
    top: var(--pitch-top-margin);
    bottom: var(--pitch-bottom-margin);
    background: rgba(0, 0, 0, 0.06);
    pointer-events: none;
  }

  .tuplet-column {
    position: absolute;
    z-index: 0;
    top: var(--pitch-top-margin);
    bottom: var(--pitch-bottom-margin);
    background: rgba(52, 132, 220, 0.14);
    pointer-events: none;
  }

  .note-focus-column.focused {
    background: rgba(255, 242, 0, 0.121);
  }

  .note-focus-column.range-selected {
    background: rgba(239, 68, 68, 0.23);
  }

  .note-focus-column.range-endpoint {
    background: rgba(239, 68, 68, 0.32);
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

  .measure-region.focused::after,
  .measure-region.range-selected::after {
    position: absolute;
    z-index: 0;
    inset: 0;
    background: #ffec3d2c;
    content: '';
    pointer-events: none;
  }
  .measure-region.range-selected::after { background: rgba(239, 68, 68, 0.23); }
  .measure-region.range-selected.focused::after { background: rgba(239, 68, 68, 0.32); }

</style>
