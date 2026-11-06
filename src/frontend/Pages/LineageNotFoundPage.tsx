import type { FC } from 'hono/jsx';
import { Layout } from '../components/Layout';

export const LineageNotFoundPage: FC<{ message: string }> = ({ message }) => (
  <Layout title="Lineage not found">
    <div class="page-header">
      <a href="/entities" class="back-link">
        ← Entities
      </a>
      <h1>Not found</h1>
    </div>
    <p class="lineage-note">{message}</p>
  </Layout>
);
