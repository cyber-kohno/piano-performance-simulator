<script lang="ts">
  import OutlinePanel from './components/OutlinePanel.svelte';
  import TimelinePanel from './components/TimelinePanel.svelte';
  import { createProject, type ScoreProject } from './model/project';
  import { createKeyHold } from './state/key-hold.svelte';
  import {
    createTimelineCursor,
    addTimelineNoteAt,
    findTimelineNoteAtMove,
    getLocatedTimelineNote,
    getOutlineBlockAtPosition,
    getOutlinePositionSixteenths,
    getOperationStepSixteenths,
    getOperationUnitForDuration,
    getTimelineLengthSixteenths,
    moveTimelineCursorHorizontally,
    moveTimelineCursorPitch,
    moveFocusedTimelineNotePitch,
    setTimelineOperationUnit,
    addFocusedNotePitch,
    selectFocusedNotePitch,
    deleteFocusedTimelineNote,
    focusAdjacentTimelineNote,
  } from './state/timeline-cursor';
  import {
    addMeasureAfterCursor,
    addSectionAfterCursor,
    createOutlineCursor,
    moveOutlineCursor,
    moveOutlineSection,
  } from './state/outline-cursor';

  const initialProject = createProject();
  let project = $state<ScoreProject>(initialProject);
  let outlineCursor = $state(createOutlineCursor(initialProject.outline));
  let timelineCursor = $state(createTimelineCursor());
  let mode = $state<'outline' | 'timeline'>('outline');
  const keyHold = createKeyHold();

  const pitchClassNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  function formatPitch(pitch: number): string {
    return `${pitchClassNames[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
  }

  function syncOutlineToTimelinePosition(positionSixteenths: number) {
    const block = getOutlineBlockAtPosition(project.outline, positionSixteenths);
    if (block && block.id !== outlineCursor.blockId) outlineCursor = { blockId: block.id };
  }

  function movePitch(direction: -1 | 1, diatonic = false) {
    const keySignature = diatonic ? project.outline[0].data.keySignature : undefined;
    if (timelineCursor.focusedNoteId === null) {
      timelineCursor = moveTimelineCursorPitch(timelineCursor, direction, keySignature);
    } else {
      const result = moveFocusedTimelineNotePitch(project, timelineCursor, direction, keySignature);
      if (result) {
        project = result.project;
        timelineCursor = result.cursor;
      }
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (
      event.defaultPrevented || event.isComposing ||
      event.altKey || event.ctrlKey || event.metaKey
    ) return;
    const isToggleModeKey = event.key.toLowerCase() === 'r';
    const isMoveKey = event.key === 'ArrowUp' || event.key === 'ArrowDown';
    const isMoveSectionKey = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
    const isAddMeasureKey = event.key.toLowerCase() === 'a';
    const isAddSectionKey = event.key.toLowerCase() === 's';
    const isOperationRateKey = mode === 'timeline' && ['1', '2', '3'].includes(event.key);
    const isDeleteKey = mode === 'timeline' && event.key === 'Delete';
    if (!isToggleModeKey && !isMoveKey && !isMoveSectionKey && !isAddMeasureKey && !isAddSectionKey && !isOperationRateKey && !isDeleteKey) return;

    const target = event.target;
    if (target instanceof HTMLElement && (
      target.isContentEditable || target.closest('input, textarea, select')
    )) return;

    event.preventDefault();
    // Shift retains pitch-selection priority; C alone only enables pitch movement.
    if (keyHold.diatonicMovement && !keyHold.pitchSelection && !event.shiftKey) {
      if (mode === 'timeline' && isMoveKey) movePitch(event.key === 'ArrowUp' ? 1 : -1, true);
      return;
    }
    if (keyHold.noteNavigation && !keyHold.pitchSelection && !event.shiftKey) {
      if (mode === 'timeline' && isMoveSectionKey) {
        timelineCursor = focusAdjacentTimelineNote(
          project.outline, timelineCursor, event.key === 'ArrowLeft' ? -1 : 1,
        );
        syncOutlineToTimelinePosition(timelineCursor.positionSixteenths);
      }
      return;
    }
    if (isDeleteKey) {
      const result = deleteFocusedTimelineNote(project, timelineCursor, keyHold.pitchSelection || event.shiftKey);
      if (result) {
        project = result.project;
        timelineCursor = result.cursor;
        syncOutlineToTimelinePosition(timelineCursor.positionSixteenths);
      }
      return;
    }
    if (keyHold.pitchSelection || event.shiftKey) {
      if (mode !== 'timeline' || timelineCursor.focusedNoteId === null) return;
      if (isAddMeasureKey) {
        const result = addFocusedNotePitch(project, timelineCursor);
        if (result) {
          project = result.project;
          timelineCursor = result.cursor;
        }
      } else if (isMoveKey) {
        timelineCursor = selectFocusedNotePitch(
          project, timelineCursor, event.key === 'ArrowUp' ? 1 : -1,
        );
      }
      return;
    }
    if (isToggleModeKey) {
      if (mode === 'outline') {
        const positionSixteenths = getOutlinePositionSixteenths(project.outline, outlineCursor.blockId);
        const meter = project.outline[0].data.timeSignature;
        const isCompoundMeter = meter.unit === 8 && meter.cnt >= 6 && meter.cnt % 3 === 0;
        timelineCursor = {
          ...timelineCursor,
          positionSixteenths,
          operationUnit: { cnt: isCompoundMeter ? 3 : 1, unit: meter.unit },
          focusedNoteId: null,
          focusedPitchIndex: null,
        };
        const block = getOutlineBlockAtPosition(project.outline, positionSixteenths);
        if (block) outlineCursor = { blockId: block.id };
        mode = 'timeline';
      } else {
        mode = 'outline';
      }
      return;
    }

    if (mode === 'timeline') {
      if (event.key.toLowerCase() === 'a') {
        const focusedNote = timelineCursor.focusedNoteId
          ? getLocatedTimelineNote(project.outline, timelineCursor.focusedNoteId)
          : undefined;
        const noteEndPosition = focusedNote
          ? focusedNote.measureStartSixteenths + focusedNote.note.positionSixteenths +
            getOperationStepSixteenths(focusedNote.note.duration)
          : timelineCursor.positionSixteenths;
        const notePitch = timelineCursor.pitch;
        const result = addTimelineNoteAt(project, timelineCursor, noteEndPosition, notePitch);
        if (result) {
          project = result.project;
          timelineCursor = result.cursor;
          syncOutlineToTimelinePosition(timelineCursor.positionSixteenths);
        }
      } else if (isOperationRateKey) {
        timelineCursor = setTimelineOperationUnit(timelineCursor, event.key);
        syncOutlineToTimelinePosition(timelineCursor.positionSixteenths);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const direction = event.key === 'ArrowLeft' ? -1 : 1;
        const focusedNote = timelineCursor.focusedNoteId
          ? getLocatedTimelineNote(project.outline, timelineCursor.focusedNoteId)
          : undefined;

        if (focusedNote) {
          const noteStart = focusedNote.measureStartSixteenths + focusedNote.note.positionSixteenths;
          const noteEnd = noteStart + getOperationStepSixteenths(focusedNote.note.duration);
          const targetPosition = direction < 0 ? noteStart : noteEnd;
          const noteOperationUnit = getOperationUnitForDuration(focusedNote.note.duration);
          const totalLength = getTimelineLengthSixteenths(project.outline);
          if (targetPosition < 0 || targetPosition >= totalLength - 1e-8) return;

          timelineCursor = {
            ...timelineCursor,
            positionSixteenths: targetPosition,
            operationUnit: noteOperationUnit ?? timelineCursor.operationUnit,
            focusedNoteId: null,
            focusedPitchIndex: null,
          };
          syncOutlineToTimelinePosition(targetPosition);
        } else {
          const collidedNote = findTimelineNoteAtMove(project.outline, timelineCursor, direction);
          if (collidedNote) {
            const noteOperationUnit = getOperationUnitForDuration(collidedNote.note.duration);
            timelineCursor = {
              ...timelineCursor,
              pitch: collidedNote.note.pitches[0]?.midi ?? timelineCursor.pitch,
              operationUnit: noteOperationUnit ?? timelineCursor.operationUnit,
              focusedNoteId: collidedNote.note.id,
              focusedPitchIndex: 0,
            };
            syncOutlineToTimelinePosition(collidedNote.measureStartSixteenths);
          } else {
            timelineCursor = moveTimelineCursorHorizontally(
              timelineCursor,
              project.outline,
              direction,
            );
            syncOutlineToTimelinePosition(timelineCursor.positionSixteenths);
          }
        }
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const direction = event.key === 'ArrowUp' ? 1 : -1;
        movePitch(direction);
      }
      return;
    }

    if (isAddMeasureKey) {
      const result = addMeasureAfterCursor(project.outline, outlineCursor);
      project = { ...project, outline: result.outline };
      outlineCursor = result.cursor;
      return;
    }
    if (isAddSectionKey) {
      project = {
        ...project,
        outline: addSectionAfterCursor(project.outline, outlineCursor),
      };
      return;
    }

    if (isMoveSectionKey) {
      outlineCursor = moveOutlineSection(
        outlineCursor,
        project.outline,
        event.key === 'ArrowLeft' ? -1 : 1,
      );
      return;
    }

    outlineCursor = moveOutlineCursor(
      outlineCursor,
      project.outline,
      event.key === 'ArrowUp' ? -1 : 1,
    );
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="editor">
  <header class="app-header">
    <h1>PIANO <span>EDITOR</span></h1>
    <div class="mode-labels" aria-label="Editing modes">
      <span class:active={mode === 'outline'}>Outline</span>
      <span class:active={mode === 'timeline'}>Timeline</span>
    </div>
    <p class="editing-target">
      Upper staff <span>/</span> Voice 0
      {#if mode === 'timeline'}
        <span>/</span> {formatPitch(timelineCursor.pitch)}
      {/if}
    </p>
  </header>

  <main class="workspace" aria-label="Score editing workspace">
    <OutlinePanel outline={project.outline} cursor={outlineCursor} />
    <TimelinePanel
      outline={project.outline}
      cursor={outlineCursor}
      timelineCursor={timelineCursor}
      mode={mode}
    />
  </main>
</div>

<style>
  .editor {
    display: grid;
    grid-template-rows: var(--app-header-height) minmax(0, 1fr);
    width: 100%;
    height: 100%;
    min-width: var(--editor-min-width);
    min-height: var(--editor-min-height);
  }

  .app-header {
    display: flex;
    align-items: center;
    gap: 24px;
    padding: 0 16px;
    border-bottom: 1px solid var(--border-color);
    background: #c5dcd9;
  }

  h1 {
    flex: 0 0 auto;
    margin: 0;
    font-size: 13px;
    letter-spacing: 0.1em;
  }

  h1 span {
    font-weight: 400;
  }

  .mode-labels {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }

  .mode-labels span {
    padding: 4px 10px;
    border: 1px solid #779b9555;
    border-radius: 3px;
  }

  .mode-labels span.active {
    background: #64beb4;
    color: #fff;
  }

  .editing-target {
    margin: 0 0 0 auto;
    white-space: nowrap;
    font-size: 12px;
  }

  .editing-target span {
    margin: 0 4px;
    opacity: 0.5;
  }

  .workspace {
    display: grid;
    grid-template-columns: var(--outline-width) minmax(0, 1fr);
    min-height: 0;
  }

</style>
