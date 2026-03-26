import api from "./api";

export const dashboardApi = {
  getAnalytics: async () => {
    const response = await api.get("/dashboard");
    // Backend returns { success: true, data: {...} }
    return response.data?.data ?? response.data;
  },
};
