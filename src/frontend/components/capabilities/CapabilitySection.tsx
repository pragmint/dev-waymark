import { Capability, MaturityLevel } from '../../../domain/capabilityTypes';

function getMaturityLevelLabel(level: number): string {
  switch (level) {
    case 0:
      return 'Not Started';
    case 1:
      return 'Initial';
    case 2:
      return 'Developing';
    case 3:
      return 'Defined';
    case 4:
      return 'Optimizing';
    default:
      return 'Unknown';
  }
}

/**
 * Group maturity levels by dimension
 */
function groupByDimension(
  maturityLevels: MaturityLevel[]
): Map<string | undefined, MaturityLevel[]> {
  const grouped = new Map<string | undefined, MaturityLevel[]>();

  for (const level of maturityLevels) {
    const dimension = level.dimension;
    if (!grouped.has(dimension)) {
      grouped.set(dimension, []);
    }
    grouped.get(dimension)!.push(level);
  }

  // Sort levels within each dimension
  for (const levels of grouped.values()) {
    levels.sort((a, b) => a.level - b.level);
  }

  return grouped;
}

/**
 * Helper to convert dimension name to kebab-case key
 * e.g., "New Code" -> "new-code"
 */
function dimensionToKey(dimension: string): string {
  return dimension.toLowerCase().replace(/\s+/g, '-');
}

/**
 * Get the score for a specific dimension
 */
function getDimensionScore(capability: Capability, dimension: string | undefined): number {
  if (!dimension) {
    return capability.currentScore;
  }

  // If we have dimension-specific scores, use them
  if (capability.dimensionScores) {
    const key = dimensionToKey(dimension);
    return capability.dimensionScores[key] ?? capability.currentScore;
  }

  // Otherwise, use the overall score
  return capability.currentScore;
}

/**
 * Get the justification for a specific dimension
 */
function getDimensionJustification(
  capability: Capability,
  dimension: string | undefined
): string | undefined {
  if (!dimension) {
    return capability.justification;
  }

  // If we have dimension-specific justifications, use them
  if (capability.dimensionJustifications) {
    const key = dimensionToKey(dimension);
    return capability.dimensionJustifications[key];
  }

  return undefined;
}

type MaturityLevelsProps = {
  capability: Capability;
};

const MaturityLevels = ({ capability }: MaturityLevelsProps) => {
  if (!capability.maturityLevels || capability.maturityLevels.length === 0) {
    return <></>;
  }

  const grouped = groupByDimension(capability.maturityLevels);
  const hasMultipleDimensions =
    grouped.size > 1 || (grouped.size === 1 && grouped.keys().next().value !== undefined);

  return (
    <div class="maturity-display">
      {hasMultipleDimensions && (
        <div class="dimension-note">
          <strong>ℹ️ Note:</strong> This capability is assessed across multiple dimensions. Your
          current score of&nbsp;<strong>{capability.currentScore}</strong>&nbsp;is an average across
          all dimensions.
        </div>
      )}

      {Array.from(grouped.entries()).map(([dimension, levels]) => {
        // Get the score for this specific dimension
        const dimensionScore = getDimensionScore(capability, dimension);
        const dimensionJustification = getDimensionJustification(capability, dimension);

        return (
          <div class="maturity-dimensions">
            {dimension && (
              <h3 class="dimension-header">
                {dimension} <span class="dimension-score">&nbsp;-&nbsp;({dimensionScore}/4)</span>
              </h3>
            )}
            <div class="maturity-grid">
              {levels.map(level => {
                // Only highlight if score is a whole number matching this level
                const isExactMatch = dimensionScore === level.level;
                // Check if this level is part of an approaching state (decimal score)
                const isDecimalScore = dimensionScore % 1 !== 0;
                const isApproaching =
                  isDecimalScore &&
                  dimensionScore > level.level - 1 &&
                  dimensionScore <= level.level;

                return (
                  <div
                    class={`maturity-card ${isExactMatch ? 'current' : ''} ${isApproaching ? 'approaching' : ''}`}
                  >
                    <div class="maturity-card-header">
                      <span class="maturity-card-level">Level {level.level}</span>
                      {isExactMatch && <span class="current-badge">Current</span>}
                      {isApproaching && <span class="approaching-badge">Approaching</span>}
                    </div>
                    <h4 class="maturity-card-title">{level.title}</h4>
                    <p class="maturity-card-description">{level.description}</p>
                  </div>
                );
              })}
            </div>
            {dimensionJustification && (
              <div class="justification-section">
                <h4 class="justification-header">Justification</h4>
                <div class="justification-text">
                  {dimensionJustification.split('\n').map((paragraph, i) => (
                    <p key={i}>{paragraph}</p>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

type CapabilitySectionProps = {
  capability: Capability;
};

export const CapabilitySection = ({ capability }: CapabilitySectionProps) => {
  return (
    <section class="capability-section">
      <h2>Current State</h2>
      {capability.maturityLevels && capability.maturityLevels.length > 0 ? (
        <MaturityLevels capability={capability} />
      ) : (
        <div>
          <div class="maturity-level">
            <div class="maturity-level-header">
              <h3>Maturity Level: {capability.currentScore}</h3>
              <span class="maturity-level-label">
                {getMaturityLevelLabel(capability.currentScore)}
              </span>
            </div>
            <div class="maturity-progress">
              <div class="maturity-progress-bar">
                <div
                  class="maturity-progress-fill"
                  style={`width: ${(capability.currentScore / 4) * 100}%`}
                ></div>
              </div>
              <div class="maturity-levels">
                <span class={`level ${capability.currentScore >= 1 ? 'achieved' : ''}`}>1</span>
                <span class={`level ${capability.currentScore >= 2 ? 'achieved' : ''}`}>2</span>
                <span class={`level ${capability.currentScore >= 3 ? 'achieved' : ''}`}>3</span>
                <span class={`level ${capability.currentScore >= 4 ? 'achieved' : ''}`}>4</span>
              </div>
            </div>
          </div>
          <p>
            The organization is currently at level {capability.currentScore}, demonstrating{' '}
            {getMaturityLevelLabel(capability.currentScore).toLowerCase()} implementation of this
            capability.
          </p>
          {capability.justification && (
            <div class="justification-section">
              <h4 class="justification-header">Justification</h4>
              <div class="justification-text">
                {capability.justification.split('\n').map((paragraph, i) => (
                  <p key={i}>{paragraph}</p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
