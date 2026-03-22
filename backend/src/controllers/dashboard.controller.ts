import { Request, Response } from "express";
import { dashboardService } from "../services/dashboard.service";

export const getDashboardAnalytics = async (req: Request, res: Response) => {
  try {
    const data = await dashboardService.getDashboardData();
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Error fetching dashboard data:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
