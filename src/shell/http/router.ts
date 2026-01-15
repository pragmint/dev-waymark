// Router abstraction - Single Responsibility: Route matching and dispatching

export type RouteHandler = (
  url: URL,
  context: RouteContext
) => Promise<Response | null>;

export interface RouteContext {
  templates: any;
  teams: any[];
  capabilities: any[];
}

export interface Route {
  pattern: string | RegExp;
  handler: RouteHandler;
}

export class Router {
  private routes: Route[] = [];

  add(pattern: string | RegExp, handler: RouteHandler): void {
    this.routes.push({ pattern, handler });
  }

  async route(url: URL, context: RouteContext): Promise<Response> {
    for (const route of this.routes) {
      const response = await this.tryRoute(route, url, context);
      if (response) return response;
    }

    return new Response("Not Found", { status: 404 });
  }

  private async tryRoute(
    route: Route,
    url: URL,
    context: RouteContext
  ): Promise<Response | null> {
    if (typeof route.pattern === 'string') {
      if (url.pathname === route.pattern ||
          url.pathname === route.pattern + '/') {
        return await route.handler(url, context);
      }
    } else {
      const match = url.pathname.match(route.pattern);
      if (match) {
        return await route.handler(url, context);
      }
    }

    return null;
  }
}
