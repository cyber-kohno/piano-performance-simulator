import MusicalTime from '../theory/musical-time.ts';
import ScoreVoice from './score-voice.ts';
import type { MeasureLength, NoteValue, PianoNote, PianoVoiceElement, ScoreProject } from './types.ts';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const isIntegerIn = (value: unknown, min: number, max: number): value is number =>
  Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
const noteTypes = ['whole', 'half', 'quarter', 'eighth', '16th', '32nd'] as const;

function isNoteValue(value: unknown): value is NoteValue {
  return isRecord(value) && noteTypes.includes(value.type as typeof noteTypes[number]) &&
    isIntegerIn(value.dots, 0, 2);
}

function isNote(value: unknown): value is PianoNote {
  if (!isRecord(value) || value.kind !== 'note' || !isId(value.id) || !isNoteValue(value.value) ||
    !Array.isArray(value.pitches) || value.pitches.length === 0 || !value.pitches.every(pitch =>
      isRecord(pitch) && isIntegerIn(pitch.midi, 0, 127) &&
      (pitch.spellingDirection === undefined || pitch.spellingDirection === 'up' || pitch.spellingDirection === 'down') &&
      (pitch.fingering === undefined || isIntegerIn(pitch.fingering, 1, 5)) &&
      (pitch.substitutionFingering === undefined ||
        isIntegerIn(pitch.substitutionFingering, 1, 5) && pitch.fingering !== undefined))) return false;
  if (value.tieFrom !== undefined && !isId(value.tieFrom) || value.tieTo !== undefined && !isId(value.tieTo)) return false;
  if (value.staccato !== undefined && (!isRecord(value.staccato) ||
    !['normal', 'staccatissimo'].includes(String(value.staccato.type)) ||
    typeof value.staccato.lengthRatio !== 'number' || value.staccato.lengthRatio < 0.1 || value.staccato.lengthRatio > 0.9)) return false;
  if (value.arpeggio !== undefined && (!isRecord(value.arpeggio) ||
    !['normal', 'down'].includes(String(value.arpeggio.type)) ||
    typeof value.arpeggio.spreadRatio !== 'number' || value.arpeggio.spreadRatio < 0.1 || value.arpeggio.spreadRatio > 1 ||
    typeof value.arpeggio.timing !== 'number' || value.arpeggio.timing < 0 || value.arpeggio.timing > 1)) return false;
  if (value.gracePerformance !== undefined && (!isRecord(value.gracePerformance) ||
    !Array.isArray(value.beforeGraceNotes) || value.beforeGraceNotes.length === 0 ||
    typeof value.gracePerformance.spreadRatio !== 'number' || value.gracePerformance.spreadRatio < 0.1 ||
    value.gracePerformance.spreadRatio > 1 || Math.abs(value.gracePerformance.spreadRatio * 10 - Math.round(value.gracePerformance.spreadRatio * 10)) > 1e-8 ||
    typeof value.gracePerformance.timing !== 'number' || value.gracePerformance.timing < 0 || value.gracePerformance.timing > 1 ||
    Math.abs(value.gracePerformance.timing * 10 - Math.round(value.gracePerformance.timing * 10)) > 1e-8)) return false;
  if (value.beforeGraceNotes !== undefined && (!Array.isArray(value.beforeGraceNotes) || !value.beforeGraceNotes.every(grace =>
    isRecord(grace) && isId(grace.id) && isNoteValue(grace.value) && typeof grace.slash === 'boolean' &&
    Array.isArray(grace.pitches) && grace.pitches.length === 1 && grace.pitches.every(pitch =>
      isRecord(pitch) && isIntegerIn(pitch.midi, 0, 127) &&
      (pitch.spellingDirection === undefined || pitch.spellingDirection === 'up' || pitch.spellingDirection === 'down') &&
      (pitch.fingering === undefined || isIntegerIn(pitch.fingering, 1, 5)) &&
      (pitch.substitutionFingering === undefined ||
        isIntegerIn(pitch.substitutionFingering, 1, 5) && pitch.fingering !== undefined))))) return false;
  return true;
}

function isElement(value: unknown): value is PianoVoiceElement {
  if (!isRecord(value) || !isId(value.id)) return false;
  if (value.kind === 'note') return isNote(value);
  if (value.kind === 'rest') return isNoteValue(value.value);
  if (value.kind === 'measure-rest') return true;
  if (value.kind !== 'tuplet' || !isIntegerIn(value.actual, 2, 64) ||
    !isIntegerIn(value.normal, 1, 64) || !noteTypes.includes(value.baseType as typeof noteTypes[number]) ||
    !Array.isArray(value.elements) || value.elements.length !== value.actual) return false;
  return value.elements.every(child => isRecord(child) &&
    (child.kind === 'note' ? isNote(child) : child.kind === 'rest' && isId(child.id) && isNoteValue(child.value)));
}

