import { describe, test, expect } from 'bun:test';
import { create } from './Handler';
import { NotFoundError } from '../../../domain/errors';
import type { Practice } from '../Repository';

const practice: Practice = { id: 'p-1', title: 'Test Practice', content: 'content' };

const mockRepo = {
  listAll: async () => [practice],
  getById: async (id: string) => (id === 'p-1' ? practice : null),
};

describe('practices/get Handler', () => {
  test('returns the practice when found', async () => {
    const handle = create(mockRepo);
    const result = await handle({ practiceId: 'p-1' });

    expect(result.practice.id).toBe('p-1');
    expect(result.practice.title).toBe('Test Practice');
  });

  test('throws NotFoundError when practice does not exist', async () => {
    const handle = create(mockRepo);

    expect(handle({ practiceId: 'missing' })).rejects.toBeInstanceOf(NotFoundError);
  });
});
