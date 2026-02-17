import { Context } from 'hono';
import { PracticesCatalogPage } from '../frontend/Pages/PracticesCatalogPage';
import { loadPracticesFromFilesystem } from '../loaders/loadPracticesFromFilesystem';
import { loadDataContext } from '../loaders/loadDataContext';

const { teams } = await loadDataContext();

export async function handlePracticeCatalog(c: Context) {
  const practices = await loadPracticesFromFilesystem();

  return c.html(<PracticesCatalogPage teams={teams} practices={practices} />);
}
