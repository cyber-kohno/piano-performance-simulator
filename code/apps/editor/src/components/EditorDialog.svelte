<script lang="ts">
  import { editorDialogStore } from '../state/editor-dialog.ts';
  import EditorDialogController from '../service/dialog/editor-dialog-controller.ts';

  const dialog = $derived($editorDialogStore);
  let dialogElement = $state<HTMLElement>();

  $effect(() => {
    if (dialog) requestAnimationFrame(() => dialogElement?.focus());
  });
</script>

{#if dialog}
  <div class="overlay">
    <section
      class="dialog"
      data-tone={dialog.tone}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="editor-dialog-title"
      aria-describedby="editor-dialog-message"
      tabindex="-1"
      bind:this={dialogElement}
    >
      <h2 id="editor-dialog-title">{dialog.title}</h2>
      <div id="editor-dialog-message" class="message">
        {#each dialog.messageLines as line}
          <p>{line}</p>
        {/each}
      </div>
      <div class="choices">
        {#each dialog.choices as choice, index}
          <button
            type="button"
            class:focused={index === dialog.focus}
            data-role={choice.role}
            aria-pressed={index === dialog.focus}
            onclick={() => EditorDialogController.choose(index)}
          >{choice.label}</button>
        {/each}
      </div>
      <p class="hint">Use Left / Right, then Enter. Escape closes.</p>
    </section>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    z-index: 10000;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgb(8 20 27 / 58%);
  }
  .dialog {
    box-sizing: border-box;
    width: 440px;
    padding: 20px 22px 14px;
    border: 2px solid #6d9caa;
    border-radius: 5px;
    background: #dce9eb;
    color: #20363d;
    box-shadow: 0 12px 38px rgb(0 0 0 / 40%);
    outline: none;
  }
  .dialog[data-tone='danger'] { border-color: #a64a4a; }
  h2 { margin: 0 0 12px; font-size: 18px; line-height: 1.35; }
  .message { font-size: 14px; line-height: 1.55; }
  .message p { margin: 4px 0; }
  .choices { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
  button {
    min-width: 86px;
    padding: 7px 14px;
    border: 1px solid #698892;
    border-radius: 4px;
    background: #edf4f4;
    color: #20363d;
    font: inherit;
    font-size: 14px;
  }
  button[data-role='proceed'] { border-color: #a64a4a; }
  button.focused { background: #426e78; color: white; font-weight: 700; }
  .dialog[data-tone='danger'] button[data-role='proceed'].focused { background: #923e43; }
  .hint { margin: 12px 0 0; color: #536970; font-size: 11px; text-align: right; }
</style>
