
import ScoreSlur from "../../domain/score/score-slur.ts";

import ScoreClef from "../../domain/score/score-clef.ts";

import ScoreTempo from "../../domain/score/score-tempo.ts";

import ScoreTrill from "../../domain/score/score-trill.ts";
import ScoreFermata from '../../domain/score/score-fermata.ts';
import ScoreDynamics from '../../domain/score/score-dynamics.ts';
import type { ScoreProject } from "../../domain/score/types.ts";

export type NormalizedRange = { oldNoteId: string; newNoteId: string };
/** Single commit boundary shared by every project-changing editor action. */
namespace EditTransaction {
  export function commit(before: ScoreProject, after: ScoreProject, normalized?: NormalizedRange): ScoreProject {
    if (before === after) return before;
    const next = ScoreFermata.reconcileCaptured(ScoreFermata.capture(before), after);
    if (ScoreFermata.hasConflicts(next)) return before;
    return ScoreDynamics.reconcile(ScoreSlur.reconcile(ScoreClef.reconcile(ScoreTempo.reconcile(ScoreTrill.reconcile(before, next, normalized)))));
  }
}
export default EditTransaction;
