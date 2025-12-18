import { describe, test, expect } from "bun:test";
import { PageRenderer } from "../src/pageRenderer";

describe("PageRenderer", () => {
  describe("render", () => {
    test("should throw error when not initialized", () => {
      const renderer = new PageRenderer();

      expect(() => {
        renderer.render({
          title: "Test Page",
          heading: "Test Heading",
          activePage: "home"
        });
      }).toThrow("PageRenderer not initialized. Call init() first.");
    });

    test("should replace title, heading, and nav placeholders", async () => {
      const layoutTemplate = "<html><head><title>{{TITLE}}</title></head><body><h1>{{HEADING}}</h1>{{NAV}}</body></html>";
      const navTemplate = '<nav><a href="/" data-page="home">Home</a></nav>';

      const renderer = new PageRenderer();
      await renderer.init(layoutTemplate, navTemplate);

      const result = renderer.render({
        title: "My Page",
        heading: "Welcome",
        activePage: "home"
      });

      expect(result).toContain("<title>My Page</title>");
      expect(result).toContain("<h1>Welcome</h1>");
      expect(result).toContain('<nav><a href="/" data-page="home" class="active">Home</a></nav>');
    });

    test("should add active class to matching nav item", async () => {
      const layoutTemplate = "{{NAV}}";
      const navTemplate = '<nav><a data-page="home">Home</a><a data-page="about">About</a></nav>';

      const renderer = new PageRenderer();
      await renderer.init(layoutTemplate, navTemplate);

      const result = renderer.render({
        title: "About",
        heading: "About Us",
        activePage: "about"
      });

      expect(result).toContain('data-page="home">Home');
      expect(result).toContain('data-page="about" class="active">About');
    });

    test("should handle multiple nav items with only one active", async () => {
      const layoutTemplate = "{{NAV}}";
      const navTemplate = `
        <nav>
          <a href="/" data-page="home">Home</a>
          <a href="/about" data-page="about">About</a>
          <a href="/contact" data-page="contact">Contact</a>
        </nav>
      `;

      const renderer = new PageRenderer();
      await renderer.init(layoutTemplate, navTemplate);

      const result = renderer.render({
        title: "Contact",
        heading: "Contact Us",
        activePage: "contact"
      });

      expect(result).toContain('data-page="home">Home');
      expect(result).toContain('data-page="about">About');
      expect(result).toContain('data-page="contact" class="active">Contact');

      // Ensure only one active class is added
      const activeMatches = result.match(/class="active"/g);
      expect(activeMatches?.length).toBe(1);
    });

    test("should handle nav item with no matching active page", async () => {
      const layoutTemplate = "{{NAV}}";
      const navTemplate = '<nav><a data-page="home">Home</a><a data-page="about">About</a></nav>';

      const renderer = new PageRenderer();
      await renderer.init(layoutTemplate, navTemplate);

      const result = renderer.render({
        title: "Other",
        heading: "Other Page",
        activePage: "nonexistent"
      });

      // No active class should be added when there's no match
      expect(result).not.toContain('class="active"');
    });

    test("should handle empty title and heading", async () => {
      const layoutTemplate = "<title>{{TITLE}}</title><h1>{{HEADING}}</h1>{{NAV}}";
      const navTemplate = '<nav></nav>';

      const renderer = new PageRenderer();
      await renderer.init(layoutTemplate, navTemplate);

      const result = renderer.render({
        title: "",
        heading: "",
        activePage: "home"
      });

      expect(result).toContain("<title></title>");
      expect(result).toContain("<h1></h1>");
    });

    test("should handle special characters in config values", async () => {
      const layoutTemplate = "<title>{{TITLE}}</title><h1>{{HEADING}}</h1>{{NAV}}";
      const navTemplate = '<nav></nav>';

      const renderer = new PageRenderer();
      await renderer.init(layoutTemplate, navTemplate);

      const result = renderer.render({
        title: "Test & Demo <Page>",
        heading: 'Welcome "User"',
        activePage: "home"
      });

      expect(result).toContain("<title>Test & Demo <Page></title>");
      expect(result).toContain('<h1>Welcome "User"</h1>');
    });

    test("should preserve template structure when placeholders are replaced", async () => {
      const layoutTemplate = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>{{TITLE}}</title>
</head>
<body>
  <h1>{{HEADING}}</h1>
  {{NAV}}
  <main>Content here</main>
</body>
</html>`;
      const navTemplate = '<nav><a data-page="home">Home</a></nav>';

      const renderer = new PageRenderer();
      await renderer.init(layoutTemplate, navTemplate);

      const result = renderer.render({
        title: "Test",
        heading: "Test Heading",
        activePage: "home"
      });

      expect(result).toContain("<!DOCTYPE html>");
      expect(result).toContain('<meta charset="UTF-8">');
      expect(result).toContain("<main>Content here</main>");
      expect(result).toContain("<title>Test</title>");
    });

    test("should handle nav template with existing classes on other elements", async () => {
      const layoutTemplate = "{{NAV}}";
      const navTemplate = '<nav class="navbar"><a data-page="home" class="link">Home</a></nav>';

      const renderer = new PageRenderer();
      await renderer.init(layoutTemplate, navTemplate);

      const result = renderer.render({
        title: "Home",
        heading: "Home Page",
        activePage: "home"
      });

      // Should preserve existing classes on nav
      expect(result).toContain('<nav class="navbar">');
      // Note: Current implementation adds class="active" even if class attribute already exists
      // This results in duplicate class attributes, which browsers handle by using the first one
      expect(result).toContain('data-page="home" class="active"');
      expect(result).toContain('class="link"');
    });

    test("should create independent instances", async () => {
      const layout1 = "<title>{{TITLE}}</title>{{NAV}}";
      const nav1 = '<nav data-page="home">Nav 1</nav>';

      const layout2 = "<h1>{{TITLE}}</h1>{{NAV}}";
      const nav2 = '<nav data-page="about">Nav 2</nav>';

      const renderer1 = new PageRenderer();
      const renderer2 = new PageRenderer();

      await renderer1.init(layout1, nav1);
      await renderer2.init(layout2, nav2);

      const result1 = renderer1.render({
        title: "Page 1",
        heading: "Heading 1",
        activePage: "home"
      });

      const result2 = renderer2.render({
        title: "Page 2",
        heading: "Heading 2",
        activePage: "about"
      });

      expect(result1).toContain("<title>Page 1</title>");
      expect(result1).toContain("Nav 1");
      expect(result1).not.toContain("<h1>");

      expect(result2).toContain("<h1>Page 2</h1>");
      expect(result2).toContain("Nav 2");
      expect(result2).not.toContain("<title>");
    });
  });
});
