import type { PedalEvent, ScoreProject } from "../../domain/score/types.ts";
import ScorePedal from '../../domain/score/score-pedal.ts';
import EditTransaction from './edit-transaction.ts';

namespace PedalEditor {
  export function add(project:ScoreProject,position:number,action:PedalEvent['action']) {
    return EditTransaction.commit(project,ScorePedal.add(project,position,action));
  }
  export function remove(project:ScoreProject,position:number) {
    return EditTransaction.commit(project,ScorePedal.remove(project,position));
  }
}
export default PedalEditor;
