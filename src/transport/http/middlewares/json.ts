// Re-exports from infra/http/json so consumers that import from this path
// continue to work. The implementation lives in infra/ so integrations/ can
// also import it without violating the sibling cross-import rule.
export type { ErrorBody } from "../../../infra/http/json"
export { json, jsonError } from "../../../infra/http/json"