function isMeasureLength(value: unknown): value is MeasureLength {
  return isRecord(value) && isIntegerIn(value.unit, 1, 64) && isIntegerIn(value.cnt, 1, 256);
}

function validVoiceElements(elements: unknown, length: MeasureLength): elements is PianoVoiceElement[] {
  if (!Array.isArray(elements) || !elements.length || !elements.every(isElement)) return false;
  try {
    const voice = { id: 'validation-voice', elements };
    const entries = ScoreVoice.locate(voice, length);
    const total = entries.reduce((sum, entry) => MusicalTime.add(sum, entry.lengthTime), MusicalTime.create(0));
    return MusicalTime.compare(total, MusicalTime.create(length.cnt * 16, length.unit)) === 0;
  } catch {
    return false;
  }
}

function isStaff(value: unknown, length: MeasureLength): boolean {
  return isRecord(value) && Array.isArray(value.voices) && value.voices.length >= 1 && value.voices.length <= 3 &&
    value.voices.every(voice => isRecord(voice) && isId(voice.id) && validVoiceElements(voice.elements, length));
}

function isMeasure(value: unknown): boolean {
  if (!isRecord(value) || !isId(value.id) || value.type !== 'measure' || !isRecord(value.data) ||
    !isMeasureLength(value.data.length) || !isStaff(value.data.upperStaff, value.data.length) ||
    !isStaff(value.data.lowerStaff, value.data.length)) return false;
  for (const key of ['pedalEvents', 'ottavaEvents'] as const) {
    const events = value.data[key];
    if (events !== undefined && (!Array.isArray(events) || !events.every(event => isRecord(event) && isId(event.id) &&
      isRecord(event.offset) && Number.isSafeInteger(event.offset.numerator) && Number.isSafeInteger(event.offset.denominator) &&
      event.offset.denominator !== 0 && (key === 'pedalEvents'
        ? ['start', 'change', 'stop'].includes(String(event.action))
        : ['start', 'stop'].includes(String(event.action)) && ['upperStaff', 'lowerStaff'].includes(String(event.staff)))))) return false;
  }
  return true;
}

namespace ScoreProjectValidator {
  export function isValid(value: unknown): value is ScoreProject {
    if (!isRecord(value) || !Array.isArray(value.outline) || value.outline.length < 2) return false;
    const [initial, firstSection] = value.outline;
    if (!isRecord(initial) || initial.type !== 'init' || !isId(initial.id) || !isRecord(initial.data) ||
      !isRecord(initial.data.keySignature) || !isIntegerIn(initial.data.keySignature.fifths, -7, 7) ||
      !isRecord(initial.data.timeSignature) || !isIntegerIn(initial.data.timeSignature.cnt, 1, 256) ||
      !isIntegerIn(initial.data.timeSignature.unit, 1, 64) || !isIntegerIn(initial.data.tempo, 10, 400) ||
      !isRecord(firstSection) || firstSection.type !== 'section' || !isId(firstSection.id) ||
      !isRecord(firstSection.data) || typeof firstSection.data.name !== 'string') return false;
    if (!value.outline.every((block, index) => {
      if (index === 0) return block === initial;
      if (index === 1) return block === firstSection;
      if (!isRecord(block) || !isId(block.id)) return false;
      if (block.type === 'section') return isRecord(block.data) && typeof block.data.name === 'string';
      if (block.type === 'measure') return isMeasure(block);
      if (block.type === 'key-change') return isRecord(block.data) && isRecord(block.data.keySignature) &&
        isIntegerIn(block.data.keySignature.fifths, -7, 7);
      return false;
    })) return false;
    if (value.slurs !== undefined && (!Array.isArray(value.slurs) || !value.slurs.every(item =>
      isRecord(item) && isId(item.id) && isId(item.startNoteId) && isId(item.endNoteId)))) return false;
    if (value.tempoChanges !== undefined && (!Array.isArray(value.tempoChanges) || !value.tempoChanges.every(item =>
      isRecord(item) && isId(item.noteId) && isIntegerIn(item.bpm, 10, 400)))) return false;
    if (value.clefChanges !== undefined && (!Array.isArray(value.clefChanges) || !value.clefChanges.every(item =>
      isRecord(item) && isId(item.noteId) && ['treble', 'bass'].includes(String(item.clef))))) return false;
    if (value.trills !== undefined && (!Array.isArray(value.trills) || !value.trills.every(item =>
      isRecord(item) && isId(item.id) && item.kind === 'trill' && isId(item.startNoteId) && isId(item.endNoteId) &&
      isRecord(item.settings) && ['diatonic', 'half', 'whole'].includes(String(item.settings.auxiliary)) &&
      ['main', 'auxiliary'].includes(String(item.settings.start)) && isIntegerIn(item.settings.attackCount, 1, 64)))) return false;
    return true;
  }

  export function fingerprint(project: ScoreProject): string {
    return JSON.stringify(project);
  }
}

export default ScoreProjectValidator;
