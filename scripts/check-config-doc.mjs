#!/usr/bin/env node
/**
 * Resolve the configuration contract from the built config-domain exports.
 *
 * This is intentionally a read-only, zero-dependency script. The schema and validator remain
 * the source of truth; this file only turns their public facts into a stable machine view for
 * the documentation guard.
 */

import process from 'node:process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONTRACT_DEFAULTS,
  defaultedFieldPaths,
  documentSchema,
  requiredFieldPaths,
  validateDocument,
} from '../dist/lib/config/index.js';

const DOCUMENT_KINDS = ['contract', 'config', 'holdout', 'experiment'];

const DOCUMENTS = {
  contract: {
    label: 'Contract',
    path: '.evofence/contract.yaml',
    requiredMarker: '- `contract.yaml`:',
  },
  config: {
    label: 'Adapter config',
    path: '.evofence/config.yaml',
    requiredMarker: '- `config.yaml`:',
  },
  holdout: {
    label: 'Private holdout',
    path: '.evofence/private/holdout.yaml',
    requiredMarker: '- `holdout.yaml`:',
  },
  experiment: {
    label: 'Experiment manifest',
    path: 'the file passed to experiment run',
    requiredMarker: '- experiment manifest:',
  },
};

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

export function readConfigDoc() {
  return readFileSync(fileURLToPath(new URL('../docs/config.md', import.meta.url)), 'utf8');
}

