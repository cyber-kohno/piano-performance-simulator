<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import ScoreTimeline from "./domain/score/score-timeline.ts";
  import ScoreProjectFactory from "./domain/score/score-project.ts";
  import ScoreKey from "./domain/score/score-key.ts";
  import ScoreMeasure from './domain/score/score-measure.ts';

  import NoteEditor from './action/editor/note-editor';
  import OutlineEditor from './action/editor/outline-editor.ts';
  import PedalEditor from './action/editor/pedal-editor';
  import OttavaEditor from './action/editor/ottava-editor.ts';
  import PedalInput from './state/pedal-input.ts';
  import OttavaInput from './state/ottava-input.ts';
  import { cycleGraceFocus, focusGraceParent, getFocusedGrace } from './state/grace-input';
  import { createPedalCursor } from './state/pedal';
  import { createOttavaCursor } from './state/ottava.ts';
  import OutlinePanel from './components/OutlinePanel.svelte';
  import TimelinePanel from './components/TimelinePanel.svelte';
  import NoteMenu from './components/NoteMenu.svelte';
  import ExpressionModal from './components/ExpressionModal.svelte';
  import FloatingTextInput from './components/FloatingTextInput.svelte';
  import EditorDialog from './components/EditorDialog.svelte';

  import NoteSettings, { type NoteSettingsState } from './state/note-settings.ts';

  import { controlNoteMenu, createNoteMenuItems } from './state/note-menu';

  import { type PianoFingering, type ScoreProject } from "./domain/score/types.ts";
  import { createKeyHold } from './state/key-hold.svelte';
  import {createTimelineCursor,getSelectedTimelineNotes} from './state/timeline-cursor.ts';
  import {createOutlineCursor} from './state/outline-cursor.ts';
  import EditorNavigation from './state/editor-navigation.ts';
  import WorkspaceKeyboard from './ui/keyboard/workspace-keyboard.ts';
  import type NotePreview from './service/playback/note-preview.ts';
  import ScorePlayback from './service/playback/score-playback.ts';
  import EditorHistory, { type EditorHistorySnapshot } from './service/history/editor-history.ts';
  import EditorDialogController from './service/dialog/editor-dialog-controller.ts';
  import ScoreProjectFileController, { type FileOperationResult } from './service/project/score-project-file-controller.ts';
  import type { ScorePassage as ScorePassageData } from './domain/score/score-passage.ts';
  import { invoke, isTauri } from '@tauri-apps/api/core';
  import { getCurrentWindow } from '@tauri-apps/api/window';

  let { notePreview = null, audioPreviewError = null }: {
    notePreview: NotePreview.Value | null;
    audioPreviewError: string | null;
  } = $props();
  onDestroy(() => notePreview?.dispose());
  const playback = notePreview ? ScorePlayback.create(notePreview) : null;
  let playbackPosition = $state<number | null>(null);
  onDestroy(() => playback?.dispose());

  const initialProject = ScoreProjectFactory.create();
  let project = $state<ScoreProject>(initialProject);
  let currentProjectFile = $state<ScoreProjectFileController.Handle | null>(null);
  let savedProjectFingerprint = $state(ScoreProjectFileController.fingerprint(initialProject));
  let fileOperationInProgress = $state(false);
  const projectFingerprint = $derived(ScoreProjectFileController.fingerprint(project));
  const projectIsDirty = $derived(projectFingerprint !== savedProjectFingerprint);
  let allowWindowClose = false;
  const windowTitle = $derived(`${currentProjectFile?.name ?? 'Untitled'}${projectIsDirty ? '*' : ''} - ClavierDesk`);
  $effect(() => {
    document.title = windowTitle;
    if (isTauri()) void getCurrentWindow().setTitle(windowTitle).catch(error =>
      console.error('Failed to update window title:', error));
  });
  let outlineCursor = $state(createOutlineCursor(initialProject.outline));
  let timelineCursor = $state(createTimelineCursor());
  let savedPlaybackFocus: { outlineCursor: typeof outlineCursor; timelineCursor: typeof timelineCursor } | null = null;
  let mode = $state<'outline' | 'timeline'>('outline');
  const keyHold = createKeyHold();
  let menuPath = $state<number[] | null>(null);
  let noteSettings=$state<NoteSettingsState|null>(null);
  let passageClipboard = $state<ScorePassageData | null>(null);
  let sectionTextInput = $state<{ blockId: string; anchor: HTMLElement; value: string } | null>(null);
  let fingeringTextInput = $state<{ noteId: string; pitchIndex: number; anchor: HTMLElement; value: string } | null>(null);
  function parseFingeringInput(value: string): { fingering: PianoFingering; substitutionFingering?: PianoFingering } | undefined {
    const match = /^([1-5])(?:-([1-5]))?$/.exec(value);
    if (!match) return undefined;
    const fingering = Number(match[1]) as PianoFingering;
    const substitutionFingering = match[2] === undefined ? undefined : Number(match[2]) as PianoFingering;
    if (substitutionFingering === fingering) return undefined;
    return substitutionFingering === undefined ? { fingering } : { fingering, substitutionFingering };
  }
  function openFingeringTextInput() {
    if (mode !== 'timeline' || pedalMode || ottavaMode || playback?.playing ||
      timelineCursor.focusedNoteId === null || timelineCursor.focusedPitchIndex === null ||
      selectedTimelineNotes.length !== 1 || getFocusedGrace(project.outline, timelineCursor)) return false;
    const focused = ScoreTimeline.note(project.outline, timelineCursor.focusedNoteId, timelineCursor.staff);
    const pitch = focused?.note.pitches[timelineCursor.focusedPitchIndex];
    if (!focused || !pitch) return false;
    const target = `${focused.note.id}:${timelineCursor.focusedPitchIndex}`;
    const anchor = Array.from(document.querySelectorAll<HTMLElement>('[data-fingering-pitch]'))
      .find(element => element.dataset.fingeringPitch === target);
    if (!anchor) return false;
    fingeringTextInput = {
      noteId: focused.note.id,
      pitchIndex: timelineCursor.focusedPitchIndex,
      anchor,
      value: pitch.fingering === undefined ? '' : `${pitch.fingering}${pitch.substitutionFingering === undefined ? '' : `-${pitch.substitutionFingering}`}`,
    };
    keyHold.reset();
    return true;
  }
  function commitFingeringText(value: string) {
    if (!fingeringTextInput) return;
    const parsed = parseFingeringInput(value);
    if (!parsed) return;
    const previousProject = project;
    project = NoteEditor.setPitchFingering(project, {
      ...timelineCursor,
      focusedNoteId: fingeringTextInput.noteId,
      focusedPitchIndex: fingeringTextInput.pitchIndex,
    }, parsed.fingering, parsed.substitutionFingering);
    fingeringTextInput = null;
    recordProjectChange(previousProject);
  }
  function openSectionTextInput() {
    if (mode !== 'outline') return false;
    const block = project.outline.find(entry => entry.id === outlineCursor.blockId);
    if (block?.type !== 'section') return false;
    const anchor = document.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(block.id)}"]`);
    if (!anchor) return false;
    sectionTextInput = { blockId: block.id, anchor, value: block.data.name };
    keyHold.reset();
    return true;
  }
  function commitSectionText(value: string) {
    if (!sectionTextInput) return;
    const previousProject = project;
    project = OutlineEditor.renameSection(project, sectionTextInput.blockId, value);
    sectionTextInput = null;
    recordProjectChange(previousProject);
  }
  function openExpressionModal() {
    if(mode!=='timeline'||pedalMode||ottavaMode)return;
    const editor=NoteSettings.open(project,timelineCursor);
    if(!editor)return;
    noteSettings=editor;
    closeMenu();
  }
  function closeExpressionModal() {noteSettings=null;keyHold.reset();}
  function closeMenu() { menuPath = null; keyHold.reset(); }
  function menuKey(key: string, path = menuPath) {
    if (!path) return;
    const previousProject = project;
    const ids = selectedTimelineNotes.map(entry => entry.note.id);
    const result = controlNoteMenu(path, key, createNoteMenuItems(project, ids));
    menuPath = result.path;
    if (!menuPath) keyHold.reset();
    if (result.action === 'expression') openExpressionModal();
    if (result.action === 'add-slur') project = NoteEditor.connectSlur(project, ids);
    if (result.action === 'remove-slur') project = NoteEditor.disconnectSlur(project, ids);
    recordProjectChange(previousProject);
  }
  let pedalMode = $state(false);
  let pedalCursor = $state(createPedalCursor());
  let ottavaMode = $state(false);
  let ottavaCursor = $state(createOttavaCursor());
  function captureHistorySnapshot(): EditorHistorySnapshot {
    return {
      project,
      outlineCursor: { ...outlineCursor },
      timelineCursor: { ...timelineCursor },
      mode,
      pedalMode,
      pedalCursor: { ...pedalCursor, value: { ...pedalCursor.value } },
      ottavaMode,
      ottavaCursor: { ...ottavaCursor, value: { ...ottavaCursor.value } },
    };
  }
  const editorHistory = EditorHistory.create(captureHistorySnapshot());
  onMount(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void getCurrentWindow().onCloseRequested(event => {
      if (allowWindowClose) return;
      const hasPendingChanges = projectIsDirty || noteSettings !== null || sectionTextInput !== null || fingeringTextInput !== null;
      if (!hasPendingChanges && !fileOperationInProgress) return;
      event.preventDefault();
      if (EditorDialogController.isOpen()) return;
      if (fileOperationInProgress) {
        EditorDialogController.alert({
          title: 'File Operation in Progress',
          messageLines: ['Wait for the current file operation to finish, then close the app.'],
        });
        return;
      }
      EditorDialogController.confirm({
        tone: 'danger',
        title: 'Discard Unsaved Changes?',
        messageLines: ['The current project has unsaved or uncommitted changes.', 'Close the application and discard them?'],
        confirmLabel: 'Discard and Close',
        onConfirm: async () => {
          allowWindowClose = true;
          try {
            await getCurrentWindow().close();
          } catch (error) {
            allowWindowClose = false;
            EditorDialogController.alert({
              title: 'Close Failed',
              messageLines: [String(error)],
            });
          }
        },
      });
    }).then(handler => {
      if (disposed) handler();
      else unlisten = handler;
    }).catch(error => console.error('Failed to register the window close guard:', error));
    return () => {
      disposed = true;
      unlisten?.();
    };
  });
  function recordProjectChange(previousProject: ScoreProject) {
    if (project !== previousProject) editorHistory.record(captureHistorySnapshot());
  }
  function restoreHistorySnapshot(snapshot: EditorHistorySnapshot) {
    project = snapshot.project;
    outlineCursor = { ...snapshot.outlineCursor };
    timelineCursor = { ...snapshot.timelineCursor };
    mode = snapshot.mode;
    pedalMode = snapshot.pedalMode;
    pedalCursor = { ...snapshot.pedalCursor, value: { ...snapshot.pedalCursor.value } };
    ottavaMode = snapshot.ottavaMode;
    ottavaCursor = { ...snapshot.ottavaCursor, value: { ...snapshot.ottavaCursor.value } };
  }
  function showProjectFileError(result: Extract<FileOperationResult<unknown>, { type: 'error' }>) {
    const messages = {
      read: 'The selected project file could not be read.',
      write: 'The project file could not be saved.',
      parse: 'The selected file is not valid JSON.',
      'invalid-project': 'The selected file does not contain a valid ClavierDesk project.',
    } satisfies Record<typeof result.reason, string>;
    EditorDialogController.alert({ title: 'Project File Error', messageLines: [messages[result.reason]] });
    if (result.error) console.error('Project file operation failed:', result.error);
  }
  function restartApplication() {
    const restart = () => {
      if (import.meta.env.DEV || !isTauri()) {
        window.location.reload();
        return;
      }
      void invoke('restart_app').catch(error => EditorDialogController.alert({
        title: 'Restart Failed',
        messageLines: [String(error)],
      }));
    };
    if (projectIsDirty) {
      EditorDialogController.confirm({
        tone: 'danger',
        title: 'Discard Unsaved Changes?',
        messageLines: ['The current project has unsaved changes.', 'Restart the application and discard them?'],
        confirmLabel: 'Restart Anyway',
        onConfirm: restart,
      });
    } else {
      restart();
    }
  }
  async function saveProject(saveAs = false) {
    if (fileOperationInProgress) return;
    if (!saveAs && currentProjectFile && !projectIsDirty) return;
    fileOperationInProgress = true;
    const result = saveAs || !currentProjectFile
      ? await ScoreProjectFileController.saveAs(project)
      : await ScoreProjectFileController.save(project, currentProjectFile);
    fileOperationInProgress = false;
    if (result.type === 'error') {
      showProjectFileError(result);
      return;
    }
    if (result.type === 'cancelled') return;
    currentProjectFile = result.value.handle;
    savedProjectFingerprint = result.value.fingerprint;
  }
  function applyLoadedProject(handle: ScoreProjectFileController.Handle, loadedProject: ScoreProject) {
    project = loadedProject;
    currentProjectFile = handle;
    savedProjectFingerprint = ScoreProjectFileController.fingerprint(loadedProject);
    outlineCursor = createOutlineCursor(loadedProject.outline);
    timelineCursor = createTimelineCursor();
    mode = 'outline';
    pedalMode = false;
    ottavaMode = false;
    menuPath = null;
    noteSettings = null;
    sectionTextInput = null;
    fingeringTextInput = null;
    passageClipboard = null;
    savedPlaybackFocus = null;
    playbackPosition = null;
    keyHold.reset();
    editorHistory.reset(captureHistorySnapshot());
  }
  async function loadProject() {
    if (fileOperationInProgress || playback?.playing) return;
    fileOperationInProgress = true;
    const result = await ScoreProjectFileController.load();
    fileOperationInProgress = false;
    if (result.type === 'error') {
      showProjectFileError(result);
      return;
    }
    if (result.type === 'cancelled') return;
    const { handle, project: loadedProject } = result.value;
    if (projectIsDirty) {
      EditorDialogController.confirm({
        tone: 'danger',
        title: 'Discard Unsaved Changes?',
        messageLines: ['The current project has unsaved changes.', 'Load the selected project and discard them?'],
        confirmLabel: 'Discard and Load',
        onConfirm: () => applyLoadedProject(handle, loadedProject),
      });
      return;
    }
    applyLoadedProject(handle, loadedProject);
  }
  function removeFocusedOutlineElement() {
    const previousProject = project;
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
    recordProjectChange(previousProject);
  }
  const isEditingInitialKey = $derived(mode === 'outline' &&
    project.outline.some(block => block.id === outlineCursor.blockId && (block.type === 'init' || block.type === 'key-change')) && keyHold.keySignatureEditing);
  const isEditingInitialTempo = $derived(mode === 'outline' &&
    outlineCursor.blockId === project.outline[0].id && keyHold.tempoEditing && !keyHold.keySignatureEditing);
  const isEditingInitialMeter = $derived(mode === 'outline' &&
    outlineCursor.blockId === project.outline[0].id && keyHold.meterEditing && !keyHold.tempoEditing && !keyHold.keySignatureEditing);
  const selectedTimelineNotes = $derived(getSelectedTimelineNotes(project.outline, timelineCursor));
  const measureKeyCache = $derived(ScoreKey.buildMeasureCache(project.outline));

  const pitchClassNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  function formatPitch(pitch: number): string {
    return `${pitchClassNames[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
  }

  function syncOutlineToTimelinePosition(positionSixteenths: number) {
    ({outlineCursor,timelineCursor}=EditorNavigation.sync(project.outline,outlineCursor,timelineCursor,positionSixteenths));
  }

  function advancePlaybackPosition(positionSixteenths: number) {
    playbackPosition = positionSixteenths;
    const timelineEnd = ScoreTimeline.length(project.outline);
    const outlinePosition = Math.min(positionSixteenths, Math.max(0, timelineEnd - 1e-7));
    const block = ScoreTimeline.blockAt(project.outline, outlinePosition);
    if (block && block.id !== outlineCursor.blockId) outlineCursor = { blockId: block.id };
  }

  function previewTimelineFocusChange(previousCursor: ReturnType<typeof createTimelineCursor>,
    previousNote: ReturnType<typeof ScoreTimeline.note> | undefined) {
    if (!notePreview || mode !== 'timeline' || !timelineCursor.focusedNoteId) return;
    const focused = ScoreTimeline.note(project.outline, timelineCursor.focusedNoteId, timelineCursor.staff);
    if (!focused) return;
    if (focused.note.id !== previousCursor.focusedNoteId) {
      notePreview.pitchChange(focused.note.pitches.map(pitch => pitch.midi));
      return;
    }
    if (!previousNote || previousNote.note.id !== focused.note.id) return;
    if (previousCursor.focusedPitchIndex !== timelineCursor.focusedPitchIndex &&
      timelineCursor.focusedPitchIndex !== null) {
      const selectedPitch = focused.note.pitches[timelineCursor.focusedPitchIndex];
      if (selectedPitch) notePreview.pitchChange([selectedPitch.midi]);
      return;
    }
    const before = previousNote.note.pitches.map(pitch => pitch.midi);
    const after = focused.note.pitches.map(pitch => pitch.midi);
    const changed = after.flatMap((pitch, index) => pitch !== before[index] ? [index] : []);
    if (!changed.length) return;
    if (before.length === after.length && changed.length === 1) {
      notePreview.pitchChange([after[changed[0]]]);
    } else {
      notePreview.pitchChange(after);
    }
  }

  function showPasteFailure(reason: import('./domain/score/score-passage.ts').PassagePasteFailureReason) {
    const messages = {
      'invalid-passage': 'The copied passage cannot be pasted at this position.',
      'outside-score': 'There is no measure at the current cursor position.',
      'crosses-measure': 'The passage would cross a measure boundary.',
      'voice-unavailable': 'The active voice is not available in this measure.',
      'invalid-position': 'The passage does not align with the available notation positions.',
      occupied: 'The paste range overlaps existing notes.',
      'tuplet-boundary': 'The paste range would split a tuplet group.',
      'pitch-collision': 'The pasted pitches conflict with notes in another voice.',
    } satisfies Record<import('./domain/score/score-passage.ts').PassagePasteFailureReason, string>;
    EditorDialogController.alert({ title: 'Paste Unavailable', messageLines: [messages[reason]] });
  }

  function handleKeydown(event: KeyboardEvent) {
    if (EditorDialogController.controlKey(event)) return;
    if(noteSettings){
      event.preventDefault();
      const previousProject = project;
      const result=NoteSettings.control(project,noteSettings,event);
      if(result.commit)project=NoteEditor.configure(project,timelineCursor,result.commit);
      noteSettings=result.editor;
      if(!noteSettings)keyHold.reset();
      recordProjectChange(previousProject);
      return;
    }
    if (menuPath) {
      event.preventDefault();
      if (!event.isComposing && !event.altKey && !event.ctrlKey && !event.metaKey &&
        (!event.repeat || ['ArrowUp', 'ArrowDown'].includes(event.key))) menuKey(event.key);
      return;
    }
    const targetElement = event.target;
    if (event.key === 'F5') {
      event.preventDefault();
      if (event.repeat || fileOperationInProgress || (targetElement instanceof HTMLElement &&
        (targetElement.isContentEditable || targetElement.closest('input, textarea, select')))) return;
      restartApplication();
      return;
    }
    if (event.defaultPrevented || event.isComposing || (targetElement instanceof HTMLElement &&
      (targetElement.isContentEditable || targetElement.closest('input, textarea, select')))) return;
    const historyKey = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && !event.altKey &&
      (historyKey === 'z' || historyKey === 'y')) {
      event.preventDefault();
      if (event.repeat || playback?.playing) return;
      const snapshot = historyKey === 'y' || (historyKey === 'z' && event.shiftKey)
        ? editorHistory.redo() : editorHistory.undo();
      if (snapshot) {
        keyHold.reset();
        restoreHistorySnapshot(snapshot);
      }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey &&
      (historyKey === 's' || historyKey === 'l')) {
      event.preventDefault();
      if (event.repeat || fileOperationInProgress || playback?.playing) return;
      if (historyKey === 'l') void loadProject();
      else void saveProject(event.shiftKey);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey &&
      (historyKey === 'c' || historyKey === 'v')) {
      event.preventDefault();
      if (event.repeat || mode !== 'timeline' || pedalMode || ottavaMode || playback?.playing || getFocusedGrace(project.outline, timelineCursor)) return;
      if (historyKey === 'c') {
        passageClipboard = NoteEditor.copyPassage(project, timelineCursor) ?? null;
        return;
      }
      if (!passageClipboard || timelineCursor.focusedNoteId !== null) return;
      const previousProject = project;
      const previousCursor = { ...timelineCursor };
      const result = NoteEditor.pastePassage(project, timelineCursor, passageClipboard);
      if (result.ok) {
        project = result.project;
        ({ outlineCursor, timelineCursor } = EditorNavigation.sync(
          project.outline, outlineCursor, result.cursor, result.cursor.positionSixteenths,
        ));
        previewTimelineFocusChange(previousCursor, undefined);
        recordProjectChange(previousProject);
      } else {
        showPasteFailure(result.reason);
      }
      return;
    }
    if (event.key === ' ') {
      event.preventDefault();
      if (event.repeat) return;
      if (playback?.playing) playback.stop();
      else if (playback) {
        const startPosition = mode === 'timeline' ? timelineCursor.positionSixteenths
          : ScoreTimeline.outlinePosition(project.outline, outlineCursor.blockId);
        savedPlaybackFocus = { outlineCursor: { ...outlineCursor }, timelineCursor: { ...timelineCursor } };
        const started = playback.start(project, startPosition,
          advancePlaybackPosition,
          () => {
            playbackPosition = null;
            if (savedPlaybackFocus) {
              outlineCursor = savedPlaybackFocus.outlineCursor;
              timelineCursor = savedPlaybackFocus.timelineCursor;
              savedPlaybackFocus = null;
            }
          });
        if (!started) savedPlaybackFocus = null;
      }
      return;
    }
    if (playback?.playing) { event.preventDefault(); return; }
    if (event.key.toLowerCase() === 'b' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      if (!event.repeat) openExpressionModal();
      return;
    }
    if (mode === 'outline' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && event.key.toLowerCase() === 'w') {
      if (openSectionTextInput()) event.preventDefault();
      return;
    }
    if (event.key.toLowerCase() === 'm' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      if (mode === 'timeline' && !pedalMode && !ottavaMode && !getFocusedGrace(project.outline, timelineCursor) && selectedTimelineNotes.length >= 1) {
        event.preventDefault();
        if (!event.repeat) { keyHold.reset(); menuPath = [0]; }
      }
      return;
    }
    if (mode === 'timeline' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && event.key.toLowerCase() === 'p') {
      event.preventDefault();
      if (!event.repeat) {
        pedalMode = !pedalMode;
        if (pedalMode) {
          ottavaMode = false;
          pedalCursor = { ...pedalCursor, position: timelineCursor.positionSixteenths };
          const block = ScoreTimeline.blockAt(project.outline, pedalCursor.position);
          if (block) outlineCursor = { blockId: block.id };
        } else syncOutlineToTimelinePosition(timelineCursor.positionSixteenths);
      }
      return;
    }
    if (mode === 'timeline' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && event.key.toLowerCase() === 'o' && !pedalMode) {
      event.preventDefault();
      if (!event.repeat) {
        ottavaMode = !ottavaMode;
        if (ottavaMode) {
          ottavaCursor = { ...ottavaCursor, position: timelineCursor.positionSixteenths };
          const block = ScoreTimeline.blockAt(project.outline, ottavaCursor.position);
          if (block) outlineCursor = { blockId: block.id };
        } else syncOutlineToTimelinePosition(timelineCursor.positionSixteenths);
      }
      return;
    }
    if(pedalMode){
      const result=PedalInput.control(project,pedalCursor,event);
      if(!result.handled)return;
      event.preventDefault();
      const previousProject = project;
      pedalCursor=result.cursor;
      if(result.exit){pedalMode=false;syncOutlineToTimelinePosition(timelineCursor.positionSixteenths);}
      if(result.outlineBlockId)outlineCursor={blockId:result.outlineBlockId};
      if(result.command?.type==='add')project=PedalEditor.add(project,result.command.position,result.command.action);
      else if(result.command?.type==='remove')project=PedalEditor.remove(project,result.command.position);
      recordProjectChange(previousProject);
      return;
    }
    if(ottavaMode && !(event.shiftKey && event.key.toLowerCase() === 'r')){
      const result=OttavaInput.control(project,ottavaCursor,timelineCursor.staff,event);
      if(!result.handled)return;
      event.preventDefault();
      const previousProject=project;
      ottavaCursor=result.cursor;
      if(result.exit){ottavaMode=false;syncOutlineToTimelinePosition(timelineCursor.positionSixteenths);}
      if(result.outlineBlockId)outlineCursor={blockId:result.outlineBlockId};
      if(result.command?.type==='add')project=OttavaEditor.add(project,result.command.position,result.command.staff,result.command.action);
      else if(result.command?.type==='remove')project=OttavaEditor.remove(project,result.command.position,result.command.staff);
      recordProjectChange(previousProject);
      return;
    }
    if (
      event.defaultPrevented || event.isComposing ||
      event.altKey || event.ctrlKey || event.metaKey
    ) return;
    if (mode === 'outline' && event.key === 'Delete' && !keyHold.pitchSelection) {
      const block = project.outline.find(entry => entry.id === outlineCursor.blockId);
      if (block?.type === 'measure' && ScoreMeasure.hasNotes(block.data)) {
        event.preventDefault();
        if (!event.repeat) EditorDialogController.confirm({
          tone: 'danger',
          title: 'Delete Measure',
          messageLines: ['This measure contains notes.', 'Delete the measure and all notes in it?'],
          confirmLabel: 'Delete',
          onConfirm: removeFocusedOutlineElement,
        });
        return;
      }
    }
    if (mode === 'timeline' && event.key.toLowerCase() === 'w' && !event.shiftKey) {
      if (!event.repeat && openFingeringTextInput()) event.preventDefault();
      if (fingeringTextInput) return;
    }
    if (mode === 'timeline' && event.key.toLowerCase() === 't') {
      event.preventDefault();
      if (!event.repeat) {
        const previousProject = project;
        if (event.shiftKey) {
          const result = NoteEditor.addGrace(project, timelineCursor);
          if (result) { project = result.project; timelineCursor = result.cursor; }
        } else timelineCursor = cycleGraceFocus(project.outline, timelineCursor);
        recordProjectChange(previousProject);
      }
      return;
    }
    if (mode === 'timeline' && getFocusedGrace(project.outline, timelineCursor)) {
      const key = event.key.toLowerCase();
      if (key === 'arrowup' || key === 'arrowdown' || key === 'delete' || key === 'escape') {
        event.preventDefault();
        const previousProject = project;
        if (key === 'escape') timelineCursor = focusGraceParent(project.outline, timelineCursor);
        else {
          const result = key === 'delete' ? NoteEditor.removeGrace(project, timelineCursor) : NoteEditor.moveGracePitch(
            project, timelineCursor, key === 'arrowup' ? 1 : -1, keyHold.diatonicMovement, keyHold.octaveMovement);
          if (result) { project = result.project; timelineCursor = result.cursor; }
        }
        recordProjectChange(previousProject);
        return;
      }
      if (key === 'q' || key === 'r' || key === 'arrowleft' || key === 'arrowright') {
        // Return to the parent before normal navigation; held resize/move never edits it accidentally.
        if ((key === 'arrowleft' || key === 'arrowright') && (keyHold.noteValueEditing || keyHold.notePositionEditing)) {
          event.preventDefault(); return;
        }
        timelineCursor = focusGraceParent(project.outline, timelineCursor);
      } else { event.preventDefault(); return; }
    }
    const projectBeforeInput = project;
    const timelineCursorBeforeInput = { ...timelineCursor };
    const focusedBeforeInput = timelineCursor.focusedNoteId
      ? ScoreTimeline.note(project.outline, timelineCursor.focusedNoteId, timelineCursor.staff)
      : undefined;
    const result=WorkspaceKeyboard.control({project,outlineCursor,timelineCursor,mode},event,keyHold,measureKeyCache);
    if(result.handled)event.preventDefault();
    project=result.project;
    outlineCursor=result.outlineCursor;
    timelineCursor=result.timelineCursor;
    mode=result.mode;
    previewTimelineFocusChange(timelineCursorBeforeInput, focusedBeforeInput);
    recordProjectChange(projectBeforeInput);
  }
</script>

<svelte:window onkeydown={handleKeydown} onblur={closeMenu} />

<div class="editor">
  <header class="app-header">
    <h1>CLAVIER<span>DESK</span></h1>
    <div class="mode-labels" aria-label="Editing modes">
      <span class:active={mode === 'outline'}>Outline</span>
      <span class:active={mode === 'timeline'}>Timeline{pedalMode ? ' / Pedal' : ottavaMode ? ' / Ottava' : ''}</span>
    </div>
    <p class="editing-target">
      {mode === 'outline' ? 'Both staves' : timelineCursor.staff === 'upperStaff' ? 'Upper staff' : 'Lower staff'}
      {#if mode === 'timeline'}
        <span>/</span> Voice {timelineCursor.voiceIndex + 1}
        <span>/</span> {formatPitch(timelineCursor.pitch)}
        {#if selectedTimelineNotes.length > 1}
          <span>/</span> {selectedTimelineNotes.length} notes selected
        {/if}
      {/if}
    </p>
    {#if audioPreviewError}<span class="audio-error" title={audioPreviewError}>Audio preview unavailable</span>{/if}
  </header>

  <main class="workspace" aria-label="Score editing workspace">
    <OutlinePanel outline={project.outline} cursor={outlineCursor} keyEditing={isEditingInitialKey} tempoEditing={isEditingInitialTempo} meterEditing={isEditingInitialMeter} />
    <TimelinePanel
      outline={project.outline}
      trills={project.trills}
      cursor={outlineCursor}
      timelineCursor={pedalMode
        ? { ...timelineCursor, positionSixteenths: pedalCursor.position, focusedNoteId: null, selectionAnchorNoteId: null }
        : ottavaMode
          ? { ...timelineCursor, positionSixteenths: ottavaCursor.position, focusedNoteId: null, selectionAnchorNoteId: null }
          : timelineCursor}
      {pedalMode}
      {pedalCursor}
      {ottavaMode}
      {ottavaCursor}
      {playbackPosition}
      playbackActive={playbackPosition !== null}
      expressionModalOpen={noteSettings !== null}
      tempoChanges={project.tempoChanges} clefChanges={project.clefChanges}
      slurs={project.slurs}
      mode={mode}
    />
  </main>
</div>

{#if menuPath && timelineCursor.focusedNoteId}
  <NoteMenu path={menuPath} noteId={timelineCursor.focusedNoteId} items={createNoteMenuItems(project, selectedTimelineNotes.map(entry => entry.note.id))}
    choose={(path) => menuKey('Enter', path)} close={closeMenu} />
{/if}
{#if sectionTextInput}
  <FloatingTextInput anchor={sectionTextInput.anchor} value={sectionTextInput.value} maxLength={32} label="Section name"
    onCommit={commitSectionText} onCancel={() => sectionTextInput = null} />
{/if}
{#if fingeringTextInput}
  <FloatingTextInput anchor={fingeringTextInput.anchor} value={fingeringTextInput.value} maxLength={3} label="Piano fingering"
    accept={(value) => parseFingeringInput(value) !== undefined}
    onCommit={commitFingeringText} onCancel={() => fingeringTextInput = null} />
{/if}
{#if noteSettings}
  <ExpressionModal target={noteSettings.target} editor={noteSettings.expression}
    tab={noteSettings.tab} changesEditor={noteSettings.changes} selectTab={(tab)=>{if(noteSettings)noteSettings={...noteSettings,tab};}}
    note={ScoreTimeline.note(project.outline,noteSettings.target.noteId,noteSettings.target.staff)!.note} close={closeExpressionModal} />
{/if}
<EditorDialog />

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

  .audio-error {
    color: #e7a391;
    font-size: 11px;
    white-space: nowrap;
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
