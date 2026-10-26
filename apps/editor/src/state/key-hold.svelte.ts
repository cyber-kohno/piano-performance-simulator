import { onMount } from 'svelte';

// Physical keys and logical actions are separate so bindings can change later.
const HOLD_BINDINGS = {
  pitchSelection: ['ShiftLeft', 'ShiftRight'],
  diatonicMovement: ['KeyC'],
  noteNavigation: ['KeyE'],
} as const;

export function createKeyHold() {
  let pressed = $state<ReadonlySet<string>>(new Set());
  function reset() { pressed = new Set(); }

  function update(event: KeyboardEvent, down: boolean) {
    const next = new Set(pressed);
    if (down) next.add(event.code);
    else next.delete(event.code);
    // Recover from a missed modifier release even while the window is active.
    if (!event.shiftKey) {
      next.delete('ShiftLeft');
      next.delete('ShiftRight');
    }
    pressed = next;
  }

  onMount(() => {
    const down = (event: KeyboardEvent) => update(event, true);
    const up = (event: KeyboardEvent) => update(event, false);
    const visibility = () => { if (document.hidden) reset(); };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('keydown', down, { capture: true });
      window.removeEventListener('keyup', up, { capture: true });
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', visibility);
      reset();
    };
  });

  return {
    get pitchSelection() {
      return HOLD_BINDINGS.pitchSelection.some((code) => pressed.has(code));
    },
    get diatonicMovement() {
      return HOLD_BINDINGS.diatonicMovement.some((code) => pressed.has(code));
    },
    get noteNavigation() {
      return HOLD_BINDINGS.noteNavigation.some((code) => pressed.has(code));
    },
  };
}
