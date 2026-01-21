import type { FC } from 'hono/jsx';

interface LayoutProps {
  title: string;
  children: any;
}

export const Layout: FC<LayoutProps> = ({ title, children }) => {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title} - Step Engine</title>
        <link rel="stylesheet" href="/resources/public/style.css" />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
};
