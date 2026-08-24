import { expect, test } from "@playwright/test"

const token = "pilot-e2e-token"
const directory = "/tmp/pilot-e2e-project"
const secondDirectory = "/tmp/pilot-e2e-second-project"

async function setup(page, scenario: { permission?: boolean; question?: boolean } = {}) {
  await page.request.post("/_e2e/setup", {
    headers: { Authorization: `Bearer ${token}` },
    data: scenario,
  })
  await page.goto(`/?token=${token}`)
  await expect(page.locator("#app")).toBeVisible()
  await expect(page.locator('.session-item[data-id="session-e2e"]')).toHaveAttribute("aria-current", "true")
}

test("sends a prompt from the dashboard to the fake agent", async ({ page }) => {
  await setup(page)
  await expect(page.locator("#prompt-input")).toBeEnabled()
  await page.locator("#prompt-input").fill("Run the browser E2E flow")
  await page.locator("#send-btn").click()

  await expect.poll(async () => page.evaluate(async (credential) => {
    const response = await fetch("/_e2e/state", { headers: { Authorization: `Bearer ${credential}` } })
    return response.json()
  }, token)).toMatchObject({ prompts: ["Run the browser E2E flow"] })
  await expect(page.locator("#messages")).toContainText("Run the browser E2E flow")
})

test("approves a native OpenCode permission exactly once", async ({ page }) => {
  await setup(page, { permission: true })
  await expect(page.locator("#perm-banner")).toHaveClass(/visible/)
  await expect(page.locator("#perm-title")).toHaveText("bash")
  await expect(page.locator("#perm-detail")).toContainText("echo e2e")
  await page.locator("#btn-allow").click()
  await expect(page.locator("#perm-banner")).not.toHaveClass(/visible/)

  await expect.poll(async () => page.evaluate(async (credential) => {
    const response = await fetch("/_e2e/state", { headers: { Authorization: `Bearer ${credential}` } })
    return response.json()
  }, token)).toMatchObject({ permissionResolution: "once", permissionReplyCount: 1 })
})

test("answers an OpenCode native question exactly once", async ({ page }) => {
  await setup(page, { question: true })
  await expect(page.locator("#question-sheet")).toHaveClass(/visible/)
  await expect(page.locator("#question-title")).toHaveText("OpenCode has a question")
  await page.getByText("Stable", { exact: true }).click()
  await page.locator("#question-submit").click()
  await expect(page.locator("#question-sheet")).not.toHaveClass(/visible/)

  await expect.poll(async () => page.evaluate(async (credential) => {
    const response = await fetch("/_e2e/state", { headers: { Authorization: `Bearer ${credential}` } })
    return response.json()
  }, token)).toMatchObject({ questionAnswers: [["Stable"]], questionReplyCount: 1 })
})

test("shows real project tabs on mobile and synchronizes project metadata", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(({ first, second }) => {
    localStorage.setItem("pilot_project_tabs", JSON.stringify([
      { id: "tab-primary", directory: first, label: "E2E project" },
      { id: "tab-second", directory: second, label: "Second project" },
    ]))
    localStorage.setItem("pilot_active_project_id", "tab-primary")
    localStorage.setItem("pilot_active_directory", first)
  }, { first: directory, second: secondDirectory })
  await setup(page, { question: true })

  const tabs = page.locator("#project-tabs-bar")
  await expect(tabs).toBeVisible()
  await expect(tabs).not.toContainText("default")
  await expect(page.locator('.project-tab[data-tab-id="tab-primary"]')).toBeVisible()
  await expect(page.locator('.project-tab[data-tab-id="tab-second"]')).toBeVisible()
  await expect(page.locator("#lbl-model")).toHaveText("Primary Model")
  await expect(page.locator("#sessions-project-label")).toHaveText("E2E project")

  await page.locator('.project-tab[data-tab-id="tab-second"]').click()
  await expect(page.locator("#question-sheet")).not.toHaveClass(/visible/)
  await expect(page.locator('.session-item[data-id="session-e2e-second"]')).toHaveAttribute("aria-current", "true")
  await expect(page.locator("#sessions-project-label")).toHaveText("Second project")
  await expect(page.locator("#lbl-agent")).toHaveText("reviewer")
  await expect(page.locator("#lbl-model")).toHaveText("Second Model")
  await expect(page.locator("#lbl-provider")).toHaveText("Second Provider")
  await expect(page.locator("#header-status-badge")).toHaveText("idle")
})
