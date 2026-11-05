import { expect, test } from "@playwright/test";
import { ENGINEER } from "../src/personas";
import { readRun } from "../src/run";

/**
 * Deep flow: an ai_engineer registers a new AI system end-to-end through the registry UI.
 *
 * Minimal deterministic path — name + description only (no document upload, no AI mode), so the
 * flow never depends on Thalamus/LLM and lands as a `pending`-tier stub. The system name carries
 * the run suffix so the cleanup teardown can find and delete it.
 *
 * Form per ai-system-registry/frontend/src/views/RegisterSystem.tsx: the submit button is enabled
 * only once name + description are non-empty; success shows a toast and redirects to the list.
 */
test.use({ storageState: ENGINEER.storageState });

test("engineer registers a new AI system end-to-end", async ({ page }) => {
  const run = readRun();
  expect(run, "run.json must exist (setup project ran)").not.toBeNull();
  const systemName = `E2E PW ${run!.suffix}`;

  await page.goto("/registry/#/systems/new");
  await expect(page.getByRole("heading", { name: "Register an AI System" })).toBeVisible();

  await page.getByLabel(/Name of AI system/).fill(systemName);
  await page.getByLabel(/System Description/).fill("Playwright end-to-end smoke registration.");

  const submit = page.getByRole("button", { name: "Register AI System" });
  await expect(submit).toBeEnabled();
  await submit.click();

  // Success: toast, redirect to the list, and the new row visible.
  await expect(page.getByText("AI system registered")).toBeVisible();
  await expect(page).toHaveURL(/#\/systems$/);
  await expect(page.getByText(systemName)).toBeVisible();
});
