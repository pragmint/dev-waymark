import type { FC } from 'hono/jsx';
import { Page } from '../components/Page';
import type { Practice } from '../../loaders/loadPracticeFromFilesystem';

export interface PracticeDetailPageProps {
  practice: Practice;
}

export const PracticeDetailPage: FC<PracticeDetailPageProps> = ({ practice }) => {
  // Remove the first h1 heading since it's already in the page heading
  const contentWithoutH1 = practice.content.replace(/<h1[^>]*>.*?<\/h1>/i, '');

  return (
    <Page title={practice.title} heading={practice.title} activePage="practices">
      <div class="practice-detail-container">
        <div
          class="practice-content markdown-content"
          dangerouslySetInnerHTML={{ __html: contentWithoutH1 }}
        />

        <div class="practice-actions">
          <a href="/" class="btn btn-secondary">
            ← Back to Overview
          </a>
          <a href="/catalog/practice/" class="btn btn-primary">
            View All Practices
          </a>
        </div>
      </div>
    </Page>
  );
};
