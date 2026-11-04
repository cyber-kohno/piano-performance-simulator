import { writable } from 'svelte/store';

export type EditorDialogTone = 'normal' | 'danger';
export type EditorDialogChoiceRole = 'proceed' | 'cancel' | 'neutral';
export type EditorDialogChoice = {
  label: string;
  role: EditorDialogChoiceRole;
  callback: () => void | Promise<void>;
};
export type EditorDialog = {
  tone: EditorDialogTone;
  title: string;
  messageLines: string[];
  choices: EditorDialogChoice[];
  focus: number;
};

export const editorDialogStore = writable<EditorDialog | null>(null);
