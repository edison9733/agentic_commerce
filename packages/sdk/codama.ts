/**
 * Generates a typed Kit client (instruction builders, account decoders, error
 * maps) from the Anchor IDL. Run after every `anchor build`.
 *
 * Codama's JS renderer emits a whole package scaffold, so we render into a
 * temp directory and lift out only `src/generated`.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rootNodeFromAnchor, type AnchorIdl } from '@codama/nodes-from-anchor';
import { renderVisitor } from '@codama/renderers-js';
import { createFromRoot } from 'codama';

const here = dirname(fileURLToPath(import.meta.url));
const idlPath = join(here, '../../target/idl/tessera.json');
const finalOut = join(here, 'src/generated');

const scratch = mkdtempSync(join(tmpdir(), 'codama-'));
try {
  const idl = JSON.parse(readFileSync(idlPath, 'utf8')) as AnchorIdl;
  // renderVisitor writes asynchronously, so the copy below must wait for it.
  await createFromRoot(rootNodeFromAnchor(idl)).accept(renderVisitor(scratch));
  rmSync(finalOut, { recursive: true, force: true });
  cpSync(join(scratch, 'src/generated'), finalOut, { recursive: true });
  console.log(`Generated Kit client -> ${finalOut}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
