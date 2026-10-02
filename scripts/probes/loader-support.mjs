import { pathToFileURL } from 'node:url';

// --import preloads are cached per process. Unlike --experimental-loader on
// newer nested test runners, repeated forwarding cannot register this hook twice.
export function testLoaderArgs(loader) {
  const program = `import { register } from 'node:module'; register(${JSON.stringify(pathToFileURL(loader).href)});`;
  return ['--import', `data:text/javascript;base64,${Buffer.from(program).toString('base64')}`];
}

// Node 22 counts pattern-skipped tests in TAP ordinals; newer runners omit them.
// Require the exact named assertion failure regardless of its numeric position.
export function namedTapFailure(stdout, title) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^not ok [1-9][0-9]* - ${escaped}\\r?$`, 'm').test(stdout);
}
