import { describe, test, expect } from "bun:test";
import { renderPage, type Templates, type Team } from "../src/core/rendering/templates";

describe("Page Rendering", () => {
  const templates: Templates = {
    layout: `
<!DOCTYPE html>
<html>
<head>
  <title>{{TITLE}}</title>
</head>
<body>
  <nav>{{NAV}}</nav>
  <h1>{{HEADING}}</h1>
  <main>{{CONTENT}}</main>
</body>
</html>
    `.trim(),
    nav: `
<ul>
  <li><a href="/" data-page="overview">Home</a></li>
  {{TEAM_LINKS}}
</ul>
    `.trim()
  };

  const teams: Team[] = [
    { id: "team-a", name: "Team Alpha" },
    { id: "team-b", name: "Team Beta" }
  ];

  test("renders a complete page with title, heading, and content", () => {
    const html = renderPage(templates, teams, {
      title: "Test Page",
      heading: "Welcome",
      activePage: "overview",
      content: "<p>Hello world</p>"
    });

    expect(html).toContain("<title>Test Page</title>");
    expect(html).toContain("<h1>Welcome</h1>");
    expect(html).toContain("<p>Hello world</p>");
  });

  test("renders team links in navigation", () => {
    const html = renderPage(templates, teams, {
      title: "Test",
      heading: "Test",
      activePage: "overview"
    });

    expect(html).toContain('href="/team/team-a/"');
    expect(html).toContain('Team Alpha');
    expect(html).toContain('href="/team/team-b/"');
    expect(html).toContain('Team Beta');
  });

  test("marks active page with active class", () => {
    const html = renderPage(templates, teams, {
      title: "Test",
      heading: "Test",
      activePage: "overview"
    });

    expect(html).toContain('data-page="overview" class="active"');
  });

  test("handles empty teams list", () => {
    const html = renderPage(templates, [], {
      title: "Test",
      heading: "Test",
      activePage: "overview"
    });

    expect(html).toContain('No teams configured');
  });

  test("handles missing content", () => {
    const html = renderPage(templates, teams, {
      title: "Test",
      heading: "Test",
      activePage: "overview"
    });

    expect(html).toContain("<main></main>");
  });
});
