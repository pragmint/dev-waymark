import { z } from 'zod';

// --- Schemas ---

const CapabilityRelationshipSchema = z.enum(['upstream', 'downstream', 'related']);
type CapabilityRelationship = z.infer<typeof CapabilityRelationshipSchema>;

const NuanceItemSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
});

const AssessmentRatingSchema = z.object({
  rating: z.number().min(1).max(4),
  title: z.string().min(1),
  description: z.string().min(1),
});

const SupportingPracticeSchema = z.object({
  id: z.string().nullable(),
  title: z.string().min(1),
  description: z.string().min(1),
});

const LinkedCapabilitySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  relationship: CapabilityRelationshipSchema,
  description: z.string().min(1),
});

export const ParsedCapabilitySchema = z.object({
  title: z.string().min(1),
  doraLink: z.url(),
  introduction: z.string().min(1),
  nuances: z.object({
    introduction: z.string().min(1),
    items: z.array(NuanceItemSchema).min(1).max(10),
  }),
  assessment: z.object({
    intro: z.string().min(1),
    outro: z.string().min(1),
    ratings: z.array(AssessmentRatingSchema).length(4),
  }),
  supporting_practices: z.object({
    intro: z.string().min(1),
    practices: z.array(SupportingPracticeSchema).min(1),
  }),
  linked_capabilities: z.array(LinkedCapabilitySchema).min(1),
});

export type ParsedCapability = z.infer<typeof ParsedCapabilitySchema>;

// --- Error ---

export class CapabilityParseError extends Error {
  constructor(message: string, section?: string) {
    const prefix = section ? `[${section}] ` : '';
    super(`${prefix}${message}`);
    this.name = 'CapabilityParseError';
  }
}

// --- Helpers ---

function collapseParagraphs(text: string): string {
  return text
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(Boolean)
    .join('\n');
}

interface H3Section {
  heading: string;
  content: string;
}

function splitIntoH2Sections(content: string): Map<string, string> {
  const sections = new Map<string, string>();
  const h2Regex = /^## (.+)$/gm;
  const matches = Array.from(content.matchAll(h2Regex));

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const sectionName = match[1].trim();
    const startIndex = match.index + match[0].length;
    const endIndex = matches[i + 1]?.index ?? content.length;
    sections.set(sectionName, content.substring(startIndex, endIndex).trim());
  }

  return sections;
}

function splitIntoH3Sections(content: string): { intro: string; items: H3Section[] } {
  const h3Regex = /^### (.+)$/gm;
  const matches = Array.from(content.matchAll(h3Regex));

  const firstH3Index = matches[0]?.index ?? content.length;
  const intro = content.substring(0, firstH3Index).trim();

  const items: H3Section[] = [];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const heading = match[1].trim();
    const startIndex = match.index + match[0].length;
    const endIndex = matches[i + 1]?.index ?? content.length;
    items.push({ heading, content: content.substring(startIndex, endIndex).trim() });
  }

  return { intro, items };
}

// --- Section Parsers ---

function parseNuances(content: string) {
  const { intro, items } = splitIntoH3Sections(content);
  if (!intro) {
    throw new CapabilityParseError('Expected introduction text', 'Nuances');
  }
  if (items.length === 0) {
    throw new CapabilityParseError('Expected at least one nuance (### heading)', 'Nuances');
  }

  return {
    introduction: collapseParagraphs(intro),
    items: items.map(item => ({
      title: item.heading,
      content: collapseParagraphs(item.content),
    })),
  };
}

function parseAssessment(content: string) {
  const blocks = content
    .split(/\n\n+/)
    .map(b => b.trim())
    .filter(Boolean);

  const listBlockIndex = blocks.findIndex(b => /^1\.\s+/.test(b));
  if (listBlockIndex === -1) {
    throw new CapabilityParseError(
      'Expected numbered rating list starting with "1."',
      'Assessment'
    );
  }

  const introBlocks = blocks.slice(0, listBlockIndex);
  const outroBlocks = blocks.slice(listBlockIndex + 1);
  const listBlock = blocks[listBlockIndex];

  if (introBlocks.length === 0) {
    throw new CapabilityParseError('Expected introduction text before ratings', 'Assessment');
  }
  if (outroBlocks.length === 0) {
    throw new CapabilityParseError('Expected text after ratings', 'Assessment');
  }

  const ratingLines = listBlock
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  const ratings = ratingLines.map(line => {
    const match = line.match(/^(\d+)\.\s+(.+?):\s+(.+)$/);
    if (!match) {
      throw new CapabilityParseError(`Invalid rating format: "${line}"`, 'Assessment');
    }
    return {
      rating: parseInt(match[1], 10),
      title: match[2].trim(),
      description: match[3].trim(),
    };
  });

  for (let i = 0; i < ratings.length; i++) {
    if (ratings[i].rating !== i + 1) {
      throw new CapabilityParseError(
        `Expected rating ${i + 1} but found ${ratings[i].rating}`,
        'Assessment'
      );
    }
  }

  return {
    intro: introBlocks.join('\n'),
    outro: outroBlocks.join('\n'),
    ratings,
  };
}

