import type { ScoreProject } from './types.ts';
namespace ScoreProjectFactory {
  export function create(): ScoreProject {
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

}
export default ScoreProjectFactory;
