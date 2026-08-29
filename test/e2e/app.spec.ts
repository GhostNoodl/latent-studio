import { expect, test } from "@playwright/test";

test("loads the Latent Core shell and Library", async ({ page }) => {
  await page.goto("/gallery");
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
  await expect(page.getByRole("navigation").first()).toBeVisible();
  await expect(page.getByRole("navigation").first().getByRole("link")).toHaveCount(4);
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

test("Krea 2 exposes Turbo-safe controls and licensed model installation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/generate/e2e-krea2");

  await expect(page.getByRole("textbox", { name: "Prompt" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /negative/i })).toHaveCount(0);
  await expect(page.getByText(/pipeline needs 3 models/i)).toBeVisible();
  await expect(page.getByRole("link", { name: "License" })).toHaveCount(3);

  await page.getByRole("button", { name: "Get all" }).click();
  await expect(page.getByRole("heading", { name: /Accept Krea 2 Community License/i })).toBeVisible();
  await expect(page.getByText(/krea-2-licensing/)).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("slider", { name: "Width slider" })).toHaveValue("1024");
  await expect(page.getByRole("slider", { name: "Steps slider" })).toHaveValue("8");
  await expect(page.getByRole("slider", { name: "Cfg slider" })).toHaveValue("1");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);

  await expect(page.getByRole("button", { name: "HomoFidelis", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Krea 2 model" }).click();
  await page.getByRole("button", { name: /homofidelis/i }).click();
  await expect(page).toHaveURL(/\/generate\/e2e-krea2$/);
  await expect(page.getByText("homofidelisKrea2NSFW_v10TURBOINT8Convrot.safetensors")).toBeVisible();
  await page.getByRole("button", { name: "Prompt", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Prompt" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /negative/i })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});

test("Reuse on an upscaled image restores its source generation settings", async ({ page }) => {
  await page.goto("/generate/e2e-pipeline");

  await page.getByTitle("Reuse these settings").first().click();
  await expect(page.getByRole("textbox", { name: "Positive prompt" })).toHaveValue(
    "recovered original prompt",
  );
  await expect(page.getByRole("textbox", { name: "Negative prompt" })).toHaveValue("blurry");
  await expect(page.getByRole("spinbutton", { name: "Width" })).toHaveValue("768");
});

test("Music 3 song authoring stays usable at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/generate/e2e-music");

  await expect(page.getByRole("textbox", { name: "Caption" })).toBeVisible();
  const lyrics = page.getByRole("textbox", { name: "Lyrics" });
  await expect(lyrics).toBeVisible();
  await page.getByRole("button", { name: "[Chorus]", exact: true }).click();
  await expect(lyrics).toHaveValue("[Chorus]\n");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("slider", { name: "Max Duration slider" })).toBeVisible();
  await page.getByTitle("More tools").click();
  await expect(page.getByRole("button", { name: "Song Studio" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});

test("generated songs open in the mobile gallery audio player", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/gallery");

  await page.getByText("music3-mobile-smoke.wav").click();
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  await expect(page.getByText("MiniMax Music 3").last()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});

test("private phone access is one scan and remains usable at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings");

  const phoneUrl = page.getByRole("textbox", { name: "Private smartphone URL", exact: true });
  await expect(phoneUrl).toHaveValue("https://studio.example.ts.net", { timeout: 15_000 });
  await expect(page.getByTestId("phone-access-card")).toBeVisible();
  await expect(page.getByText("No IP address or pairing token needed.")).toBeVisible();
  await expect(page.getByTestId("phone-access-qr").locator("svg")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});

test("Models keeps installed and browse views under one destination", async ({ page }) => {
  await page.goto("/models");
  await expect(page.getByRole("heading", { name: "Models" })).toBeVisible();
  await page.getByRole("link", { name: "Browse", exact: true }).click();
  await expect(page).toHaveURL(/\/models\?tab=browse$/);
  await expect(page.getByRole("heading", { name: "Browse" })).toBeVisible();
  await expect(page.getByPlaceholder("Search Civitai…")).toBeVisible();
});
