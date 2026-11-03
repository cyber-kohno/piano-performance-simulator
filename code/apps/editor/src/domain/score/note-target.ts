import type { ScoreProject,PianoStaffName } from './types.ts';
import ScoreTimeline from './score-timeline.ts';
export type VoiceScope={ staff: PianoStaffName; voiceIndex: number };
export type NoteTarget=VoiceScope&{ noteId: string; pitchIndex: number|null };
/** Derived musical result. Cursor focus and input unit are never part of a score mutation. */
export type NoteTimeResult={ project: ScoreProject; position: number; noteId?: string; pitchIndex?: number; pitch?: number };
namespace NoteTargets {
  export function resolve(project: ScoreProject,target: NoteTarget) {
    const note=ScoreTimeline.note(project.outline,target.noteId,target.staff);
    return note?.voiceIndex===target.voiceIndex? note:undefined;
  }
}
export default NoteTargets;