function parseSupportingPractices(content: string) {
  const { intro, items } = splitIntoH3Sections(content);
  if (!intro) {
    throw new CapabilityParseError('Expected introduction text', 'Supporting Practices');
  }
  if (items.length === 0) {
    throw new CapabilityParseError(
      'Expected at least one practice (### heading)',
      'Supporting Practices'
    );
  }

  const practices = items.map(item => {
    const linkMatch = item.heading.match(/^\[(.+?)]\(\/practices\/(.+?)\.md\)$/);
    if (linkMatch) {
      return {
        id: linkMatch[2],
        title: linkMatch[1],
        description: collapseParagraphs(item.content),
      };
    }
    return {
      id: null,
      title: item.heading,
      description: collapseParagraphs(item.content),
    };
  });

  return {
    intro: collapseParagraphs(intro),
    practices,
  };
}

function parseAdjacentCapabilities(content: string, capabilityTitle: string) {
  const { intro, items } = splitIntoH3Sections(content);

  validateAdjacentIntro(intro, capabilityTitle);

  if (items.length === 0) {
    throw new CapabilityParseError(
      'Expected at least one capability (### heading)',
      'Adjacent Capabilities'
    );
  }

  return items.map(item => {
    const linkMatch = item.heading.match(
      /^\[(.+?)]\(\/capabilities\/(.+?)\.md\)\s+-\s+(Upstream|Downstream|Related)$/
    );
    if (!linkMatch) {
      throw new CapabilityParseError(
        `Invalid heading format: "${item.heading}". ` +
          'Expected: [Title](/capabilities/id.md) - Upstream|Downstream|Related',
        'Adjacent Capabilities'
      );
    }
    return {
      id: linkMatch[2],
      title: linkMatch[1],
      relationship: linkMatch[3].toLowerCase() as CapabilityRelationship,
      description: collapseParagraphs(item.content),
    };
  });
}

function validateAdjacentIntro(intro: string, capabilityTitle: string): void {
  const expectedLines = [
    'The following capabilities will be valuable for you and your team to explore, as they are either:',
    '',
    `- Related (they cover similar territory to ${capabilityTitle})`,
    `- Upstream (they are a pre-requisite for ${capabilityTitle})`,
    `- Downstream (${capabilityTitle} is a pre-requisite for them)`,
  ];
  const expected = expectedLines.join('\n');

  if (intro !== expected) {
    throw new CapabilityParseError(
      `Introduction does not match expected format.\nExpected:\n${expected}\n\nGot:\n${intro}`,
      'Adjacent Capabilities'
    );
  }
}

// --- Main Parser ---

export function parseCapabilityMarkdown(content: string): ParsedCapability {
  // Check for HTML comments
  const commentMatch = content.match(/<!--[\s\S]*?-->/);
  if (commentMatch) {
    const lineNumber = content.substring(0, commentMatch.index!).split('\n').length;
    throw new CapabilityParseError(`HTML comments are not allowed (line ${lineNumber})`);
  }

  // Parse H1 title and link
  const h1Match = content.match(/^# \[(.+?)]\((.+?)\)\s*$/m);
  if (!h1Match) {
    throw new CapabilityParseError(
      'Expected H1 heading with link format: # [Title](url)',
      'Header'
    );
  }
  const title = h1Match[1];
  const doraLink = h1Match[2];

  // Extract introduction (between H1 and first H2)
  const h1End = h1Match.index! + h1Match[0].length;
  const firstH2Index = content.indexOf('\n## ', h1End);
  if (firstH2Index === -1) {
    throw new CapabilityParseError('Expected at least one H2 section', 'Document');
  }
  const introText = content.substring(h1End, firstH2Index).trim();
  if (!introText) {
    throw new CapabilityParseError('Expected introduction text after H1 heading', 'Introduction');
  }
  const introduction = collapseParagraphs(introText);

  // Split into H2 sections
  const sections = splitIntoH2Sections(content);

  // Validate required sections
  const requiredSections = [
    'Nuances',
    'Assessment',
    'Supporting Practices',
    'Adjacent Capabilities',
  ];
  for (const name of requiredSections) {
    if (!sections.has(name)) {
      throw new CapabilityParseError(`Missing required section: ## ${name}`, 'Document');
    }
  }

  const nuances = parseNuances(sections.get('Nuances')!);
  const assessment = parseAssessment(sections.get('Assessment')!);
  const supporting_practices = parseSupportingPractices(sections.get('Supporting Practices')!);
  const linked_capabilities = parseAdjacentCapabilities(
    sections.get('Adjacent Capabilities')!,
    title
  );

  const result = {
    title,
    doraLink,
    introduction,
    nuances,
    assessment,
    supporting_practices,
    linked_capabilities,
  };

  // Final Zod validation
  const parsed = ParsedCapabilitySchema.safeParse(result);
  if (!parsed.success) {
    throw new CapabilityParseError(`Validation failed: ${parsed.error.message}`);
  }

  return parsed.data;
}

console.log(parseCapabilityMarkdown(await Bun.file("/Users/tristanbarrow/Projects/step-engine/resources/capabilities/job-satisfaction.md").text()))

