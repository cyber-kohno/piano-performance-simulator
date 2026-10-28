/** Exact derived musical time. Numbers are used only at existing UI boundaries. */
export type Rational = { numerator: number; denominator: number };
export function gcd(a: number, b: number): number {
  a = Math.abs(a); b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}
export function rational(numerator: number, denominator = 1): Rational {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator === 0) throw new RangeError('Invalid musical fraction');
  const divisor = gcd(numerator, denominator) * Math.sign(denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}
/** Recover the small exact fraction at the legacy number/UI boundary, never accumulate decimals. */
export function fromNumber(value: number): Rational {
  if (!Number.isFinite(value)) throw new RangeError('Invalid musical time');
  const sign = Math.sign(value);
  let x = Math.abs(value), n0 = 0, n1 = 1, d0 = 1, d1 = 0;
  for (let count = 0; count < 32; count++) {
    const whole = Math.floor(x);
    const n = whole * n1 + n0, d = whole * d1 + d0;
    if (d > 1_000_000 || !Number.isSafeInteger(n)) break;
    [n0, n1, d0, d1] = [n1, n, d1, d];
    if (Math.abs(n / d - Math.abs(value)) < 1e-12) return rational(sign * n, d);
    x = 1 / (x - whole);
  }
  throw new RangeError('Musical time cannot be represented exactly');
}
export const add = (a: Rational, b: Rational) => rational(a.numerator * b.denominator + b.numerator * a.denominator, a.denominator * b.denominator);
export const subtract = (a: Rational, b: Rational) => add(a, rational(-b.numerator, b.denominator));
export const multiply = (a: Rational, b: Rational) => rational(a.numerator * b.numerator, a.denominator * b.denominator);
export const compare = (a: Rational, b: Rational) => Math.sign(a.numerator * b.denominator - b.numerator * a.denominator);
export const toNumber = (a: Rational) => a.numerator / a.denominator;
export const addTime = (a: number, b: number) => toNumber(add(fromNumber(a), fromNumber(b)));
export const compareTime = (a: number, b: number) => compare(fromNumber(a), fromNumber(b));
export const lcm = (a: number, b: number) => a / gcd(a, b) * b;
