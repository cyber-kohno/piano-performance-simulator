<script lang="ts">
  import { onMount } from 'svelte';
  import { expressionDefinitions, getExpressionRows, type ExpressionEditor } from '../state/expression-editor';
  import type { PianoNote } from '../model/project';
  import type { ChangesEditor } from '../state/changes-editor';
  let { target, editor, note, close, tab, changesEditor, selectTab }: {
    tab: 'expression' | 'changes';
    changesEditor: ChangesEditor;
    selectTab: (tab: 'expression' | 'changes') => void;
    target: { noteId: string; measureNumber: number; staff: 'upperStaff' | 'lowerStaff'; voice: number; trillNoteCount?: number };
    close: () => void;
    editor: ExpressionEditor;
    note: PianoNote;
  } = $props();
  const rows = $derived(getExpressionRows(editor,note));
  const selectedDefinition = $derived(expressionDefinitions.find(item=>item.id===(editor.detail ?? rows[editor.row]?.id)));
  let dialog: HTMLDialogElement;
  onMount(() => { dialog.showModal(); dialog.focus(); });
</script>

<dialog class="expression-modal" aria-labelledby="expression-modal-title" aria-describedby="expression-modal-context"
  bind:this={dialog} tabindex="-1" oncancel={(event) => { event.preventDefault(); close(); }}>
  <header>
    <h2 id="expression-modal-title">Note settings{tab === 'expression' && editor.detail ? ` > ${selectedDefinition?.label ?? ''}` : tab === 'changes' && changesEditor.detail ? (changesEditor.detail === 'tempo' ? ' > Tempo' : ' > Clef') : ''}</h2>
    <p id="expression-modal-context">Measure {target.measureNumber} · {target.staff === 'upperStaff' ? 'Upper' : 'Lower'} · Voice {target.voice}</p>
  </header>
  <div class="expression-content">
    <div class="tabs" role="tablist" aria-label="Note settings">
      <button type="button" role="tab" aria-selected={tab === 'expression'} onclick={() => selectTab('expression')}>Expression</button>
      <button type="button" role="tab" aria-selected={tab === 'changes'} onclick={() => selectTab('changes')}>Changes</button>
    </div>
    {#if tab === 'changes'}
      <div role="listbox" aria-label={changesEditor.detail ? `${changesEditor.detail} settings` : 'Changes'}>
        {#if changesEditor.detail}
          <div role="option" aria-selected="true" class="expression-row active">
            <span>{changesEditor.detail === 'tempo' ? 'BPM' : 'Clef'}</span>
            <span class="expression-value">{changesEditor.detail === 'tempo' ? changesEditor.tempo.bpm : changesEditor.clef === 'treble' ? 'Treble' : 'Bass'}</span>
          </div>
        {:else}
          {#each ['Tempo', 'Clef'] as label, index}
            {@const disabled = target.voice !== 1 || (index === 0 && target.staff !== 'upperStaff')}
            <div role="option" aria-selected={changesEditor.row === index} aria-disabled={disabled}
              class="expression-row" class:active={changesEditor.row === index} class:disabled>
              <span>{label}</span><span class="expression-value">{(index === 0 ? changesEditor.tempo.bpm !== null : changesEditor.clef !== null) ? 'On ›' : 'Off ›'}</span>
            </div>
          {/each}
        {/if}
      </div>
      {#if (changesEditor.detail ?? (changesEditor.row === 0 ? 'tempo' : 'clef')) === 'tempo'}
        <p>Applies to all staves and voices from this note until the next change.</p>
        {#if target.staff !== 'upperStaff' || target.voice !== 1}<p class="unavailable">Requires Upper · Voice 1.</p>{/if}
      {:else}
        <p>Applies to every voice on this staff from this note. Pitches are unchanged.</p>
        {#if target.voice !== 1}<p class="unavailable">Requires Voice 1 on this staff.</p>{/if}
      {/if}
      <p>{changesEditor.detail ? '←→ Edit · Backspace Back' : '↑↓ Select · Enter Settings · Delete Remove'}</p>
    {:else}
    <div role="listbox" aria-label={editor.detail ? `${selectedDefinition?.label} settings` : 'Expressions'}>
      {#each rows as row, index (row.id)}
        <div role="option" aria-selected={editor.row === index} aria-disabled={row.disabled}
          class="expression-row" class:active={editor.row === index} class:disabled={row.disabled}>
          <span>{row.label}</span><span class="expression-value">{row.value}{row.parent ? ' ›' : ''}</span>
        </div>
      {/each}
    </div>
    {#if selectedDefinition?.id === 'trill'}
      <p>Applies to {target.trillNoteCount && target.trillNoteCount > 1 ? `the entire tie chain (${target.trillNoteCount} notes)` : 'this note'}.</p>
    {/if}
    {#if selectedDefinition && !selectedDefinition.available(note,editor.draft)}
      <p class="unavailable">{selectedDefinition.unavailableReason(note,editor.draft)}</p>
    {/if}
    {/if}
    {#if editor.error}<p class="error" role="alert">{editor.error}</p>{/if}
  </div>
  <footer><kbd>Tab</kbd> Switch <span>·</span><kbd>Shift+Enter</kbd> Apply <span>·</span> <kbd>Esc</kbd> Cancel{#if tab === 'expression' ? editor.detail : changesEditor.detail} <span>·</span> <kbd>Backspace</kbd> Back{/if}</footer>
</dialog>

<style>
  .tabs { display: flex; gap: 8px; margin-bottom: 8px; }
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
    max-height: none;
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
  .expression-content { background: #f3f7f7; padding: 12px; }
  .expression-row { display: flex; justify-content: space-between; align-items: center; min-height: 36px; padding: 8px 12px; border-radius: 3px; font-size: 13px; }
  .expression-row.active { background: #d4e5e8; }
  .expression-row.disabled { opacity: 0.45; }
  .expression-value { font-weight: 600; }
  .unavailable, .error { margin: 16px 12px 0; line-height: 1.5; }
  .unavailable { color: #60767d; }
  .error { color: #a82929; }
  footer { padding: 8px 16px; border-top: 1px solid #c4d3d3; font-size: 12px; }
  kbd { font: inherit; font-weight: 600; margin-right: 5px; }
  footer span { margin: 0 6px; }
</style>
