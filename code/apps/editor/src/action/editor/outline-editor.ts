import type { ScoreProject } from "../../domain/score/types.ts";
import type { OutlineCursor } from '../../state/outline-cursor.ts';
import ScoreOutline from '../../domain/score/score-outline.ts';
import EditTransaction from './edit-transaction.ts';

namespace OutlineEditor {
  function commit(project: ScoreProject, outline: ScoreProject['outline']) {
    return EditTransaction.commit(project, outline === project.outline ? project : { ...project, outline });
  }
  function finish(project: ScoreProject, result: { outline: ScoreProject['outline']; blockId: string }) {
    return { project: commit(project, result.outline), cursor: { blockId: result.blockId } };
  }
  export function addMeasure(project: ScoreProject, cursor: OutlineCursor) {
    return finish(project, ScoreOutline.addMeasure(project.outline, cursor.blockId));
  }
  export function addSection(project: ScoreProject, cursor: OutlineCursor) {
    return commit(project, ScoreOutline.addSection(project.outline, cursor.blockId));
  }
  export function addKeyChange(project: ScoreProject, cursor: OutlineCursor) {
    return finish(project, ScoreOutline.addKeyChange(project.outline, cursor.blockId));
  }
  export function remove(project: ScoreProject, cursor: OutlineCursor) {
    return finish(project, ScoreOutline.remove(project.outline, cursor.blockId));
  }
  export function changeKey(project: ScoreProject, cursor: OutlineCursor, direction: -1 | 1) {
    return commit(project, ScoreOutline.changeKey(project.outline, cursor.blockId, direction));
  }
  export function changeTempo(project: ScoreProject, cursor: OutlineCursor, direction: -1 | 1) {
    return commit(project, ScoreOutline.changeTempo(project.outline, cursor.blockId, direction));
  }
  export function changeMeasureBeats(project: ScoreProject, cursor: OutlineCursor, direction: -1 | 1) {
    return commit(project, ScoreOutline.changeMeasureBeats(project.outline, cursor.blockId, direction));
  }
  export function changeMeter(project: ScoreProject, cursor: OutlineCursor, part: 'numerator' | 'denominator', direction: -1 | 1) {
    return commit(project, ScoreOutline.changeMeter(project.outline, cursor.blockId, part, direction));
  }
}
export default OutlineEditor;
