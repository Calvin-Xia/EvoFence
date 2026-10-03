/** Deterministic paired, stratified repo bootstrap. No model calls or ambient random state. */
import { canonical } from '../../kernel/store/index.js';
import type { DigestPort } from '../../kernel/store/index.js';
import type { Pair, Statistics } from './types.js';

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000; };
}
export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const next = random(seed), copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; }
  return copy;
}
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const density = Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
  const p = 1 - density * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x < 0 ? 1 - p : p;
}
function inverseNormal(p: number): number {
  // Acklam rational approximation; p is explicitly clamped to the bootstrap's finite resolution.
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  if (p < 0.02425 || p > 0.97575) {
    const q = Math.sqrt(-2 * Math.log(p < 0.02425 ? p : 1 - p));
    const value = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    return p < 0.02425 ? value : -value;
  }
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
export function quantile(sorted: readonly number[], p: number): number {
  const at = (sorted.length - 1) * p, i = Math.floor(at), fraction = at - i;
  return sorted[i] + fraction * (sorted[Math.min(i + 1, sorted.length - 1)] - sorted[i]);
}
const difference = (p: Pair): number => p.treatment.success - p.control.success;
export function statistics(pairs: readonly Pair[], mve: number, seed: number, replicates: number, plannedN: number, digest: DigestPort): Statistics {
  const n = pairs.length, n01 = pairs.filter(p => p.control.success === 0 && p.treatment.success === 1).length;
  const n10 = pairs.filter(p => p.control.success === 1 && p.treatment.success === 0).length;
  if (n === 0) return { n, n01, n10, delta: null, se: null, zMve: null, bca95: null, conditionalPower: null,
    bootstrapDigest: digest.digest('[]'), exactMcNemarP: 1, scoreNullSe: null, bcaMvePositive: null };
  const delta = (n01 - n10) / n;
  const strata = [...new Set(pairs.map(p => p.sample.stratum))].sort().map(stratum => {
    const rows = pairs.filter(p => p.sample.stratum === stratum);
    const repoIds = [...new Set(rows.map(p => p.sample.repoId))].sort();
    return { weight: rows.length / n, repos: repoIds.map(repo => rows.filter(p => p.sample.repoId === repo)), rows };
  });
  const next = random(seed), bootstrap: number[] = [];
  for (let b = 0; b < replicates; b++) {
    let value = 0;
    for (const s of strata) {
      let sum = 0, count = 0;
      for (let i = 0; i < s.repos.length; i++) {
        const repo = s.repos[Math.floor(next() * s.repos.length)];
        for (const p of repo) { sum += difference(p); count++; }
      }
      value += s.weight * sum / count;
    }
    bootstrap.push(value);
  }
  const mean = bootstrap.reduce((a, b) => a + b, 0) / replicates;
  const se = Math.sqrt(bootstrap.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (replicates - 1));
  const bootstrapDigest = digest.digest(canonical(bootstrap));
  const jackknife: number[] = [];
  const repoIds = [...new Set(pairs.map(p => p.sample.repoId))].sort();
  for (const repo of repoIds) {
    let value = 0, defined = true;
    for (const s of strata) {
      const rows = s.rows.filter(p => p.sample.repoId !== repo);
      if (rows.length === 0) { defined = false; break; }
      value += s.weight * rows.reduce((a, p) => a + difference(p), 0) / rows.length;
    }
    if (defined) jackknife.push(value);
  }
  let bca95: Statistics['bca95'] = null;
  if (jackknife.length === repoIds.length && jackknife.length > 1 && se > 0) {
    const jackMean = jackknife.reduce((a, b) => a + b, 0) / jackknife.length;
    const deviations = jackknife.map(x => jackMean - x), squared = deviations.reduce((a, x) => a + x * x, 0);
    if (squared > 0) {
      const acceleration = deviations.reduce((a, x) => a + x ** 3, 0) / (6 * squared ** 1.5);
      const rank = (bootstrap.filter(x => x < delta).length + 0.5 * bootstrap.filter(x => x === delta).length) / replicates;
      const z0 = inverseNormal(Math.max(0.5 / replicates, Math.min(1 - 0.5 / replicates, rank)));
      const adjusted = (p: number): number => {
        const z = z0 + inverseNormal(p);
        return normalCdf(z0 + z / (1 - acceleration * z));
      };
      const sorted = [...bootstrap].sort((a, b) => a - b);
      bca95 = [quantile(sorted, adjusted(0.025)), quantile(sorted, adjusted(0.975))];
    }
  }
  const pi = (n01 + n10) / n;
  const discordant = n01 + n10;
  let probability = 2 ** -discordant, tail = probability;
  for (let k = 1; k <= Math.min(n01, n10); k++) { probability *= (discordant - k + 1) / k; tail += probability; }
  return { n, n01, n10, delta, se, zMve: se > 0 ? (delta - mve) / se : null, bca95,
    conditionalPower: pi > 0 ? 1 - normalCdf(1.960 - (delta - mve) / Math.sqrt(pi / plannedN)) : null, bootstrapDigest,
    exactMcNemarP: Math.min(1, 2 * tail), scoreNullSe: pi >= mve * mve ? Math.sqrt((pi - mve * mve) / n) : null,
    bcaMvePositive: bca95 === null ? null : bca95[0] >= mve };
}
