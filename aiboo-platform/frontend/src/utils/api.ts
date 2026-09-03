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
  // Refresh token lives in an httpOnly cookie — send cookies on every call.
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token && token !== "undefined") {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Silent refresh: on a 401 (expired short-lived access token) try
// POST /auth/refresh once — the httpOnly cookie rotates — then retry the
// original request. Only when refresh itself fails do we log out.
let refreshing: Promise<string | null> | null = null;

async function tryRefresh(): Promise<string | null> {
  if (!refreshing) {
    refreshing = axios
      .post(`${API}/auth/refresh`, {}, { withCredentials: true, timeout: 10000 })
      .then((res) => {
        const token: string | undefined = res.data?.token;
        if (token) {
          setToken(token);
          return token;
        }
        return null;
      })
      .catch(() => null)
      .finally(() => {
        // allow a future refresh cycle after this one settles
        setTimeout(() => { refreshing = null; }, 100);
      });
  }
  return refreshing;
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error.response?.status;
    const url: string = error.config?.url ?? "";
    const isAuthPath = url.includes("/auth/login") || url.includes("/auth/register") || url.includes("/auth/refresh");
    const cfg = error.config as (import("axios").AxiosRequestConfig & { __retried?: boolean }) | undefined;
    const alreadyRetried = cfg?.__retried === true;

    if (status === 401 && !isAuthPath && cfg && !alreadyRetried) {
      const token = await tryRefresh();
      if (token) {
        cfg.__retried = true;
        cfg.headers = { ...(cfg.headers as Record<string, string>), Authorization: `Bearer ${token}` };
        return api.request(cfg);
      }
      logger.warn("401 + refresh failed — redirecting to login");
      clearToken();
      window.location.reload();
    } else if (status === 401 && !isAuthPath) {
      logger.warn("401 Unauthorized — redirecting to login");
      clearToken();
      window.location.reload();
    }
    return Promise.reject(error);
  }
);

export default api;
