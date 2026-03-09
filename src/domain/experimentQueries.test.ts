import { describe, test, expect } from 'bun:test';
import {
  compareExperimentsByStatus,
  EXPERIMENT_STATUS_SORT_ORDER,
  CHRONOLOGICAL_STATUSES,
} from './experimentQueries';
import { ExperimentSchema } from '../schemas/experimentSchemas';
import type { Experiment } from '../schemas/experimentSchemas';

function exp(status: Experiment['status'], startDate?: string | null): Experiment {
  return { status, startDate } as Partial<Experiment> as Experiment;
}

describe('EXPERIMENT_STATUS_SORT_ORDER', () => {
  test('covers exactly the set of statuses defined in ExperimentSchema', () => {
    const schemaStatuses = new Set(ExperimentSchema.shape.status.options);
    const orderStatuses = new Set(EXPERIMENT_STATUS_SORT_ORDER);
    expect(orderStatuses).toEqual(schemaStatuses);
  });
});

describe('compareExperimentsByStatus', () => {
  describe('different statuses', () => {
    const statusOrder = EXPERIMENT_STATUS_SORT_ORDER;

    for (let i = 0; i < statusOrder.length - 1; i++) {
      const earlier = statusOrder[i];
      const later = statusOrder[i + 1];

      test(`${earlier} sorts before ${later}`, () => {
        // Arrange
        const a = exp(earlier);
        const b = exp(later);

        // Act
        const result = compareExperimentsByStatus(a, b);

        // Assert
        expect(result).toBeLessThan(0);
      });

      test(`${later} sorts after ${earlier}`, () => {
        // Arrange
        const a = exp(later);
        const b = exp(earlier);

        // Act
        const result = compareExperimentsByStatus(a, b);

        // Assert
        expect(result).toBeGreaterThan(0);
      });
    }
  });

  describe('same status, chronological group (active / blocked / backlog) — older date first', () => {
    const chronologicalStatuses = CHRONOLOGICAL_STATUSES;

    for (const status of chronologicalStatuses) {
      test(`${status}: older startDate sorts before newer startDate`, () => {
        // Arrange — "1.1.2024" is older than "1.6.2024"
        const older = exp(status, '1.1.2024');
        const newer = exp(status, '1.6.2024');

        // Act
        const result = compareExperimentsByStatus(older, newer);

        // Assert
        expect(result).toBeLessThan(0);
      });

      test(`${status}: newer startDate sorts after older startDate`, () => {
        // Arrange
        const older = exp(status, '1.1.2024');
        const newer = exp(status, '1.6.2024');

        // Act
        const result = compareExperimentsByStatus(newer, older);

        // Assert
        expect(result).toBeGreaterThan(0);
      });
    }
  });

  describe('same status, reverse-chronological group (polish / pitch) — newer date first', () => {
    const reverseChronologicalStatuses: Experiment['status'][] = ['polish', 'pitch'];

    for (const status of reverseChronologicalStatuses) {
      test(`${status}: newer startDate sorts before older startDate`, () => {
        // Arrange — "1.6.2024" is newer than "1.1.2024"
        const older = exp(status, '1.1.2024');
        const newer = exp(status, '1.6.2024');

        // Act
        const result = compareExperimentsByStatus(newer, older);

        // Assert
        expect(result).toBeLessThan(0);
      });

      test(`${status}: older startDate sorts after newer startDate`, () => {
        // Arrange
        const older = exp(status, '1.1.2024');
        const newer = exp(status, '1.6.2024');

        // Act
        const result = compareExperimentsByStatus(older, newer);

        // Assert
        expect(result).toBeGreaterThan(0);
      });
    }
  });

  describe('null startDate treated as epoch (timestamp 0)', () => {
    const chronologicalStatuses = CHRONOLOGICAL_STATUSES;

    for (const status of chronologicalStatuses) {
      test(`${status}: null startDate sorts before a real date (chronological group)`, () => {
        // Arrange — null resolves to 0, which is before any positive timestamp
        const noDate = exp(status, null);
        const withDate = exp(status, '1.1.2024');

        // Act
        const result = compareExperimentsByStatus(noDate, withDate);

        // Assert
        expect(result).toBeLessThan(0);
      });

      test(`${status}: undefined startDate sorts before a real date (chronological group)`, () => {
        // Arrange — undefined follows the same null-coalescing path (falsy → 0)
        const noDate = exp(status, undefined);
        const withDate = exp(status, '1.1.2024');

        // Act
        const result = compareExperimentsByStatus(noDate, withDate);

        // Assert
        expect(result).toBeLessThan(0);
      });
    }
  });

  describe('equal status and equal dates — returns 0', () => {
    const allStatuses = EXPERIMENT_STATUS_SORT_ORDER;

    for (const status of allStatuses) {
      test(`${status}: identical startDate returns 0`, () => {
        // Arrange
        const a = exp(status, '15.3.2025');
        const b = exp(status, '15.3.2025');

        // Act
        const result = compareExperimentsByStatus(a, b);

        // Assert
        expect(result).toBe(0);
      });
    }

    test('same status with both startDates null returns 0', () => {
      // Arrange
      const a = exp('active', null);
      const b = exp('active', null);

      // Act
      const result = compareExperimentsByStatus(a, b);

      // Assert
      expect(result).toBe(0);
    });
  });
});
