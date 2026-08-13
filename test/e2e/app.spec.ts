import { expect, test } from "@playwright/test";

test("loads the local app shell and gallery", async ({ page }) => {
  await page.goto("/gallery");
  await expect(page.getByRole("heading", { name: "Gallery" })).toBeVisible();
  await expect(page.getByRole("navigation").first()).toBeVisible();
});

test("gallery actions wrap inside a phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/gallery");
  const select = page.getByRole("button", { name: "Select" });
  await expect(select).toBeVisible();
  const box = await select.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("mobile generator opens on prompts and keeps every pane reachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/generate/e2e-pipeline");
  await page.getByRole("button", { name: /skip to the app/i }).click();

  const prompt = page.getByRole("button", { name: "Prompt", exact: true });
  const settings = page.getByRole("button", { name: "Settings", exact: true });
  const results = page.getByRole("button", { name: "Results", exact: true });
  await expect(prompt).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("textbox", { name: "Positive prompt" })).toBeVisible();

  await settings.click();
  await expect(settings).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("spinbutton", { name: "Width" })).toBeVisible();

  await results.click();
  await expect(results).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Set your parameters and hit Generate — results resolve here.")).toBeVisible();

  const generateBox = await page.getByRole("button", { name: "Generate", exact: true }).last().boundingBox();
  const notificationBox = await page.getByRole("button", { name: "Notifications" }).boundingBox();
  expect(generateBox).not.toBeNull();
  expect(notificationBox).not.toBeNull();
  const overlaps =
    notificationBox!.x < generateBox!.x + generateBox!.width &&
    notificationBox!.x + notificationBox!.width > generateBox!.x &&
    notificationBox!.y < generateBox!.y + generateBox!.height &&
    notificationBox!.y + notificationBox!.height > generateBox!.y;
  expect(overlaps).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});

test("Music 3 song authoring stays usable at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/generate/e2e-music");
  const skip = page.getByRole("button", { name: /skip to the app/i });
  await skip.click();
  await expect(skip).toBeHidden();

  await expect(page.getByRole("textbox", { name: "Caption" })).toBeVisible();
  const lyrics = page.getByRole("textbox", { name: "Lyrics" });
  await expect(lyrics).toBeVisible();
  await page.getByRole("button", { name: "[Chorus]", exact: true }).click();
  await expect(lyrics).toHaveValue("[Chorus]\n");
  await expect(page.getByRole("button", { name: "Song Studio" })).toBeVisible();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("slider", { name: "Max Duration slider" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});

test("generated songs open in the mobile gallery audio player", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/gallery");
  const skip = page.getByRole("button", { name: /skip to the app/i });
  await skip.click();
  await expect(skip).toBeHidden();

  await page.getByText("music3-mobile-smoke.wav").click();
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  await expect(page.getByText("MiniMax Music 3").last()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});

test("private phone access is one scan and remains usable at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings");
  await page.getByRole("button", { name: /skip to the app/i }).click({ timeout: 15_000 });

  const phoneUrl = page.getByRole("textbox", { name: "Private smartphone URL", exact: true });
  await expect(phoneUrl).toHaveValue("https://studio.example.ts.net", { timeout: 15_000 });
  await expect(page.getByTestId("phone-access-card")).toBeVisible();
  await expect(page.getByText("No IP address or pairing token needed.")).toBeVisible();
  await expect(page.getByTestId("phone-access-qr").locator("svg")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});
