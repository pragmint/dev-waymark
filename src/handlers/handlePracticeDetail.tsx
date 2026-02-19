import { Context } from 'hono';
import { PracticeDetailPage } from '../frontend/Pages/PracticeDetailPage';
import { loadPracticeFromFilesystem } from '../loaders/loadPracticeFromFilesystem';
import { NotFoundError } from '../domain/errors';

export async function handlePracticeDetail(c: Context) {
  const practiceId = c.req.param('practiceId');
  const practice = await loadPracticeFromFilesystem(practiceId);

  if (!practice) {
    throw new NotFoundError('Practice', practiceId);
  }

  return c.html(<PracticeDetailPage practice={practice} />);
}
