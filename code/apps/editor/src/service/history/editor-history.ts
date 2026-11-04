import type { ScoreProject } from '../../domain/score/types.ts';
import type { OutlineCursor } from '../../state/outline-cursor.ts';
import type { TimelineCursor } from '../../state/timeline-cursor.ts';
import type { PedalCursor } from '../../state/pedal.ts';
import type { OttavaCursor } from '../../state/ottava.ts';

export type EditorHistorySnapshot = {
  project: ScoreProject;
  outlineCursor: OutlineCursor;
  timelineCursor: TimelineCursor;
  mode: 'outline' | 'timeline';
  pedalMode: boolean;
  pedalCursor: PedalCursor;
  ottavaMode: boolean;
  ottavaCursor: OttavaCursor;
};

export type EditorHistoryValue = {
  reset(snapshot: EditorHistorySnapshot): void;
  record(snapshot: EditorHistorySnapshot): void;
  undo(): EditorHistorySnapshot | undefined;
  redo(): EditorHistorySnapshot | undefined;
};

namespace EditorHistory {
  export const maxSnapshots = 100;

  export function create(initial: EditorHistorySnapshot, limit = maxSnapshots): EditorHistoryValue {
    const snapshots = [initial];
    let currentIndex = 0;
    const maxLength = Math.max(2, Math.floor(limit));

    return {
      reset(snapshot) {
        snapshots.splice(0, snapshots.length, snapshot);
        currentIndex = 0;
      },
      record(snapshot) {
        if (snapshots[currentIndex]?.project === snapshot.project) return;
        snapshots.splice(currentIndex + 1);
        snapshots.push(snapshot);
        if (snapshots.length > maxLength) snapshots.shift();
        currentIndex = snapshots.length - 1;
      },
      undo() {
        if (currentIndex <= 0) return undefined;
        currentIndex -= 1;
        return snapshots[currentIndex];
      },
      redo() {
        if (currentIndex >= snapshots.length - 1) return undefined;
        currentIndex += 1;
        return snapshots[currentIndex];
      },
    };
  }
}

export default EditorHistory;
