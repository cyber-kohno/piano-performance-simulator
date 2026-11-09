export type FloatingTextState = { value: string; cursor: number };
export type FloatingTextKey = {
  key: string; isComposing: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean;
};

// Match Scorehack's character set and cursor editing without a native text input.
namespace FloatingText {
  export function create(value: string): FloatingTextState {
    return { value, cursor: value.length };
  }
  export function control(state: FloatingTextState, input: FloatingTextKey, maxLength: number): {
    state: FloatingTextState; action?: 'commit' | 'cancel';
  } {
    const { value } = state;
    const cursor = Math.max(0, Math.min(value.length, state.cursor));
    if (input.isComposing || input.ctrlKey || input.metaKey || input.altKey) return { state };
    switch (input.key) {
      case 'Enter': return { state, action: 'commit' };
      case 'Escape': return { state, action: 'cancel' };
      case 'ArrowLeft': return { state: { value, cursor: Math.max(0, cursor - 1) } };
      case 'ArrowRight': return { state: { value, cursor: Math.min(value.length, cursor + 1) } };
      case 'Backspace': return { state: cursor === 0 ? state : {
        value: value.slice(0, cursor - 1) + value.slice(cursor), cursor: cursor - 1,
      } };
      case 'Delete': return { state: { value: value.slice(0, cursor) + value.slice(cursor + 1), cursor } };
    }
    if (!/^[a-zA-Z0-9 _'.,#-]$/.test(input.key) || value.length >= maxLength) return { state };
    return { state: { value: value.slice(0, cursor) + input.key + value.slice(cursor), cursor: cursor + 1 } };
  }
}
export default FloatingText;
