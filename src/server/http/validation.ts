// ─── Input Validation ────────────────────────────────────────────────────────
// Lightweight hand-written body validator. No external deps.
// Designed for JSON request bodies — validates shape against a declarative schema.

export type FieldType =
  | "string"
  | "number"
  | "boolean"
  | "optional-string"
  | "optional-number"
  | "optional-boolean"

/** Declarative schema: field name → expected type. */
export type BodySchema = Record<string, FieldType>

export interface ValidationDetail {
  field: string
  message: string
}

export interface ValidationError {
  message: string
  details: ValidationDetail[]
}

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }

export function validateBody<T extends Record<string, unknown>>(
  body: unknown,
  schema: BodySchema,
): Result<T, ValidationError> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      error: {
        message: "Request body must be a JSON object",
        details: [{ field: "(root)", message: "Expected a JSON object" }],
      },
    }
  }

  const obj = body as Record<string, unknown>
  const details: ValidationDetail[] = []

  for (const [field, fieldType] of Object.entries(schema)) {
    const value = obj[field]
    const isOptional = fieldType.startsWith("optional-")
    const baseType = isOptional ? fieldType.slice("optional-".length) : fieldType

    if (value === undefined || value === null) {
      if (!isOptional) {
        details.push({ field, message: `Field "${field}" is required` })
      }
      // optional + absent/null → ok
      continue
    }

    // Value is present — check type
    if (typeof value !== baseType) {
      details.push({
        field,
        message: `Field "${field}" must be a ${baseType}, got ${typeof value}`,
      })
    }
  }

  if (details.length > 0) {
    return {
      ok: false,
      error: { message: "Validation failed", details },
    }
  }

  return { ok: true, value: obj as T }
}
