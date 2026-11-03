import ScoreTimeline from '../score/score-timeline.ts';
import ScoreClock from './score-clock.ts';
import StaccatoPerformance from './staccato-performance.ts';
import TrillPerformance from './trill-performance.ts';
import ArpeggioPerformance from './arpeggio-performance.ts';
import ScoreTrill from '../score/score-trill.ts';
import ScoreArpeggio from '../score/score-arpeggio.ts';
import ScoreKey from '../score/score-key.ts';
import TrillPitch from '../theory/trill-pitch.ts';
import ScorePedal from '../score/score-pedal.ts';
import ScoreSlur from '../score/score-slur.ts';
import ArticulationPerformance from './articulation-performance.ts';
import type { ScoreProject, PianoStaffName } from '../score/types.ts';

export type PlaybackEvent = {
  startSeconds: number;
  durationSeconds: number;
  pitches: number[];
  /** Per-pitch lengths are used when a chord's pitches articulate differently. */
  pitchDurationsSeconds?: number[];
  sourceNoteId: string;
};
export type PlaybackPedalEvent = { atSeconds: number; action: 'start' | 'change' | 'stop' };
export type PlaybackPlan = {
  startPosition: number;
  endPosition: number;
  durationSeconds: number;
  pedalInitiallyDown: boolean;
  pedalEvents: PlaybackPedalEvent[];
  events: PlaybackEvent[];
};

