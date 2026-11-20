/**
 * Runs as `preinstall`. Fails the install when this bun is older than the
 * `engines.bun` range in package.json. Bun before 1.2 can't read `bun.lock`,
 * so it resolves fresh versions without integrity checks, and bun before
 * 1.4.4 trusts compromised root certificates (GHSA-26q8-h657-pf84).
 */
import packageJson from '../package.json';

const required = packageJson.engines.bun;

if (!Bun.semver.satisfies(Bun.version, required)) {
  console.error(
    `bun ${Bun.version} does not satisfy engines.bun "${required}". ` +
      'Run inside `devenv shell` or upgrade bun.'
  );
  process.exit(1);
}
