<script lang="ts">
  import ScoreTimeline from "./domain/score/score-timeline.ts";
  import ScoreProjectFactory from "./domain/score/score-project.ts";
  import ScoreKey from "./domain/score/score-key.ts";

  import NoteEditor from './action/editor/note-editor';
  import PedalEditor from './action/editor/pedal-editor';
  import PedalInput from './state/pedal-input.ts';
  import { cycleGraceFocus, focusGraceParent, getFocusedGrace } from './state/grace-input';
  import { createPedalCursor } from './state/pedal';
  import OutlinePanel from './components/OutlinePanel.svelte';
  import TimelinePanel from './components/TimelinePanel.svelte';
  import NoteMenu from './components/NoteMenu.svelte';
  import ExpressionModal from './components/ExpressionModal.svelte';

  import NoteSettings, { type NoteSettingsState } from './state/note-settings.ts';

  import { controlNoteMenu, createNoteMenuItems } from './state/note-menu';

  import { type ScoreProject } from "./domain/score/types.ts";
  import { createKeyHold } from './state/key-hold.svelte';
  import {createTimelineCursor,getSelectedTimelineNotes} from './state/timeline-cursor.ts';
  import {createOutlineCursor} from './state/outline-cursor.ts';
  import EditorNavigation from './state/editor-navigation.ts';
  import WorkspaceKeyboard from './ui/keyboard/workspace-keyboard.ts';

  const initialProject = ScoreProjectFactory.create();
  let project = $state<ScoreProject>(initialProject);
  let outlineCursor = $state(createOutlineCursor(initialProject.outline));
  let timelineCursor = $state(createTimelineCursor());
  let mode = $state<'outline' | 'timeline'>('outline');
  const keyHold = createKeyHold();
  let menuPath = $state<number[] | null>(null);
  let noteSettings=$state<NoteSettingsState|null>(null);
  function openExpressionModal() {
    if(mode!=='timeline'||pedalMode)return;
    const editor=NoteSettings.open(project,timelineCursor);
    if(!editor)return;
    noteSettings=editor;
    closeMenu();
  }
  function closeExpressionModal() {noteSettings=null;keyHold.reset();}
  function closeMenu() { menuPath = null; keyHold.reset(); }
  function menuKey(key: string, path = menuPath) {
    if (!path) return;
    const ids = selectedTimelineNotes.map(entry => entry.note.id);
    const result = controlNoteMenu(path, key, createNoteMenuItems(project, ids));
    menuPath = result.path;
    if (!menuPath) keyHold.reset();
    if (result.action === 'expression') openExpressionModal();
    if (result.action === 'add-slur') project = NoteEditor.connectSlur(project, ids);
    if (result.action === 'remove-slur') project = NoteEditor.disconnectSlur(project, ids);
  }
  let pedalMode = $state(false);
  let pedalCursor = $state(createPedalCursor());
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

  function handleKeydown(event: KeyboardEvent) {
    if(noteSettings){
      event.preventDefault();
      const result=NoteSettings.control(project,noteSettings,event);
      if(result.commit)project=NoteEditor.configure(project,timelineCursor,result.commit);
      noteSettings=result.editor;
      if(!noteSettings)keyHold.reset();
      return;
    }
    if (menuPath) {
      event.preventDefault();
      if (!event.isComposing && !event.altKey && !event.ctrlKey && !event.metaKey &&
        (!event.repeat || ['ArrowUp', 'ArrowDown'].includes(event.key))) menuKey(event.key);
      return;
    }
    const targetElement = event.target;
    if (event.defaultPrevented || event.isComposing || (targetElement instanceof HTMLElement &&
      (targetElement.isContentEditable || targetElement.closest('input, textarea, select')))) return;
    if (event.key.toLowerCase() === 'b' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      if (!event.repeat) openExpressionModal();
      return;
    }
    if (event.key.toLowerCase() === 'm' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      if (mode === 'timeline' && !pedalMode && !getFocusedGrace(project.outline, timelineCursor) && selectedTimelineNotes.length >= 1) {
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
          pedalCursor = { ...pedalCursor, position: timelineCursor.positionSixteenths };
          const block = ScoreTimeline.blockAt(project.outline, pedalCursor.position);
          if (block) outlineCursor = { blockId: block.id };
        } else syncOutlineToTimelinePosition(timelineCursor.positionSixteenths);
      }
      return;
    }
    if(pedalMode){
      const result=PedalInput.control(project,pedalCursor,event);
      if(!result.handled)return;
      event.preventDefault();
      pedalCursor=result.cursor;
      if(result.exit){pedalMode=false;syncOutlineToTimelinePosition(timelineCursor.positionSixteenths);}
      if(result.outlineBlockId)outlineCursor={blockId:result.outlineBlockId};
      if(result.command?.type==='add')project=PedalEditor.add(project,result.command.position,result.command.action);
      else if(result.command?.type==='remove')project=PedalEditor.remove(project,result.command.position);
      return;
    }
    if (
      event.defaultPrevented || event.isComposing ||
      event.altKey || event.ctrlKey || event.metaKey
    ) return;
    if (mode === 'timeline' && event.key.toLowerCase() === 'w') {
      event.preventDefault();
      if (!event.repeat) {
        if (event.shiftKey) {
          const result = NoteEditor.addGrace(project, timelineCursor);
          if (result) { project = result.project; timelineCursor = result.cursor; }
        } else timelineCursor = cycleGraceFocus(project.outline, timelineCursor);
      }
      return;
    }
    if (mode === 'timeline' && getFocusedGrace(project.outline, timelineCursor)) {
      const key = event.key.toLowerCase();
      if (key === 'arrowup' || key === 'arrowdown' || key === 'delete' || key === 'escape') {
        event.preventDefault();
        if (key === 'escape') timelineCursor = focusGraceParent(project.outline, timelineCursor);
        else {
          const result = key === 'delete' ? NoteEditor.removeGrace(project, timelineCursor) : NoteEditor.moveGracePitch(
            project, timelineCursor, key === 'arrowup' ? 1 : -1, keyHold.diatonicMovement, keyHold.octaveMovement);
          if (result) { project = result.project; timelineCursor = result.cursor; }
        }
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
    const result=WorkspaceKeyboard.control({project,outlineCursor,timelineCursor,mode},event,keyHold,measureKeyCache);
    if(result.handled)event.preventDefault();
    project=result.project;
    outlineCursor=result.outlineCursor;
    timelineCursor=result.timelineCursor;
    mode=result.mode;
  }
</script>

<svelte:window onkeydown={handleKeydown} onblur={closeMenu} />

<div class="editor">
  <header class="app-header">
    <h1>PIANO <span>EDITOR</span></h1>
    <div class="mode-labels" aria-label="Editing modes">
      <span class:active={mode === 'outline'}>Outline</span>
      <span class:active={mode === 'timeline'}>Timeline{pedalMode ? ' / Pedal' : ''}</span>
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
  </header>

  <main class="workspace" aria-label="Score editing workspace">
    <OutlinePanel outline={project.outline} cursor={outlineCursor} keyEditing={isEditingInitialKey} tempoEditing={isEditingInitialTempo} meterEditing={isEditingInitialMeter} />
    <TimelinePanel
      outline={project.outline}
      trills={project.trills}
      cursor={outlineCursor}
      timelineCursor={pedalMode ? { ...timelineCursor, positionSixteenths: pedalCursor.position, focusedNoteId: null, selectionAnchorNoteId: null } : timelineCursor}
      {pedalMode}
      {pedalCursor}
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
{#if noteSettings}
  <ExpressionModal target={noteSettings.target} editor={noteSettings.expression}
    tab={noteSettings.tab} changesEditor={noteSettings.changes} selectTab={(tab)=>{if(noteSettings)noteSettings={...noteSettings,tab};}}
    note={ScoreTimeline.note(project.outline,noteSettings.target.noteId,noteSettings.target.staff)!.note} close={closeExpressionModal} />
{/if}

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
