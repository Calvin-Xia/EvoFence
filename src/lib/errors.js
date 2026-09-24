export class EvoFenceError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'EvoFenceError';
    this.code = code;
    this.details = details;
  }
}

export function invariant(condition, code, message, details) {
  if (!condition) throw new EvoFenceError(code, message, details);
}
