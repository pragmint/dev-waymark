import { describe, test, expect } from "bun:test";
import { getContentType, createResourceHandler, type FileStore } from "../src/resourceLoader";

// Mock FileStore implementation for testing
class MockFileStore implements FileStore {
  private files: Map<string, string | Uint8Array> = new Map();

  addFile(path: string, content: string | Uint8Array) {
    this.files.set(path, content);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async read(path: string): Promise<string | Uint8Array> {
    if (!this.files.has(path)) {
      throw new Error(`File not found: ${path}`);
    }
    return this.files.get(path)!;
  }

  clear() {
    this.files.clear();
  }
}

describe("getContentType", () => {
  test("should return correct content type for CSS files", () => {
    expect(getContentType("style.css")).toBe("text/css");
    expect(getContentType("path/to/file.CSS")).toBe("text/css");
  });

  test("should return correct content type for JavaScript files", () => {
    expect(getContentType("script.js")).toBe("application/javascript");
    expect(getContentType("app.JS")).toBe("application/javascript");
  });

  test("should return correct content type for JSON files", () => {
    expect(getContentType("data.json")).toBe("application/json");
    expect(getContentType("config.JSON")).toBe("application/json");
  });

  test("should return correct content type for PNG images", () => {
    expect(getContentType("image.png")).toBe("image/png");
    expect(getContentType("photo.PNG")).toBe("image/png");
  });

  test("should return correct content type for JPG/JPEG images", () => {
    expect(getContentType("photo.jpg")).toBe("image/jpeg");
    expect(getContentType("photo.jpeg")).toBe("image/jpeg");
    expect(getContentType("photo.JPG")).toBe("image/jpeg");
    expect(getContentType("photo.JPEG")).toBe("image/jpeg");
  });

  test("should return correct content type for GIF images", () => {
    expect(getContentType("animation.gif")).toBe("image/gif");
    expect(getContentType("animation.GIF")).toBe("image/gif");
  });

  test("should return correct content type for SVG images", () => {
    expect(getContentType("icon.svg")).toBe("image/svg+xml");
    expect(getContentType("icon.SVG")).toBe("image/svg+xml");
  });

  test("should return correct content type for ICO files", () => {
    expect(getContentType("favicon.ico")).toBe("image/x-icon");
    expect(getContentType("favicon.ICO")).toBe("image/x-icon");
  });

  test("should return correct content type for HTML files", () => {
    expect(getContentType("index.html")).toBe("text/html");
    expect(getContentType("page.HTML")).toBe("text/html");
  });

  test("should return correct content type for text files", () => {
    expect(getContentType("readme.txt")).toBe("text/plain");
    expect(getContentType("notes.TXT")).toBe("text/plain");
  });

  test("should return default content type for unknown extensions", () => {
    expect(getContentType("file.unknown")).toBe("application/octet-stream");
    expect(getContentType("file.xyz")).toBe("application/octet-stream");
    expect(getContentType("file.abc123")).toBe("application/octet-stream");
  });

  test("should handle files without extensions", () => {
    expect(getContentType("noextension")).toBe("application/octet-stream");
    expect(getContentType("path/to/noextension")).toBe("application/octet-stream");
    expect(getContentType("README")).toBe("application/octet-stream");
  });

  test("should handle paths with multiple dots", () => {
    expect(getContentType("file.min.js")).toBe("application/javascript");
    expect(getContentType("style.min.css")).toBe("text/css");
    expect(getContentType("data.backup.json")).toBe("application/json");
  });

  test("should handle empty extension", () => {
    expect(getContentType("file.")).toBe("application/octet-stream");
    expect(getContentType("path/to/file.")).toBe("application/octet-stream");
  });

  test("should be case insensitive", () => {
    expect(getContentType("FILE.css")).toBe("text/css");
    expect(getContentType("FILE.Js")).toBe("application/javascript");
    expect(getContentType("FILE.PnG")).toBe("image/png");
    expect(getContentType("FILE.HtMl")).toBe("text/html");
  });
});

describe("createResourceHandler", () => {
  describe("with mock filestore", () => {
    test("should return Response with correct content type for existing CSS file", async () => {
      const mockStore = new MockFileStore();
      mockStore.addFile("resources/public/style.css", "body { color: red; }");
      const handler = createResourceHandler(mockStore);

      const url = new URL("http://localhost:3000/resources/public/style.css");
      const response = await handler(url);

      expect(response).not.toBeNull();
      expect(response?.status).toBe(200);
      expect(response?.headers.get("Content-Type")).toBe("text/css");

      const text = await response?.text();
      expect(text).toBe("body { color: red; }");
    });

    test("should return Response with correct content type for existing JS file", async () => {
      const mockStore = new MockFileStore();
      mockStore.addFile("resources/public/app.js", "console.log('hello');");
      const handler = createResourceHandler(mockStore);

      const url = new URL("http://localhost:3000/resources/public/app.js");
      const response = await handler(url);

      expect(response).not.toBeNull();
      expect(response?.status).toBe(200);
      expect(response?.headers.get("Content-Type")).toBe("application/javascript");

      const text = await response?.text();
      expect(text).toBe("console.log('hello');");
    });

    test("should return Response with correct content type for existing JSON file", async () => {
      const mockStore = new MockFileStore();
      mockStore.addFile("resources/public/data.json", '{"name": "test"}');
      const handler = createResourceHandler(mockStore);

      const url = new URL("http://localhost:3000/resources/public/data.json");
      const response = await handler(url);

      expect(response).not.toBeNull();
      expect(response?.status).toBe(200);
      expect(response?.headers.get("Content-Type")).toBe("application/json");

      const text = await response?.text();
      expect(text).toBe('{"name": "test"}');
    });

    test("should return Response with correct content type for binary files", async () => {
      const mockStore = new MockFileStore();
      const pngData = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      mockStore.addFile("resources/public/image.png", pngData);
      const handler = createResourceHandler(mockStore);

      const url = new URL("http://localhost:3000/resources/public/image.png");
      const response = await handler(url);

      expect(response).not.toBeNull();
      expect(response?.status).toBe(200);
      expect(response?.headers.get("Content-Type")).toBe("image/png");

      const buffer = await response?.arrayBuffer();
      const responseData = new Uint8Array(buffer!);
      expect(responseData).toEqual(pngData);
    });

    test("should return 404 Response for non-existent file", async () => {
      const mockStore = new MockFileStore();
      const handler = createResourceHandler(mockStore);

      const url = new URL("http://localhost:3000/resources/public/nonexistent.css");
      const response = await handler(url);

      expect(response).not.toBeNull();
      expect(response?.status).toBe(404);

      const text = await response?.text();
      expect(text).toBe("Not Found");
    });

    test("should return null for paths not starting with /resources/public/", async () => {
      const mockStore = new MockFileStore();
      mockStore.addFile("index.html", "<html></html>");
      const handler = createResourceHandler(mockStore);

      const url1 = new URL("http://localhost:3000/");
      const response1 = await handler(url1);
      expect(response1).toBeNull();

      const url2 = new URL("http://localhost:3000/index.html");
      const response2 = await handler(url2);
      expect(response2).toBeNull();

      const url3 = new URL("http://localhost:3000/api/data");
      const response3 = await handler(url3);
      expect(response3).toBeNull();
    });

    test("should return null for /resources/ paths without public/ subdirectory", async () => {
      const mockStore = new MockFileStore();
      mockStore.addFile("resources/private/secret.txt", "secret data");
      const handler = createResourceHandler(mockStore);

      const url1 = new URL("http://localhost:3000/resources/private/secret.txt");
      const response1 = await handler(url1);
      expect(response1).toBeNull();

      const url2 = new URL("http://localhost:3000/resources/file.css");
      const response2 = await handler(url2);
      expect(response2).toBeNull();
    });

    test("should handle nested directory paths", async () => {
      const mockStore = new MockFileStore();
      mockStore.addFile("resources/public/css/components/button.css", ".btn { padding: 10px; }");
      const handler = createResourceHandler(mockStore);

      const url = new URL("http://localhost:3000/resources/public/css/components/button.css");
      const response = await handler(url);

      expect(response).not.toBeNull();
      expect(response?.status).toBe(200);
      expect(response?.headers.get("Content-Type")).toBe("text/css");

      const text = await response?.text();
      expect(text).toBe(".btn { padding: 10px; }");
    });

    test("should handle files with special characters in names", async () => {
      const mockStore = new MockFileStore();
      mockStore.addFile("resources/public/my-file_v2.0.js", "// version 2");
      const handler = createResourceHandler(mockStore);

      const url = new URL("http://localhost:3000/resources/public/my-file_v2.0.js");
      const response = await handler(url);

      expect(response).not.toBeNull();
      expect(response?.status).toBe(200);
      expect(response?.headers.get("Content-Type")).toBe("application/javascript");

      const text = await response?.text();
      expect(text).toBe("// version 2");
    });

    test("should handle paths with query parameters", async () => {
      const mockStore = new MockFileStore();
      mockStore.addFile("resources/public/cached.css", "body { margin: 0; }");
      const handler = createResourceHandler(mockStore);

      const url = new URL("http://localhost:3000/resources/public/cached.css?v=123&cache=bust");
      const response = await handler(url);

      expect(response).not.toBeNull();
      expect(response?.status).toBe(200);
      expect(response?.headers.get("Content-Type")).toBe("text/css");

      const text = await response?.text();
      expect(text).toBe("body { margin: 0; }");
    });

    test("should handle paths with hash fragments", async () => {
      const mockStore = new MockFileStore();
      mockStore.addFile("resources/public/main.js", "function main() {}");
      const handler = createResourceHandler(mockStore);

      const url = new URL("http://localhost:3000/resources/public/main.js#L42");
      const response = await handler(url);

      expect(response).not.toBeNull();
      expect(response?.status).toBe(200);
      expect(response?.headers.get("Content-Type")).toBe("application/javascript");

      const text = await response?.text();
      expect(text).toBe("function main() {}");
    });

    test("should handle empty file content", async () => {
      const mockStore = new MockFileStore();
      mockStore.addFile("resources/public/empty.txt", "");
      const handler = createResourceHandler(mockStore);

      const url = new URL("http://localhost:3000/resources/public/empty.txt");
      const response = await handler(url);

      expect(response).not.toBeNull();
      expect(response?.status).toBe(200);
      expect(response?.headers.get("Content-Type")).toBe("text/plain");

      const text = await response?.text();
      expect(text).toBe("");
    });

    test("should handle multiple file types correctly", async () => {
      const mockStore = new MockFileStore();
      mockStore.addFile("resources/public/style.css", "div {}");
      mockStore.addFile("resources/public/script.js", "var x;");
      mockStore.addFile("resources/public/data.json", "{}");
      mockStore.addFile("resources/public/page.html", "<html></html>");
      const handler = createResourceHandler(mockStore);

      const cssResponse = await handler(new URL("http://localhost:3000/resources/public/style.css"));
      expect(cssResponse?.headers.get("Content-Type")).toBe("text/css");

      const jsResponse = await handler(new URL("http://localhost:3000/resources/public/script.js"));
      expect(jsResponse?.headers.get("Content-Type")).toBe("application/javascript");

      const jsonResponse = await handler(new URL("http://localhost:3000/resources/public/data.json"));
      expect(jsonResponse?.headers.get("Content-Type")).toBe("application/json");

      const htmlResponse = await handler(new URL("http://localhost:3000/resources/public/page.html"));
      expect(htmlResponse?.headers.get("Content-Type")).toBe("text/html");
    });

    test("should handle case-insensitive file extensions", async () => {
      const mockStore = new MockFileStore();
      mockStore.addFile("resources/public/FILE.CSS", "body {}");
      const handler = createResourceHandler(mockStore);

      const url = new URL("http://localhost:3000/resources/public/FILE.CSS");
      const response = await handler(url);

      expect(response).not.toBeNull();
      expect(response?.status).toBe(200);
      expect(response?.headers.get("Content-Type")).toBe("text/css");
    });
  });
});
