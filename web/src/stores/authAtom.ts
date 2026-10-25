import { atom } from "jotai";

export interface AuthState {
  token: string | null;
}

const STORAGE_KEY = "auth_token";
const LOGGED_OUT_KEY = "auth_logged_out";

export function getStoredToken(): string | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return stored;
    if (sessionStorage.getItem(LOGGED_OUT_KEY) === "true") return null;
  } catch {
    // ignore storage errors in restricted contexts
  }
  return import.meta.env.VITE_DEV_TOKEN || null;
}

export function saveToken(token: string) {
  try {
    sessionStorage.removeItem(LOGGED_OUT_KEY);
    localStorage.setItem(STORAGE_KEY, token);
  } catch {
    // ignore
  }
}

export function clearToken() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.setItem(LOGGED_OUT_KEY, "true");
  } catch {
    // ignore
  }
}

export const authAtom = atom<AuthState>({
  token: getStoredToken(),
});
