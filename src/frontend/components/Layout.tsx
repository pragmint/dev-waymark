import type { FC, Child } from 'hono/jsx';

export const Layout: FC<{ title: string; children?: Child; extraScripts?: string[] }> = ({
  title,
  children,
  extraScripts,
}) => (
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>{title} — Dev Waymark</title>
      <link rel="stylesheet" href="/style.css" />
    </head>
    <body>
      <header class="site-header">
        <nav class="nav">
          <a href="/entities" class="nav-brand">
            Dev Waymark
          </a>
          <a href="/entities" class="nav-link">
            Entities
          </a>
          <a href="/presets" class="nav-link">
            Saved Presets
          </a>
          <a href="/visualizations" class="nav-link">
            Visualizations
          </a>
        </nav>
      </header>
      <main class="main">{children}</main>
      <script src="/filters.js" />
      {extraScripts?.map(src => (
        <script src={src} key={src} />
      ))}
    </body>
  </html>
);
