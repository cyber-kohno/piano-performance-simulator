<script lang="ts">
  import OutlinePanel from './components/OutlinePanel.svelte';
  import TimelinePanel from './components/TimelinePanel.svelte';
  import { createProject, getNoteValueSixteenths, type ScoreProject } from './model/project';
  import { createKeyHold } from './state/key-hold.svelte';
  import {
    createTimelineCursor,
    setTimelineCursorUnit,
    TIMELINE_CURSOR_UNITS,
    setFocusedTimelineNoteType,
    toggleFocusedTimelineNoteDot,
    moveFocusedTimelineNote,
    appendFocusedTimelineTie,
    duplicateFocusedTimelineNoteAfter,
    resizeFocusedTimelineTie,
    addTimelineNoteAt,
    findTimelineNoteAtMove,
    getLocatedTimelineNote,
    getOutlineBlockAtPosition,
    getOutlinePositionSixteenths,
    getTimelineLengthSixteenths,
    moveTimelineCursorHorizontally,
    moveTimelineCursorPitch,
    moveFocusedTimelineNotePitch,
    addFocusedNotePitch,
    selectFocusedNotePitch,
    deleteFocusedTimelineNote,
    focusAdjacentTimelineNote,
    toggleTieToAdjacentTimelineNote,
    getSelectedTimelineNotes,
    extendTimelineNoteSelection,
    collapseTimelineNoteSelection,
    transposeSelectedTimelineNotes,
    resetTimelineCursorForStaff,
    switchTimelineStaff,
  } from './state/timeline-cursor';
  import {
    addMeasureAfterCursor,
    addSectionAfterCursor,
    createOutlineCursor,
    deleteOutlineBlock,
    moveOutlineCursor,
    moveOutlineSection,
  } from './state/outline-cursor';

  const initialProject = createProject();
  let project = $state<ScoreProject>(initialProject);
  let outlineCursor = $state(createOutlineCursor(initialProject.outline));
  let timelineCursor = $state(createTimelineCursor());
  let mode = $state<'outline' | 'timeline'>('outline');
  const keyHold = createKeyHold();
  const selectedTimelineNotes = $derived(getSelectedTimelineNotes(project.outline, timelineCursor));

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
    const isDeleteKey = event.key === 'Delete';
    const isEscapeKey = mode === 'timeline' && event.key === 'Escape';
    const isToggleAdjacentTieKey = mode === 'timeline' && (event.key === '=' || event.code === 'Equal');
    const isCursorUnitKey = mode === 'timeline' && TIMELINE_CURSOR_UNITS.some((unit) => unit.key === event.key);
    const isDotKey = mode === 'timeline' && event.key === '.';
    if (!isToggleModeKey && !isMoveKey && !isMoveSectionKey && !isAddMeasureKey && !isAddSectionKey && !isDeleteKey && !isCursorUnitKey && !isDotKey && !isToggleAdjacentTieKey && !isEscapeKey) return;

    const target = event.target;
    if (target instanceof HTMLElement && (
      target.isContentEditable || target.closest('input, textarea, select')
    )) return;

    event.preventDefault();
    if (isToggleModeKey && (keyHold.rangeSelection || event.shiftKey)) {
      if (mode === 'timeline' && !event.repeat) {
        timelineCursor = switchTimelineStaff(project.outline, timelineCursor);
        syncOutlineToTimelinePosition(timelineCursor.positionSixteenths);
      }
      return;
    }
    if (isToggleModeKey && event.repeat) return;
    if (isEscapeKey) {
      timelineCursor = {
        ...timelineCursor, selectionAnchorNoteId: null,
        focusedPitchIndex: selectedTimelineNotes.length > 1 ? 0 : timelineCursor.focusedPitchIndex,
      };
      return;
    }
    if ((keyHold.rangeSelection || event.shiftKey) && isMoveSectionKey) {
      if (mode === 'timeline') {
        timelineCursor = extendTimelineNoteSelection(project.outline, timelineCursor, event.key === 'ArrowLeft' ? -1 : 1);
        syncOutlineToTimelinePosition(timelineCursor.positionSixteenths);
      }
      return;
    }
    if (selectedTimelineNotes.length > 1) {
      if (isMoveKey) {
        const result = transposeSelectedTimelineNotes(project, timelineCursor, event.key === 'ArrowUp' ? 1 : -1);
        if (result) {
          project = result.project;
          timelineCursor = result.cursor;
        }
        return;
      }
      const plain = !keyHold.noteValueEditing && !keyHold.notePositionEditing &&
        !keyHold.diatonicMovement && !keyHold.pitchSelection;
      const navigation = isMoveSectionKey && (plain || keyHold.noteNavigation);
      const rangeMove = isMoveSectionKey && keyHold.notePositionEditing && !keyHold.noteValueEditing && !keyHold.pitchSelection;
      // Other editing commands require returning to a single focused note first.
      if (!navigation && !rangeMove && !(plain && (isDeleteKey || isToggleModeKey || isCursorUnitKey))) return;
    }
    if (isToggleAdjacentTieKey) {
      const nextProject = toggleTieToAdjacentTimelineNote(project, timelineCursor);
      if (nextProject) project = nextProject;
      return;
    }
    if (keyHold.noteValueEditing && !keyHold.pitchSelection) {
      if (mode !== 'timeline') return;
      const result = isMoveSectionKey ? resizeFocusedTimelineTie(project, timelineCursor, event.key === 'ArrowLeft' ? -1 : 1)
        : isAddMeasureKey ? appendFocusedTimelineTie(project, timelineCursor)
        : isCursorUnitKey ? setFocusedTimelineNoteType(project, timelineCursor, event.key)
        : isDotKey && !event.repeat ? toggleFocusedTimelineNoteDot(project, timelineCursor) : undefined;
      if (result) {
        project = result.project;
        timelineCursor = result.cursor;
        syncOutlineToTimelinePosition(timelineCursor.positionSixteenths);
      }
      return;
    }
    if (keyHold.notePositionEditing && !keyHold.pitchSelection) {
      const result = mode === 'timeline' && isAddMeasureKey
        ? duplicateFocusedTimelineNoteAfter(project, timelineCursor)
        : mode === 'timeline' && isMoveSectionKey
        ? moveFocusedTimelineNote(project, timelineCursor, event.key === 'ArrowLeft' ? -1 : 1)
        : undefined;
      if (result) {
        project = result.project;
        timelineCursor = result.cursor;
        syncOutlineToTimelinePosition(timelineCursor.positionSixteenths);
      }
      return;
    }
    // E pitch editing takes priority over scale-constrained movement.
    if (keyHold.diatonicMovement && !keyHold.pitchSelection) {
      if (mode === 'timeline' && isMoveKey) movePitch(event.key === 'ArrowUp' ? 1 : -1, true);
      return;
    }
    if (keyHold.noteNavigation && isMoveSectionKey) {
      if (mode === 'timeline') {
        timelineCursor = focusAdjacentTimelineNote(
          project.outline, timelineCursor, event.key === 'ArrowLeft' ? -1 : 1,
        );
        syncOutlineToTimelinePosition(timelineCursor.positionSixteenths);
      }
      return;
    }
    if (isDeleteKey) {
      if (mode === 'outline') {
        if (keyHold.pitchSelection) return;
        const result = deleteOutlineBlock(project.outline, outlineCursor);
        if (result.outline !== project.outline) {
          project = { ...project, outline: result.outline };
          outlineCursor = result.cursor;
          timelineCursor = {
            ...timelineCursor,
            positionSixteenths: getOutlinePositionSixteenths(project.outline, outlineCursor.blockId),
            focusedNoteId: null,
            focusedPitchIndex: null,
            selectionAnchorNoteId: null,
          };
        }
        return;
      }
      const result = deleteFocusedTimelineNote(project, timelineCursor, keyHold.pitchSelection);
      if (result) {
        project = result.project;
        timelineCursor = result.cursor;
        syncOutlineToTimelinePosition(timelineCursor.positionSixteenths);
      }
      return;
    }
    if (keyHold.pitchSelection) {
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
        timelineCursor = resetTimelineCursorForStaff(
          project.outline, { ...timelineCursor, positionSixteenths }, 'upperStaff',
        );
        const block = getOutlineBlockAtPosition(project.outline, positionSixteenths);
        if (block) outlineCursor = { blockId: block.id };
        mode = 'timeline';
      } else {
        timelineCursor = { ...timelineCursor, selectionAnchorNoteId: null };
        mode = 'outline';
      }
      return;
    }

    if (mode === 'timeline') {
      if (isCursorUnitKey) {
        timelineCursor = setTimelineCursorUnit(timelineCursor, event.key);
      } else if (event.key.toLowerCase() === 'a') {
        const focusedNote = timelineCursor.focusedNoteId
          ? getLocatedTimelineNote(project.outline, timelineCursor.focusedNoteId, timelineCursor.staff)
          : undefined;
        const noteEndPosition = focusedNote
          ? focusedNote.measureStartSixteenths + focusedNote.positionSixteenths +
            getNoteValueSixteenths(focusedNote.note.value)
          : timelineCursor.positionSixteenths;
        const notePitch = timelineCursor.pitch;
        const result = addTimelineNoteAt(project, timelineCursor, noteEndPosition, notePitch);
        if (result) {
          project = result.project;
          timelineCursor = result.cursor;
          syncOutlineToTimelinePosition(timelineCursor.positionSixteenths);
        }
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const direction = event.key === 'ArrowLeft' ? -1 : 1;
        if (timelineCursor.selectionAnchorNoteId !== null) {
          timelineCursor = collapseTimelineNoteSelection(project.outline, timelineCursor, direction);
          syncOutlineToTimelinePosition(timelineCursor.positionSixteenths);
          return;
        }
        const focusedNote = timelineCursor.focusedNoteId
          ? getLocatedTimelineNote(project.outline, timelineCursor.focusedNoteId, timelineCursor.staff)
          : undefined;

        if (focusedNote) {
          const noteStart = focusedNote.measureStartSixteenths + focusedNote.positionSixteenths;
          const noteEnd = noteStart + getNoteValueSixteenths(focusedNote.note.value);
          const targetPosition = direction < 0 ? noteStart : noteEnd;
          const totalLength = getTimelineLengthSixteenths(project.outline);
          if (targetPosition < 0 || targetPosition >= totalLength - 1e-8) return;

          timelineCursor = {
            ...timelineCursor,
            positionSixteenths: targetPosition,
            focusedNoteId: null,
            focusedPitchIndex: null,
            selectionAnchorNoteId: null,
          };
          syncOutlineToTimelinePosition(targetPosition);
        } else {
          const collidedNote = findTimelineNoteAtMove(project.outline, timelineCursor, direction);
          if (collidedNote) {
            timelineCursor = {
              ...timelineCursor,
              positionSixteenths: collidedNote.measureStartSixteenths + collidedNote.positionSixteenths,
              pitch: collidedNote.note.pitches[0]?.midi ?? timelineCursor.pitch,
              focusedNoteId: collidedNote.note.id,
              focusedPitchIndex: 0,
              selectionAnchorNoteId: null,
            };
            syncOutlineToTimelinePosition(timelineCursor.positionSixteenths);
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
      {mode === 'outline' ? 'Both staves' : timelineCursor.staff === 'upperStaff' ? 'Upper staff' : 'Lower staff'} <span>/</span> Voice 0
      {#if mode === 'timeline'}
        <span>/</span> {formatPitch(timelineCursor.pitch)}
        {#if selectedTimelineNotes.length > 1}
          <span>/</span> {selectedTimelineNotes.length} notes selected
        {/if}
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