function section(source, heading, level = '##') {
  const marker = `${level} ${heading}`;
  const start = source.indexOf(marker);
  if (start < 0) return null;
  const bodyStart = start + marker.length;
  const rest = source.slice(bodyStart);
  const next = rest.search(/\n## /);
  return next < 0 ? rest : rest.slice(0, next);
}

function normalized(source) {
  return source.replace(/\s+/g, ' ').trim();
}

function addFactChecks(errors, source, heading, facts) {
  const body = section(source, heading);
  if (body === null) {
    errors.push(`[${heading}] section is missing`);
    return;
  }
  const text = normalized(body);
  for (const fact of facts) {
    if (!fact.pattern.test(text)) errors.push(`[${heading}] missing documented rule: ${fact.label}`);
  }
}

function requiredBullets(source) {
  const body = section(source, 'Required fields');
  if (body === null) return { bullets: [], missingSection: true };
  const bullets = [];
  let current = null;
  for (const line of body.split(/\r?\n/)) {
    if (/^-\s/.test(line)) {
      if (current !== null) bullets.push(current);
      current = line;
    } else if (current !== null && /^\s+/.test(line)) {
      current += ` ${line.trim()}`;
    }
  }
  if (current !== null) bullets.push(current);
  return { bullets, missingSection: false };
}

function expandRequiredToken(token) {
  const grouped = token.match(/^(.+)\.\{(.+)\}$/);
  if (!grouped) return [token];
  return grouped[2].split(',').map((child) => `${grouped[1]}.${child.trim()}`);
}

function parseRequired(source, errors) {
  const { bullets, missingSection } = requiredBullets(source);
  if (missingSection) {
    errors.push('[Required fields] section is missing');
    return {};
  }
  const parsed = {};
  for (const [kind, document] of Object.entries(DOCUMENTS)) {
    const bullet = bullets.find((candidate) => candidate.startsWith(document.requiredMarker));
    if (!bullet) {
      errors.push(`[Required fields] missing declaration for ${kind}`);
      parsed[kind] = [];
      continue;
    }
    const markerEnd = document.requiredMarker.length;
    parsed[kind] = [...bullet.slice(markerEnd).matchAll(/`([^`]+)`/g)]
      .flatMap((match) => expandRequiredToken(match[1]));
  }
  return parsed;
}

function tableRows(source, heading, level = '##') {
  const body = section(source, heading, level);
  if (body === null) return null;
  return body.split(/\r?\n/)
    .filter((line) => /^\|/.test(line) && !/^\|\s*-/.test(line))
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
}

function stripCode(value) {
  return value.replaceAll('`', '').replace(/\s+/g, ' ').trim();
}

function parseFailureTable(source, errors) {
  const rows = tableRows(source, 'The EvoFence config surface (v2)', '#');
  if (rows === null) {
    errors.push('[The EvoFence config surface (v2)] failure-code table is missing');
    return {};
  }
  const parsed = {};
  for (const row of rows) {
    if (row.length < 3 || row[0] === 'Document') continue;
    const label = stripCode(row[0]);
    const kind = Object.entries(DOCUMENTS).find(([, document]) => document.label === label)?.[0];
    if (!kind) continue;
    const code = row[2].match(/\b[A-Z][A-Z_]+\b/)?.[0] ?? null;
    parsed[kind] = { path: stripCode(row[1]), code };
  }
  for (const kind of DOCUMENT_KINDS) {
    if (!parsed[kind]) errors.push(`[failure-code table] missing declaration for ${kind}`);
  }
  return parsed;
}

function parseDefaults(source, errors) {
  const rows = tableRows(source, 'Code defaults (exactly two)');
  if (rows === null) {
    errors.push('[Code defaults (exactly two)] section is missing');
    return {};
  }
  const parsed = {};
  for (const row of rows) {
    if (row.length < 2 || row[0] === 'Field') continue;
    const field = stripCode(row[0]);
    const rawValue = stripCode(row[1]);
    const value = /^-?(?:\d+\.?\d*|\.\d+)$/.test(rawValue) ? Number(rawValue) : rawValue;
    parsed[field] = value;
  }
  return parsed;
}

function compareSets(errors, scope, expected, actual) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  for (const path of actualSet) {
    if (!expectedSet.has(path)) errors.push(`[${scope}] documented path is not in schema: ${path}`);
  }
  for (const path of expectedSet) {
    if (!actualSet.has(path)) errors.push(`[${scope}] schema path is missing from docs: ${path}`);
  }
}

function compareRecords(errors, scope, expected, actual) {
  const expectedKeys = Object.keys(expected);
  const actualKeys = Object.keys(actual);
  compareSets(errors, scope, expectedKeys, actualKeys);
  for (const key of expectedKeys) {
    if (Object.hasOwn(actual, key) && expected[key] !== actual[key]) {
      errors.push(`[${scope}] value drift at ${key}: schema=${expected[key]} docs=${actual[key]}`);
    }
  }
}

export function compareConfigContract(contract, source) {
  const errors = [];
  const failureRows = parseFailureTable(source, errors);
  for (const kind of DOCUMENT_KINDS) {
    const document = DOCUMENTS[kind];
    const row = failureRows[kind];
    if (!row) continue;
    if (row.path !== document.path) errors.push(`[failure-code table] ${kind} path drift: expected ${document.path}, docs=${row.path}`);
    if (row.code !== contract.documents[kind].failure_code) {
      errors.push(`[failure-code table] ${kind} code drift: schema=${contract.documents[kind].failure_code} docs=${row.code}`);
    }
  }

  const required = parseRequired(source, errors);
  for (const kind of DOCUMENT_KINDS) {
    compareSets(errors, `Required fields/${kind}`, contract.documents[kind].required, required[kind] ?? []);
  }

  const defaults = parseDefaults(source, errors);
  compareRecords(errors, 'Code defaults', contract.code_defaults, defaults);
  compareSets(errors, 'Schema default declarations', Object.keys(contract.code_defaults), contract.documents.contract.defaulted);
  if (Object.keys(contract.code_defaults).length !== 2) {
    errors.push(`[Code defaults (exactly two)] schema declares ${Object.keys(contract.code_defaults).length} defaults`);
  }

  addFactChecks(errors, source, 'What "v2" means here', [
    { label: 'unknown fields are rejected', pattern: /Unknown fields are rejected\./ },
    { label: 'unknown array-entry fields are reported', pattern: /unknown key inside an array entry is reported/i },
    { label: 'missing required fields are rejected', pattern: /Missing required fields are rejected/ },
    { label: 'missing fields are never filled in', pattern: /They are never filled in\./ },
  ]);
  addFactChecks(errors, source, 'Open maps vs. closed maps', [
    { label: 'capabilities is the only open map', pattern: /`capabilities` is the one open map \(`open: true`\)/ },
    { label: 'capability names are not typos', pattern: /unknown key there is a capability name, not a typo/i },
    { label: 'adapters is closed', pattern: /`adapters` is closed/ },
    { label: 'unknown adapter keys are rejected', pattern: /`adapters` is closed.*v2 rejects an unknown one/i },
  ]);
  return errors;
}

export function checkConfigDoc() {
  const contract = solveConfigContract();
  return compareConfigContract(contract, readConfigDoc());
}

function main() {
  const errors = checkConfigDoc();
  if (errors.length > 0) {
    process.stderr.write(`config-doc guard failed:\n${errors.map((error) => `- ${error}`).join('\n')}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('config-doc guard passed\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();
