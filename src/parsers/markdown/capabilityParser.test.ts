import { describe, test, expect } from 'bun:test';
import { parseCapabilityMarkdown, CapabilityParseError } from './capabilityParser';

const VALID_MARKDOWN = `# [Job Satisfaction](https://dora.dev/capabilities/job-satisfaction/)

Job Satisfaction refers to the level of contentment employees feel toward their work.

When employees are satisfied, they perform better.

## Nuances

This section outlines common pitfalls teams encounter.

### Lagging Indicator

Changes in job satisfaction often occur after changes in underlying factors.

There is often a lag in metrics.

### Providing Necessary Tools

Employees need the right tools and resources to perform effectively.

## Assessment

Assess how mature your team is in this capability.

Consider the descriptions below.

1. Unfulfilling Work: Employees often feel undervalued and disconnected.
2. Limited Engagement: Employees are somewhat satisfied but lack autonomy.
3. Satisfactory Engagement: Employees are generally content with some room for growth.
4. Exceptional Engagement: Employees are highly motivated and empowered.

The number you selected represents your overall score.

Use a decimal if you feel in between.

## Supporting Practices

The following is a curated list of supporting practices.

### Host Skip-Level 1:1s

Skip-level 1:1s create a direct channel for information flow.

They demonstrate that employee voices are valued.

### [Create a Team Charter](/practices/create-a-team-charter.md)

A team charter improves job satisfaction by making purpose and expectations explicit.

## Adjacent Capabilities

The following capabilities will be valuable for you and your team to explore, as they are either:

- Related (they cover similar territory to Job Satisfaction)
- Upstream (they are a pre-requisite for Job Satisfaction)
- Downstream (Job Satisfaction is a pre-requisite for them)

### [Generative Organizational Culture](/capabilities/generative-organizational-culture.md) - Upstream

A generative culture emphasizes collaboration and trust.

### [Well-being](/capabilities/well-being.md) - Related

Well-being focuses on physical and mental health.

### [Team Performance](/capabilities/team-performance.md) - Downstream

Team performance is driven by satisfied employees.
`;

