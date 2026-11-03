import MusicalTime from '../theory/musical-time.ts';
namespace NoteOrder {
  type Span={ start: number; length: number };
  /** Check the entire swept interval so movement cannot skip a stationary note.
   * Callers exclude every moving note from stationary, including tied successors.
   * Half-open intervals allow the destination to touch a neighbor exactly.
   */
  export function crosses(moving: readonly Span[],stationary: readonly Span[],shift: number): boolean {
    return moving.some(note => {
      const start=shift<0? MusicalTime.addNumbers(note.start,shift):note.start;
      const end=MusicalTime.addNumbers(MusicalTime.addNumbers(note.start,note.length),shift>0? shift:0);
      return stationary.some(other => MusicalTime.compareNumbers(start,MusicalTime.addNumbers(other.start,other.length))<0&&MusicalTime.compareNumbers(end,other.start)>0);
    });
  }

}
export default NoteOrder;
