import { listInitialChoreTemplates } from "../services/templates.js";
import type { RouteResult } from "./types.js";
import { ok } from "./types.js";

export async function getInitialChoreTemplates(): Promise<RouteResult> {
  return ok({ items: listInitialChoreTemplates() });
}
