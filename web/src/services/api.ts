import axios from "axios";
import { getStoredToken, clearToken } from "@/stores/authAtom";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001/api/v1";
const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL ?? "ws://localhost:3001";

export const API_BASE_URL = BASE_URL;
export const WS_URL = WS_BASE_URL;

export const api = axios.create({
  baseURL: BASE_URL,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  const isPublicCandidateRoute =
    typeof window !== "undefined" && window.location.pathname.startsWith("/interview/");
  if (!isPublicCandidateRoute) {
    const token = getStoredToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Unwrap backend envelope: { data: { ... } } -> { ... }
// On 401/403 (outside login and candidate interview routes), clear stored credentials and redirect to login.
api.interceptors.response.use(
  (response) => {
    if (response.data && typeof response.data === "object" && "data" in response.data) {
      response.data = response.data.data;
    }
    return response;
  },
  (error) => {
    const status = error.response?.status;
    const reqUrl = String(error.config?.url ?? "");
    const isAuthRequest = reqUrl.includes("/auth/login");
    const isPublicRoute =
      typeof window !== "undefined" &&
      (window.location.pathname.startsWith("/login") ||
        window.location.pathname.startsWith("/interview/"));

    if ((status === 401 || status === 403) && !isAuthRequest && !isPublicRoute) {
      clearToken();
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);

export default api;
