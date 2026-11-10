import ProjectFile, { type ProjectFileHandle } from '../../infra/tauri/project-file.ts';
import ScoreProjectValidator from '../../domain/score/score-project-validator.ts';
import ScoreFermata from '../../domain/score/score-fermata.ts';
import ScoreDynamics from '../../domain/score/score-dynamics.ts';
import type { ScoreProject } from '../../domain/score/types.ts';

export type FileOperationResult<T> =
  | { type: 'success'; value: T }
  | { type: 'cancelled' }
  | { type: 'error'; reason: 'read' | 'write' | 'parse' | 'invalid-project'; error?: unknown };

namespace ScoreProjectFileController {
  export type Handle = ProjectFileHandle;

  export function fingerprint(project: ScoreProject): string {
    return ScoreProjectValidator.fingerprint(project);
  }

  export async function saveAs(project: ScoreProject): Promise<FileOperationResult<{ handle: Handle; fingerprint: string }>> {
    const serialized = ProjectFile.serialize(project);
    const savedFingerprint = fingerprint(project);
    let handle: Handle | null;
    try {
      handle = await ProjectFile.saveAsPath();
    } catch (error) {
      return { type: 'error', reason: 'write', error };
    }
    if (!handle) return { type: 'cancelled' };
    return write(serialized, savedFingerprint, handle);
  }

  export async function save(project: ScoreProject, handle: Handle): Promise<FileOperationResult<{ handle: Handle; fingerprint: string }>> {
    return write(ProjectFile.serialize(project), fingerprint(project), handle);
  }

  async function write(serialized: string, savedFingerprint: string, handle: Handle): Promise<FileOperationResult<{ handle: Handle; fingerprint: string }>> {
    try {
      await ProjectFile.write(handle, serialized);
      return { type: 'success', value: { handle, fingerprint: savedFingerprint } };
    } catch (error) {
      return { type: 'error', reason: 'write', error };
    }
  }

  export async function load(): Promise<FileOperationResult<{ handle: Handle; project: ScoreProject }>> {
    let handle: Handle | null;
    try {
      handle = await ProjectFile.openPath();
    } catch (error) {
      return { type: 'error', reason: 'read', error };
    }
    if (!handle) return { type: 'cancelled' };

    let text: string;
    try {
      text = await ProjectFile.read(handle);
    } catch (error) {
      return { type: 'error', reason: 'read', error };
    }
    let parsed: unknown;
    try {
      parsed = ProjectFile.parse(text);
    } catch (error) {
      return { type: 'error', reason: 'parse', error };
    }
    if (!ScoreProjectValidator.isValid(parsed) || ScoreFermata.hasConflicts(parsed) || !ScoreDynamics.isValid(parsed)) return { type: 'error', reason: 'invalid-project' };
    return { type: 'success', value: { handle, project: parsed } };
  }
}

export default ScoreProjectFileController;
