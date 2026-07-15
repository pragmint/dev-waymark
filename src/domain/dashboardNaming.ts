const COPY_NAME_RE = /^copy(\d+) - (.+)$/;

export function nextDashboardCopyName(existingNames: string[], sourceName: string): string {
  const sourceMatch = COPY_NAME_RE.exec(sourceName);
  const baseName = sourceMatch ? sourceMatch[2] : sourceName;

  let maxCopyNumber = 0;
  for (const name of existingNames) {
    const match = COPY_NAME_RE.exec(name);
    if (match && match[2] === baseName) {
      maxCopyNumber = Math.max(maxCopyNumber, parseInt(match[1], 10));
    }
  }

  return `copy${maxCopyNumber + 1} - ${baseName}`;
}
