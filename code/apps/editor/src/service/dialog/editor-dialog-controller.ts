import { get } from 'svelte/store';
import { editorDialogStore, type EditorDialog, type EditorDialogTone } from '../../state/editor-dialog.ts';

export type ConfirmDialogOptions = {
  tone?: EditorDialogTone;
  title: string;
  messageLines: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void | Promise<void>;
};
export type AlertDialogOptions = {
  tone?: EditorDialogTone;
  title: string;
  messageLines: string[];
  onClose?: () => void | Promise<void>;
};

namespace EditorDialogController {
  export function isOpen(): boolean {
    return get(editorDialogStore) !== null;
  }

  export function confirm(options: ConfirmDialogOptions): void {
    const dialog: EditorDialog = {
      tone: options.tone ?? 'normal',
      title: options.title,
      messageLines: [...options.messageLines],
      choices: [
        { label: options.confirmLabel ?? 'OK', role: 'proceed', callback: options.onConfirm },
        { label: options.cancelLabel ?? 'Cancel', role: 'cancel', callback: () => {} },
      ],
      // Destructive confirmations default to the safe choice.
      focus: 1,
    };
    editorDialogStore.set(dialog);
  }

  export function alert(options: AlertDialogOptions): void {
    editorDialogStore.set({
      tone: options.tone ?? 'normal',
      title: options.title,
      messageLines: [...options.messageLines],
      choices: [{ label: 'OK', role: 'neutral', callback: options.onClose ?? (() => {}) }],
      focus: 0,
    });
  }

  export function close(): void {
    editorDialogStore.set(null);
  }

  export function move(direction: -1 | 1): void {
    const dialog = get(editorDialogStore);
    if (!dialog) return;
    const focus = Math.max(0, Math.min(dialog.choices.length - 1, dialog.focus + direction));
    if (focus !== dialog.focus) editorDialogStore.set({ ...dialog, focus });
  }

  export function choose(index: number): boolean {
    const dialog = get(editorDialogStore);
    const choice = dialog?.choices[index];
    if (!dialog || !choice) return false;
    close();
    try {
      const result = choice.callback();
      if (result instanceof Promise) result.catch(error => console.error('Editor dialog callback failed:', error));
    } catch (error) {
      console.error('Editor dialog callback failed:', error);
    }
    return true;
  }

  export function controlKey(event: Pick<KeyboardEvent, 'key' | 'repeat' | 'preventDefault'>): boolean {
    if (!isOpen()) return false;
    event.preventDefault();
    if (event.repeat && !['ArrowLeft', 'ArrowRight'].includes(event.key)) return true;
    switch (event.key) {
      case 'ArrowLeft': move(-1); break;
      case 'ArrowRight': move(1); break;
      case 'Enter': choose(get(editorDialogStore)!.focus); break;
      case 'Escape': close(); break;
    }
    return true;
  }
}

export default EditorDialogController;
