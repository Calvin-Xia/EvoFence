#!/usr/bin/env node
/**
 * Resolve the configuration contract from the built config-domain exports.
 *
 * This is intentionally a read-only, zero-dependency script. The schema and validator remain
 * the source of truth; this file only turns their public facts into a stable machine view for
 * the documentation guard.
 */

import process from 'node:process';
import {
  CONTRACT_DEFAULTS,
  defaultedFieldPaths,
  documentSchema,
  requiredFieldPaths,
  validateDocument,
} from '../dist/lib/config/index.js';

const DOCUMENT_KINDS = ['contract', 'config', 'holdout', 'experiment'];

function failureCode(kind) {
  const report = validateDocument(kind, null, '<config-doc-guard>');
  return report.rejected_fields[0].code;
}

export function solveConfigContract() {
  const documents = Object.fromEntries(
    DOCUMENT_KINDS.map((kind) => {
      const schema = documentSchema(kind);
      return [kind, {
        required: requiredFieldPaths(schema),
        defaulted: defaultedFieldPaths(schema),
        failure_code: failureCode(kind),
      }];
    }),
  );

  return {
    documents,
    code_defaults: Object.fromEntries(Object.entries(CONTRACT_DEFAULTS)),
  };
}

function main() {
  process.stdout.write(`${JSON.stringify(solveConfigContract(), null, 2)}\n`);
}

main();
