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
      <title>{title} — Step Engine</title>
      <link rel="stylesheet" href="/style.css" />
    </head>
    <body>
      <header class="site-header">
        <nav class="nav">
          <a href="/entities" class="nav-brand">
            Step Engine
          </a>
          <a href="/entities" class="nav-link">
            Entities
          </a>
          <a href="/datasets" class="nav-link">
            Saved Datasets
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
