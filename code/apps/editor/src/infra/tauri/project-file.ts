import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import type { ScoreProject } from '../../domain/score/types.ts';

export type ProjectFileHandle = { path: string; name: string };

namespace ProjectFile {
  const filters = [{ name: 'ClavierDesk Project', extensions: ['clavierdesk'] }];

  function toHandle(path: string): ProjectFileHandle {
    const name = path.replaceAll('\\', '/').split('/').at(-1) || path;
    return { path, name };
  }

  export async function saveAsPath(): Promise<ProjectFileHandle | null> {
    const path = await save({
      defaultPath: 'Untitled.clavierdesk',
      filters,
    });
    return path ? toHandle(path) : null;
  }

  export async function openPath(): Promise<ProjectFileHandle | null> {
    const path = await open({ multiple: false, directory: false, filters });
    return typeof path === 'string' ? toHandle(path) : null;
  }

  export async function write(handle: ProjectFileHandle, serializedProject: string): Promise<void> {
    await writeTextFile(handle.path, serializedProject);
  }

  export async function read(handle: ProjectFileHandle): Promise<string> {
    return readTextFile(handle.path);
  }

  export function serialize(project: ScoreProject): string {
    return JSON.stringify(project, null, 2);
  }

  export function parse(text: string): unknown {
    return JSON.parse(text) as unknown;
  }
}

export default ProjectFile;
