import { expect, test } from "@playwright/test"

const token = "pilot-e2e-token"

test.beforeEach(async ({ page }) => {
  await page.goto(`/?token=${token}`)
  await expect(page.locator("#app")).toBeVisible()
  await expect(page.locator('.session-item[data-id="session-e2e"]')).toHaveAttribute("aria-current", "true")
})

test("sends a prompt from the dashboard to the fake agent", async ({ page }) => {
  await expect(page.locator("#prompt-input")).toBeEnabled()
  await page.locator("#prompt-input").fill("Run the browser E2E flow")
  await page.locator("#send-btn").click()

  await expect.poll(async () => page.evaluate(async (credential) => {
    const response = await fetch("/_e2e/state", {
      headers: { Authorization: `Bearer ${credential}` },
    })
    return response.json()
  }, token)).toMatchObject({ prompts: ["Run the browser E2E flow"] })
  await expect(page.locator("#messages")).toContainText("Run the browser E2E flow")
})

test("approves a pending permission exactly once", async ({ page }) => {
  await expect(page.locator("#perm-banner")).toHaveClass(/visible/)
  await expect(page.locator("#perm-title")).toHaveText("Run the E2E command")
  await page.locator("#btn-allow").click()
  await expect(page.locator("#perm-banner")).not.toHaveClass(/visible/)

  await expect.poll(async () => page.evaluate(async (credential) => {
    const response = await fetch("/_e2e/state", {
      headers: { Authorization: `Bearer ${credential}` },
    })
    return response.json()
  }, token)).toMatchObject({ permissionResolution: "allow" })
})
