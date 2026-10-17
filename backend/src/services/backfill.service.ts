import { PrismaClient, Batch, Campus } from "@prisma/client";
import { deriveEntryAcademicYearForBackfill } from "./academic.service";

export interface InconsistentMemberReport {
  memberId: string;
  name: string;
  uniqueId: string;
  campus: Campus;
  batch: Batch;
  derivedEntryAcademicYear: number;
  reason: string;
}

export interface BackfillReport {
  totalMembersChecked: number;
  membersBackfilled: number;
  inconsistentMembers: InconsistentMemberReport[];
  totalClustersFound: number;
  studiesCreated: number;
  eventsLinkedToStudies: number;
  eventsPlannedStartTimeBackfilled: number;
}

/**
 * Runs the data backfill and cluster-to-study migration.
 * Safe and idempotent: can be run repeatedly without duplicating or corrupting data.
 */
export async function runBackfill(
  prisma: PrismaClient,
  asOfDate: Date = new Date(),
): Promise<BackfillReport> {
  const inconsistentMembers: InconsistentMemberReport[] = [];

  // 1. Backfill Member entryAcademicYear
  const members = await prisma.member.findMany();
  let membersBackfilled = 0;

  for (const member of members) {
    const analysis = deriveEntryAcademicYearForBackfill(member, asOfDate);

    if (analysis.isInconsistent) {
      inconsistentMembers.push({
        memberId: member.id,
        name: member.name,
        uniqueId: member.uniqueId,
        campus: member.campus,
        batch: member.batch,
        derivedEntryAcademicYear: analysis.entryAcademicYear,
        reason: analysis.inconsistencyReason || "Inconsistent batch for campus length",
      });
    }

    if (member.entryAcademicYear === null || member.entryAcademicYear === undefined) {
      await prisma.member.update({
        where: { id: member.id },
        data: { entryAcademicYear: analysis.entryAcademicYear },
      });
      membersBackfilled++;
    }
  }

  // 2. Migrate EventCluster rows into Study rows (audience ALL)
  const clusters = await prisma.eventCluster.findMany();
  let studiesCreated = 0;
  let eventsLinkedToStudies = 0;

  for (const cluster of clusters) {
    const existingStudy = await prisma.study.findUnique({
      where: { id: cluster.id },
    });

    if (!existingStudy) {
      await prisma.study.create({
        data: {
          id: cluster.id,
          name: cluster.title,
          description: cluster.description,
          startDate: cluster.startDate,
          endDate: cluster.endDate,
          audienceType: "ALL",
          audienceBatches: [],
          defaultLateGraceMinutes: 15,
          isActive: true,
        },
      });
      studiesCreated++;
    }

    // Link events that belonged to this cluster
    const linkResult = await prisma.event.updateMany({
      where: {
        clusterId: cluster.id,
        studyId: null,
      },
      data: {
        studyId: cluster.id,
      },
    });
    eventsLinkedToStudies += linkResult.count;
  }

  // 3. Backfill plannedStartTime on events where it's not set
  const eventsNeedingPlannedStart = await prisma.event.findMany({
    where: { plannedStartTime: null },
    select: { id: true, startTime: true },
  });

  let eventsPlannedStartTimeBackfilled = 0;
  for (const event of eventsNeedingPlannedStart) {
    await prisma.event.update({
      where: { id: event.id },
      data: { plannedStartTime: event.startTime },
    });
    eventsPlannedStartTimeBackfilled++;
  }

  return {
    totalMembersChecked: members.length,
    membersBackfilled,
    inconsistentMembers,
    totalClustersFound: clusters.length,
    studiesCreated,
    eventsLinkedToStudies,
    eventsPlannedStartTimeBackfilled,
  };
}