describe('parseCapabilityMarkdown', () => {
  test('parses a valid document', () => {
    const result = parseCapabilityMarkdown(VALID_MARKDOWN);

    expect(result.title).toBe('Job Satisfaction');
    expect(result.doraLink).toBe('https://dora.dev/capabilities/job-satisfaction/');
    expect(result.introduction).toBe(
      'Job Satisfaction refers to the level of contentment employees feel toward their work.\n' +
        'When employees are satisfied, they perform better.'
    );
  });

  test('parses nuances correctly', () => {
    const result = parseCapabilityMarkdown(VALID_MARKDOWN);

    expect(result.nuances.introduction).toBe(
      'This section outlines common pitfalls teams encounter.'
    );
    expect(result.nuances.items).toHaveLength(2);
    expect(result.nuances.items[0]).toEqual({
      title: 'Lagging Indicator',
      content:
        'Changes in job satisfaction often occur after changes in underlying factors.\n' +
        'There is often a lag in metrics.',
    });
    expect(result.nuances.items[1]).toEqual({
      title: 'Providing Necessary Tools',
      content: 'Employees need the right tools and resources to perform effectively.',
    });
  });

  test('parses assessment ratings correctly', () => {
    const result = parseCapabilityMarkdown(VALID_MARKDOWN);

    expect(result.assessment.intro).toBe(
      'Assess how mature your team is in this capability.\nConsider the descriptions below.'
    );
    expect(result.assessment.outro).toBe(
      'The number you selected represents your overall score.\n' +
        'Use a decimal if you feel in between.'
    );
    expect(result.assessment.ratings).toHaveLength(4);
    expect(result.assessment.ratings[0]).toEqual({
      rating: 1,
      title: 'Unfulfilling Work',
      description: 'Employees often feel undervalued and disconnected.',
    });
    expect(result.assessment.ratings[3]).toEqual({
      rating: 4,
      title: 'Exceptional Engagement',
      description: 'Employees are highly motivated and empowered.',
    });
  });

  test('parses simple assessment without dimensions', () => {
    const result = parseCapabilityMarkdown(VALID_MARKDOWN);

    // Verify that ratings in simple format don't have dimension property set
    for (const rating of result.assessment.ratings) {
      expect(rating.dimension).toBeUndefined();
    }
  });

  test('parses multi-dimensional assessment correctly', () => {
    const markdown = `# [Code Maintainability](https://dora.dev/capabilities/code-maintainability/)

Introduction text.

## Nuances

Nuance intro.

### Nuance One

Nuance content.

## Assessment

Assessment intro text before dimensions.

### New Code

1. **Growing Tech Debt:** Code is rarely refactored.
2. **Occasional Maintenance:** Teams sometimes prioritize delivery.
3. **Reactive Maintenance:** Code is maintained as problems arise.
4. **Proactive Maintenance:** Teams proactively refactor the codebase.

### Previously Written Code

1. **Brittle Codebase:** Changing any code is time-consuming.
2. **Fairly Complex Codebase:** Most changes require significant refactoring.
3. **Partially Modular Codebase:** Most parts are modular and easy to update.
4. **Well-organized Codebase:** Changes don't require much rework.

Assessment outro text after dimensions.

## Supporting Practices

Practices intro.

### Practice One

Practice description.

## Adjacent Capabilities

The following capabilities will be valuable for you and your team to explore, as they are either:

- Related (they cover similar territory to Code Maintainability)
- Upstream (they are a pre-requisite for Code Maintainability)
- Downstream (Code Maintainability is a pre-requisite for them)

### [Testing](/capabilities/testing.md) - Upstream

Testing description.
`;

    const result = parseCapabilityMarkdown(markdown);

    expect(result.assessment.intro).toBe('Assessment intro text before dimensions.');
    expect(result.assessment.outro).toBe('Assessment outro text after dimensions.');
    expect(result.assessment.ratings).toHaveLength(8);

    // Verify first dimension's ratings
    expect(result.assessment.ratings[0]).toEqual({
      rating: 1,
      title: 'Growing Tech Debt',
      description: 'Code is rarely refactored.',
      dimension: 'New Code',
    });
    expect(result.assessment.ratings[1]).toEqual({
      rating: 2,
      title: 'Occasional Maintenance',
      description: 'Teams sometimes prioritize delivery.',
      dimension: 'New Code',
    });
    expect(result.assessment.ratings[2]).toEqual({
      rating: 3,
      title: 'Reactive Maintenance',
      description: 'Code is maintained as problems arise.',
      dimension: 'New Code',
    });
    expect(result.assessment.ratings[3]).toEqual({
      rating: 4,
      title: 'Proactive Maintenance',
      description: 'Teams proactively refactor the codebase.',
      dimension: 'New Code',
    });

    // Verify second dimension's ratings
    expect(result.assessment.ratings[4]).toEqual({
      rating: 1,
      title: 'Brittle Codebase',
      description: 'Changing any code is time-consuming.',
      dimension: 'Previously Written Code',
    });
    expect(result.assessment.ratings[5]).toEqual({
      rating: 2,
      title: 'Fairly Complex Codebase',
      description: 'Most changes require significant refactoring.',
      dimension: 'Previously Written Code',
    });
    expect(result.assessment.ratings[6]).toEqual({
      rating: 3,
      title: 'Partially Modular Codebase',
      description: 'Most parts are modular and easy to update.',
      dimension: 'Previously Written Code',
    });
    expect(result.assessment.ratings[7]).toEqual({
      rating: 4,
      title: 'Well-organized Codebase',
      description: "Changes don't require much rework.",
      dimension: 'Previously Written Code',
    });
  });

  test('parses supporting practices with and without links', () => {
    const result = parseCapabilityMarkdown(VALID_MARKDOWN);

    expect(result.supporting_practices.intro).toBe(
      'The following is a curated list of supporting practices.'
    );
    expect(result.supporting_practices.practices).toHaveLength(2);
    expect(result.supporting_practices.practices[0]).toEqual({
      id: null,
      title: 'Host Skip-Level 1:1s',
      description:
        'Skip-level 1:1s create a direct channel for information flow.\n' +
        'They demonstrate that employee voices are valued.',
    });
    expect(result.supporting_practices.practices[1]).toEqual({
      id: 'create-a-team-charter',
      title: 'Create a Team Charter',
      description:
        'A team charter improves job satisfaction by making purpose and expectations explicit.',
    });
  });

  test('parses adjacent capabilities with relationship types', () => {
    const result = parseCapabilityMarkdown(VALID_MARKDOWN);

    expect(result.linked_capabilities).toHaveLength(3);
    expect(result.linked_capabilities[0]).toEqual({
      id: 'generative-organizational-culture',
      title: 'Generative Organizational Culture',
      relationship: 'upstream',
      description: 'A generative culture emphasizes collaboration and trust.',
    });
    expect(result.linked_capabilities[1]).toEqual({
      id: 'well-being',
      title: 'Well-being',
      relationship: 'related',
      description: 'Well-being focuses on physical and mental health.',
    });
    expect(result.linked_capabilities[2]).toEqual({
      id: 'team-performance',
      title: 'Team Performance',
      relationship: 'downstream',
      description: 'Team performance is driven by satisfied employees.',
    });
  });
});

