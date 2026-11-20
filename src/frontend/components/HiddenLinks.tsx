import type { FC } from 'hono/jsx';

// Navigation targets as real links, for scripts to follow with `followLink`
// instead of reading a URL out of the page. Order is the lookup key: entry i
// belongs to option i of a <select>, or point i of a chart series. A null
// entry renders a link with no href, which `followLink` refuses.
export const HiddenLinks: FC<{ name: string; hrefs: (string | null)[] }> = ({ name, hrefs }) => (
  <div hidden data-links={name}>
    {hrefs.map(href => (href ? <a href={href}></a> : <a></a>))}
  </div>
);
