import { onMount } from 'svelte';

// Physical keys and logical actions are separate so bindings can change later.
const HOLD_BINDINGS = {
  rangeSelection: ['ShiftLeft', 'ShiftRight'],
  pitchSelection: ['KeyE'],
  diatonicMovement: ['KeyC'],
  octaveMovement: ['KeyZ'],
  keySignatureEditing: ['KeyC'],
  noteNavigation: ['KeyE'],
  noteValueEditing: ['KeyF'],
  tempoEditing: ['KeyF'],
  measureLengthEditing: ['KeyF'],
  notePositionEditing: ['KeyD'],
  meterEditing: ['KeyD'],
} as const;

export function createKeyHold() {
  let pressed = $state<ReadonlySet<string>>(new Set());
  function reset() { pressed = new Set(); }

  function update(event: KeyboardEvent, down: boolean) {
    const next = new Set(pressed);
    if (down) next.add(event.code);
    else next.delete(event.code);
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
    reset,
    get rangeSelection() {
      return HOLD_BINDINGS.rangeSelection.some((code) => pressed.has(code));
    },
    get pitchSelection() {
      return HOLD_BINDINGS.pitchSelection.some((code) => pressed.has(code));
    },
    get diatonicMovement() {
      return HOLD_BINDINGS.diatonicMovement.some((code) => pressed.has(code));
    },
    get octaveMovement() {
      return HOLD_BINDINGS.octaveMovement.some((code) => pressed.has(code));
    },
    get keySignatureEditing() {
      return HOLD_BINDINGS.keySignatureEditing.some((code) => pressed.has(code));
    },
    get noteNavigation() {
      return HOLD_BINDINGS.noteNavigation.some((code) => pressed.has(code));
    },
    get noteValueEditing() {
      return HOLD_BINDINGS.noteValueEditing.some((code) => pressed.has(code));
    },
    get tempoEditing() {
      return HOLD_BINDINGS.tempoEditing.some((code) => pressed.has(code));
    },
    get measureLengthEditing() {
      return HOLD_BINDINGS.measureLengthEditing.some((code) => pressed.has(code));
    },
    get notePositionEditing() {
      return HOLD_BINDINGS.notePositionEditing.some((code) => pressed.has(code));
    },
    get meterEditing() {
      return HOLD_BINDINGS.meterEditing.some((code) => pressed.has(code));
    },
  };
}
