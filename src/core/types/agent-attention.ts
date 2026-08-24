export interface AgentPermissionRequest {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
  metadata: Record<string, unknown>
  always: string[]
}

export interface AgentQuestionOption {
  label: string
  description: string
}

export interface AgentQuestionInfo {
  question: string
  header: string
  options: AgentQuestionOption[]
  multiple?: boolean
  custom?: boolean
}

export interface AgentQuestionRequest {
  id: string
  sessionID: string
  questions: AgentQuestionInfo[]
  tool?: { messageID: string; callID: string }
}

export interface AgentAttentionService {
  listPermissions(directory?: string): Promise<AgentPermissionRequest[]>
  replyPermission(
    requestID: string,
    reply: "once" | "always" | "reject",
    directory?: string,
  ): Promise<void>
  listQuestions(directory?: string): Promise<AgentQuestionRequest[]>
  replyQuestion(requestID: string, answers: string[][], directory?: string): Promise<void>
  rejectQuestion(requestID: string, directory?: string): Promise<void>
}
