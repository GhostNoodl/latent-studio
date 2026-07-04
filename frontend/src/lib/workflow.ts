/**
 * Client-side view of "what would actually run": the same manifest→graph
 * transform the backend applies before queueing, used to seed the raw-JSON
 * editor so it reflects Simple/Advanced edits. Re-exported from @latent/shared
 * so the backend and frontend share one implementation and can't drift.
 * (Seed variation + wildcard expansion happen backend-side and are not shown here.)
 */
export { buildWorkflow as buildEffectiveWorkflow } from "@latent/shared";
