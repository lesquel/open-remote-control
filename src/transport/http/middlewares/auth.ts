// Re-exports from infra/http/auth so consumers that import from this path
// continue to work. The implementation lives in infra/ so integrations/ can
// also import it without violating the sibling cross-import rule.
export { validateToken, getIP, safeEqual } from "../../../infra/http/auth"
