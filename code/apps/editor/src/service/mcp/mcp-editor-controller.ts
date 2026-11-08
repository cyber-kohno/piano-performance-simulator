import NoteEditor from '../../action/editor/note-editor.ts';
import ScoreTimeline from '../../domain/score/score-timeline.ts';
import type { PianoFingering, PianoStaffName, ScoreProject } from '../../domain/score/types.ts';
import type { TimelineCursor } from '../../state/timeline-cursor.ts';
import type { McpBridgeRequest, McpBridgeResponse, McpCheckoutState } from './mcp-session-controller.ts';

export type McpEditContext = { project: ScoreProject; timelineCursor: TimelineCursor };
export type McpEditorPort = {
  getEditorState(): unknown;
  getEditContext(): McpEditContext;
  updateProject(previous: ScoreProject, next: ScoreProject): void;
  checkoutChanged(state: McpCheckoutState): void;
};

namespace McpEditorController {
  export function create(port: McpEditorPort) {
    let checkoutOwner: string | null = null;

    function applyEdit(params: Record<string, unknown>) {
      const { operation, noteId, staff, pitchIndex, fingering, substitutionFingering } = params;
      const substitution = substitutionFingering == null ? undefined : substitutionFingering;
      if (operation !== 'set_pitch_fingering' || typeof noteId !== 'string' ||
        (staff !== 'upperStaff' && staff !== 'lowerStaff') || !Number.isInteger(pitchIndex) ||
        typeof pitchIndex !== 'number' || !Number.isInteger(fingering) || typeof fingering !== 'number' ||
        fingering < 1 || fingering > 5 || (substitution !== undefined &&
          (!Number.isInteger(substitution) || typeof substitution !== 'number' || substitution < 1 ||
            substitution > 5 || substitution === fingering))) {
        return { error: { code: 'INVALID_ARGUMENT', message: 'Provide operation set_pitch_fingering, noteId, staff, pitchIndex, fingering (1–5), and optional distinct substitutionFingering (1–5).' } };
      }
      const { project, timelineCursor } = port.getEditContext();
      const located = ScoreTimeline.note(project.outline, noteId, staff as PianoStaffName);
      if (!located || pitchIndex < 0 || pitchIndex >= located.note.pitches.length) {
        return { error: { code: 'TARGET_NOT_FOUND', message: 'The note or pitch index does not exist on the requested staff.' } };
      }
      const cursor: TimelineCursor = { ...timelineCursor, staff: staff as PianoStaffName, voiceIndex: located.voiceIndex,
        focusedNoteId: noteId, focusedPitchIndex: pitchIndex };
      const next = NoteEditor.setPitchFingering(project, cursor, fingering as PianoFingering,
        substitution as PianoFingering | undefined);
      port.updateProject(project, next);
      return { result: { changed: next !== project, noteId, staff, voiceIndex: located.voiceIndex,
        pitchIndex, fingering, substitutionFingering: substitution ?? null } };
    }

    return {
      handle(request: McpBridgeRequest): McpBridgeResponse {
        const params = request.params as Record<string, unknown>;
        if (request.method === 'ping') return { id: request.id, result: { application: 'ClavierDesk', status: 'ok' } };
        if (!['beginCheckout', 'finishCheckout', 'getEditorState', 'applyEdit'].includes(request.method)) {
          return { id: request.id, error: { code: 'UNKNOWN_METHOD', message: 'This MCP method is not supported.' } };
        }
        const owner = typeof params?.ownerId === 'string' ? params.ownerId : '';
        if (!owner) return { id: request.id, error: { code: 'INVALID_OWNER', message: 'A checkout owner is required.' } };
        if (request.method === 'beginCheckout') {
          if (checkoutOwner && checkoutOwner !== owner) return { id: request.id, error: { code: 'CHECKOUT_BUSY', message: 'Another MCP client owns the checkout.' } };
          checkoutOwner = owner;
          port.checkoutChanged({ active: true, completed: false });
          return { id: request.id, result: { status: 'checked_out' } };
        }
        if (checkoutOwner !== owner) return { id: request.id, error: { code: 'CHECKOUT_REQUIRED', message: 'This MCP client does not own the checkout.' } };
        if (request.method === 'getEditorState') return { id: request.id, result: port.getEditorState() };
        if (request.method === 'applyEdit') {
          const result = applyEdit(params);
          return result.error ? { id: request.id, error: result.error } : { id: request.id, result: result.result };
        }
        port.checkoutChanged({ active: false, completed: true });
        return { id: request.id, result: { status: 'completed' } };
      },
      releaseCheckout() { checkoutOwner = null; },
    };
  }
}

export default McpEditorController;
