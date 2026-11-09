<script lang="ts">
  import { onMount } from 'svelte';
  import type { FloatingTextState } from '../state/floating-text-input.ts';

  let { anchor, draft, label = 'Text', accept, onCancel }: {
    anchor: HTMLElement;
    draft: FloatingTextState;
    label?: string;
    accept?: (value: string) => boolean;
    onCancel: () => void;
  } = $props();

  let frame: HTMLDivElement;
  const hasError = $derived(accept ? !accept(draft.value.trim()) : draft.value.trim().length === 0);
  let position = $state({ left: 0, top: 0, width: 120 });

  function updatePosition() {
    if (!anchor.isConnected) return;
    const rect = anchor.getBoundingClientRect();
    const width = Math.max(80, Math.min(360, rect.width, window.innerWidth - 16));
    const actualWidth = Math.max(width, frame?.offsetWidth ?? width);
    const height = frame?.offsetHeight ?? 28;
    position = {
      left: Math.max(8, Math.min(rect.left, window.innerWidth - actualWidth - 8)),
      top: rect.bottom + 4 + height <= window.innerHeight - 8 ? rect.bottom + 4 : Math.max(8, rect.top - height - 4),
      width,
    };
  }

  onMount(() => {
    updatePosition();
    frame.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !frame.contains(event.target)) onCancel();
    };
    const observer = new ResizeObserver(updatePosition);
    observer.observe(frame);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('pointerdown', outside, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('pointerdown', outside, true);
    };
  });
</script>

<div bind:this={frame} class="frame" class:error={hasError} role="group" aria-label={label}
  tabindex="-1"
  style:left={`${position.left}px`} style:top={`${position.top}px`} style:min-width={`${position.width}px`}>
  <span>{draft.value.slice(0, draft.cursor)}</span><span class="cursor" aria-hidden="true"></span><span>{draft.value.slice(draft.cursor)}</span>
</div>

<style>
  .frame {
    display: inline-block;
    position: fixed;
    z-index: 1000;
    min-height: 24px;
    max-width: calc(100vw - 16px);
    overflow-x: auto;
    padding: 3px 6px;
    border: solid 1px #ffffffa8;
    border-radius: 3px;
    box-sizing: border-box;
    outline: none;
    background-color: #000;
    color: #fff;
    font-family: Consolas, monospace;
    font-size: 14px;
    font-weight: 600;
    line-height: 18px;
    white-space: pre;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.55);
  }
  .frame.error { border-color: #ff8f8f; background-color: #2a0505; }
  .cursor {
    display: inline-block;
    width: 1px;
    height: 16px;
    margin-right: -1px;
    background-color: #fff;
    vertical-align: -3px;
  }
</style>
