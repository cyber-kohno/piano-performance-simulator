import type { OttavaEvent, PianoStaffName, ScoreProject } from '../../domain/score/types.ts';
import ScoreOttava from '../../domain/score/score-ottava.ts';
import EditTransaction from './edit-transaction.ts';

namespace OttavaEditor {
  export function add(project: ScoreProject, position: number, staff: PianoStaffName, action: OttavaEvent['action']) {
    return EditTransaction.commit(project, ScoreOttava.add(project, position, staff, action));
  }
  export function remove(project: ScoreProject, position: number, staff: PianoStaffName) {
    return EditTransaction.commit(project, ScoreOttava.remove(project, position, staff));
  }
}
export default OttavaEditor;
