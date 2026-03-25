#!/usr/bin/env bun
/**
 * Website mirror script that treats query parameters as separate pages.
 *
 * Behaves like:
 *   wget --mirror --convert-links --adjust-extension --page-requisites --no-parent <url>
 *
 * ...but treats URLs with different query parameters as distinct pages.
 *
 * Query params are encoded into filenames using '@' and ',' separators, e.g.:
 *   /teams?id=foo&tab=bar  ->  teams@id=foo,tab=bar.html
 *
 * Usage:
 *   bun mirror.ts [base_url] [output_dir]
 *
 * Defaults:
 *   base_url:   http://localhost:3000/
 *   output_dir: mirror
 */

import { mkdir, writeFile } from 'fs/promises';
import { dirname, relative, join, extname, basename } from 'path';

const baseUrl = process.argv[2] ?? 'http://localhost:3000/';
const outputDir = process.argv[3] ?? 'mirror';

// Matches href, src, and action attributes in both quote styles
const ATTR_RE = /((?:href|src|action)\s*=\s*)(['"])([^'"]*)\2/gi;

// Injected into every mirrored HTML page to handle JS-driven query-param navigation.
//
// Two problems solved:
//   1. Direct access: file:// ignores query strings when loading files, but
//      window.location.search is still set. If we detect a query string on load,
//      redirect to the @-encoded filename that actually has the right content.
//   2. onchange "all" case: navigating back to the base file from a @team=foo.html
//      page requires stripping the @-encoding from the pathname.
const MIRROR_SHIM = `<script>
(function () {
  // Use only the filename (not the full absolute pathname) so that
  // location.replace() stays relative — Chrome blocks file:// navigation
  // when the target URL is constructed from an absolute /Users/... path.
  function currentBase() {
    var filename = location.pathname.split('/').pop() || 'index.html';
    return filename.replace(/@[^.]+\\.html$/, '.html').replace(/\\.html$/, '');
  }
  if (location.search) {
    var q = location.search.slice(1).replace(/&/g, ',');
    location.replace('./' + currentBase() + '@' + q + '.html');
    return;
  }
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[onchange]').forEach(function (el) {
      var orig = el.getAttribute('onchange') || '';
      if (orig.indexOf('window.location') === -1 || orig.indexOf('?') === -1) return;
      var paramMatch = orig.match(/\\?(\\w+)=/);
      var param = paramMatch ? paramMatch[1] : 'q';
      el.removeAttribute('onchange');
      el.addEventListener('change', function () {
        var base = currentBase();
        location.href = !this.value || this.value === 'all'
          ? './' + base + '.html'
          : './' + base + '@' + param + '=' + this.value + '.html';
      });
    });
  });
})();
</script>`;

function urlToLocalPath(url: string): string {
  const p = new URL(url);
  const netloc = p.host.replace(':', '+');
  let path = p.pathname || '/';

  let filePath: string;
  if (path.endsWith('/')) {
    filePath = path + 'index.html';
  } else if (!extname(basename(path))) {
    filePath = path + '.html';
  } else {
    filePath = path;
  }

  if (p.search) {
    const query = p.search.slice(1); // strip leading '?'
    const ext = extname(filePath);
    const root = filePath.slice(0, filePath.length - ext.length);
    const safeQuery = query.replace(/&/g, ',');
    filePath = `${root}@${safeQuery}${ext}`;
  }

  return join(outputDir, netloc, filePath.replace(/^\//, ''));
}

function relativeHref(fromUrl: string, toUrl: string): string {
  const fromPath = urlToLocalPath(fromUrl);
  const toPath = urlToLocalPath(toUrl);
  const rel = relative(dirname(fromPath), toPath);
  return rel.replace(/\\/g, '/');
}

function resolveUrl(url: string, fromUrl: string): string {
  try {
    const resolved = new URL(url, fromUrl);
    resolved.hash = '';
    return resolved.toString();
  } catch {
    return '';
  }
}

function sameOrigin(url: string, base: URL): boolean {
  try {
    const p = new URL(url);
    return p.protocol === base.protocol && p.host === base.host;
  } catch {
    return false;
  }
}

function underBase(url: string, base: URL): boolean {
  if (!sameOrigin(url, base)) return false;
  const p = new URL(url);
  const basePath = base.pathname.replace(/\/$/, '');
  return p.pathname === basePath || p.pathname.startsWith(basePath + '/');
}

async function crawl() {
  const base = new URL(baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');
  const visited = new Set<string>();
  const queue: string[] = [base.toString()];

  let count = 0;
  while (queue.length > 0) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    console.log(url);
    let response: Response;
    try {
      response = await fetch(url, { headers: { 'User-Agent': 'site-mirror/1.0' } });
    } catch (err) {
      console.log(`  -> Error: ${err}`);
      continue;
    }

    if (!response.ok) {
      console.log(`  -> HTTP ${response.status}`);
      continue;
    }

    const contentType = response.headers.get('content-type') ?? '';
    const localPath = urlToLocalPath(url);
    await mkdir(dirname(localPath), { recursive: true });

    if (contentType.includes('text/html') && underBase(url, base)) {
      let html = await response.text();

      // Inject shim before </head> (or at the top if no <head>)
      const withShim = html.replace('</head>', MIRROR_SHIM + '</head>');
      html = withShim !== html ? withShim : MIRROR_SHIM + html;

      // Rewrite all href/src/action attributes and enqueue new URLs
      html = html.replace(ATTR_RE, (match, prefix: string, quote: string, rawUrl: string) => {
        // Decode HTML entities
        const urlStr = rawUrl
          .replace(/&amp;/g, '&')
          .replace(/&#38;/g, '&')
          .replace(/&#x26;/g, '&');

        if (
          !urlStr ||
          urlStr.startsWith('data:') ||
          urlStr.startsWith('javascript:') ||
          urlStr.startsWith('mailto:') ||
          urlStr.startsWith('#')
        ) {
          return match;
        }

        const resolved = resolveUrl(urlStr, url);
        if (!resolved || !sameOrigin(resolved, base)) return match;

        if (!visited.has(resolved)) queue.push(resolved);

        const rel = relativeHref(url, resolved);
        return `${prefix}${quote}${rel}${quote}`;
      });

      // type="module" scripts are blocked by null-origin CORS on file:// — strip it
      html = html.replace(/<script\s([^>]*)type="module"([^>]*)>/gi, '<script $1$2>');

      await writeFile(localPath, html, 'utf-8');
    } else if (localPath.endsWith('.js')) {
      // Strip top-level export blocks that Bun adds for test imports.
      // They cause SyntaxError when the script is loaded without type="module".
      let js = await response.text();
      js = js.replace(/\nexport\s*\{[^}]*\};\s*$/, '\n');
      await writeFile(localPath, js, 'utf-8');
    } else {
      const buffer = await response.arrayBuffer();
      await writeFile(localPath, Buffer.from(buffer));
    }

    count++;
  }

  console.log(`\nDone. ${count} URLs downloaded to ./${outputDir}/`);
}

crawl().catch(err => {
  console.error(err);
  process.exit(1);
});
