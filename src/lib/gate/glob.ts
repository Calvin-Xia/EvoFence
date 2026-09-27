/**
 * Gate domain · path-glob primitive.
 *
 * The pattern language behind both path rules of the isolation gate (protected paths and the
 * allowed evolution surface). Ported verbatim from `src/lib/policy.js:24-43` (0.3.0) so the
 * matching semantics — `**` crossing separators, `*` staying inside one segment, `?` one
 * character, `./` normalisation and Windows separator folding — cannot drift.
 *
 * Imports: nothing (leaf of the gate domain).
 */

/** Compile one glob pattern into an anchored `RegExp`. */
export function globRegex(glob: string): RegExp {
  let source = '^';
  const pattern = glob.replaceAll('\\', '/').replace(/^\.\//, '');
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    const next = pattern[i + 1];
    if (char === '*' && next === '*') {
      if (pattern[i + 2] === '/') {
        source += '(?:.*/)?';
        i += 2;
      } else {
        source += '.*';
        i += 1;
      }
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  return new RegExp(`${source}$`);
}

/** `true` when `filename` matches `pattern`; separators are normalised first. */
export function matchesGlob(filename: string, pattern: string): boolean {
  const name = filename.replaceAll('\\', '/').replace(/^\.\//, '');
  return globRegex(pattern).test(name);
}