namespace ScorePlaybackPlan {
  /** Creates a playback snapshot. Performance expressions affect sounding events, never written score timing. */
  export function create(project: ScoreProject, requestedStart: number): PlaybackPlan {
    const endPosition = ScoreTimeline.length(project.outline);
    const startPosition = Math.max(0, Math.min(endPosition, requestedStart));
    const startSeconds = ScoreClock.secondsAt(project, startPosition);
    const pedalScoreEvents = ScorePedal.events(project);
    const precedingPedalEvent = pedalScoreEvents.filter(event => event.position < startPosition).at(-1);
    const pedalInitiallyDown = precedingPedalEvent !== undefined && precedingPedalEvent.action !== 'stop';
    const pedalEvents = pedalScoreEvents.filter(event => event.position >= startPosition && event.position <= endPosition)
      .map(event => ({ atSeconds: ScoreClock.secondsAt(project, event.position) - startSeconds, action: event.action }));
    const events: PlaybackEvent[] = [];
    const slurRanges = ScoreSlur.ranges(project);
    const noteGroups: {
      staff: PianoStaffName; voiceIndex: number; ids: Set<string>; startPosition: number; endPosition: number;
      startSeconds: number; endSeconds: number; hasStaccato: boolean; events: PlaybackEvent[];
    }[] = [];
    const staffNames: PianoStaffName[] = ['upperStaff', 'lowerStaff'];

    for (const staff of staffNames) {
      const voiceCount = Math.max(0, ...project.outline.map(block =>
        block.type === 'measure' ? block.data[staff].voices.length : 0));
      for (let voiceIndex = 0; voiceIndex < voiceCount; voiceIndex++) {
        const notes = ScoreTimeline.notes(project.outline, staff, voiceIndex);
        const byId = new Map(notes.map(entry => [entry.note.id, entry]));
        const visited = new Set<string>();
        for (const entry of notes) {
          if (visited.has(entry.note.id)) continue;
          const chain = ScoreTimeline.tieChain(project.outline, entry.note.id, staff).filter(member => member.voiceIndex === voiceIndex);
          const members = chain.length > 0 ? chain : [entry];
          for (const member of members) visited.add(member.note.id);
          // Only start from the first valid segment. Broken links are handled as independent notes.
          const first = members[0];
          const last = members[members.length - 1];
          if (first.note.tieFrom && byId.has(first.note.tieFrom)) continue;
          const noteStart = first.measureStartSixteenths + first.positionSixteenths;
          const noteEnd = last.measureStartSixteenths + last.positionSixteenths + last.lengthSixteenths;
          if (noteStart >= endPosition || first.note.pitches.length === 0) continue;
          const tailStart = last.measureStartSixteenths + last.positionSixteenths;
          const tailEnd = tailStart + last.lengthSixteenths;
          const performedEndSeconds = StaccatoPerformance.soundingEndSeconds(
            project, Math.min(noteEnd, endPosition), tailStart, last.lengthSixteenths, last.note.staccato,
          );
          const effectiveStart = Math.max(noteStart, startPosition);
          const effectiveStartSeconds = ScoreClock.secondsAt(project, effectiveStart);
          if (performedEndSeconds <= effectiveStartSeconds) continue;
          const noteEvents: PlaybackEvent[] = [];
          const trill = ScoreTrill.forNote(project, first.note.id);
          if (trill && trill.startNoteId === first.note.id && trill.endNoteId === last.note.id &&
            ScoreTrill.canApply(project, first.note.id)) {
            const mainPitch = first.note.pitches[0].midi;
            const auxiliaryPitch = TrillPitch.above(mainPitch,
              ScoreKey.forNote(project.outline, first.note.id), trill.settings.auxiliary).midi;
            const trillStartSeconds = ScoreClock.secondsAt(project, noteStart);
            const trillDurationSeconds = performedEndSeconds - trillStartSeconds;
            const elapsedSeconds = Math.max(0, effectiveStartSeconds - trillStartSeconds);
            const attacks = TrillPerformance.attacks(mainPitch, auxiliaryPitch, trill.settings, trillDurationSeconds);
            attacks.forEach((attack, index) => {
              const attackEnd = attack.offset + attack.duration;
              if (attackEnd <= elapsedSeconds) return;
              const onset = Math.max(attack.offset, elapsedSeconds);
              noteEvents.push({ startSeconds: trillStartSeconds - startSeconds + onset,
                durationSeconds: attackEnd - onset, pitches: [attack.midi],
                sourceNoteId: `${first.note.id}-trill-${index}` });
            });
          } else if (first.note.arpeggio && ScoreArpeggio.canApply(first.note)) {
            const sixteenthSeconds = ScoreClock.secondsAt(project, noteStart + 1) - ScoreClock.secondsAt(project, noteStart);
            const attacks = ArpeggioPerformance.attacks(first.note.pitches, first.note.arpeggio, sixteenthSeconds);
            const noteStartSeconds = ScoreClock.secondsAt(project, noteStart);
            const earliestAttackSeconds = noteStartSeconds + Math.min(...attacks.map(attack => attack.offset));
            // A transport cannot sound notes before its start. Preserve the roll by shifting
            // this arpeggio forward as a group when playback begins before its pre-roll.
            const preRollShift = startPosition <= noteStart
              ? Math.max(0, startSeconds - earliestAttackSeconds) : 0;
            attacks.forEach((attack, index) => {
              const absoluteAttackSeconds = noteStartSeconds + attack.offset + preRollShift;
              const effectiveAttackSeconds = Math.max(absoluteAttackSeconds, startSeconds);
              if (effectiveAttackSeconds >= performedEndSeconds) return;
              noteEvents.push({ startSeconds: effectiveAttackSeconds - startSeconds,
                durationSeconds: performedEndSeconds - effectiveAttackSeconds, pitches: [attack.midi],
                sourceNoteId: `${first.note.id}-arpeggio-${index}` });
            });
          } else {
            const eventStart = effectiveStartSeconds - startSeconds;
            const eventEnd = performedEndSeconds - startSeconds;
            noteEvents.push({ startSeconds: eventStart, durationSeconds: eventEnd - eventStart,
              pitches: first.note.pitches.map(pitch => pitch.midi), sourceNoteId: first.note.id });
          }
          if (noteEvents.length === 0) continue;
          events.push(...noteEvents);
          noteGroups.push({ staff, voiceIndex, ids: new Set(members.map(member => member.note.id)),
            startPosition: noteStart, endPosition: noteEnd, startSeconds: ScoreClock.secondsAt(project, noteStart),
            endSeconds: performedEndSeconds, hasStaccato: last.note.staccato !== undefined, events: noteEvents });
        }
      }
    }

    // Articulation changes the sounding end of a note only at a continuous transition;
    // written positions, rests and later note onsets remain untouched.
    const samePosition = (a: number, b: number) => Math.abs(a - b) < 1e-8;
    for (const group of noteGroups) {
      const next = noteGroups.find(candidate => candidate.staff === group.staff && candidate.voiceIndex === group.voiceIndex &&
        samePosition(candidate.startPosition, group.endPosition));
      if (!next || group.hasStaccato) continue;
      const slurred = slurRanges.some(range => range.first.staff === group.staff && range.first.voiceIndex === group.voiceIndex &&
        [...group.ids].some(id => range.members.some(member => member.note.id === id)) &&
        [...next.ids].some(id => range.members.some(member => member.note.id === id)));
      const nextOnsetSeconds = Math.min(...next.events.map(event => event.startSeconds)) + startSeconds;
      const interval = next.startSeconds - group.startSeconds;
      if (interval <= 0) continue;
      const nextPitchOnsets = new Map<number, number>();
      for (const event of next.events) for (const pitch of event.pitches) {
        const onset = event.startSeconds + startSeconds;
        nextPitchOnsets.set(pitch, Math.min(nextPitchOnsets.get(pitch) ?? Infinity, onset));
      }
      const groupTailSeconds = group.endSeconds - startSeconds;
      for (const event of group.events) {
        const eventEnd = event.startSeconds + event.durationSeconds;
        // For multi-attack ornaments, only the final attack reaches the note boundary.
        if (eventEnd < groupTailSeconds - 1e-7) continue;
        const ends = event.pitches.map(pitch => {
          const samePitchOnset = nextPitchOnsets.get(pitch);
          const target = ArticulationPerformance.transitionEndSeconds(
            slurred && samePitchOnset !== undefined ? samePitchOnset : nextOnsetSeconds,
            interval, slurred, samePitchOnset !== undefined,
          );
          const currentEnd = event.startSeconds + event.durationSeconds + startSeconds;
          return Math.max(0.001, (slurred ? Math.max(currentEnd, target) : Math.min(currentEnd, target)) -
            (event.startSeconds + startSeconds));
        });
        if (ends.length > 0) {
          event.pitchDurationsSeconds = ends;
          event.durationSeconds = Math.max(...ends);
        }
      }
    }

    events.sort((a, b) => a.startSeconds - b.startSeconds || a.sourceNoteId.localeCompare(b.sourceNoteId));
    return { startPosition, endPosition, durationSeconds: Math.max(0, ScoreClock.secondsAt(project, endPosition) - startSeconds),
      pedalInitiallyDown, pedalEvents, events };
  }
}
export default ScorePlaybackPlan;
