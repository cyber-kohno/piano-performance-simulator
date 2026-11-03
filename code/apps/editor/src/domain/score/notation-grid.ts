
namespace NotationGrid {
  /** Current editor resolution; not a restriction on future tuplet notation. */
  export function contains(value: number): boolean {
    return Number.isFinite(value) && Number.isInteger(value * 2);
  }

}
export default NotationGrid;