describe('HTML comment detection', () => {
  test('throws on HTML comments', () => {
    const markdown = `# [Title](https://dora.dev/capabilities/title/)

Introduction.

<!-- this is a comment -->

## Nuances

Intro.
`;
    expect(() => parseCapabilityMarkdown(markdown)).toThrow(CapabilityParseError);
    expect(() => parseCapabilityMarkdown(markdown)).toThrow('HTML comments are not allowed');
  });

  test('includes line number in HTML comment error', () => {
    const markdown = `# [Title](https://dora.dev/capabilities/title/)

Introduction.

<!-- comment -->
`;
    try {
      parseCapabilityMarkdown(markdown);
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(CapabilityParseError);
      expect((e as CapabilityParseError).message).toContain('line 5');
    }
  });
});

describe('header parsing errors', () => {
  test('throws on missing H1 heading', () => {
    const markdown = `No heading here

## Nuances
`;
    expect(() => parseCapabilityMarkdown(markdown)).toThrow('[Header]');
  });

  test('throws on H1 without link format', () => {
    const markdown = `# Just a Title

Introduction.

## Nuances
`;
    expect(() => parseCapabilityMarkdown(markdown)).toThrow('[Header]');
  });

  test('throws when no H2 sections exist', () => {
    const markdown = `# [Title](https://dora.dev/capabilities/title/)

Introduction only, no sections.
`;
    expect(() => parseCapabilityMarkdown(markdown)).toThrow('[Document]');
  });

  test('throws when introduction text is missing', () => {
    const markdown = `# [Title](https://dora.dev/capabilities/title/)
## Nuances

Intro.
`;
    expect(() => parseCapabilityMarkdown(markdown)).toThrow('[Introduction]');
  });
});

describe('missing required sections', () => {
  test('throws when Nuances section is missing', () => {
    const markdown = `# [Title](https://dora.dev/capabilities/title/)

Introduction.

## Assessment

Intro.

1. Low: Description.
2. Medium: Description.
3. High: Description.
4. Expert: Description.

Outro.
`;
    expect(() => parseCapabilityMarkdown(markdown)).toThrow('Missing required section: ## Nuances');
  });

  test('throws when Assessment section is missing', () => {
    const markdown = `# [Title](https://dora.dev/capabilities/title/)

Introduction.

## Nuances

Intro.

### A Nuance

Content.
`;
    expect(() => parseCapabilityMarkdown(markdown)).toThrow(
      'Missing required section: ## Assessment'
    );
  });
});

