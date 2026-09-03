import axios from "axios";
import { logger } from "./logger";

// Service base URLs.
// - Local dev (vite dev server): VITE_* unset → localhost defaults below.
// - Production / docker: build args set VITE_API_URL=/api, VITE_CV_URL=/cv-api,
//   VITE_AGENT_URL=/agent-api and nginx proxies each prefix to the right
//   service (same-origin — no CORS, no hardcoded hosts, works behind any
//   domain/tunnel/proxy).
// `??` (not `||`) so an explicit empty VITE_SOCKET_URL means "same origin".
export const API: string = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";
export const SOCKET_URL: string = import.meta.env.VITE_SOCKET_URL ?? "http://localhost:4000";
export const CV_URL: string = import.meta.env.VITE_CV_URL ?? "http://localhost:5050";
export const AGENT_URL: string = import.meta.env.VITE_AGENT_URL ?? "http://localhost:8001";

export function getToken(): string | null {
  return localStorage.getItem("token");
}

export function authH() {
  const token = getToken();
  if (!token || token === "undefined") {
    return { headers: {} };
  }
  return { headers: { Authorization: `Bearer ${token}` } };
}

export function setToken(token: string) {
  if (token && token !== "undefined") {
    localStorage.setItem("token", token);
  } else {
    logger.warn("Attempted to store invalid token");
  }
}

export function clearToken() {
  localStorage.removeItem("token");
}

const api = axios.create({
  baseURL: API,
  timeout: 15000,
});

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token && token !== "undefined") {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      logger.warn("401 Unauthorized — redirecting to login");
      clearToken();
      window.location.reload();
    }
    return Promise.reject(error);
  }
);

export default api;
