export type MenuItem = { label: string; children?: MenuItem[]; action?: 'staccato' | 'none' | 'exit' };
export const articulationItems: MenuItem[] = [
  { label: 'Staccato', children: [{ label: 'Normal', action: 'staccato' }] },
  { label: 'None', action: 'none' },
  { label: 'Exit', action: 'exit' },
];
export function isMenuItemSelected(item: MenuItem, current?: 'staccato'): boolean {
  if (item.children) return item.children.some(child => isMenuItemSelected(child, current));
  return item.action === 'staccato' ? current === 'staccato' : item.action === 'none' && !current;
}
export function menuItemsAt(path: number[]) {
  let items = articulationItems;
  for (const index of path.slice(0, -1)) items = items[index]?.children ?? [];
  return items;
}
export function controlArticulationMenu(path: number[], key: string): { path: number[] | null; action?: MenuItem['action'] } {
  const items = menuItemsAt(path), index = path.at(-1)!, item = items[index];
  if (key === 'Escape' || key.toLowerCase() === 'm') return { path: null };
  if (key === 'ArrowUp' || key === 'ArrowDown') return { path: [...path.slice(0, -1), Math.max(0, Math.min(items.length - 1, index + (key === 'ArrowUp' ? -1 : 1)))] };
  if (key === 'ArrowLeft') return { path: path.length > 1 ? path.slice(0, -1) : path };
  if (key === 'ArrowRight' || key === 'Enter') {
    if (item?.children?.length) return { path: [...path, 0] };
    if (key === 'Enter' && item?.action) return { path: null, action: item.action };
  }
  return { path };
}
