import { Campus, Batch } from "@prisma/client";

/**
 * Program length in years per campus.
 * FIVE_KILO: 5 years (Faculty of Technology / Engineering)
 * FOUR_KILO, SIX_KILO, ART: 4 years
 * Configured in one central map so it is easy to update.
 */
export const CAMPUS_PROGRAM_YEARS: Record<Campus, number> = {
  FIVE_KILO: 5,
  FOUR_KILO: 4,
  SIX_KILO: 4,
  ART: 4,
};

/**
 * Academic year starting month (1-indexed).
 * 9 = September. University academic years run e.g. Sep 2025 - Aug 2026 for academic year 2025.
 */
export const ACADEMIC_YEAR_START_MONTH = 9;

/**
 * Default grace minutes for late arrival before a check-in is marked LATE.
 */
export const DEFAULT_LATE_GRACE_MINUTES = 15;

/**
 * Mapping helper for numeric level (1..5) to Batch enum.
 */

export const LEVEL_TO_BATCH: Record<number, Batch> = {
  1: Batch.FRESHMAN,
  2: Batch.YEAR_2,
  3: Batch.YEAR_3,
  4: Batch.YEAR_4,
  5: Batch.YEAR_5,
};

export const BATCH_TO_LEVEL: Record<Batch, number> = {
  FRESHMAN: 1,
  YEAR_2: 2,
  YEAR_3: 3,
  YEAR_4: 4,
  YEAR_5: 5,
  GRADUATE: 6,
};
