import { Context } from 'hono';
import { PracticesCatalogPage } from '../frontend/Pages/PracticesCatalogPage';
import { loadPracticesFromFilesystem } from '../loaders/loadPracticesFromFilesystem';

export async function handlePracticeCatalog(c: Context) {
  const practices = await loadPracticesFromFilesystem();

  return c.html(<PracticesCatalogPage practices={practices} />);
}
