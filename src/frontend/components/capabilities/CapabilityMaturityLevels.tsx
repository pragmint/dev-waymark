import { Capability, MaturityLevel } from "../../../domain/capabilityTypes";
import { CapabilityProps } from "../../../types/global";
import { CapabilityJustification } from "./CapabilityJustification";

function toKey(dim: string) {
  return dim.toLowerCase().replace(/\s+/g, '-');
}

function getScore(cap: Capability, dim: string | undefined): number {
  if (dim) return cap.dimensionScores?.[toKey(dim)] ?? cap.currentScore;
  return cap.currentScore;
}

function getJustification(cap: Capability, dim: string | undefined): string | undefined {
  if (!dim) return cap.justification;
  return cap.dimensionJustifications?.[toKey(dim)];
}

function groupByDimension(levels: MaturityLevel[]) {
  const map = new Map<string | undefined, MaturityLevel[]>();
  for (const l of [...levels].sort((a, b) => a.level - b.level)) {
    const group = map.get(l.dimension);
    if (group) group.push(l);
    else map.set(l.dimension, [l]);
  }
  return map;
}

export const CapabilityMaturityLevels = ({ capability }: CapabilityProps) => {
  if (!capability.maturityLevels?.length) return <></>;

  const grouped = groupByDimension(capability.maturityLevels);
  const hasDimensions = grouped.size > 1 || !grouped.has(undefined);

  return (
    <div class="maturity-display">
      {hasDimensions && (
        <div class="dimension-note">
          <strong>ℹ️ Note:</strong> This capability is assessed across multiple dimensions. Your
          current score of&nbsp;<strong>{capability.currentScore}</strong>&nbsp;is an average across
          all dimensions.
        </div>
      )}

      {Array.from(grouped.entries()).map(([dimension, levels]) => {
        const score = getScore(capability, dimension);

        return (
          <div class="maturity-dimensions">
            {dimension && (
              <h3 class="dimension-header">
                {dimension} <span class="dimension-score">&nbsp;-&nbsp;({score}/4)</span>
              </h3>
            )}
            <div class="maturity-grid">
              {levels.map((level) => {
                const isExactMatch = score === level.level;
                const isApproaching = score % 1 !== 0 && Math.ceil(score) === level.level;

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
            <CapabilityJustification text={getJustification(capability, dimension)} />
          </div>
        );
      })}
    </div>
  );
};

