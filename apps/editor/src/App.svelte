<script lang="ts">
  import OutlinePanel from './components/OutlinePanel.svelte';
  import TimelinePanel from './components/TimelinePanel.svelte';
  import { createProject, type ScoreProject } from './model/project';
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

  const pitchClassNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  function formatPitch(pitch: number): string {
    return `${pitchClassNames[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
  }

  function syncOutlineToTimelinePosition(positionSixteenths: number) {
    const block = getOutlineBlockAtPosition(project.outline, positionSixteenths);
    if (block && block.id !== outlineCursor.blockId) outlineCursor = { blockId: block.id };
  }

  function handleKeydown(event: KeyboardEvent) {
    if (
      event.defaultPrevented || event.isComposing ||
      event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
    ) return;
    const isToggleModeKey = event.key.toLowerCase() === 'r';
    const isMoveKey = event.key === 'ArrowUp' || event.key === 'ArrowDown';
    const isMoveSectionKey = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
    const isAddMeasureKey = event.key.toLowerCase() === 'a';
    const isAddSectionKey = event.key.toLowerCase() === 's';
    const isOperationRateKey = mode === 'timeline' && ['1', '2', '3'].includes(event.key);
    if (!isToggleModeKey && !isMoveKey && !isMoveSectionKey && !isAddMeasureKey && !isAddSectionKey && !isOperationRateKey) return;

    const target = event.target;
    if (target instanceof HTMLElement && (
      target.isContentEditable || target.closest('input, textarea, select')
    )) return;

    event.preventDefault();
    if (isToggleModeKey) {
      if (mode === 'outline') {
        const positionSixteenths = getOutlinePositionSixteenths(project.outline, outlineCursor.blockId);
        timelineCursor = { ...timelineCursor, positionSixteenths };
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
        const notePitch = focusedNote?.note.pitches[0]?.midi ?? timelineCursor.pitch;
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
        if (timelineCursor.focusedNoteId === null) {
          timelineCursor = moveTimelineCursorPitch(
            timelineCursor,
            direction,
          );
        } else {
          const result = moveFocusedTimelineNotePitch(project, timelineCursor, direction);
          if (result) {
            project = result.project;
            timelineCursor = result.cursor;
          }
        }
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
