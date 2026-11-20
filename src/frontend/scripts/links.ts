// Scripts navigate by following server-rendered links (see HiddenLinks) rather
// than copying text from the page into `location`. The browser parses each
// href, and a link that isn't same-origin (`javascript:`, `data:`, another
// host, or no href at all) is never followed.
type FollowableLink = Pick<HTMLAnchorElement, 'origin' | 'click'>;

export function followLink(link: FollowableLink | null | undefined, pageOrigin: string): boolean {
  if (!link || link.origin !== pageOrigin) return false;
  link.click();
  return true;
}

// A select whose options pair by index with server-rendered links (HiddenLinks
// named after the select's id). Changing the option follows its link and then
// calls `onFollow`.
export function wireSelectToLinks(
  select: Pick<HTMLSelectElement, 'selectedIndex'> & {
    addEventListener(type: 'change', listener: () => void): void;
  },
  links: FollowableLink[] | null,
  pageOrigin: string,
  onFollow: () => void = () => {}
): void {
  select.addEventListener('change', () => {
    if (followLink(links?.[select.selectedIndex], pageOrigin)) onFollow();
  });
}

export function linksNamed(root: ParentNode, name: string): HTMLAnchorElement[] | null {
  const box = root.querySelector(`[data-links="${CSS.escape(name)}"]`);
  return box ? Array.from(box.querySelectorAll('a')) : null;
}

// Client-side twin of HiddenLinks, for markup rebuilt from fetched data.
export function replaceLinks(
  root: HTMLElement,
  name: string,
  hrefs: (string | null)[] | null
): void {
  root.querySelector(`[data-links="${CSS.escape(name)}"]`)?.remove();
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
