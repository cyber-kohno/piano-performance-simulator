import NoteEditor from '../../action/editor/note-editor.ts';
import OutlineEditor from '../../action/editor/outline-editor.ts';
import EditorNavigation, { type WorkspaceState } from '../../state/editor-navigation.ts';
import ScoreTimeline from '../../domain/score/score-timeline.ts';
import ScoreKey from '../../domain/score/score-key.ts';
import MusicalTime from '../../domain/theory/musical-time.ts';
import { resolveTimelineNumberInput, resolveTimelineDotInput } from '../../state/number-input.ts';
import { TIMELINE_CURSOR_UNITS, setTimelineCursorUnit, toggleTimelineCursorDot, findTimelineNoteAtMove, moveTimelineCursorHorizontally, moveTimelineCursorPitch, selectFocusedNotePitch, focusAdjacentTimelineNote, getSelectedTimelineNotes, extendTimelineNoteSelection, collapseTimelineNoteSelection, switchTimelineStaff, cycleTimelineVoice } from '../../state/timeline-cursor.ts';
import { moveOutlineCursor, moveOutlineSection } from '../../state/outline-cursor.ts';
export type WorkspaceKey = { key: string; code: string; repeat: boolean; shiftKey: boolean };
export type WorkspaceHolds = { rangeSelection: boolean; pitchSelection: boolean; diatonicMovement: boolean; octaveMovement: boolean; keySignatureEditing: boolean; noteNavigation: boolean; noteValueEditing: boolean; tempoEditing: boolean; measureLengthEditing: boolean; notePositionEditing: boolean; meterEditing: boolean };
namespace WorkspaceKeyboard {
  export function control(state: WorkspaceState, event: WorkspaceKey, keyHold: WorkspaceHolds, measureKeyCache = ScoreKey.buildMeasureCache(state.project.outline)) {
    let { project, outlineCursor, timelineCursor, mode } = state;
    let handled = false;
    const selectedTimelineNotes = getSelectedTimelineNotes(project.outline, timelineCursor);
    function syncOutlineToTimelinePosition(position: number) { ({ outlineCursor, timelineCursor } = EditorNavigation.sync(project.outline, outlineCursor, timelineCursor, position)); }
    function movePitch(direction: -1 | 1, diatonic = false, octave = false) {
      const measure = timelineCursor.focusedNoteId
        ? ScoreTimeline.note(project.outline, timelineCursor.focusedNoteId, timelineCursor.staff)?.measure
        : ScoreTimeline.measureAt(project.outline, timelineCursor.positionSixteenths)?.measure;
      const keySignature = diatonic ? (measure && measureKeyCache.get(measure.id)?.keySignature) ?? ScoreKey.at(project.outline, timelineCursor.positionSixteenths) : undefined;
      if (timelineCursor.focusedNoteId === null) {
        timelineCursor = moveTimelineCursorPitch(timelineCursor, direction, keySignature, ScoreKey.at(project.outline, timelineCursor.positionSixteenths));
      } else {
        const result = NoteEditor.movePitch(project, timelineCursor, direction, keySignature, octave);
        if (result) {
          project = result.project;
          timelineCursor = result.cursor;
        }
      }
    }


    function run() {
      const isToggleModeKey = event.key.toLowerCase() === 'r';
      const isTupletKey = mode === 'timeline' && (event.key === '/' || event.code === 'NumpadDivide');
      const isVoiceKey = mode === 'timeline' && event.key.toLowerCase() === 'q';
      const isMoveKey = event.key === 'ArrowUp' || event.key === 'ArrowDown';
      const isMoveSectionKey = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
      const isAddMeasureKey = event.key.toLowerCase() === 'a';
      const isAddSectionKey = event.key.toLowerCase() === 's';
      const isAddKeyChangeKey = mode === 'outline' && event.key.toLowerCase() === 'x';
      const isDeleteKey = event.key === 'Delete';
      const isEscapeKey = mode === 'timeline' && event.key === 'Escape';
      const isToggleAdjacentTieKey = mode === 'timeline' && (event.key === '=' || event.code === 'Equal');
      const numberInput = mode === 'timeline'
        ? resolveTimelineNumberInput(event, timelineCursor.focusedNoteId !== null, keyHold.rangeSelection)
        : undefined;
      const isCursorUnitKey = numberInput !== undefined;
      const dotInput = mode === 'timeline'
        ? resolveTimelineDotInput(event, timelineCursor.focusedNoteId !== null, keyHold.rangeSelection)
        : undefined;
      const isDotKey = dotInput !== undefined;
      const isNormalizeKey = mode === 'timeline' && keyHold.noteValueEditing && event.key === 'Enter';
      if (!isAddKeyChangeKey && !isTupletKey && !isNormalizeKey && !isVoiceKey && !isToggleModeKey && !isMoveKey && !isMoveSectionKey && !isAddMeasureKey && !isAddSectionKey && !isDeleteKey && !isCursorUnitKey && !isDotKey && !isToggleAdjacentTieKey && !isEscapeKey) return;

      handled = true;
      if (isTupletKey) {
        if (!event.repeat) {
          const result = NoteEditor.convertTuplet(project, timelineCursor);
          if (result) { project = result.project; timelineCursor = result.cursor; }
        }
        return;
      }
      if (mode === 'outline' && keyHold.keySignatureEditing) {
        if (isMoveSectionKey) {
          project = OutlineEditor.changeKey(project, outlineCursor, event.key === 'ArrowLeft' ? -1 : 1);
        }
        return;
      }
      if (mode === 'outline' && (keyHold.tempoEditing || keyHold.measureLengthEditing)) {
        if (isMoveSectionKey) {
          const direction = event.key === 'ArrowLeft' ? -1 : 1;
          const block = project.outline.find((entry) => entry.id === outlineCursor.blockId);
          if (block?.type === 'measure' && keyHold.measureLengthEditing) project = OutlineEditor.changeMeasureBeats(project, outlineCursor, direction);
          else if (keyHold.tempoEditing) project = OutlineEditor.changeTempo(project, outlineCursor, direction);
        }
        return;
      }
      if (mode === 'outline' && keyHold.meterEditing) {
        if (isMoveKey || isMoveSectionKey) {
          project = OutlineEditor.changeMeter(project, outlineCursor, isMoveSectionKey ? 'numerator' : 'denominator',
            event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1);
        }
        return;
      }
      if (numberInput?.target === 'cursor' && (keyHold.rangeSelection || event.shiftKey)) {
        timelineCursor = setTimelineCursorUnit(timelineCursor, numberInput.key);
        return;
      }
      if (dotInput === 'cursor' && (keyHold.rangeSelection || event.shiftKey)) {
        if (!event.repeat) timelineCursor = toggleTimelineCursorDot(timelineCursor, project.outline);
        return;
      }
      if (isVoiceKey) {
        if (keyHold.rangeSelection || event.shiftKey) project = NoteEditor.addVoice(project, timelineCursor);
        else {
          timelineCursor = cycleTimelineVoice(project.outline, timelineCursor);
          syncOutlineToTimelinePosition(timelineCursor.positionSixteenths);
        }
        return;
      }
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
      if ((keyHold.rangeSelection || event.shiftKey) && !keyHold.noteValueEditing && isMoveSectionKey && timelineCursor.focusedNoteId !== null) {
        if (mode === 'timeline') {
          timelineCursor = extendTimelineNoteSelection(project.outline, timelineCursor, event.key === 'ArrowLeft' ? -1 : 1);
          syncOutlineToTimelinePosition(timelineCursor.positionSixteenths);
        }
        return;
      }
      if (selectedTimelineNotes.length > 1) {
        if (isMoveKey) {
          const result = NoteEditor.transpose(project, timelineCursor, event.key === 'ArrowUp' ? 1 : -1,
            keyHold.octaveMovement && !keyHold.pitchSelection);
          if (result) {
            project = result.project;
            timelineCursor = result.cursor;
          }
          return;
        }
        const plain = !keyHold.noteValueEditing && !keyHold.notePositionEditing &&
          !keyHold.diatonicMovement && !keyHold.octaveMovement && !keyHold.pitchSelection;
        const navigation = isMoveSectionKey && (plain || keyHold.noteNavigation);
        const rangeMove = isMoveSectionKey && keyHold.notePositionEditing && !keyHold.noteValueEditing && !keyHold.pitchSelection;
        // Other editing commands require returning to a single focused note first.
        if (!navigation && !rangeMove && !(plain && (isDeleteKey || isToggleModeKey))) return;
      }
      if (isToggleAdjacentTieKey) {
        const nextProject = NoteEditor.toggleTie(project, timelineCursor);
        if (nextProject) project = nextProject;
        return;
      }
      if (keyHold.noteValueEditing && !keyHold.pitchSelection) {
        if (mode !== 'timeline') return;
        const resize = keyHold.rangeSelection || event.shiftKey ? NoteEditor.resizeTie : NoteEditor.resize;
        const result = isMoveSectionKey ? resize(project, timelineCursor, event.key === 'ArrowLeft' ? -1 : 1)
          : isNormalizeKey && !event.repeat ? NoteEditor.normalizeTie(project, timelineCursor)
            : isAddMeasureKey ? NoteEditor.appendTie(project, timelineCursor)
              : undefined;
        if (result) {
          project = result.project;
          timelineCursor = result.cursor;
          syncOutlineToTimelinePosition(timelineCursor.positionSixteenths);
        }
        return;
      }
      if (keyHold.notePositionEditing && !keyHold.pitchSelection) {
        // D also controls octave movement; vertical timeline arrows continue to that handler.
        if (!(mode === 'timeline' && isMoveKey && keyHold.octaveMovement)) {
          const result = mode === 'timeline' && isAddMeasureKey
            ? NoteEditor.duplicate(project, timelineCursor)
            : mode === 'timeline' && isMoveSectionKey
              ? NoteEditor.move(project, timelineCursor, event.key === 'ArrowLeft' ? -1 : 1)
              : undefined;
          if (result) {
            project = result.project;
            timelineCursor = result.cursor;
            syncOutlineToTimelinePosition(timelineCursor.positionSixteenths);
          }
          return;
        }
      }
      // E pitch editing takes priority over scale-constrained movement.
      if (keyHold.octaveMovement && !keyHold.pitchSelection) {
        if (mode === 'timeline' && isMoveKey && timelineCursor.focusedNoteId !== null) {
          movePitch(event.key === 'ArrowUp' ? 1 : -1, false, true);
        }
        return;
      }
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
          const result = OutlineEditor.remove(project, outlineCursor);
          if (result.project !== project) {
            project = result.project;
            outlineCursor = result.cursor;
            timelineCursor = {
              ...timelineCursor,
              positionSixteenths: ScoreTimeline.outlinePosition(project.outline, outlineCursor.blockId),
              focusedNoteId: null,
              focusedPitchIndex: null,
              selectionAnchorNoteId: null,
            };
          }
          return;
        }
        const result = NoteEditor.remove(project, timelineCursor, keyHold.pitchSelection);
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
          const result = NoteEditor.addPitch(project, timelineCursor);
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
        ({ project, outlineCursor, timelineCursor, mode } = EditorNavigation.toggle({ project, outlineCursor, timelineCursor, mode }));
        return;
      }

