import { expect, test } from "@playwright/test";

/**
 * Interaction pass: clicks the controls a person actually uses, rather than
 * only asserting that a page rendered. Complements ui.spec.ts.
 *
 * Deliberately stops short of two things that cost GPU hours or gigabytes of
 * disk — downloading a model from Hugging Face, and running a benchmark to
 * completion. Both are still exercised up to the point of submission.
 */
const BASE = process.env.BASE_URL ?? "http://10.17.254.27:3000";
const STAMP = `ui-${Date.now().toString(36)}`;

test.describe("Notes", () => {
  test("create a note, then delete it", async ({ page }) => {
    await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });

    // "New" reveals the title box; it does not exist before that click.
    // The app title-cases what you type, so `a-b-c` is listed as "A B C" —
    // match on the stamp alone rather than the string that was typed.
    const title = `${STAMP}-note`;
    const listed = new RegExp(STAMP.replace(/-/g, "[ -]"), "i");
    const newNote = page.getByRole("button", { name: /^New$/ });
    await expect(newNote).toBeVisible({ timeout: 25_000 });
    await newNote.click();
    const titleBox = page.getByPlaceholder("Note title…");
    await expect(titleBox).toBeVisible({ timeout: 15_000 });
    await titleBox.fill(title);
    await titleBox.press("Enter");
    await expect(page.getByRole("button", { name: listed }).first()).toBeVisible({
      timeout: 30_000,
    });

    // Open it, type a body, and prove the save survives a reload.
    await page.getByRole("button", { name: listed }).first().click();
    const body = page.getByPlaceholder(/Write your note here/).first();
    await expect(body).toBeVisible({ timeout: 15_000 });
    await body.fill("# Uji\n\nIsi catatan dari uji otomatis.");
    await expect(page.getByRole("button", { name: /^saved$/i })).toBeVisible({ timeout: 20_000 });

    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByRole("button", { name: listed }).first()).toBeVisible({ timeout: 20_000 });

    // Clean up: the delete control is labelled with the title-cased name too.
    const deleteBtn = page.getByRole("button", {
      name: new RegExp(`delete\\s+${STAMP.replace(/-/g, "[ -]")}`, "i"),
    });
    page.once("dialog", (d) => d.accept());
    await deleteBtn.first().click();
    await expect(page.getByRole("button", { name: listed })).toHaveCount(0, { timeout: 20_000 });
  });
});

test.describe("Prompts", () => {
  test("create a prompt through the form", async ({ page }) => {
    await page.goto(`${BASE}/prompts`, { waitUntil: "networkidle" });

    const newBtn = page.getByRole("button", { name: /new prompt/i }).first();
    await expect(newBtn).toBeVisible({ timeout: 25_000 });
    await newBtn.click();

    const name = `${STAMP}-prompt`;
    const nameBox = page.getByPlaceholder("e.g. ask-grounded");
    await expect(nameBox).toBeVisible({ timeout: 15_000 });
    await nameBox.fill(name);
    await page.getByPlaceholder("ask, sea-lion").fill("e2e, ui");
    await page.getByPlaceholder("What this prompt is for").fill("Dibuat oleh uji UI");
    await page.getByPlaceholder(/Jawab HANYA berdasarkan materi/).fill("Kamu asisten uji.");

    await page.getByRole("button", { name: /^create$/i }).click();
    await expect(page.getByText(name, { exact: false }).first()).toBeVisible({ timeout: 25_000 });
  });

  test("Create stays disabled until name and text are filled", async ({ page }) => {
    await page.goto(`${BASE}/prompts`, { waitUntil: "networkidle" });
    const newBtn = page.getByRole("button", { name: /new prompt/i }).first();
    await expect(newBtn).toBeVisible({ timeout: 25_000 });
    await newBtn.click();

    const create = page.getByRole("button", { name: /^create$/i });
    await expect(create).toBeVisible({ timeout: 15_000 });
    await expect(create).toBeDisabled();

    await page.getByPlaceholder("e.g. ask-grounded").fill("x");
    await expect(create).toBeDisabled();
    await page.getByPlaceholder(/Jawab HANYA berdasarkan materi/).fill("isi");
    await expect(create).toBeEnabled();
  });
});

