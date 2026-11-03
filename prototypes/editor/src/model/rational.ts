/** Compatibility entry point. New production code uses domain APIs directly. */
export type { Rational } from '../domain/theory/musical-time.ts';
import MusicalTime from '../domain/theory/musical-time.ts';
export const gcd = MusicalTime.gcd;
export const rational = MusicalTime.create;
export const fromNumber = MusicalTime.fromNumber;
export const add = MusicalTime.add;
export const subtract = MusicalTime.subtract;
export const multiply = MusicalTime.multiply;
export const compare = MusicalTime.compare;
export const toNumber = MusicalTime.toNumber;
export const addTime = MusicalTime.addNumbers;
export const compareTime = MusicalTime.compareNumbers;
export const lcm = MusicalTime.lcm;
