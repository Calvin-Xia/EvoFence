/**
 * Exec domain · `.evofence/config.yaml` loader for the runner (0.3.0 `loadConfig`).
 * Kept separate from the gate/evidence loaders because it only validates the adapter entries
 * the runner needs before dispatching an agent.
 */
import path from 'node:path';
import { loadYamlFile } from '../contract.js';
import { invariant } from './errors.js';
import type { AdapterConfig, EvoFenceConfig } from '../../types/index.js';

export async function loadConfig(root: string): Promise<EvoFenceConfig> {
  const config = await loadYamlFile(path.join(root, '.evofence', 'config.yaml'), root) as EvoFenceConfig;
  invariant(config.version === 1, 'INVALID_CONFIG', 'config.version must be 1.');
  for (const name of ['codex', 'opencode', 'claude', 'pi'] as const) {
    const item = config.adapters?.[name] as AdapterConfig | undefined;
    if (item !== undefined) {
      invariant(item && typeof item === 'object', 'INVALID_CONFIG', `adapters.${name} must be an object.`);
      invariant(item.command === undefined || (typeof item.command === 'string' && item.command.trim()), 'INVALID_CONFIG', `adapters.${name}.command must be a non-empty string.`);
      invariant(item.model === undefined || item.model === null || typeof item.model === 'string', 'INVALID_CONFIG', `adapters.${name}.model must be a string or null.`);
      invariant(item.agent === undefined || item.agent === null || typeof item.agent === 'string', 'INVALID_CONFIG', `adapters.${name}.agent must be a string or null.`);
      if (name === 'pi') invariant(item.agent === undefined || item.agent === null, 'INVALID_CONFIG', 'adapters.pi.agent is unsupported by Pi CLI.');
    }
  }
  return config;
}
