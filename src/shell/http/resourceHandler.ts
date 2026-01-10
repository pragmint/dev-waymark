// Pure HTTP resource handler - handles static file serving

export const getContentType = (path: string): string => {
  const ext = path.split('.').pop()?.toLowerCase();
  const contentTypes: Record<string, string> = {
    'css': 'text/css',
    'js': 'application/javascript',
    'json': 'application/json',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'svg': 'image/svg+xml',
    'ico': 'image/x-icon',
    'html': 'text/html',
    'txt': 'text/plain',
  };
  return contentTypes[ext || ''] || 'application/octet-stream';
};

export interface FileStore {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string | Uint8Array>;
}

export class BunFileStore implements FileStore {
  async exists(path: string): Promise<boolean> {
    const file = Bun.file(path);
    return await file.exists();
  }

  async read(path: string): Promise<string | Uint8Array> {
    const file = Bun.file(path);
    return await file.arrayBuffer().then(buf => new Uint8Array(buf));
  }
}

export const createResourceHandler = (fileStore: FileStore = new BunFileStore()) => {
  return async (url: URL): Promise<Response | null> => {
    // Serve public resource files only
    if (url.pathname.startsWith("/resources/public/")) {
      const filePath = url.pathname.slice(1); // Remove leading slash

      if (await fileStore.exists(filePath)) {
        const content = await fileStore.read(filePath);
        return new Response(content, {
          headers: {
            "Content-Type": getContentType(filePath),
          },
        });
      }

      return new Response("Not Found", { status: 404 });
    }

    return null;
  };
};

// Default export with Bun filesystem
export const handleResourceRequest = createResourceHandler();
