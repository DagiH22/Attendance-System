import api from "./api";

export const dashboardApi = {
  getAnalytics: async () => {
    const response = await api.get("/dashboard");
    return response.data;
  },
};
