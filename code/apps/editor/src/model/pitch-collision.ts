/** Compatibility aliases only; production consumers use the domain namespace APIs. */
export type { VoicePitchSpan } from '../domain/score/voice-collision.ts';
import VoiceCollision from '../domain/score/voice-collision.ts';
export const hasCrossVoicePitchCollision = VoiceCollision.exists;
