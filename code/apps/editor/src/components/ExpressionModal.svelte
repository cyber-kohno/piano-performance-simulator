<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { expressionDefinitions, getExpressionRows, fermataFromDraft, type ExpressionEditor } from '../state/expression-editor';
  import ScoreFermata from '../domain/score/score-fermata.ts';
  import type { PianoNote, ScoreProject } from "../domain/score/types.ts";
  import type { ChangesEditor } from '../state/changes-editor';
  let { target, editor, note, project, close, tab, changesEditor, selectTab }: {
    project: ScoreProject;
    tab: 'expression' | 'changes';
    changesEditor: ChangesEditor;
    selectTab: (tab: 'expression' | 'changes') => void;
    target: { noteId: string; measureNumber: number; staff: 'upperStaff' | 'lowerStaff'; voice: number; trillNoteCount?: number; graceNote?: boolean };
    close: () => void;
    editor: ExpressionEditor;
    note: PianoNote;
  } = $props();
  const rows = $derived(getExpressionRows(editor,note,project));
  const selectedDefinition = $derived(expressionDefinitions.find(item=>item.id===(editor.detail ?? rows[editor.row]?.id)));
  const fermataGroup = $derived(ScoreFermata.groups(project, { noteId: note.id, settings: fermataFromDraft(editor) }).find(group => group.noteIds.includes(note.id)));
  let dialog: HTMLDialogElement;
  let content = $state<HTMLDivElement>();
  onMount(() => { dialog.showModal(); dialog.focus(); });
  $effect(() => {
    const container = content;
    const row = tab === 'changes' ? changesEditor.row : editor.row;
    const detail = tab === 'changes' ? changesEditor.detail : editor.detail;
    if (!container) return;
    void tick().then(() => {
      if (!container.isConnected) return;
      const active = container.querySelectorAll<HTMLElement>('.expression-row')[detail ? 0 : row];
      if (!active) return;
      const bounds = container.getBoundingClientRect(), item = active.getBoundingClientRect();
      if (item.top < bounds.top + 4) container.scrollTop -= bounds.top + 4 - item.top;
      else if (item.bottom > bounds.bottom - 4) container.scrollTop += item.bottom - bounds.bottom + 4;
    });
  });
</script>

