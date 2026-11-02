import { getSlurActions } from '../model/slur.ts';
import type { ScoreProject } from '../model/project.ts';
export type MenuItem = { label: string; children?: MenuItem[]; action?: 'expression' | 'add-slur' | 'remove-slur' | 'exit'; disabled?: boolean; reason?: string };
export const noteMenuItems: MenuItem[] = [
  { label: 'Expression…', action: 'expression' },
  { label: 'Add slur to selection', action: 'add-slur' },
  { label: 'Remove slur', action: 'remove-slur' },
  { label: 'Exit', action: 'exit' },
];
export function createNoteMenuItems(project: ScoreProject, ids: readonly string[]): MenuItem[] {
  const slur = getSlurActions(project, ids);
  return noteMenuItems.map(item => item.action === 'expression' ? { ...item, disabled: ids.length !== 1, reason: 'Select one note.' }
    : item.action === 'add-slur' ? { ...item, disabled: !slur.canAdd, reason: slur.addReason }
    : item.action === 'remove-slur' ? { ...item, disabled: !slur.canRemove, reason: slur.removeReason } : item);
}
export function menuItemsAt(path: number[], rootItems = noteMenuItems) {
  let items = rootItems;
  for (const index of path.slice(0, -1)) items = items[index]?.children ?? [];
  return items;
}
export function controlNoteMenu(path: number[], key: string, rootItems = noteMenuItems): { path: number[] | null; action?: MenuItem['action'] } {
  const items = menuItemsAt(path, rootItems), index = path.at(-1)!, item = items[index];
  if (key === 'Escape' || key.toLowerCase() === 'm') return { path: null };
  if (key === 'ArrowUp' || key === 'ArrowDown') return { path: [...path.slice(0, -1), Math.max(0, Math.min(items.length - 1, index + (key === 'ArrowUp' ? -1 : 1)))] };
  if (key === 'ArrowLeft') return { path: path.length > 1 ? path.slice(0, -1) : path };
  if (key === 'ArrowRight' || key === 'Enter') {
    if (item?.disabled) return { path };
    if (item?.children?.length) return { path: [...path, 0] };
    if (key === 'Enter' && item?.action) return { path: null, action: item.action };
  }
  return { path };
}
