import { ParsedCapabilitySchema } from '../../schemas/parsedCapabilitySchemas';
import type { ParsedCapability } from '../../schemas/parsedCapabilitySchemas';

export type { ParsedCapability };

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

// --- Rating Line Parser ---

function parseRatingLine(
  line: string,
  dimension?: string
): { rating: number; title: string; description: string } {
  const match = line.match(/^(\d+)\.\s+\*{0,2}(.+?):\*{0,2}\s+(.+)$/);
  if (!match) {
    const ctx = dimension ? ` in dimension "${dimension}"` : '';
    throw new CapabilityParseError(`Invalid rating format${ctx}: "${line}"`, 'Assessment');
  }
  return {
    rating: parseInt(match[1], 10),
    title: match[2].trim(),
    description: match[3].trim(),
  };
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

function parseMultiDimensionalAssessment(intro: string, items: H3Section[]) {
  const allRatings: Array<{
    rating: number;
    title: string;
    description: string;
    dimension: string;
  }> = [];
  let outro = '';

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const dimensionName = item.heading;
    const dimensionContent = item.content;

    const blocks = dimensionContent
      .split(/\n\n+/)
      .map(b => b.trim())
      .filter(Boolean);

    const listBlockIndex = blocks.findIndex(b => /^1\.\s+/.test(b));
    if (listBlockIndex === -1) {
      throw new CapabilityParseError(
        `Expected numbered rating list in dimension "${dimensionName}"`,
        'Assessment'
      );
    }

    const listBlock = blocks[listBlockIndex];
    const ratingLines = listBlock
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);

    const dimensionRatings = ratingLines.map(line => ({
      ...parseRatingLine(line, dimensionName),
      dimension: dimensionName,
    }));

    for (let j = 0; j < dimensionRatings.length; j++) {
      if (dimensionRatings[j].rating !== j + 1) {
        throw new CapabilityParseError(
          `In dimension "${dimensionName}": expected rating ${j + 1} but found ${dimensionRatings[j].rating}`,
          'Assessment'
        );
      }
    }

    allRatings.push(...dimensionRatings);

    if (i === items.length - 1) {
      const outroBlocks = blocks.slice(listBlockIndex + 1);
      outro = outroBlocks.join('\n');
    }
  }

  if (!intro) {
    throw new CapabilityParseError('Expected introduction text before dimensions', 'Assessment');
  }
  if (!outro) {
    throw new CapabilityParseError('Expected text after dimensions', 'Assessment');
  }

  return { intro, outro, ratings: allRatings };
}

function parseSimpleAssessment(content: string) {
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

  const ratings = ratingLines.map(line => parseRatingLine(line));

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

function parseAssessment(content: string) {
  const { intro, items } = splitIntoH3Sections(content);
  if (items.length > 0) {
    return parseMultiDimensionalAssessment(intro, items);
  }
  return parseSimpleAssessment(content);
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

  if (items.length > 0) {
    validateAdjacentIntro(intro, capabilityTitle);

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
        relationship: linkMatch[3].toLowerCase() as 'upstream' | 'downstream' | 'related',
        description: collapseParagraphs(item.content),
      };
    });
  }

  // Fallback: bullet-list format (e.g. continuous-delivery.md)
  const bulletRegex = /^- \[(.+?)]\(\/capabilities\/(.+?)\.md\)\s+(.+)$/gm;
  const capabilities: {
    id: string;
    title: string;
    relationship: 'upstream' | 'downstream' | 'related';
    description: string;
  }[] = [];

  for (const match of content.matchAll(bulletRegex)) {
    capabilities.push({
      id: match[2],
      title: match[1],
      relationship: 'upstream',
      description: match[3].trim(),
    });
  }

  if (capabilities.length === 0) {
    throw new CapabilityParseError(
      'Expected at least one capability (### heading or bullet list)',
      'Adjacent Capabilities'
    );
  }

  return capabilities;
}

function validateAdjacentIntro(intro: string, capabilityTitle: string): void {
  const hasAllRelationshipTypes =
    intro.includes('Related') && intro.includes('Upstream') && intro.includes('Downstream');

  if (!hasAllRelationshipTypes) {
    throw new CapabilityParseError(
      'Introduction must mention all three relationship types: Related, Upstream, Downstream',
      'Adjacent Capabilities'
    );
  }

  if (!intro.includes(capabilityTitle)) {
    const usedTitleMatch = intro.match(/Related \(they cover similar territory to (.+?)\)/);
    const usedTitle = usedTitleMatch ? usedTitleMatch[1] : '(unknown)';
    throw new CapabilityParseError(
      `Introduction uses "${usedTitle}" but the document title is "${capabilityTitle}"`,
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
