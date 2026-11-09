// Generated schema is consumed by Rust; the TypeScript contract also validates runtime requests.
import { writeFileSync } from 'node:fs';
import Contract from '../editor/src/domain/score/score-edit-contract.ts';
writeFileSync(new URL('./score-operations.schema.json', import.meta.url), JSON.stringify(Contract.operations, null, 2) + '\n');
