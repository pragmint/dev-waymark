import { Context } from 'hono';
import { PracticesCatalogPage } from '../frontend/Pages/PracticesCatalogPage';
import { loadPracticesFromFilesystem } from '../loaders/loadPracticesFromFilesystem';

const practices = await loadPracticesFromFilesystem();

export async function handlePracticeCatalog(c: Context) {
  return c.html(<PracticesCatalogPage practices={practices} />);
}
