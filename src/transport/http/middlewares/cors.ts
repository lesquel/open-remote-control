// Re-exports from infra/http/cors so consumers that import from this path
// continue to work. The implementation lives in infra/ so integrations/ can
// also import it without violating the sibling cross-import rule.
export { CORS_HEADERS, corsPreflightResponse } from "../../../infra/http/cors"