<dialog class="expression-modal" aria-labelledby="expression-modal-title" aria-describedby="expression-modal-context"
  bind:this={dialog} tabindex="-1" oncancel={(event) => { event.preventDefault(); close(); }}>
  <header>
    <h2 id="expression-modal-title">Note settings{tab === 'expression' && editor.detail ? ` > ${selectedDefinition?.label ?? ''}` : tab === 'changes' && changesEditor.detail ? (changesEditor.detail === 'tempo' ? ' > Tempo' : changesEditor.detail === 'clef' ? ' > Clef' : ' > Dynamics') : ''}</h2>
    <p id="expression-modal-context">Measure {target.measureNumber} · {target.staff === 'upperStaff' ? 'Upper' : 'Lower'} · Voice {target.voice}</p>
  </header>
  <div class="expression-content">
    <div class="tabs" role="tablist" aria-label="Note settings">
      <button type="button" role="tab" aria-selected={tab === 'expression'} onclick={() => selectTab('expression')}>Expression</button>
      <button type="button" role="tab" aria-selected={tab === 'changes'} onclick={() => selectTab('changes')}>Changes</button>
    </div>
    <div class="expression-list" bind:this={content}>
    {#if tab === 'changes'}
      <div role="listbox" aria-label={changesEditor.detail ? `${changesEditor.detail} settings` : 'Changes'}>
        {#if changesEditor.detail}
          <div role="option" aria-selected="true" class="expression-row active">
            <span>{changesEditor.detail === 'tempo' ? 'BPM' : changesEditor.detail === 'clef' ? 'Clef' : 'Level'}</span>
            <span class="expression-value">{changesEditor.detail === 'tempo' ? changesEditor.tempo.bpm : changesEditor.detail === 'clef' ? changesEditor.clef === 'treble' ? 'Treble' : 'Bass' : changesEditor.dynamic}</span>
          </div>
        {:else}
          {#each ['Tempo', 'Clef', 'Dynamics'] as label, index}
            {@const disabled = target.voice !== 1 || (index !== 1 && target.staff !== 'upperStaff') || (index === 2 && target.graceNote)}
            <div role="option" aria-selected={changesEditor.row === index} aria-disabled={disabled}
              class="expression-row" class:active={changesEditor.row === index} class:disabled>
              <span>{label}</span><span class="expression-value">{(index === 0 ? changesEditor.tempo.bpm !== null : index === 1 ? changesEditor.clef !== null : changesEditor.dynamic !== null) ? 'On ›' : 'Off ›'}</span>
            </div>
          {/each}
        {/if}
      </div>
    {:else}
      <div role="listbox" aria-label={editor.detail ? `${selectedDefinition?.label} settings` : 'Expressions'}>
        {#each rows as row, index (row.id)}
          <div role="option" aria-selected={editor.row === index} aria-disabled={row.disabled}
            class="expression-row" class:active={editor.row === index} class:disabled={row.disabled}>
            <span>{row.label}</span><span class="expression-value">{row.value}{row.parent ? ' ›' : ''}</span>
          </div>
        {/each}
      </div>
    {/if}
    </div>
    <div class="expression-notes">
    {#if tab === 'changes'}
      {#if (changesEditor.detail ?? (changesEditor.row === 0 ? 'tempo' : 'clef')) === 'tempo'}
        <p>Applies to all staves and voices from this note until the next change.</p>
        {#if target.staff !== 'upperStaff' || target.voice !== 1}<p class="unavailable">Requires Upper · Voice 1.</p>{/if}
      {:else if (changesEditor.detail ?? (changesEditor.row === 1 ? 'clef' : 'dynamic')) === 'clef'}
        <p>Applies to every voice on this staff from this note. Pitches are unchanged.</p>
        {#if target.voice !== 1}<p class="unavailable">Requires Voice 1 on this staff.</p>{/if}
      {:else}
        <p>Global level until the next dynamic change. Current: {changesEditor.currentDynamic}. Playback is not yet affected.</p>
        {#if target.voice !== 1 || target.staff !== 'upperStaff' || target.graceNote}<p class="unavailable">Requires a written note in Upper · Voice 1.</p>{/if}
      {/if}
      <p>{changesEditor.detail ? '←→ Edit · Backspace Back' : '↑↓ Select · Enter Settings · Delete Remove'}</p>
    {:else}
    {#if selectedDefinition?.id === 'trill'}
      <p>Applies to {target.trillNoteCount && target.trillNoteCount > 1 ? `the entire tie chain (${target.trillNoteCount} notes)` : 'this note'}.</p>
    {:else if selectedDefinition?.id === 'fermata'}
      <p>Shared range: earliest start to common end. Ratio priority: lower voice number, then upper staff.</p>
    {/if}
    {#if selectedDefinition?.id === 'fermata' && fermataGroup}
      <p>Effective ratio: {fermataGroup.lengthRatio.toFixed(1)} · {fermataGroup.staff === 'upperStaff' ? 'Upper' : 'Lower'} · Voice {fermataGroup.voiceIndex + 1}</p>
    {/if}
    {#if selectedDefinition && !selectedDefinition.available(note,editor.draft,project)}
      <p class="unavailable">{selectedDefinition.unavailableReason(note,editor.draft,project)}</p>
    {/if}
    {/if}
    {#if editor.error}<p class="error" role="alert">{editor.error}</p>{/if}
    </div>
  </div>
  <footer><kbd>Tab</kbd> Switch <span>·</span><kbd>Shift+Enter</kbd> Apply <span>·</span> <kbd>Esc</kbd> Cancel{#if tab === 'expression' ? editor.detail : changesEditor.detail} <span>·</span> <kbd>Backspace</kbd> Back{/if}</footer>
</dialog>

<style>
  .tabs { display: flex; gap: 8px; }
  .tabs button { border: 1px solid #a4bcbc; padding: 5px 14px; background: #edf3f3; color: inherit; border-radius: 3px; }
  .tabs button[aria-selected='true'] { background: #c9dddd; font-weight: 600; }
  .expression-modal {
    position: fixed;
    inset: auto;
    top: calc(var(--app-header-height) + 16px);
    left: calc(var(--outline-width) + 16px);
    width: 480px;
    height: 360px;
    max-width: none;
    max-height: calc(100dvh - var(--app-header-height) - 32px);
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    border: 1px solid #73959f;
    border-radius: 5px;
    background: #edf3f3;
    color: #304b55;
    box-shadow: 0 12px 32px #0005;
    overflow: hidden;
    outline: none;
  }
  .expression-modal[open] { display: grid; grid-template-rows: 76px minmax(0, 1fr) 36px; }
  .expression-modal::backdrop { background: transparent; }
  header { padding: 12px 16px; background: #c9dddd; border-bottom: 1px solid #a4bcbc; }
  h2 { margin: 0 0 8px; font-size: 16px; font-weight: 600; }
  p { margin: 0; font-size: 12px; }
  .expression-content { min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr) 40px; gap: 8px; overflow: hidden; background: #f3f7f7; padding: 12px 12px 0; }
  .expression-list { min-height: 0; overflow-y: auto; scrollbar-width: none; overscroll-behavior: contain; padding-block: 4px; }
  .expression-list::-webkit-scrollbar { display: none; }
  .expression-notes { box-sizing: border-box; height: 40px; display: grid; align-content: start; margin-inline: -12px; padding: 4px 12px; overflow: hidden; background: #e1ebed; line-height: 16px; }
  .expression-row { display: flex; justify-content: space-between; align-items: center; min-height: 36px; padding: 8px 12px; border-radius: 3px; font-size: 13px; }
  .expression-row.active { background: #d4e5e8; }
  .expression-row.disabled { opacity: 0.45; }
  .expression-value { font-weight: 600; }
  .unavailable, .error { line-height: inherit; }
  .unavailable { color: #60767d; }
  .error { color: #a82929; }
  footer { padding: 8px 16px; border-top: 1px solid #c4d3d3; font-size: 12px; }
  kbd { font: inherit; font-weight: 600; margin-right: 5px; }
  footer span { margin: 0 6px; }
</style>
