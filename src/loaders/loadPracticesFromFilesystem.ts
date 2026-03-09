import { readdir } from 'node:fs/promises';
import { loadPracticeFromFilesystem, type Practice } from './loadPracticeFromFilesystem';
import { isEnoentError } from './isEnoentError';

/**
 * Loads all practices from filesystem
 * Directory structure: resources/practices/{practice-name}.md
 */
export async function loadPracticesFromFilesystem(): Promise<Practice[]> {
  const dir = 'resources/practices';

  try {
    const files = await readdir(dir);

    const practices = await Promise.all(
      files
        .filter(file => file.endsWith('.md'))
        .map(async file => {
          const practiceId = file.replace('.md', '');
          return await loadPracticeFromFilesystem(practiceId);
        })
    );

    const result = practices
      .filter((p): p is Practice => p !== null)
      .sort((a, b) => a.title.localeCompare(b.title));

    console.log(`Loaded ${result.length} practices`);

    return result;
  } catch (error) {
    if (isEnoentError(error)) {
      console.log('Practices directory not found, returning empty array');
      return [];
    }
    throw error;
  }
}
