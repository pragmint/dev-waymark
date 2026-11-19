import { describe, expect, it } from 'bun:test';
import { pipelineChecksFor } from './pipelineChecks';

const pytest = {
  name: 'pipeline (pytest)',
  cwd: 'pipeline',
  command: ['uv', 'run', 'pytest', '-q'],
};

describe('pipelineChecksFor', () => {
  it('runs nothing when no pipeline file changed', () => {
    expect(pipelineChecksFor(['src/domain/parseDate.ts', 'README.md'])).toEqual([]);
  });

  it('runs nothing for a docs-only pipeline change', () => {
    expect(pipelineChecksFor(['pipeline/README.md', 'pipeline/CONTRACT.md'])).toEqual([]);
  });

  it('runs the Python tests for a pipeline code change', () => {
    expect(pipelineChecksFor(['pipeline/runner.py'])).toEqual([pytest]);
  });

  it('runs the Python tests for a job or client config change', () => {
    expect(pipelineChecksFor(['pipeline/jobs/entities/query.sql'])).toEqual([pytest]);
    expect(pipelineChecksFor(['pipeline/clients/apache-kafka.toml'])).toEqual([pytest]);
  });

  it("adds a touched container's own tests", () => {
    expect(pipelineChecksFor(['pipeline/containers/lead-time/src/leadTime.ts'])).toEqual([
      pytest,
      {
        name: 'container lead-time (bun test)',
        cwd: 'pipeline/containers/lead-time',
        command: ['bun', 'test'],
      },
    ]);
  });

  it('runs each touched container once, in name order', () => {
    const checks = pipelineChecksFor([
      'pipeline/containers/zeta/main.ts',
      'pipeline/containers/alpha/a.ts',
      'pipeline/containers/alpha/b.ts',
    ]);
    expect(checks.map(check => check.cwd)).toEqual([
      'pipeline',
      'pipeline/containers/alpha',
      'pipeline/containers/zeta',
    ]);
  });

  it('treats a file directly in containers/ as pipeline code, not a container', () => {
    expect(pipelineChecksFor(['pipeline/containers/notes.txt'])).toEqual([pytest]);
  });

  it("ignores a container's Markdown", () => {
    expect(pipelineChecksFor(['pipeline/containers/lead-time/README.md'])).toEqual([]);
  });
});
