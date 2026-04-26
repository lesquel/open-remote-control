// ─── Shared HTTP types ────────────────────────────────────────────────────────
// Generic HTTP infrastructure types shared by both transport/ and integrations/.
// Lives in infra/ so both layers can import without violating the
// sibling cross-import rule.
//
// RouteContext<TDeps> is generic so infra/ does not need to import domain types.
// The concrete RouteContext (with RouteDeps) is defined in transport/http/routes.ts.
// The RouteSpec used by AgentIntegration.setup() is defined in integrations/ports.ts.

/** Auth requirements for a route. */
export type AuthRequirement = "required" | "optional" | "none"

/** Resolved URL params from named capture groups. */
export type RouteParams = Record<string, string>

/** Generic per-request context. TDeps is the deps object injected into handlers. */
// TDeps defaults to `unknown` so the base type is maximally permissive.
// Concrete usages (transport/http/routes.ts) specialize with RouteDeps.
export interface RouteContext<TDeps = unknown> {
  req: Request
  url: URL
  params: RouteParams
  deps: TDeps
}

/** Generic route definition. TDeps narrows the handler's context. */
export interface Route<TDeps = unknown> {
  method: "GET" | "POST" | "DELETE" | "PUT" | "PATCH"
  pattern: RegExp
  auth: AuthRequirement
  handler: (ctx: RouteContext<TDeps>) => Promise<Response>
}
