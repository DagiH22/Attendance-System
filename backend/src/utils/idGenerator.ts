export function generateMezmurId(lastSerial: number): string {
  const currentYear = new Date().getFullYear();
  const nextSerial = lastSerial + 1;
  const paddedSerial = nextSerial.toString().padStart(3, "0");
  return `MEZ-${currentYear}-${paddedSerial}`;
}

export function getNextMezmurId(existingIds: string[]): string {
  const currentYear = new Date().getFullYear().toString();

  // Filter IDs that belong to the current year
  const currentYearIds = existingIds.filter((id) =>
    id.startsWith(`MEZ-${currentYear}-`),
  );

  if (currentYearIds.length === 0) {
    // If no IDs exist for the current year, start from 0
    return generateMezmurId(0);
  }

  // Extract serial numbers and find the maximum
  const serials = currentYearIds.map((id) => {
    const parts = id.split("-");
    const serialStr = parts[parts.length - 1]; // "001"
    return parseInt(serialStr, 10);
  });

  const maxSerial = Math.max(...serials);

  return generateMezmurId(maxSerial);
}
