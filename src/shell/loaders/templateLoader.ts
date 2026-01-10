import type { Templates } from "../../core/rendering/templates";

// Pure I/O function - loads templates from filesystem
export async function loadTemplatesFromFilesystem(): Promise<Templates> {
  const layoutFile = Bun.file("resources/private/html/partials/layout.html");
  const navFile = Bun.file("resources/private/html/partials/nav.html");

  const layout = await layoutFile.text();
  const nav = await navFile.text();

  return { layout, nav };
}
