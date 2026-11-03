/** Shift changes number-key characters (!, @, #...), so use the physical digit code too. */
export function resolveTimelineNumberInput(
  event: Pick<KeyboardEvent, 'key' | 'code' | 'shiftKey'>,
  hasFocusedNote: boolean,
  shiftHeld = false,
): { key: '1' | '2' | '3' | '4'; target: 'note' | 'cursor' } | undefined {
  const key = /^Digit[1234]$/.test(event.code) ? event.code.slice(5) : event.key;
  if (key !== '1' && key !== '2' && key !== '3' && key !== '4') return undefined;
  return { key, target: hasFocusedNote && !event.shiftKey && !shiftHeld ? 'note' : 'cursor' };
}

/** Shift+Period produces '>' on common layouts. Numpad decimal also supplies '.'. */
export function resolveTimelineDotInput(
  event: Pick<KeyboardEvent, 'key' | 'code' | 'shiftKey'>,
  hasFocusedNote: boolean,
  shiftHeld = false,
): 'note' | 'cursor' | undefined {
  if (event.key !== '.' && event.code !== 'Period') return undefined;
  return hasFocusedNote && !event.shiftKey && !shiftHeld ? 'note' : 'cursor';
}
