/**
 * Validate browser selections against the exact question options delivered by
 * OpenCode. Returns ordered answer arrays for the v2 API, or null when any
 * question is unanswered or contains an unknown value.
 */
export function buildQuestionAnswers(questions, selected, custom) {
  if (!Array.isArray(questions) || questions.length === 0) return null
  const answers = []
  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index]
    const allowed = new Set(
      Array.isArray(question?.options)
        ? question.options.map((option) => option?.label).filter((label) => typeof label === 'string')
        : [],
    )
    const picked = Array.isArray(selected?.[index])
      ? selected[index].filter((label) => typeof label === 'string' && allowed.has(label))
      : []
    if ((selected?.[index]?.length ?? 0) !== picked.length) return null

    const customValue = typeof custom?.[index] === 'string' ? custom[index].trim() : ''
    if (customValue && question?.custom !== false) {
      if (question?.multiple) picked.push(customValue)
      else picked.splice(0, picked.length, customValue)
    }
    const unique = [...new Set(picked)]
    if (unique.length === 0 || (!question?.multiple && unique.length !== 1)) return null
    answers.push(unique)
  }
  return answers
}
