import { Context } from 'hono';
import { PracticeDetailPage } from '../frontend/Pages/PracticeDetailPage';
import { loadPracticeFromFilesystem } from '../loaders/loadPracticeFromFilesystem';
import { loadDataContext } from '../loaders/loadDataContext';
import { NotFoundError } from '../domain/errors';

const { teams } = await loadDataContext();

export async function handlePracticeDetail(c: Context) {
  const practiceId = c.req.param('practiceId');
  const practice = await loadPracticeFromFilesystem(practiceId);

  if (!practice) {
    throw new NotFoundError('Practice', practiceId);
  }

  return c.html(<PracticeDetailPage teams={teams} practice={practice} />);
}
