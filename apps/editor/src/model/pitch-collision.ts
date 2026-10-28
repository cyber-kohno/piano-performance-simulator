import {
  getFlattenedVoiceElements,
  type OutlineBlock, type PianoPitch, type PianoStaffName,
} from './project.ts';
import { addTime, compareTime } from './rational.ts';

/** Derived edit proposal. Voice identity is scoped to a staff, not to a measure. */
export type VoicePitchSpan = {
  staff: PianoStaffName;
  voiceId: string;
  startSixteenths: number;
  lengthSixteenths: number;
  pitches: readonly PianoPitch[];
};

/** Compare proposed notes with every other voice, including other voices on the same staff. */
export function hasCrossVoicePitchCollision(
  outline: readonly OutlineBlock[], spans: readonly VoicePitchSpan[],
): boolean {
  const proposals = spans.map((span) => ({ ...span, midis: new Set(span.pitches.map(({ midi }) => midi)) }));
  let measureStart = 0;
  for (const block of outline) {
    if (block.type !== 'measure') continue;
    for (const staff of ['upperStaff', 'lowerStaff'] as const) {
      for (const voice of block.data[staff].voices) {
        const otherVoices = proposals.filter((span) => span.staff !== staff || span.voiceId !== voice.id);
        if (!otherVoices.length) continue;
        for (const entry of getFlattenedVoiceElements(voice, block.data.length)) {
          if (entry.element.kind !== 'note') continue;
          const start = addTime(measureStart, entry.positionSixteenths);
          const end = addTime(start, entry.lengthSixteenths);
          for (const span of otherVoices) {
            // Half-open intervals: release and attack at the same instant may touch.
            if (compareTime(start, addTime(span.startSixteenths, span.lengthSixteenths)) < 0 &&
              compareTime(end, span.startSixteenths) > 0 &&
              entry.element.pitches.some(({ midi }) => span.midis.has(midi))) return true;
          }
        }
      }
    }
    measureStart += block.data.length.cnt / block.data.length.unit * 16;
  }
  return false;
}
