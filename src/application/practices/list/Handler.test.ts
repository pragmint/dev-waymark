import { describe, test, expect } from 'bun:test';
import { create } from './Handler';
import type { Practice } from '../Repository';

const practice: Practice = { id: 'p-1', title: 'Test Practice', content: 'content' };

const mockRepo = {
  listAll: async () => [practice],
  getById: async () => null,
};

describe('practices/list Handler', () => {
  test('returns all practices from the repository', async () => {
    const handle = create(mockRepo);
    const result = await handle({});

    expect(result.practices).toHaveLength(1);
    expect(result.practices[0].id).toBe('p-1');
  });

  test('returns empty list when repository is empty', async () => {
    const emptyRepo = { ...mockRepo, listAll: async () => [] };
    const handle = create(emptyRepo);
    const result = await handle({});

    expect(result.practices).toHaveLength(0);
  });
});
