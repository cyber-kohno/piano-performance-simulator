<script lang="ts">
  import { onMount } from 'svelte';
  import { menuItemsAt, isMenuItemSelected } from '../state/articulation-menu';
  let { path, noteId, current, choose, close }: {
    path: number[]; noteId: string; current?: 'staccato';
    choose: (path: number[]) => void; close: () => void;
  } = $props();
  let left = $state(0), top = $state(0), height = $state(200);
  const width = 220, row = 28, padding = 6;
  const levels = $derived.by(() => {
    const result = path.map((focus, depth) => ({ items: menuItemsAt(path.slice(0, depth + 1)), focus, active: true }));
    const child = result.at(-1)?.items[path.at(-1)!]?.children;
    if (child?.length) result.push({ items: child, focus: -1, active: false });
    return result;
  });
  function place() {
    const anchor = document.getElementById(`note-menu-anchor-${noteId}`);
    if (!anchor) { close(); return; }
    const rect = anchor.getBoundingClientRect();
    const available = window.innerWidth - 16;
    const totalWidth = Math.min(width, available) * levels.length;
    left = Math.max(8, Math.min(rect.left, window.innerWidth - totalWidth - 8));
    const required = Math.max(...levels.map(level => level.items.length * row + padding * 2)) + path.length * row;
    top = rect.bottom + 4;
    if (top + required > window.innerHeight - 8) top = Math.max(8, rect.top - required - 4);
    height = Math.max(28, window.innerHeight - top - 8);
  }
  $effect(() => { path; levels; place(); });
  onMount(() => {
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  });
</script>

<div class="articulation-menu" aria-label="Articulation menu">
  {#each levels as level, depth}
    {@const offset = path.slice(0, depth).reduce((sum, index) => sum + padding + index * row, 0)}
    <div class="frame" role="menu" aria-label={depth === 0 ? 'Articulation' : 'Staccato'}
      style:left={`${Math.min(left + depth * width, Math.max(8, window.innerWidth - width - 8))}px`}
      style:top={`${Math.min(top + offset, window.innerHeight - level.items.length * row - padding * 2 - 8)}px`}
      style:max-height={`${height}px`}>
      {#each level.items as item, index}
        <button type="button" role="menuitem" tabindex="-1" class:focus={level.focus === index}
          class:muted={!level.active || (depth < path.length - 1 && index !== level.focus)}
          aria-current={isMenuItemSelected(item, current) ? 'true' : undefined}
          onclick={() => { if (level.active) choose([...path.slice(0, depth), index]); }}>
          <span>{item.label}{isMenuItemSelected(item, current) ? ' ✓' : ''}</span>
          {#if item.children}<span>›</span>{/if}
        </button>
      {/each}
    </div>
  {/each}
</div>

<style>
  .frame { position: fixed; z-index: 100; display: flex; flex-direction: column; width: min(220px, calc(100vw - 16px)); padding: 6px; box-sizing: border-box; border: 1px solid #4f7fa5; border-radius: 5px; background: #0d263a; box-shadow: 0 8px 16px #0008; overflow-y: auto; }
  button { display: flex; justify-content: space-between; align-items: center; min-height: 28px; flex-shrink: 0; padding: 4px 8px; border: 1px solid transparent; border-radius: 4px; background: transparent; color: #c8f3ff; font: inherit; font-size: 13px; text-align: left; }
  button.focus { background: #245577; border-color: #72b9de; }
  button.muted { opacity: 0.55; }
</style>
