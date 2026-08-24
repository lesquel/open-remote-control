import { getState, setState } from '../state/state.js'
import { fetchQuestions, replyQuestion, rejectQuestion } from '../api/api.js'
import { buildQuestionAnswers } from './questions-model.js'
import { toast } from '../ui/toast.js'

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function setBusy(busy) {
  const sheet = document.getElementById('question-sheet')
  if (sheet) sheet.setAttribute('aria-busy', String(busy))
  sheet?.querySelectorAll('button, input').forEach((element) => { element.disabled = busy })
}

function questionHtml(question, index) {
  const multiple = question?.multiple === true
  const inputType = multiple ? 'checkbox' : 'radio'
  const options = Array.isArray(question?.options) ? question.options : []
  const optionsHtml = options.map((option, optionIndex) => `
    <label class="question-option">
      <input type="${inputType}" name="question-${index}" value="${esc(option?.label)}" data-question-index="${index}" data-option-index="${optionIndex}">
      <span><strong>${esc(option?.label)}</strong><small>${esc(option?.description)}</small></span>
    </label>`).join('')
  const customHtml = question?.custom !== false
    ? `<label class="question-custom"><span>Custom answer</span><input type="text" data-question-custom="${index}" maxlength="10000" autocomplete="off"></label>`
    : ''
  return `<fieldset class="question-group" data-question-group="${index}">
    <legend>${esc(question?.header || `Question ${index + 1}`)}</legend>
    <p>${esc(question?.question || '')}</p>
    <div class="question-options">${optionsHtml}</div>
    ${customHtml}
  </fieldset>`
}

export function showNextQuestion() {
  const sheet = document.getElementById('question-sheet')
  const form = document.getElementById('question-form')
  if (!sheet || !form) return
  const pending = getState().pendingQuestions
  if (!Array.isArray(pending) || pending.length === 0) {
    sheet.classList.remove('visible')
    form.innerHTML = ''
    return
  }

  const request = pending[0]
  const questions = Array.isArray(request?.questions) ? request.questions : []
  document.getElementById('question-session').textContent = request?.sessionID
    ? `Session ${String(request.sessionID).slice(0, 10)}`
    : 'OpenCode needs your input'
  const queue = document.getElementById('question-queue')
  if (queue) {
    queue.textContent = pending.length > 1 ? `1 of ${pending.length}` : ''
    queue.hidden = pending.length <= 1
  }
  form.innerHTML = questions.map(questionHtml).join('')
  sheet.classList.add('visible')
  form.querySelector('input')?.focus()
}

export async function loadQuestions() {
  try {
    const questions = await fetchQuestions()
    setState({ pendingQuestions: Array.isArray(questions) ? questions : [] })
    showNextQuestion()
  } catch (error) {
    console.warn('[questions] Could not load pending questions:', error?.message ?? error)
  }
}

async function submitCurrentQuestion() {
  const pending = getState().pendingQuestions
  const request = pending?.[0]
  if (!request) return
  const selected = request.questions.map((_, index) =>
    [...document.querySelectorAll(`[data-question-index="${index}"]:checked`)].map((input) => input.value),
  )
  const custom = request.questions.map((_, index) =>
    document.querySelector(`[data-question-custom="${index}"]`)?.value ?? '',
  )
  const answers = buildQuestionAnswers(request.questions, selected, custom)
  if (!answers) {
    toast('Answer every question before continuing')
    return
  }

  setBusy(true)
  try {
    await replyQuestion(request.id, answers)
    setState({ pendingQuestions: pending.slice(1) })
    showNextQuestion()
  } catch (_) {
    toast("Couldn't send the answer. The question queue was refreshed.")
    await loadQuestions()
  } finally {
    setBusy(false)
  }
}

async function rejectCurrentQuestion() {
  const pending = getState().pendingQuestions
  const request = pending?.[0]
  if (!request) return
  setBusy(true)
  try {
    await rejectQuestion(request.id)
    setState({ pendingQuestions: pending.slice(1) })
    showNextQuestion()
  } catch (_) {
    toast("Couldn't reject the question. The queue was refreshed.")
    await loadQuestions()
  } finally {
    setBusy(false)
  }
}

export function initQuestions() {
  document.getElementById('question-submit')?.addEventListener('click', submitCurrentQuestion)
  document.getElementById('question-reject')?.addEventListener('click', rejectCurrentQuestion)
  document.getElementById('question-form')?.addEventListener('submit', (event) => {
    event.preventDefault()
    void submitCurrentQuestion()
  })
  window.__loadQuestions = loadQuestions
  window.__clearQuestions = () => {
    setState({ pendingQuestions: [] })
    showNextQuestion()
  }
}
