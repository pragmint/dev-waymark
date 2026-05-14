import { ParquetReader } from '@dsnp/parquetjs';
import { getDb } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { createEntityRepository } from '../src/db/entityRepository';
import { EntitySchema, MetadataSchema } from '../src/schemas/entity';

const db = getDb();
runMigrations(db);
db.exec('DELETE FROM entity_metadata; DELETE FROM entities;');
const repo = createEntityRepository(db);

const dir = new URL('./fixtures', import.meta.url).pathname;

const entityReader = await ParquetReader.openFile(`${dir}/entities.parquet`);
const entityCursor = entityReader.getCursor();
let entityRow: Record<string, unknown> | null;
const entities = [];
while ((entityRow = await entityCursor.next()) !== null) {
  entities.push(EntitySchema.parse(entityRow));
}
await entityReader.close();

const metaReader = await ParquetReader.openFile(`${dir}/entity_metadata.parquet`);
const metaCursor = metaReader.getCursor();
let metaRow: Record<string, unknown> | null;
const allMetadata = [];
while ((metaRow = await metaCursor.next()) !== null) {
  allMetadata.push(MetadataSchema.parse(metaRow));
}
await metaReader.close();

for (const entity of entities) {
  const metadata = allMetadata.filter(m => m.entity_id === entity.id);
  repo.upsert(entity, metadata);
}

console.log(`Seeded ${entities.length} entities with ${allMetadata.length} metadata rows.`);
