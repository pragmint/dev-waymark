/** A test suite to run from `cwd` (repo-relative) before a commit. */
export type PipelineCheck = { name: string; cwd: string; command: string[] };

const PIPELINE = 'pipeline/';
const CONTAINERS = 'pipeline/containers/';

/**
 * The pipeline test suites a commit of `paths` (repo-relative, as `git diff --name-only` prints
 * them) should run: the Python tests for any change under `pipeline/` other than Markdown, and
 * each touched container's own tests. Docs-only commits run nothing.
 */
export function pipelineChecksFor(paths: string[]): PipelineCheck[] {
  const code = paths.filter(path => path.startsWith(PIPELINE) && !path.endsWith('.md'));
  if (code.length === 0) return [];
  const containers = new Set(
    code
      .filter(path => path.startsWith(CONTAINERS))
      .map(path => path.slice(CONTAINERS.length).split('/'))
      .filter(parts => parts.length > 1)
      .map(([name]) => name)
  );
  return [
    { name: 'pipeline (pytest)', cwd: 'pipeline', command: ['uv', 'run', 'pytest', '-q'] },
    ...[...containers].sort().map(name => ({
      name: `container ${name} (bun test)`,
      cwd: `${CONTAINERS}${name}`,
      command: ['bun', 'test'],
    })),
  ];
}
