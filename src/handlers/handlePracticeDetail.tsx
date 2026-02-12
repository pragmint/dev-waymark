import { Context } from "hono";
import { NotFoundError } from "../core/errors";
import { PracticeDetailPage } from "../frontend/Pages/PracticeDetailPage";
import { loadPracticeFromFilesystem } from "../shell/loaders/practiceLoader";
import { loadDataContext } from "../loaders/loadDataContext";

const { teams } = await loadDataContext()

export async function handlePracticeDetail(c: Context) {
  const practiceId = c.req.param('practiceId');
  const practice = await loadPracticeFromFilesystem(practiceId);

  if (!practice) {
    throw new NotFoundError('Practice', practiceId);
  }

  return c.html(<PracticeDetailPage teams={teams} practice={practice} />);
};

