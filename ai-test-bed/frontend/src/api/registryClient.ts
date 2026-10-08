import type { AISystem } from "../types";
import { requestBase } from "./client";

// AI-system list for the selector — read from the registry backend (same source the
// compliance MFE uses). The env var is already loaded via the repo-root envDir.
const API_BASE = import.meta.env.VITE_REGISTRY_API_BASE as string;

export const registryApi = {
  getSystems: () => requestBase<AISystem[]>(API_BASE, "/systems?limit=200"),
};
