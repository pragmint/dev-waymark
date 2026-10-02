// Scripts navigate by following server-rendered links (see HiddenLinks) rather
// than copying text from the page into `location`. The browser parses each
// href, and a link that isn't same-origin (`javascript:`, `data:`, another
// host, or no href at all) is never followed.
export function followLink(
  link: Pick<HTMLAnchorElement, 'origin' | 'click'> | null | undefined,
  pageOrigin: string
): boolean {
  if (!link || link.origin !== pageOrigin) return false;
  link.click();
  return true;
}

export function linksNamed(root: ParentNode, name: string): HTMLAnchorElement[] | null {
  const box = root.querySelector(`[data-links="${name}"]`);
  return box ? Array.from(box.querySelectorAll('a')) : null;
}

// Client-side twin of HiddenLinks, for markup rebuilt from fetched data.
export function replaceLinks(
  root: HTMLElement,
  name: string,
  hrefs: (string | null)[] | null
): void {
  root.querySelector(`[data-links="${name}"]`)?.remove();
  if (!hrefs) return;
  const box = document.createElement('div');
  box.hidden = true;
  box.dataset.links = name;
  for (const href of hrefs) {
    const link = document.createElement('a');
    if (href) link.href = href;
    box.appendChild(link);
  }
  root.appendChild(box);
}
