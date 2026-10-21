import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { StudyService } from "../services/study.service";
import { setExcelDownloadHeaders } from "../utils/excelExport";

const prisma = new PrismaClient();
const studyService = new StudyService(prisma);

export const getAllStudies = async (_req: Request, res: Response) => {
  try {
    const studies = await studyService.getAllStudies();
    return res.status(200).json({ studies });
  } catch (err: any) {
    console.error("Error in getAllStudies:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const getStudyById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;
    if (!idStr) return res.status(400).json({ error: "Study id is required" });

    const studyData = await studyService.getStudyById(idStr);
    if (!studyData) {
      return res.status(404).json({ error: "Study not found" });
    }
    return res.status(200).json(studyData);
  } catch (err: any) {
    console.error("Error in getStudyById:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const createStudy = async (req: Request, res: Response) => {
  try {
    if (!req.admin?.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const {
      name,
      description,
      startDate,
      endDate,
      audienceType,
      audienceBatches,
      requiredSessions,
      defaultLateGraceMinutes,
      sessionsInput,
    } = req.body ?? {};

    if (!name || !startDate || !endDate) {
      return res.status(400).json({
        error: "name, startDate, and endDate are required",
      });
    }

    const study = await studyService.createStudy(req.admin.id, {
      name,
      description,
      startDate,
      endDate,
      audienceType,
      audienceBatches,
      requiredSessions:
        requiredSessions !== undefined && requiredSessions !== ""
          ? Number(requiredSessions)
          : null,
      defaultLateGraceMinutes:
        defaultLateGraceMinutes !== undefined && defaultLateGraceMinutes !== ""
          ? Number(defaultLateGraceMinutes)
          : null,
    });

    let generatedSessions: any[] = [];
    if (sessionsInput && typeof sessionsInput === "object") {
      generatedSessions = await studyService.addSessionsToStudy(
        study.id,
        req.admin.id,
        sessionsInput,
      );
    }

    let warning: string | undefined;
    if (
      study.requiredSessions &&
      generatedSessions.length > 0 &&
      study.requiredSessions > generatedSessions.length
    ) {
      warning = `Required sessions (${study.requiredSessions}) exceeds the number of sessions (${generatedSessions.length})`;
    }

    return res.status(201).json({
      message: "Study created successfully",
      study,
      generatedSessions,
      warning,
    });
  } catch (err: any) {
    console.error("Error in createStudy:", err?.message ?? err);
    return res
      .status(err.statusCode || 400)
      .json({ error: err.message || "Internal server error" });
  }
};

export const updateStudy = async (req: Request, res: Response) => {
  try {
    if (!req.admin?.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;
    if (!idStr) return res.status(400).json({ error: "Study id is required" });

    const updated = await studyService.updateStudy(idStr, req.body ?? {});

    const sessionCount = await prisma.event.count({
      where: { studyId: idStr, isActive: true, cancelledAt: null },
    });
    let warning: string | undefined;
    if (
      updated.requiredSessions &&
      sessionCount > 0 &&
      updated.requiredSessions > sessionCount
    ) {
      warning = `Required sessions (${updated.requiredSessions}) exceeds the number of sessions (${sessionCount})`;
    }

    return res.status(200).json({
      message: "Study updated successfully",
      study: updated,
      warning,
    });
  } catch (err: any) {
    console.error("Error in updateStudy:", err?.message ?? err);
    return res
      .status(err.statusCode || 400)
      .json({ error: err.message || "Internal server error" });
  }
};

export const deleteStudy = async (req: Request, res: Response) => {
  try {
    if (!req.admin?.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;
    if (!idStr) return res.status(400).json({ error: "Study id is required" });

    const moveSessions =
      req.query.moveSessionsToStandalone === "true" ||
      req.body?.moveSessionsToStandalone === true;

    await studyService.deleteStudy(idStr, moveSessions);
    return res.status(200).json({ message: "Study deleted successfully" });
  } catch (err: any) {
    console.error("Error in deleteStudy:", err?.message ?? err);
    return res
      .status(err.statusCode || 500)
      .json({ error: err.message || "Internal server error", sessionCount: err.sessionCount });
  }
};

export const addSessionsToStudy = async (req: Request, res: Response) => {
  try {
    if (!req.admin?.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;
    if (!idStr) return res.status(400).json({ error: "Study id is required" });

    const sessions = await studyService.addSessionsToStudy(
      idStr,
      req.admin.id,
      req.body ?? {},
    );

    return res.status(201).json({
      message: "Sessions added successfully",
      sessions,
    });
  } catch (err: any) {
    console.error("Error in addSessionsToStudy:", err?.message ?? err);
    return res.status(400).json({ error: err.message || "Failed to add sessions" });
  }
};

export const getStudyStats = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;
    if (!idStr) return res.status(400).json({ error: "Study id is required" });

    const stats = await studyService.getStudyStats(idStr);
    return res.status(200).json(stats);
  } catch (err: any) {
    console.error("Error in getStudyStats:", err?.message ?? err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
};

export const getStudyGrid = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;
    if (!idStr) return res.status(400).json({ error: "Study id is required" });

    const stats = await studyService.getStudyStats(idStr);
    return res.status(200).json({
      sessions: stats.sessionSeries,
      rows: stats.grid,
    });
  } catch (err: any) {
    console.error("Error in getStudyGrid:", err?.message ?? err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
};

export const exportStudyExcel = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;
    if (!idStr) return res.status(400).json({ error: "Study id is required" });

    const workbook = await studyService.exportStudyToExcel(idStr);
    const study = await prisma.study.findUnique({
      where: { id: idStr },
      select: { name: true },
    });

    const safeName = (study?.name || "study").replace(/[^a-zA-Z0-9_-]/g, "_");
    setExcelDownloadHeaders(res, safeName, "study_attendance");
    await workbook.xlsx.write(res);
    return res.end();
  } catch (err: any) {
    console.error("Error in exportStudyExcel:", err?.message ?? err);
    return res.status(500).json({ error: err.message || "Failed to export Excel" });
  }
};

export const getNotParticipatingMembers = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;
    if (!idStr) return res.status(400).json({ error: "Study id is required" });

    const { search, campus, batch, department, hideAttendingOther, page, limit } = req.query;

    const result = await studyService.getNotParticipating(idStr, {
      search: typeof search === "string" ? search : undefined,
      campus: typeof campus === "string" ? (campus as any) : undefined,
      batch: typeof batch === "string" ? (batch as any) : undefined,
      department: typeof department === "string" ? department : undefined,
      hideAttendingOther:
        hideAttendingOther === "true" || hideAttendingOther === "1",
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });

    return res.status(200).json(result);
  } catch (err: any) {
    console.error("Error in getNotParticipatingMembers:", err?.message ?? err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
};

export const exportNotParticipatingExcel = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;
    if (!idStr) return res.status(400).json({ error: "Study id is required" });

    const { search, campus, batch, department, hideAttendingOther } = req.query;

    const { workbook, studyName } = await studyService.exportNotParticipatingToExcel(idStr, {
      search: typeof search === "string" ? search : undefined,
      campus: typeof campus === "string" ? (campus as any) : undefined,
      batch: typeof batch === "string" ? (batch as any) : undefined,
      department: typeof department === "string" ? department : undefined,
      hideAttendingOther:
        hideAttendingOther === "true" || hideAttendingOther === "1",
    });

    const safeName = (studyName || "study").replace(/[^a-zA-Z0-9_-]/g, "_");
    setExcelDownloadHeaders(res, safeName, "not_participating");
    await workbook.xlsx.write(res);
    return res.end();
  } catch (err: any) {
    console.error("Error in exportNotParticipatingExcel:", err?.message ?? err);
    return res.status(500).json({ error: err.message || "Failed to export Excel" });
  }
};
