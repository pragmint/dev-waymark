import type { FC } from 'hono/jsx';
import type { EntityWithMetadata } from '../../schemas/entity';
import { Layout } from '../components/Layout';
import { MetadataTable } from '../components/MetadataTable';
import { getEntityTitle } from '../../domain/entityQueries';

export const EntityDetailPage: FC<{ entity: EntityWithMetadata; lineageHref?: string }> = ({
  entity,
  lineageHref,
}) => (
  <Layout title={getEntityTitle(entity)}>
    <div class="page-header">
      <a href="/entities" class="back-link">
        ← Entities
      </a>
      <h1>{getEntityTitle(entity)}</h1>
      {lineageHref ? (
        <div class="page-header-actions">
          <a class="lineage-action" href={lineageHref}>
            Trace lineage
          </a>
        </div>
      ) : null}
    </div>

    <section class="entity-detail">
      <dl class="entity-fields">
        <dt>ID</dt>
        <dd>{entity.id}</dd>

        <dt>Name</dt>
        <dd>{entity.name}</dd>

        <dt>Type</dt>
        <dd>{entity.type || '—'}</dd>

        <dt>Created at</dt>
        <dd>{entity.created_at}</dd>
      </dl>
    </section>

    <section class="entity-metadata">
      <h2>Metadata</h2>
      <MetadataTable metadata={entity.metadata} />
    </section>
  </Layout>
);
