import { describe, test, expect } from 'bun:test';
import { CapabilitySection } from './CapabilitySection';
import type { Capability } from '../../../domain/capabilityTypes';

const render = (capability: Capability) =>
  (<CapabilitySection capability={capability} />).toString();

describe('CapabilitySection', () => {
  test('renders fallback progress bar when no maturity levels', () => {
    const capability: Capability = {
      id: 'cap-1',
      name: 'CI',
      currentScore: 2,
      trend: 'up',
      teamsTargeting: 1,
    };
    expect(render(capability)).toMatchSnapshot();
  });

  test('renders fallback with justification', () => {
    const capability: Capability = {
      id: 'cap-2',
      name: 'Testing',
      currentScore: 3,
      trend: 'stable',
      teamsTargeting: 0,
      justification: 'Line one\nLine two',
    };
    expect(render(capability)).toMatchSnapshot();
  });

  test('renders single-dimension maturity levels', () => {
    const capability: Capability = {
      id: 'cap-3',
      name: 'Code Review',
      currentScore: 2,
      trend: 'up',
      teamsTargeting: 1,
      maturityLevels: [
        { level: 1, title: 'Ad Hoc', description: 'No formal process' },
        { level: 2, title: 'Repeatable', description: 'Basic process in place' },
        { level: 3, title: 'Defined', description: 'Standardized process' },
        { level: 4, title: 'Optimizing', description: 'Continuous improvement' },
      ],
    };
    expect(render(capability)).toMatchSnapshot();
  });

  test('renders multi-dimension maturity levels with dimension scores', () => {
    const capability: Capability = {
      id: 'cap-4',
      name: 'Test Coverage',
      currentScore: 2.5,
      trend: 'up',
      teamsTargeting: 2,
      dimensionScores: { 'new-code': 3, 'legacy-code': 2 },
      dimensionJustifications: {
        'new-code': 'Good coverage on new code',
        'legacy-code': 'Still catching up',
      },
      maturityLevels: [
        { level: 1, title: 'Minimal', description: 'Little coverage', dimension: 'New Code' },
        { level: 2, title: 'Growing', description: 'Some coverage', dimension: 'New Code' },
        { level: 3, title: 'Solid', description: 'Good coverage', dimension: 'New Code' },
        { level: 4, title: 'Comprehensive', description: 'Full coverage', dimension: 'New Code' },
        { level: 1, title: 'Minimal', description: 'Little coverage', dimension: 'Legacy Code' },
        { level: 2, title: 'Growing', description: 'Some coverage', dimension: 'Legacy Code' },
        { level: 3, title: 'Solid', description: 'Good coverage', dimension: 'Legacy Code' },
        {
          level: 4,
          title: 'Comprehensive',
          description: 'Full coverage',
          dimension: 'Legacy Code',
        },
      ],
    };
    expect(render(capability)).toMatchSnapshot();
  });

  test('renders approaching state for decimal scores', () => {
    const capability: Capability = {
      id: 'cap-5',
      name: 'Deployment',
      currentScore: 2.5,
      trend: 'up',
      teamsTargeting: 1,
      maturityLevels: [
        { level: 1, title: 'Manual', description: 'Manual deploys' },
        { level: 2, title: 'Scripted', description: 'Scripted deploys' },
        { level: 3, title: 'Automated', description: 'Fully automated' },
        { level: 4, title: 'Continuous', description: 'Continuous deployment' },
      ],
    };
    expect(render(capability)).toMatchSnapshot();
  });

  test('renders empty when maturityLevels is empty array', () => {
    const capability: Capability = {
      id: 'cap-6',
      name: 'Empty',
      currentScore: 0,
      trend: 'stable',
      teamsTargeting: 0,
      maturityLevels: [],
    };
    expect(render(capability)).toMatchSnapshot();
  });

  test('renders score 0 fallback correctly', () => {
    const capability: Capability = {
      id: 'cap-7',
      name: 'Not Started',
      currentScore: 0,
      trend: 'stable',
      teamsTargeting: 0,
    };
    expect(render(capability)).toMatchSnapshot();
  });
});
