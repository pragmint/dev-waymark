# Step Engine

A simple website that helps software and data engineering teams continuously experiment with relevant and novel engineering practices.

## Getting Started

```bash
# get deps
bun install

# Build the js/css
bun b

# Development with hot reload
bun dev

# Run unit tests
bun test

# Run ui tests
bun test:pw  # Note: You may need to run `bunx playwright install` to install the browsers playwright depends on

# Build for Production
bun b:prod

# Start app from dist
bun start
```

While developing you may find some structures or patterns around. Here are some patterns you'll find and want to keep so things stay organized:

- Handler: Zero logic boilerplate for tying into hono endpoints. Takes in a Hono Context returns Hono response.
- Loader: Loads data from somewhere
- Processor: Processes data into a palatable format for the jsx views to consume.
- Pages: Content to be displayed by a route (uses server side jsx as html).
- Components: Set of reusable views that get composed within Pages.

Server runs at `http://localhost:3000`