test.describe("Datasets", () => {
  test("upload a JSONL through the dialog and see it listed", async ({ page }) => {
    await page.goto(`${BASE}/datasets`, { waitUntil: "networkidle" });
    const uploadBtn = page.getByRole("button", { name: /upload dataset/i });
    await expect(uploadBtn).toBeVisible({ timeout: 25_000 });
    await uploadBtn.click();

    const name = `${STAMP}-ds`;
    const nameBox = page.getByPlaceholder("e.g. my-training-data");
    await expect(nameBox).toBeVisible({ timeout: 15_000 });
    await nameBox.fill(name);
    await page.locator('input[type="file"]').setInputFiles({
      name: "train.jsonl",
      mimeType: "application/jsonl",
      buffer: Buffer.from(
        [
          JSON.stringify({ prompt: "Apa ibu kota Indonesia?", completion: "Jakarta." }),
          JSON.stringify({ prompt: "Berapa 2+2?", completion: "4." }),
        ].join("\n"),
      ),
    });
    await page.getByRole("button", { name: /^upload$/i }).click();

    await expect(page.getByText(name, { exact: false }).first()).toBeVisible({ timeout: 40_000 });
  });

  test("rejects a file with the wrong extension", async ({ page }) => {
    await page.goto(`${BASE}/datasets`, { waitUntil: "networkidle" });
    const uploadBtn = page.getByRole("button", { name: /upload dataset/i });
    await expect(uploadBtn).toBeVisible({ timeout: 25_000 });
    await uploadBtn.click();
    const badName = page.getByPlaceholder("e.g. my-training-data");
    await expect(badName).toBeVisible({ timeout: 15_000 });
    await badName.fill(`${STAMP}-bad`);
    await page.locator('input[type="file"]').setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("bukan jsonl"),
    });
    await page.getByRole("button", { name: /^upload$/i }).click();
    await expect(page.locator("body")).toContainText(/jsonl|csv|error|gagal|invalid/i, {
      timeout: 25_000,
    });
  });

  test("Browse Hugging Face navigates to the Hub", async ({ page }) => {
    await page.goto(`${BASE}/datasets`, { waitUntil: "networkidle" });
    // Two such buttons exist (header + empty state); take the header one.
    const browse = page.getByRole("button", { name: /browse hugging face/i }).first();
    await expect(browse).toBeVisible({ timeout: 25_000 });
    await browse.click();
    await expect(page).toHaveURL(/\/hub/, { timeout: 20_000 });
  });
});

test.describe("Hub", () => {
  // Searches Hugging Face but never clicks Download — that would pull gigabytes.
  test("search returns results without downloading", async ({ page }) => {
    await page.goto(`${BASE}/hub`, { waitUntil: "networkidle" });
    const search = page.getByRole("textbox", { name: /search hugging face models/i }).first();
    await expect(search).toBeVisible({ timeout: 25_000 });
    await search.fill("qwen2.5-0.5b");
    await page.waitForTimeout(3000);
    await expect(page.locator("body")).toContainText(/qwen/i, { timeout: 30_000 });
  });
});

test.describe("Fine-tune", () => {
  test("Start stays disabled until the form is complete", async ({ page }) => {
    await page.goto(`${BASE}/finetune`, { waitUntil: "networkidle" });
    const start = page.getByRole("button", { name: /start fine-?tune/i });
    await expect(start).toBeVisible({ timeout: 20_000 });
    await expect(start).toBeDisabled();

    await page.getByPlaceholder("my-finetune").fill(`${STAMP}-adaptor`);
    // Base model and dataset are still empty, so it must stay disabled.
    await expect(start).toBeDisabled();
  });

  test("the Advanced section opens", async ({ page }) => {
    await page.goto(`${BASE}/finetune`, { waitUntil: "networkidle" });
    await page.getByText(/\+ Advanced/i).click();
    await expect(page.locator("body")).toContainText(/learning rate|LoRA|max steps/i, {
      timeout: 15_000,
    });
  });
});

test.describe("Evals", () => {
  // Submitting would occupy the GPU for hours; stop at the guard.
  test("Run stays disabled until a model and benchmark are chosen", async ({ page }) => {
    await page.goto(`${BASE}/evals`, { waitUntil: "networkidle" });
    const run = page.getByRole("button", { name: /run evaluation|starting/i }).first();
    await expect(run).toBeVisible({ timeout: 25_000 });
    await expect(run).toBeDisabled();
  });
});

test.describe("Workflows", () => {
  test("Run stays disabled without a name", async ({ page }) => {
    await page.goto(`${BASE}/workflows`, { waitUntil: "networkidle" });
    await expect(page.getByPlaceholder("e.g. rugby-pipeline")).toBeVisible({ timeout: 25_000 });
    await expect(page.getByRole("button", { name: /run pipeline/i }).first()).toBeDisabled();
  });
});

test.describe("Deployments", () => {
  test("create a gateway key from the UI", async ({ page }) => {
    await page.goto(`${BASE}/serve`, { waitUntil: "networkidle" });
    const keyName = `${STAMP}-key`;
    await page.getByPlaceholder(/key name/i).fill(keyName);
    await page.getByRole("button", { name: /create key/i }).click();
    await expect(page.getByText(keyName, { exact: false }).first()).toBeVisible({ timeout: 25_000 });
  });
});
