import type { MeasureBlock, ScoreProject } from '../domain/score/types.ts';
import ScoreClock from '../domain/performance/score-clock.ts';
import ScoreFermata from '../domain/score/score-fermata.ts';
import ScoreTempo from '../domain/score/score-tempo.ts';
import ScoreTimeline from '../domain/score/score-timeline.ts';
import KeyTheory from '../domain/theory/key-signature.ts';

export type TimelineHeaderEvent = {
  id: string;
  kind: 'section' | 'key' | 'tempo';
  position: number;
  label: string;
};
export type TimelineHeaderData = {
  boundaries: { id: string; position: number; seconds: number; label: string }[];
  markers: { position: number; events: TimelineHeaderEvent[] }[];
};

namespace TimelineHeader {
  /** Seconds from score start, following the same tempo/fermata clock as playback. */
  export function formatSeconds(seconds: number): string {
    return `${Number(seconds.toFixed(2))}s`;
  }

  /** A view owns its projection. Unchanged immutable measures retain their holds;
   * cursor/scroll updates never enter this calculation. */
  export function create() {
    const holds = new WeakMap<MeasureBlock, ReturnType<typeof ScoreFermata.groups>>();
    let previousKey: string | undefined;
    let previous: TimelineHeaderData;
    return (project: ScoreProject): TimelineHeaderData => {
      const boundaries: { id: string; position: number }[] = [];
      const events: TimelineHeaderEvent[] = [];
      const groups: { startSixteenths: number; endSixteenths: number; lengthRatio: number }[] = [];
      let position = 0, fifths = project.outline[0].data.keySignature.fifths;
      for (const block of project.outline) {
        if (block.type === 'section') events.push({ id: `section:${block.id}`, kind: 'section', position, label: block.data.name });
        if (block.type === 'key-change') {
          events.push({ id: `key:${block.id}`, kind: 'key', position,
            label: `Key: ${KeyTheory.label({ fifths })} → ${KeyTheory.label(block.data.keySignature)}` });
          fifths = block.data.keySignature.fifths;
        }
        if (block.type !== 'measure') continue;
        boundaries.push({ id: `measure:${block.id}`, position });
        let local = ScoreTimeline.isPrepared(project.outline) ? holds.get(block) : undefined;
        if (!local) {
          // Most measures have no holds. Avoid flattening their voice sequences.
          const hasHold = [block.data.upperStaff, block.data.lowerStaff].some(staff => staff.voices.some(voice =>
            voice.elements.some(element => element.kind === 'note' ? !!element.fermata : element.kind === 'tuplet' &&
              element.elements.some(child => child.kind === 'note' && !!child.fermata))));
          local = hasHold ? ScoreFermata.groups({ outline: [project.outline[0], project.outline[1], block] }) : [];
          if (ScoreTimeline.isPrepared(project.outline)) holds.set(block, local);
        }
        groups.push(...local.map(group => ({ startSixteenths: position + group.startSixteenths,
          endSixteenths: position + group.endSixteenths, lengthRatio: group.lengthRatio })));
        position += block.data.length.cnt / block.data.length.unit * 16;
      }
      if (boundaries.length) boundaries.push({ id: 'score-end', position });
      let bpm = project.outline[0].data.tempo;
      for (const change of ScoreTempo.changes(project)) {
        events.push({ id: `tempo:${change.noteId}`, kind: 'tempo', position: change.position,
          label: `Tempo: ${bpm} → ${change.bpm}` });
        bpm = change.bpm;
      }
      events.sort((a, b) => a.position - b.position);
      // Compare small timing/event metadata, never the complete score or pitches.
      const key = JSON.stringify([project.outline[0].data.tempo, project.outline[0].data.timeSignature, boundaries, groups, events]);
      if (key === previousKey) return previous;
      const clock = ScoreClock.withFermatas(ScoreClock.createTempo(project), groups);
      const markers: TimelineHeaderData['markers'] = [];
      for (const event of events) {
        const last = markers.at(-1);
        if (last?.position === event.position) last.events.push(event);
        else markers.push({ position: event.position, events: [event] });
      }
      previousKey = key;
      previous = { boundaries: boundaries.map(boundary => {
        const seconds = clock.secondsAt(boundary.position);
        return { ...boundary, seconds, label: formatSeconds(seconds) };
      }), markers };
      return previous;
    };
  }
}
export default TimelineHeader;
