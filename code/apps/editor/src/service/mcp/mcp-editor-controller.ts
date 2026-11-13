import NoteEditor from '../../action/editor/note-editor.ts';
import ScoreAuthoring, { type AuthoringState } from '../../action/editor/score-authoring.ts';
import { AuthoringError } from '../../domain/score/score-authoring-input.ts';
import ScoreEditing from '../../action/editor/score-editing.ts';
import Integrity from '../../domain/score/score-integrity.ts';
import Reader from './mcp-score-reader.ts';
import ScoreTimeline from '../../domain/score/score-timeline.ts';
import ScoreTrill from '../../domain/score/score-trill.ts';
import type { PianoFingering, PianoStaffName, ScoreProject } from '../../domain/score/types.ts';
import type { TimelineCursor } from '../../state/timeline-cursor.ts';
import type { McpBridgeRequest, McpBridgeResponse, McpCheckoutState } from './mcp-session-controller.ts';

export type McpEditContext = { project: ScoreProject; timelineCursor: TimelineCursor };
export type McpEditorPort = {
  getEditorState(project: ScoreProject): unknown;
  checkoutBlocker(): string | null;
  getEditContext(): McpEditContext;
  updateProject(previous: ScoreProject, next: ScoreProject, focusFirstMeasure?: boolean): void;
  checkoutChanged(state: McpCheckoutState): void;
};

