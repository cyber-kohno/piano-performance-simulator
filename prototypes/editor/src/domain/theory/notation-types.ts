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
