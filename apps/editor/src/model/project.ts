export type KeySignature = {
  /** Negative values count flats; positive values count sharps. */
  fifths: -7 | -6 | -5 | -4 | -3 | -2 | -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
};

export type TimeSignature = { unit: number; cnt: number };
export type MeasureLength = { unit: number; cnt: number };

/** Written value is authoritative; elapsed time is always derived. */
export type NoteValue = {
  type: 'whole' | 'half' | 'quarter' | 'eighth' | '16th' | '32nd';
  dots: number;
};

export type PianoPitch = {
  midi: number;
  fingering?: 1 | 2 | 3 | 4 | 5;
};

export type PianoNote = {
  id: string;
  kind: 'note';
  value: NoteValue;
  /** Optional links retained for later explicit tie editing. */
  tieFrom?: string;
  tieTo?: string;
  /** Unique MIDI pitches, descending; all pitches share the written value. */
  pitches: PianoPitch[];
};

export type PianoRest = { id: string; kind: 'rest'; value: NoteValue };
/** Its elapsed time is the actual measure length, regardless of time signature. */
export type PianoMeasureRest = { id: string; kind: 'measure-rest' };
export type PianoVoiceElement = PianoNote | PianoRest | PianoMeasureRest;
export type PianoVoice = { id: string; elements: PianoVoiceElement[] };
export type PianoStaff = { voices: PianoVoice[] };
export type PianoStaffName = 'upperStaff' | 'lowerStaff';

export type InitialValues = {
  keySignature: KeySignature;
  timeSignature: TimeSignature;
  /** Compound meters use a dotted quarter-note beat. */
  tempo: number;
};
export type InitialValuesBlock = { id: string; type: 'init'; data: InitialValues };
export type SectionBlock = { id: string; type: 'section'; data: { name: string } };
export type MeasureBlock = {
  id: string;
  type: 'measure';
  data: { length: MeasureLength; upperStaff: PianoStaff; lowerStaff: PianoStaff };
};
export type OutlineBlock = InitialValuesBlock | SectionBlock | MeasureBlock;
export type ScoreProject = { outline: [InitialValuesBlock, SectionBlock, ...OutlineBlock[]] };

const VALUE_SIXTEENTHS: Record<NoteValue['type'], number> = {
  whole: 16, half: 8, quarter: 4, eighth: 2, '16th': 1, '32nd': 0.5,
};

/** Current editor resolution; not a restriction on future tuplet notation. */
export function isOnEditingGrid(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value * 2);
}

export function getNoteValueSixteenths(value: NoteValue): number {
  return VALUE_SIXTEENTHS[value.type] * (2 - 2 ** -value.dots);
}

export function getNoteValueLabel(value: NoteValue): string {
  return `1/${16 / VALUE_SIXTEENTHS[value.type]}${'.'.repeat(value.dots)}`;
}

export function getElementSixteenths(element: PianoVoiceElement, measureLength: MeasureLength): number {
  return element.kind === 'measure-rest'
    ? measureLength.cnt / measureLength.unit * 16
    : getNoteValueSixteenths(element.value);
}

export function getLocatedVoiceElements(voice: PianoVoice, measureLength: MeasureLength) {
  let position = 0;
  return voice.elements.map((element, index) => {
    const lengthSixteenths = getElementSixteenths(element, measureLength);
    const entry = { element, index, positionSixteenths: position, lengthSixteenths };
    position += lengthSixteenths;
    return entry;
  });
}

export function createRestId(): string {
  return `rest-${crypto.randomUUID()}`;
}

/** Default spelling for a newly exposed rest span; existing rests outside it stay intact. */
export function createRestElements(start: number, length: number): PianoRest[] {
  if (!isOnEditingGrid(start) || !isOnEditingGrid(length) || start < 0 || length < 0) {
    throw new RangeError('Rest spans must use the thirty-second-note editing grid.');
  }
  const values = Object.entries(VALUE_SIXTEENTHS) as [NoteValue['type'], number][];
  const result: PianoRest[] = [];
  let position = start;
  let remaining = length;
  while (remaining > 0) {
    const [type, steps] = values.find(([, steps]) => steps <= remaining && position % steps === 0)!;
    result.push({ id: createRestId(), kind: 'rest', value: { type, dots: 0 } });
    position += steps;
    remaining -= steps;
  }
  return result;
}

export function createMeasureData(length: MeasureLength): MeasureBlock['data'] {
  const createStaff = (): PianoStaff => ({
    voices: [{ id: 'voice-0', elements: [{ id: createRestId(), kind: 'measure-rest' }] }],
  });
  return { length: { ...length }, upperStaff: createStaff(), lowerStaff: createStaff() };
}

/** Derive tie timing from the voice sequence after outline edits. */
export function reconcileOutlineTies(outline: ScoreProject['outline']): ScoreProject['outline'] {
  const entries = new Map<string, { note: PianoNote; scope: string; start: number; end: number }>();
  let position = 0;
  for (const block of outline) {
    if (block.type !== 'measure') continue;
    [block.data.upperStaff, block.data.lowerStaff].forEach((staff, staffIndex) => {
      staff.voices.forEach((voice) => {
        for (const entry of getLocatedVoiceElements(voice, block.data.length)) {
          if (entry.element.kind !== 'note') continue;
          const start = position + entry.positionSixteenths;
          entries.set(entry.element.id, {
            note: entry.element, start, end: start + entry.lengthSixteenths,
            scope: `${staffIndex}:${voice.id}`,
          });
        }
      });
    });
    position += block.data.length.cnt / block.data.length.unit * 16;
  }
  const valid = new Set<string>();
  for (const entry of entries.values()) {
    const next = entry.note.tieTo ? entries.get(entry.note.tieTo) : undefined;
    if (next && next.note.tieFrom === entry.note.id && entry.scope === next.scope &&
      Math.abs(entry.end - next.start) < 1e-8 &&
      entry.note.pitches.length === next.note.pitches.length &&
      entry.note.pitches.every((pitch, index) => pitch.midi === next.note.pitches[index].midi)) valid.add(entry.note.id);
  }
  const cleanStaff = (staff: PianoStaff): PianoStaff => ({
    ...staff,
    voices: staff.voices.map((voice) => ({ ...voice, elements: voice.elements.map((element) => {
      if (element.kind !== 'note') return element;
      const keepFrom = element.tieFrom !== undefined && valid.has(element.tieFrom) &&
        entries.get(element.tieFrom)?.note.tieTo === element.id;
      const keepTo = valid.has(element.id);
      if ((!element.tieFrom || keepFrom) && (!element.tieTo || keepTo)) return element;
      const next = { ...element };
      if (!keepFrom) delete next.tieFrom;
      if (!keepTo) delete next.tieTo;
      return next;
    }) })),
  });
  return outline.map((block) => block.type !== 'measure' ? block : {
    ...block,
    data: { ...block.data, upperStaff: cleanStaff(block.data.upperStaff), lowerStaff: cleanStaff(block.data.lowerStaff) },
  }) as ScoreProject['outline'];
}

export function createProject(): ScoreProject {
  return {
    outline: [
      {
        id: 'initial-values', type: 'init',
        data: { keySignature: { fifths: 0 }, timeSignature: { unit: 4, cnt: 4 }, tempo: 100 },
      },
      { id: 'section-0', type: 'section', data: { name: 'section0' } },
    ],
  };
}
