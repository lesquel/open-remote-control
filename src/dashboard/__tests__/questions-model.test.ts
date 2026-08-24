import { describe, expect, test } from "bun:test"
import { buildQuestionAnswers } from "../components/questions-model"

const single = {
  header: "Choice",
  question: "Choose one",
  options: [{ label: "A", description: "First" }, { label: "B", description: "Second" }],
}

describe("question answer model", () => {
  test("returns ordered single and multiple selections", () => {
    const result = buildQuestionAnswers([
      single,
      { ...single, header: "Many", multiple: true },
    ], [["B"], ["A", "B"]], ["", ""])
    expect(result).toEqual([["B"], ["A", "B"]])
  })

  test("uses a custom answer only when the question permits it", () => {
    expect(buildQuestionAnswers([{ ...single, custom: true }], [[]], ["Custom value"]))
      .toEqual([["Custom value"]])
    expect(buildQuestionAnswers([{ ...single, custom: false }], [[]], ["Ignored"]))
      .toBeNull()
  })

  test("rejects unknown option labels and unanswered questions", () => {
    expect(buildQuestionAnswers([single], [["Injected"]], [""])).toBeNull()
    expect(buildQuestionAnswers([single], [[]], [""])).toBeNull()
  })
})
