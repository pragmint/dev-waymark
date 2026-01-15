// Coming soon route handler - Single Responsibility: Handle placeholder pages for upcoming features

import { RouteHandler } from '../router';
import { renderPage } from '../../../core/rendering/templates';

const comingSoonContent = `
  <div style="max-width: 600px; margin: 64px auto; text-align: center;">
    <div style="font-size: 64px; margin-bottom: 24px; opacity: 0.3;">🚧</div>
    <h2 style="font-size: 32px; color: #333; margin-bottom: 16px;">Coming Soon</h2>
    <p style="font-size: 18px; color: #666; line-height: 1.6;">
      This page is currently under development. Check back later for updates.
    </p>
  </div>
`;

interface PageConfig {
  title: string;
  heading: string;
  activePage: string;
}

const pageConfigs: Record<string, PageConfig> = {
  '/insight/': { title: 'Insights', heading: 'Insights', activePage: 'insights' },
  '/catalog/resource/': { title: 'Resources', heading: 'Resources', activePage: 'resources' },
};

export const comingSoonHandler: RouteHandler = async (url, context) => {
  const config = pageConfigs[url.pathname];

  if (!config) return null;

  const html = renderPage(context.templates, context.teams, {
    ...config,
    content: comingSoonContent,
  });

  return new Response(html, {
    headers: { "Content-Type": "text/html" },
  });
};
