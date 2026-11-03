import type { ScoreProject, PianoStaffName } from './types.ts';
import RestSpelling from './rest-spelling.ts';
namespace ScoreStaff {
  export function addVoice(project: ScoreProject, measureId: string, staff: PianoStaffName, voiceIndex: number): ScoreProject {
    const measure = project.outline.find(block => block.type === 'measure' && block.id === measureId);
    if (!measure || measure.type !== 'measure') return project;
    const nextIndex = voiceIndex + 1;
    if (nextIndex >= 3 || measure.data[staff].voices.length !== nextIndex) return project;
    return {
      ...project, outline: project.outline.map((block) => block !== measure ? block : {
        ...block, data: {
          ...block.data, [staff]: {
            ...block.data[staff], voices: [...block.data[staff].voices, {
              id: `voice-${nextIndex}`, elements: [{ id: RestSpelling.createId(), kind: 'measure-rest' }],
            }],
          }
        },
      }) as ScoreProject['outline']
    };
  }


}
export default ScoreStaff;
