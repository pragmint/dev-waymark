import { Context } from 'hono';
import { PracticesCatalogPage } from '../frontend/Pages/PracticesCatalogPage';
import { loadAllPracticesFromFilesystem } from '../shell/loaders/practiceLoader';
import { loadDataContext } from '../loaders/loadDataContext';

const { teams } = await loadDataContext();

export async function handlePracticeCatalog(c: Context) {
  const practices = await loadAllPracticesFromFilesystem();

  return c.html(<PracticesCatalogPage teams={teams} practices={practices} />);
}
