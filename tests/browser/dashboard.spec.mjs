import { test, expect } from "@playwright/test";
import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
const legacy = {
  id: 1,
  model: "iPhone 15",
  storage_gb: 128,
  color: "Blue",
  battery_health: 92,
  condition: "Good",
  imei: "001234567890123",
  status: "In Stock",
  purchase_price: 2000,
  repair_cost: 100,
  other_cost: 50,
  selling_price: 3500,
  purchase_source: "Shop",
  notes: "Sample phone",
};
async function setup(page, employee = false) {
  let phones = [
    { ...legacy },
    { ...legacy, id: 2, model: "iPhone 14", status: "Sold" },
  ];
  const calls = [];
  await page.addInitScript(() => {
    localStorage.setItem(
      "sb-lager-test-auth-token",
      JSON.stringify({
        access_token: "test-session-token",
        refresh_token: "test-refresh",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        expires_in: 3600,
        token_type: "bearer",
        user: {
          id: "00000000-0000-4000-8000-000000000001",
          email: "test@example.com",
          aud: "authenticated",
          role: "authenticated",
        },
      }),
    );
  });
  await page.route("https://lager-test.supabase.co/**", async (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop(),
      body = route.request().postDataJSON() || {};
    calls.push({ name, body });
    let response = null;
    if (name === "lager_dashboard")
      response = {
        access: {
          role: employee ? "employee" : "admin",
          can_view_financials: !employee,
          can_delete: !employee,
        },
        phones: phones.map((p) => {
          const r = { ...p };
          if (employee) {
            delete r.purchase_price;
            delete r.repair_cost;
            delete r.other_cost;
          }
          return r;
        }),
        market_prices: [
          {
            model: "iPhone 15",
            storage_gb: 128,
            condition: "Good",
            source: "Tradera",
            market_price: 4000,
            listing_url: "https://example.com/item",
          },
          {
            model: "iPhone 15",
            storage_gb: 128,
            condition: "Good",
            source: "Blocket",
            market_price: 5000,
            listing_url: "",
          },
        ],
      };
    else if (name === "lager_save_phone") {
      if (body.phone_id)
        phones = phones.map((p) =>
          String(p.id) === body.phone_id ? { ...p, ...body.payload } : p,
        );
      else phones.push({ ...body.payload, id: phones.length + 1 });
    } else if (name === "lager_delete_phone")
      phones = phones.filter((p) => String(p.id) !== body.phone_id);
    else if (name === "lager_members") response = [];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(response),
    });
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Available Phones", exact: true }),
  ).toBeVisible();
  return calls;
}
test("inventory editing, search, sold separation and confirmed deletion", async ({
  page,
}) => {
  const calls = await setup(page);
  await expect(page.locator(".phone")).toHaveCount(1);
  await expect(page.locator(".phone")).toContainText("001234567890123");
  await page.getByLabel("Search inventory").fill("Blue 128");
  await expect(page.locator(".phone")).toHaveCount(1);
  await page.getByLabel("Search inventory").fill("iPhone 14");
  await expect(page.locator(".phone")).toHaveCount(0);
  await page.getByLabel("Search inventory").fill("");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Color", { exact: true }).fill("Green");
  await page.getByRole("button", { name: "Save Phone" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(calls.find((c) => c.name === "lager_save_phone").body.payload).toEqual(
    { color: "Green" },
  );
  await page.getByRole("button", { name: "Mark Sold" }).click();
  await expect(page.locator(".phone")).toHaveCount(0);
  await page.getByRole("button", { name: "Sold Phones", exact: true }).click();
  await expect(page.locator(".phone")).toHaveCount(2);
  await page
    .locator(".phone")
    .first()
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("cannot be undone");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(calls.filter((c) => c.name === "lager_delete_phone")).toHaveLength(0);
  await page
    .locator(".phone")
    .first()
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await page.getByRole("button", { name: "Delete Phone", exact: true }).click();
  await expect(page.locator(".phone")).toHaveCount(1);
  await page.getByRole("button", { name: "+ Add Phone" }).click();
  await page.getByLabel("Model", { exact: true }).fill("iPhone 16");
  await page.getByLabel("IMEI", { exact: true }).fill("009876543210123");
  await page.getByRole("button", { name: "Save Phone" }).click();
  await page
    .getByRole("button", { name: "Available Phones", exact: true })
    .click();
  await expect(page.locator(".phone")).toContainText("009876543210123");
});
test("Excel and PDF exports download selected columns with finances off by default", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(
    page.getByLabel("Purchase Price", { exact: true }),
  ).not.toBeChecked();
  await expect(page.getByLabel("Profit", { exact: true })).not.toBeChecked();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Export" }).click();
  const file = await download,
    book = new ExcelJS.Workbook();
  await book.xlsx.readFile(await file.path());
  const sheet = book.worksheets[0],
    headers = sheet.getRow(1).values;
  expect(headers).not.toContain("Purchase Price");
  expect(headers).not.toContain("Profit");
  expect(sheet.getRow(2).getCell(headers.indexOf("IMEI")).value).toBe(
    "001234567890123",
  );
  expect(sheet.rowCount).toBe(2);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByLabel("File format").selectOption("pdf");
  const pdfDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Export" }).click();
  const pdf = await pdfDownload;
  expect((await readFile(await pdf.path())).subarray(0, 5).toString()).toBe(
    "%PDF-",
  );
});
test("mobile layout, market calculations and restricted Employee controls", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("mobile-inventory.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Market Prices", exact: true })
    .click();
  await page.getByLabel("Model", { exact: true }).fill("iPhone 15");
  await page.getByLabel("Buy price (% of average market price)").fill("80");
  await page.getByLabel("Estimated repair and other costs (SEK)").fill("100");
  await expect(
    page.locator(".card").filter({ hasText: "Recommended Buy Price" }),
  ).toContainText("3,600");
  await expect(
    page.locator(".card").filter({ hasText: "Expected Profit" }),
  ).toContainText("800");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("mobile-market.png"),
    fullPage: true,
  });
  await page.unrouteAll();
  await setup(page, true);
  await expect(
    page.getByRole("button", { name: "Delete", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".phone")).not.toContainText("Purchase Price");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(
    page.getByLabel("Purchase Price (SEK)", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByLabel("Profit", { exact: true })).toHaveCount(0);
});
test("login retains English branding and password form", async ({ page }) => {
  await page.goto("/login");
  await expect(page).toHaveTitle("Lager iPhone");
  await expect(
    page.getByRole("heading", { name: "Lager iPhone" }),
  ).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
    "type",
    "password",
  );
});
