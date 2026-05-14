import type { FC } from 'hono/jsx';
import type { EntityWithMetadata } from '../../schemas/entity';
import { Layout } from '../components/Layout';
import { MetadataTable } from '../components/MetadataTable';
import { formatDate } from '../../domain/parseDate';
import { getEntityTitle } from '../../domain/entityQueries';

export const EntityDetailPage: FC<{ entity: EntityWithMetadata }> = ({ entity }) => (
  <Layout title={getEntityTitle(entity)}>
    <div class="page-header">
      <a href="/entities" class="back-link">
        ← Entities
      </a>
      <h1>{getEntityTitle(entity)}</h1>
    </div>

    <section class="entity-detail">
      <dl class="entity-fields">
        <dt>ID</dt>
        <dd>{entity.id}</dd>

        <dt>Source ID</dt>
        <dd>{entity.source_id}</dd>

        <dt>Created</dt>
        <dd>{formatDate(entity.created_at)}</dd>

        <dt>Updated</dt>
        <dd>{formatDate(entity.updated_at)}</dd>
      </dl>
    </section>

    <section class="entity-metadata">
      <h2>Metadata</h2>
      <MetadataTable metadata={entity.metadata} />
    </section>
  </Layout>
);