namespace McpEditorController {
  export function create(port: McpEditorPort) {
    let checkout: { id: string; owner: string; baseline: ScoreProject; project: ScoreProject; timelineCursor: TimelineCursor;
      authoring: AuthoringState; revision: string; baselineFingerprint: string;
      requests: Map<string, { content: string; result: unknown }> } | null = null;
    let liveFingerprint = '', liveRevision = '';
    const live = () => {
      const project = port.getEditContext().project;
      const fingerprint = JSON.stringify(project);
      if (fingerprint !== liveFingerprint) { liveFingerprint = fingerprint; liveRevision = crypto.randomUUID(); }
      return { project, fingerprint, revision: liveRevision };
    };

    function applyBatch(params: Record<string, unknown>) {
      const current = checkout!;
      if (typeof params.requestId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(params.requestId))
        return { error: { code: 'INVALID_ARGUMENT', message: 'Provide requestId (1–128 ASCII letters, digits, _, ., :, -).' } };
      if (Object.keys(params).some(key => !['ownerId', 'sessionId', 'checkoutId', 'requestId', 'operations', 'expectedRevision'].includes(key)))
        return { error: { code: 'INVALID_ARGUMENT', message: 'Unsupported batch field.' } };
      if (typeof params.expectedRevision !== 'string') return { error: { code: 'REVISION_REQUIRED', message: 'Read the score and provide its revision as expectedRevision.' } };
      // Canonical object keys make semantically identical JSON retries equivalent.
      const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
        : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)])) : value;
      const operationsContent = JSON.stringify(canonical(params.operations));
      const content = JSON.stringify({ expectedRevision: params.expectedRevision, operations: operationsContent });
      if (!operationsContent || new TextEncoder().encode(operationsContent).length > 48 * 1024)
        return { error: { code: 'REQUEST_LIMIT', message: 'Operations must fit within 48 KiB of UTF-8 JSON.' } };
      const previous = current.requests.get(params.requestId);
      if (previous) return previous.content === content ? { result: previous.result }
        : { error: { code: 'REQUEST_ID_CONFLICT', message: 'This requestId was already used with different operations.' } };
      if (params.expectedRevision !== current.revision) return { error: { code: 'STALE_REVISION', message: 'The score changed after your read. Read the current range before editing.' } };
      if (current.requests.size >= 64) return { error: { code: 'REQUEST_LIMIT', message: 'At most 64 successful construction requests per checkout.' } };
      try {
        const next = ScoreEditing.apply(current.project, current.authoring, params.operations);
        const changed = JSON.stringify(next.project) !== JSON.stringify(current.project);
        const stateChanged = JSON.stringify(next.state) !== JSON.stringify(current.authoring);
        const revision = changed || stateChanged ? crypto.randomUUID() : current.revision;
        const result = Reader.bounded({ changed, revision, requestId: params.requestId, ...next.summary });
        if (changed) current.project = next.project;
        current.revision = revision;
        current.authoring = next.state;
        current.requests.set(params.requestId, { content, result });
        return { result };
      } catch (error) {
        if (error instanceof AuthoringError) return { error: { code: error.code, message: error.message } };
        throw error;
      }
    }

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
      const { project, timelineCursor } = checkout!;
      const located = ScoreTimeline.note(project.outline, noteId, staff as PianoStaffName);
      if (!located || pitchIndex < 0 || pitchIndex >= located.note.pitches.length) {
        return { error: { code: 'TARGET_NOT_FOUND', message: 'The note or pitch index does not exist on the requested staff.' } };
      }
      const cursor: TimelineCursor = { ...timelineCursor, staff: staff as PianoStaffName, voiceIndex: located.voiceIndex,
        focusedNoteId: noteId, focusedPitchIndex: pitchIndex };
      if (ScoreTrill.forNote(project,noteId)) return { error: { code: 'INVALID_ARGUMENT', message: 'Use set_trill settings.fingerings for trill notes. Substitutions are not allowed.' } };
      const next = NoteEditor.setPitchFingering(project, cursor, fingering as PianoFingering,
        substitution as PianoFingering | undefined);
      checkout!.project = next;
      return { result: { changed: next !== project, noteId, staff, voiceIndex: located.voiceIndex,
        pitchIndex, fingering, substitutionFingering: substitution ?? null } };
    }

    return {
      handle(request: McpBridgeRequest): McpBridgeResponse {
        const params = (request.params ?? {}) as Record<string, unknown>;
        if (request.method === 'ping') return { id: request.id, result: { application: 'ClavierDesk', status: 'ok' } };
        if (!['beginCheckout', 'finishCheckout', 'cancelCheckout', 'getEditorState', 'applyEdit', 'getScoreOverview', 'getScoreRange', 'getCapabilities'].includes(request.method)) {
          return { id: request.id, error: { code: 'UNKNOWN_METHOD', message: 'This MCP method is not supported.' } };
        }
        const owner = typeof params?.ownerId === 'string' ? params.ownerId : '';
        if (!owner) return { id: request.id, error: { code: 'INVALID_OWNER', message: 'A checkout owner is required.' } };
        if (request.method === 'getCapabilities') {
          try { return { id: request.id, result: Reader.bounded(Reader.capabilities(params.operation)) }; }
          catch (error) { if (error instanceof AuthoringError) return { id: request.id, error: { code: error.code, message: error.message } }; throw error; }
        }
        if (request.method === 'getScoreOverview' || request.method === 'getScoreRange') {
          if (params.checkoutId !== undefined && (!checkout || checkout.owner !== owner || params.checkoutId !== checkout.id))
            return { id: request.id, error: { code: 'CHECKOUT_REQUIRED', message: 'The requested checkout is not active or not owned by this client.' } };
          const snapshot = params.checkoutId !== undefined ? checkout! : live();
          try {
            const data = request.method === 'getScoreOverview' ? Reader.overview(snapshot.project) : Reader.range(snapshot.project, params);
            return { id: request.id, result: Reader.bounded({ revision: snapshot.revision, source: params.checkoutId !== undefined ? 'checkout' : 'live', ...data }) };
          } catch (error) {
            if (error instanceof AuthoringError) return { id: request.id, error: { code: error.code, message: error.message } };
            throw error;
          }
        }
        if (request.method === 'beginCheckout') {
          if (checkout && checkout.owner !== owner) return { id: request.id, error: { code: 'CHECKOUT_BUSY', message: 'Another MCP client owns the checkout.' } };
          if (checkout) return { id: request.id, result: { status: 'checked_out', checkoutId: checkout.id, revision: checkout.revision } };
          const blocker = port.checkoutBlocker();
          if (blocker) return { id: request.id, error: { code: 'EDITOR_BUSY', message: blocker } };
          const context = port.getEditContext();
          const snapshot = live();
          checkout = { id: crypto.randomUUID(), owner, baseline: context.project, project: context.project,
            timelineCursor: { ...context.timelineCursor }, authoring: ScoreAuthoring.createState(), revision: snapshot.revision,
            baselineFingerprint: snapshot.fingerprint, requests: new Map() };
          port.checkoutChanged({ active: true, completed: false });
          return { id: request.id, result: { status: 'checked_out', checkoutId: checkout.id, revision: checkout.revision } };
        }
        if (!checkout || checkout.owner !== owner || params.checkoutId !== checkout.id) {
          return { id: request.id, error: { code: 'CHECKOUT_REQUIRED', message: 'An active checkoutId owned by this MCP client is required.' } };
        }
        if (request.method === 'cancelCheckout') {
          checkout = null;
          port.checkoutChanged({ active: false, completed: false });
          return { id: request.id, result: { status: 'cancelled' } };
        }
        if (request.method === 'getEditorState') {
          try { return { id: request.id, result: Reader.bounded({ ...(port.getEditorState(checkout.project) as object), revision: checkout.revision }) }; }
          catch (error) { if (error instanceof AuthoringError) return { id: request.id, error: { code: error.code, message: error.message } }; throw error; }
        }
        if (request.method === 'applyEdit') {
          const previous = checkout.project;
          const result = 'operations' in params || 'requestId' in params ? applyBatch(params) : applyEdit(params);
          if (!('operations' in params || 'requestId' in params) && checkout.project !== previous) checkout.revision = crypto.randomUUID();
          return result.error ? { id: request.id, error: result.error } : { id: request.id, result: result.result };
        }
        if (port.getEditContext().project !== checkout.baseline || JSON.stringify(port.getEditContext().project) !== checkout.baselineFingerprint) {
          return { id: request.id, error: { code: 'PROJECT_CHANGED', message: 'The project changed during checkout. Stop this checkout and start again.' } };
        }
        const changed = checkout.project !== checkout.baseline;
        {
          try { ScoreAuthoring.validate(checkout.project, checkout.authoring, true); }
          catch (error) {
            if (error instanceof AuthoringError) return { id: request.id, error: { code: error.code, message: error.message } };
            throw error;
          }
          try { Integrity.validate(checkout.project); }
          catch (error) { if (error instanceof AuthoringError) return { id: request.id, error: { code: error.code, message: error.message } }; throw error; }
        }
        if (changed) port.updateProject(checkout.baseline, checkout.project, checkout.baseline.outline.every(block => block.type !== 'measure'));
        const revision = live().revision;
        checkout = null;
        port.checkoutChanged({ active: false, completed: true });
        return { id: request.id, result: { status: 'completed', changed, revision } };
      },
      releaseCheckout() {
        checkout = null;
        port.checkoutChanged({ active: false, completed: false });
      },
    };
  }
}

export default McpEditorController;