describe('nuances parsing errors', () => {
  test('throws when nuances has no introduction', () => {
    const markdown = VALID_MARKDOWN.replace(
      '## Nuances\n\nThis section outlines common pitfalls teams encounter.\n\n### Lagging',
      '## Nuances\n\n### Lagging'
    );
    expect(() => parseCapabilityMarkdown(markdown)).toThrow('[Nuances] Expected introduction text');
  });

  test('throws when nuances has no H3 items', () => {
    const markdown = VALID_MARKDOWN.replace(/### Lagging Indicator[\s\S]*?(?=## Assessment)/, '');
    expect(() => parseCapabilityMarkdown(markdown)).toThrow(
      '[Nuances] Expected at least one nuance'
    );
  });
});

describe('assessment parsing errors', () => {
  test('throws when no numbered list is found', () => {
    const markdown = VALID_MARKDOWN.replace(
      /1\. Unfulfilling.*\n2\. Limited.*\n3\. Satisfactory.*\n4\. Exceptional.*/,
      'No ratings here.'
    );
    expect(() => parseCapabilityMarkdown(markdown)).toThrow(
      'Expected numbered rating list starting with "1."'
    );
  });

  test('throws when assessment has no intro before ratings', () => {
    const markdown = VALID_MARKDOWN.replace(
      '## Assessment\n\nAssess how mature your team is in this capability.\n\nConsider the descriptions below.\n\n1.',
      '## Assessment\n\n1.'
    );
    expect(() => parseCapabilityMarkdown(markdown)).toThrow(
      'Expected introduction text before ratings'
    );
  });

  test('throws when assessment has no outro after ratings', () => {
    const markdown = VALID_MARKDOWN.replace(
      '4. Exceptional Engagement: Employees are highly motivated and empowered.\n\nThe number you selected represents your overall score.\n\nUse a decimal if you feel in between.\n\n## Supporting',
      '4. Exceptional Engagement: Employees are highly motivated and empowered.\n\n## Supporting'
    );
    expect(() => parseCapabilityMarkdown(markdown)).toThrow('Expected text after ratings');
  });

  test('throws on non-sequential rating numbers', () => {
    const markdown = VALID_MARKDOWN.replace(
      '1. Unfulfilling Work: Employees often feel undervalued and disconnected.\n2. Limited Engagement: Employees are somewhat satisfied but lack autonomy.\n3. Satisfactory Engagement: Employees are generally content with some room for growth.\n4. Exceptional Engagement: Employees are highly motivated and empowered.',
      '1. Unfulfilling Work: Employees often feel undervalued and disconnected.\n3. Limited Engagement: Employees are somewhat satisfied but lack autonomy.\n3. Satisfactory Engagement: Employees are generally content with some room for growth.\n4. Exceptional Engagement: Employees are highly motivated and empowered.'
    );
    expect(() => parseCapabilityMarkdown(markdown)).toThrow('Expected rating 2 but found 3');
  });

  test('throws when multi-dimensional assessment has no intro', () => {
    const markdown = `# [Title](https://dora.dev/capabilities/title/)

Intro.

## Nuances

Nuance intro.

### Nuance

Content.

## Assessment

### Dimension One

1. **Low:** Description.
2. **Medium:** Description.
3. **High:** Description.
4. **Expert:** Description.

Outro text.

## Supporting Practices

Practices intro.

### Practice

Description.

## Adjacent Capabilities

The following capabilities will be valuable for you and your team to explore, as they are either:

- Related (they cover similar territory to Title)
- Upstream (they are a pre-requisite for Title)
- Downstream (Title is a pre-requisite for them)

### [Cap](/capabilities/cap.md) - Related

Description.
`;
    expect(() => parseCapabilityMarkdown(markdown)).toThrow(
      'Expected introduction text before dimensions'
    );
  });

  test('throws when multi-dimensional assessment has no outro', () => {
    const markdown = `# [Title](https://dora.dev/capabilities/title/)

Intro.

## Nuances

Nuance intro.

### Nuance

Content.

## Assessment

Intro text.

### Dimension One

1. **Low:** Description.
2. **Medium:** Description.
3. **High:** Description.
4. **Expert:** Description.

## Supporting Practices

Practices intro.

### Practice

Description.

## Adjacent Capabilities

The following capabilities will be valuable for you and your team to explore, as they are either:

- Related (they cover similar territory to Title)
- Upstream (they are a pre-requisite for Title)
- Downstream (Title is a pre-requisite for them)

### [Cap](/capabilities/cap.md) - Related

Description.
`;
    expect(() => parseCapabilityMarkdown(markdown)).toThrow('Expected text after dimensions');
  });

  test('throws when dimension has no numbered list', () => {
    const markdown = `# [Title](https://dora.dev/capabilities/title/)

Intro.

## Nuances

Nuance intro.

### Nuance

Content.

## Assessment

Intro text.

### Dimension One

No ratings here.

### Dimension Two

1. **Low:** Description.
2. **Medium:** Description.
3. **High:** Description.
4. **Expert:** Description.

Outro text.

## Supporting Practices

Practices intro.

### Practice

Description.

## Adjacent Capabilities

The following capabilities will be valuable for you and your team to explore, as they are either:

- Related (they cover similar territory to Title)
- Upstream (they are a pre-requisite for Title)
- Downstream (Title is a pre-requisite for them)

### [Cap](/capabilities/cap.md) - Related

Description.
`;
    expect(() => parseCapabilityMarkdown(markdown)).toThrow(
      'Expected numbered rating list in dimension "Dimension One"'
    );
  });
});

describe('supporting practices parsing', () => {
  test('throws when no practices intro exists', () => {
    const markdown = VALID_MARKDOWN.replace(
      '## Supporting Practices\n\nThe following is a curated list of supporting practices.\n\n### Host',
      '## Supporting Practices\n\n### Host'
    );
    expect(() => parseCapabilityMarkdown(markdown)).toThrow(
      '[Supporting Practices] Expected introduction text'
    );
  });
});

describe('adjacent capabilities bullet-list format', () => {
  const BULLET_LIST_MARKDOWN = `# [Continuous Delivery](https://dora.dev/capabilities/continuous-delivery/)

Introduction to continuous delivery.

## Nuances

Nuance intro.

### A Nuance

Nuance content.

## Assessment

Assessment intro.

1. Low: Level one.
2. Medium: Level two.
3. High: Level three.
4. Expert: Level four.

Assessment outro.

## Supporting Practices

Practices intro.

### A Practice

Practice description.

## Adjacent Capabilities

These capabilities are pre-requisites for Continuous Delivery:

- [Code Maintainability](/capabilities/code-maintainability.md) ensures a clean codebase.
- [Continuous Integration](/capabilities/continuous-integration.md) integrates code changes regularly.
`;

  test('parses bullet-list adjacent capabilities as upstream', () => {
    const result = parseCapabilityMarkdown(BULLET_LIST_MARKDOWN);

    expect(result.linked_capabilities).toHaveLength(2);
    expect(result.linked_capabilities[0]).toEqual({
      id: 'code-maintainability',
      title: 'Code Maintainability',
      relationship: 'upstream',
      description: 'ensures a clean codebase.',
    });
    expect(result.linked_capabilities[1]).toEqual({
      id: 'continuous-integration',
      title: 'Continuous Integration',
      relationship: 'upstream',
      description: 'integrates code changes regularly.',
    });
  });

  test('throws when bullet-list has no matching items', () => {
    const markdown = BULLET_LIST_MARKDOWN.replace(
      /- \[Code Maintainability].*\n- \[Continuous Integration].*/,
      'No capabilities listed here.'
    );
    expect(() => parseCapabilityMarkdown(markdown)).toThrow(
      '[Adjacent Capabilities] Expected at least one capability (### heading or bullet list)'
    );
  });
});

describe('adjacent capabilities parsing', () => {
  test('throws on invalid heading format', () => {
    const markdown = VALID_MARKDOWN.replace(
      '### [Generative Organizational Culture](/capabilities/generative-organizational-culture.md) - Upstream',
      '### Generative Organizational Culture - Upstream'
    );
    expect(() => parseCapabilityMarkdown(markdown)).toThrow(
      '[Adjacent Capabilities] Invalid heading format'
    );
  });

  test('throws on missing relationship type', () => {
    const markdown = VALID_MARKDOWN.replace(
      '### [Generative Organizational Culture](/capabilities/generative-organizational-culture.md) - Upstream',
      '### [Generative Organizational Culture](/capabilities/generative-organizational-culture.md)'
    );
    expect(() => parseCapabilityMarkdown(markdown)).toThrow(
      '[Adjacent Capabilities] Invalid heading format'
    );
  });

  test('throws when adjacent capabilities intro omits relationship types', () => {
    const markdown = VALID_MARKDOWN.replace(
      'The following capabilities will be valuable for you and your team to explore, as they are either:\n\n' +
        '- Related (they cover similar territory to Job Satisfaction)\n' +
        '- Upstream (they are a pre-requisite for Job Satisfaction)\n' +
        '- Downstream (Job Satisfaction is a pre-requisite for them)',
      'These are some capabilities you may find useful.'
    );
    expect(() => parseCapabilityMarkdown(markdown)).toThrow(
      '[Adjacent Capabilities] Introduction must mention all three relationship types: Related, Upstream, Downstream'
    );
  });

  test('throws a specific error when the intro structure matches but the title differs', () => {
    const markdown = VALID_MARKDOWN.replace(
      '- Related (they cover similar territory to Job Satisfaction)\n' +
        '- Upstream (they are a pre-requisite for Job Satisfaction)\n' +
        '- Downstream (Job Satisfaction is a pre-requisite for them)',
      '- Related (they cover similar territory to Job satisfaction)\n' +
        '- Upstream (they are a pre-requisite for Job satisfaction)\n' +
        '- Downstream (Job satisfaction is a pre-requisite for them)'
    );
    expect(() => parseCapabilityMarkdown(markdown)).toThrow(
      '[Adjacent Capabilities] Introduction uses "Job satisfaction" but the document title is "Job Satisfaction"'
    );
  });
});

describe('adjacent capabilities intro validation resilience', () => {
  test('accepts alternate wording as long as all three relationship types and title are present', () => {
    const markdown = VALID_MARKDOWN.replace(
      'The following capabilities will be valuable for you and your team to explore, as they are either:\n\n' +
        '- Related (they cover similar territory to Job Satisfaction)\n' +
        '- Upstream (they are a pre-requisite for Job Satisfaction)\n' +
        '- Downstream (Job Satisfaction is a pre-requisite for them)',
      'These capabilities are related to Job Satisfaction:\n\n' +
        '- Related: overlaps with this capability\n' +
        '- Upstream: a pre-requisite\n' +
        '- Downstream: depends on this capability'
    );
    expect(() => parseCapabilityMarkdown(markdown)).not.toThrow();
  });

  test('throws when intro omits one relationship type', () => {
    const markdown = VALID_MARKDOWN.replace(
      'The following capabilities will be valuable for you and your team to explore, as they are either:\n\n' +
        '- Related (they cover similar territory to Job Satisfaction)\n' +
        '- Upstream (they are a pre-requisite for Job Satisfaction)\n' +
        '- Downstream (Job Satisfaction is a pre-requisite for them)',
      'These capabilities are Related or Upstream to Job Satisfaction.'
    );
    expect(() => parseCapabilityMarkdown(markdown)).toThrow(
      '[Adjacent Capabilities] Introduction must mention all three relationship types'
    );
  });

  test('throws with title-mismatch error when structure is valid but title is wrong', () => {
    const markdown = VALID_MARKDOWN.replace(
      '- Related (they cover similar territory to Job Satisfaction)\n' +
        '- Upstream (they are a pre-requisite for Job Satisfaction)\n' +
        '- Downstream (Job Satisfaction is a pre-requisite for them)',
      '- Related (they cover similar territory to Wrong Title)\n' +
        '- Upstream (they are a pre-requisite for Wrong Title)\n' +
        '- Downstream (Wrong Title is a pre-requisite for them)'
    );
    expect(() => parseCapabilityMarkdown(markdown)).toThrow(
      '[Adjacent Capabilities] Introduction uses "Wrong Title" but the document title is "Job Satisfaction"'
    );
  });
});

describe('rating line parsing', () => {
  test('parses ratings with bold title markers', () => {
    const markdown = VALID_MARKDOWN.replace(
      '1. Unfulfilling Work: Employees often feel undervalued and disconnected.\n' +
        '2. Limited Engagement: Employees are somewhat satisfied but lack autonomy.\n' +
        '3. Satisfactory Engagement: Employees are generally content with some room for growth.\n' +
        '4. Exceptional Engagement: Employees are highly motivated and empowered.',
      '1. **Unfulfilling Work:** Employees often feel undervalued and disconnected.\n' +
        '2. **Limited Engagement:** Employees are somewhat satisfied but lack autonomy.\n' +
        '3. **Satisfactory Engagement:** Employees are generally content with some room for growth.\n' +
        '4. **Exceptional Engagement:** Employees are highly motivated and empowered.'
    );
    const result = parseCapabilityMarkdown(markdown);
    expect(result.assessment.ratings[0]).toEqual({
      rating: 1,
      title: 'Unfulfilling Work',
      description: 'Employees often feel undervalued and disconnected.',
    });
  });

  test('throws on invalid rating line format with clear message', () => {
    const markdown = VALID_MARKDOWN.replace(
      '1. Unfulfilling Work: Employees often feel undervalued and disconnected.',
      '1. Unfulfilling Work — Employees often feel undervalued and disconnected.'
    );
    expect(() => parseCapabilityMarkdown(markdown)).toThrow('[Assessment] Invalid rating format');
  });

  test('multi-dimensional assessment uses same rating line parsing', () => {
    const markdown = `# [Title](https://dora.dev/capabilities/title/)

Intro.

## Nuances

Nuance intro.

### A Nuance

Content.

## Assessment

Intro text.

### Dimension One

1. **Low:** Description one.
2. **Medium:** Description two.
3. **High:** Description three.
4. **Expert:** Description four.

Outro text.

## Supporting Practices

Practice intro.

### A Practice

Description.

## Adjacent Capabilities

The following capabilities will be valuable for you and your team to explore, as they are either:

- Related (they cover similar territory to Title)
- Upstream (they are a pre-requisite for Title)
- Downstream (Title is a pre-requisite for them)

### [Cap](/capabilities/cap.md) - Related

Description.
`;
    const result = parseCapabilityMarkdown(markdown);
    expect(result.assessment.ratings[0]).toEqual({
      rating: 1,
      title: 'Low',
      description: 'Description one.',
      dimension: 'Dimension One',
    });
  });

  test('multi-dimensional invalid rating line includes dimension name in error', () => {
    const markdown = `# [Title](https://dora.dev/capabilities/title/)

Intro.

## Nuances

Nuance intro.

### A Nuance

Content.

## Assessment

Intro text.

### My Dimension

1. Low — bad format here.
2. Medium: Description two.
3. High: Description three.
4. Expert: Description four.

Outro text.

## Supporting Practices

Practice intro.

### A Practice

Description.

## Adjacent Capabilities

The following capabilities will be valuable for you and your team to explore, as they are either:

- Related (they cover similar territory to Title)
- Upstream (they are a pre-requisite for Title)
- Downstream (Title is a pre-requisite for them)

### [Cap](/capabilities/cap.md) - Related

Description.
`;
    expect(() => parseCapabilityMarkdown(markdown)).toThrow(
      '[Assessment] Invalid rating format in dimension "My Dimension"'
    );
  });
});

describe('paragraph collapsing', () => {
  test('collapses double newlines into single newlines', () => {
    const result = parseCapabilityMarkdown(VALID_MARKDOWN);

    expect(result.introduction).toBe(
      'Job Satisfaction refers to the level of contentment employees feel toward their work.\n' +
        'When employees are satisfied, they perform better.'
    );
    expect(result.introduction).not.toContain('\n\n');
  });

  test('handles single paragraph without extra newlines', () => {
    const result = parseCapabilityMarkdown(VALID_MARKDOWN);

    expect(result.nuances.introduction).toBe(
      'This section outlines common pitfalls teams encounter.'
    );
  });
});

describe('real-world parsing', () => {
  test('parses a document with many nuances', () => {
    const markdown = `# [Code Quality](https://dora.dev/capabilities/code-quality/)

Introduction to code quality.

## Nuances

Understanding nuances is important.

### Nuance One

Content one.

### Nuance Two

Content two.

### Nuance Three

Content three.

### Nuance Four

Content four.

### Nuance Five

Content five.

## Assessment

Assessment intro.

1. Poor: Rarely reviewed.
2. Basic: Sometimes reviewed.
3. Good: Regularly reviewed.
4. Excellent: Always reviewed.

Assessment outro.

## Supporting Practices

Practices intro.

### Practice A

Practice A description.

## Adjacent Capabilities

The following capabilities will be valuable for you and your team to explore, as they are either:

- Related (they cover similar territory to Code Quality)
- Upstream (they are a pre-requisite for Code Quality)
- Downstream (Code Quality is a pre-requisite for them)

### [Testing](/capabilities/testing.md) - Upstream

Testing description.
`;

    const result = parseCapabilityMarkdown(markdown);
    expect(result.nuances.items).toHaveLength(5);
    expect(result.nuances.items[4].title).toBe('Nuance Five');
  });

  test('handles all supporting practices with links', () => {
    const markdown = `# [Test Cap](https://dora.dev/capabilities/test-cap/)

Introduction.

## Nuances

Nuance intro.

### A Nuance

Nuance content.

## Assessment

Assessment intro.

1. Low: Level one.
2. Medium: Level two.
3. High: Level three.
4. Expert: Level four.

Assessment outro.

## Supporting Practices

Practices intro.

### [Practice A](/practices/practice-a.md)

Description A.

### [Practice B](/practices/practice-b.md)

Description B.

## Adjacent Capabilities

The following capabilities will be valuable for you and your team to explore, as they are either:

- Related (they cover similar territory to Test Cap)
- Upstream (they are a pre-requisite for Test Cap)
- Downstream (Test Cap is a pre-requisite for them)

### [Cap A](/capabilities/cap-a.md) - Related

Description A.
`;

    const result = parseCapabilityMarkdown(markdown);
    expect(result.supporting_practices.practices).toHaveLength(2);
    expect(result.supporting_practices.practices[0].id).toBe('practice-a');
    expect(result.supporting_practices.practices[1].id).toBe('practice-b');
  });

  test('parses multiple paragraphs in nuance items', () => {
    const result = parseCapabilityMarkdown(VALID_MARKDOWN);

    expect(result.nuances.items[0].content).toBe(
      'Changes in job satisfaction often occur after changes in underlying factors.\n' +
        'There is often a lag in metrics.'
    );
  });

  test('parses multiple paragraphs in linked capability descriptions', () => {
    const markdown = `# [Cap](https://dora.dev/capabilities/cap/)

Intro.

## Nuances

Nuance intro.

### A Nuance

Content.

## Assessment

Assessment intro.

1. Low: One.
2. Medium: Two.
3. High: Three.
4. Expert: Four.

Outro.

## Supporting Practices

Practice intro.

### A Practice

Description.

## Adjacent Capabilities

The following capabilities will be valuable for you and your team to explore, as they are either:

- Related (they cover similar territory to Cap)
- Upstream (they are a pre-requisite for Cap)
- Downstream (Cap is a pre-requisite for them)

### [Other Cap](/capabilities/other-cap.md) - Upstream

First paragraph of description.

Second paragraph of description.
`;

    const result = parseCapabilityMarkdown(markdown);
    expect(result.linked_capabilities[0].description).toBe(
      'First paragraph of description.\nSecond paragraph of description.'
    );
  });
});
