import { expect, test } from "@playwright/test";

test("home renders search and fits the viewport", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("combobox", { name: "Search movies" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("coverage dashboard lists elCinema as a working integration", async ({ page }) => {
  await page.goto("/providers");
  await expect(page.locator('[data-provider="elcinema"]').getByText("Working", { exact: true })).toBeVisible();
  await expect(page.locator('[data-provider="vox-egypt"]').getByText("Partially supported", { exact: true })).toBeVisible();
  // providers without an integration must never be presented as working
  await expect(page.locator('[data-provider="renaissance"]').getByText("Not yet integrated", { exact: true })).toBeVisible();
});

test("protected pages redirect to sign-in", async ({ page }) => {
  await page.goto("/watchlist");
  await expect(page).toHaveURL(/\/login\?next=%2Fwatchlist|\/login\?next=\/watchlist/);
});

test("watchlist API rejects anonymous users", async ({ request }) => {
  const res = await request.post("/api/watchlist", { data: { tmdbId: 550 } });
  expect(res.status()).toBe(401);
});

test("health endpoint reports worker and DB state", async ({ request }) => {
  const res = await request.get("/api/health");
  const body = await res.json();
  expect(body).toHaveProperty("db");
  expect(body).toHaveProperty("worker");
});

// Needs TMDB credentials on the server.
test("search → movie page shows Egyptian availability", async ({ page }) => {
  test.skip(!process.env.E2E_TMDB, "set E2E_TMDB=1 when the server has TMDB credentials");
  await page.goto("/");
  await page.getByRole("combobox", { name: "Search movies" }).fill("Inception");
  await page.getByRole("option").first().click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Booking availability in Egypt")).toBeVisible();
  await expect(page.getByRole("button", { name: /Notify me|Tracking/ })).toBeVisible();
});
