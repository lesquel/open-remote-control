type Question = {
  header?: string
  question?: string
  options?: Array<{ label?: string }>
  multiple?: boolean
  custom?: boolean
}
export function buildQuestionAnswers(
  questions: Question[],
  selected: string[][],
  custom: string[],
): string[][] | null
