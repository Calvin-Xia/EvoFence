/**
 * `evofence doctor` — read-only preflight presentation skeleton.
 *
 * DOMAIN: CLI handler (node `l2_doctor_cmd`). The next doctor node supplies the checks from the
 * run preflight path; this node owns only the stable output shape and exit-code presentation.
 */
import { jsonDocument, type Write } from '../output.js';
import type { CommandContext } from './context.js';

export interface DoctorCheck {
  readonly id: string;
  readonly label: string;
  readonly status: 'ok' | 'refused';
  readonly code: string | null;
  readonly remediation: string;
}

const CHECK_SKELETON: readonly DoctorCheck[] = [
  {
    id: 'preflight',
    label: 'Preflight checks',
    status: 'ok',
    code: null,
    remediation: 'No action required.',
  },
];

export function renderDoctor(checks: readonly DoctorCheck[], json: boolean, stdout: Write): number {
  if (json) stdout(jsonDocument({ checks }));
  else {
    for (const check of checks) {
      const code = check.code === null ? '' : ` (${check.code})`;
      const remediation = check.status === 'refused' ? ` — ${check.remediation}` : '';
      stdout(`${check.status.toUpperCase()} ${check.id}: ${check.label}${code}${remediation}\n`);
    }
  }
  return checks.some((check) => check.status === 'refused') ? 1 : 0;
}

export async function commandDoctor(context: CommandContext): Promise<number> {
  return renderDoctor(CHECK_SKELETON, context.json, context.stdout);
}
