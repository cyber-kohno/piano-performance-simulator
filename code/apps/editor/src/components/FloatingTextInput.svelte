<script lang="ts">
  import { onMount } from 'svelte';

  let { anchor, value, maxLength = 32, label = 'Text', onCommit, onCancel }: {
    anchor: HTMLElement;
    value: string;
    maxLength?: number;
    label?: string;
    onCommit: (value: string) => void;
    onCancel: () => void;
  } = $props();

  let input: HTMLInputElement;
  let position = $state({ left: 0, top: 0, width: 240 });

  function updatePosition() {
    if (!anchor.isConnected) return;
    const rect = anchor.getBoundingClientRect();
    const width = Math.max(220, Math.min(360, rect.width));
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + rect.width / 2 - width / 2));
    const below = rect.bottom + 6;
    const top = below + 46 <= window.innerHeight ? below : Math.max(8, rect.top - 52);
    position = { left, top, width };
  }

  function handleKeydown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      const next = input.value.trim();
      if (next) onCommit(next);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    }
  }

  onMount(() => {
    updatePosition();
    input.focus();
    input.select();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !input.contains(event.target)) onCancel();
    };
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('pointerdown', outside, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('pointerdown', outside, true);
    };
  });
</script>

<input
  bind:this={input}
  class="floating-text-input"
  type="text"
  aria-label={label}
  maxlength={maxLength}
  {value}
  style={`left:${position.left}px;top:${position.top}px;width:${position.width}px`}
  onkeydown={handleKeydown}
/>

<style>
  .floating-text-input {
    position: fixed;
    z-index: 1000;
    box-sizing: border-box;
    height: 38px;
    padding: 7px 10px;
    border: 1px solid #397a70;
    border-radius: 4px;
    outline: 2px solid #397a7040;
    background: #fffef8;
    color: #263d43;
    box-shadow: 0 5px 18px #243b4533;
    font: inherit;
    font-size: 14px;
  }
</style>