      if (mode === 'timeline') {
        if (numberInput) {
          if (numberInput.target === 'note') {
            const type = TIMELINE_CURSOR_UNITS.find(unit => unit.key === numberInput.key)!.type;
            const selected = ScoreTimeline.note(project.outline, timelineCursor.focusedNoteId!, timelineCursor.staff)!.note;
            const result = NoteEditor.setValue(project, timelineCursor, { type, dots: selected.value.type === type ? selected.value.dots : 0 });
            if (result) {
              project = result.project;
              timelineCursor = result.cursor;
              syncOutlineToTimelinePosition(timelineCursor.positionSixteenths);
            }
          } else timelineCursor = setTimelineCursorUnit(timelineCursor, numberInput.key);
        } else if (isDotKey) {
          if (!event.repeat) {
            if (dotInput === 'note') {
              const result = NoteEditor.toggleDot(project, timelineCursor);
              if (result) {
                project = result.project;
                timelineCursor = result.cursor;
                syncOutlineToTimelinePosition(timelineCursor.positionSixteenths);
              }
            } else timelineCursor = toggleTimelineCursorDot(timelineCursor, project.outline);
          }
        } else if (event.key.toLowerCase() === 'a') {
          const focusedNote = timelineCursor.focusedNoteId
            ? ScoreTimeline.note(project.outline, timelineCursor.focusedNoteId, timelineCursor.staff)
            : undefined;
          const noteEndPosition = focusedNote
            ? MusicalTime.addNumbers(MusicalTime.addNumbers(focusedNote.measureStartSixteenths, focusedNote.positionSixteenths), focusedNote.lengthSixteenths)
            : timelineCursor.positionSixteenths;
          const notePitch = timelineCursor.pitch;
          const result = NoteEditor.add(project, timelineCursor, noteEndPosition, notePitch);
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
            ? ScoreTimeline.note(project.outline, timelineCursor.focusedNoteId, timelineCursor.staff)
            : undefined;

          if (focusedNote) {
            const noteStart = focusedNote.measureStartSixteenths + focusedNote.positionSixteenths;
            const noteEnd = MusicalTime.addNumbers(noteStart, focusedNote.lengthSixteenths);
            const targetPosition = direction < 0 ? noteStart : noteEnd;
            const totalLength = ScoreTimeline.length(project.outline);
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
            const collidedNote = keyHold.rangeSelection || event.shiftKey
              ? undefined
              : findTimelineNoteAtMove(project.outline, timelineCursor, direction);
            if (collidedNote) {
              timelineCursor = {
                ...timelineCursor,
                voiceIndex: collidedNote.voiceIndex,
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
        const result = OutlineEditor.addMeasure(project, outlineCursor);
        project = result.project;
        outlineCursor = result.cursor;
        return;
      }
      if (isAddSectionKey) {
        project = OutlineEditor.addSection(project, outlineCursor);
        return;
      }
      if (isAddKeyChangeKey) {
        const result = OutlineEditor.addKeyChange(project, outlineCursor);
        project = result.project;
        outlineCursor = result.cursor;
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
    run();
    return { project, outlineCursor, timelineCursor, mode, handled };
  }
}
export default WorkspaceKeyboard;
