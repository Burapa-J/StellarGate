/* XSS regression for merchant-controlled fields (#800) and sign-out wipe (#797).
 *
 * `memo`, `webhook_url` and webhook event names are written into the DOM. The
 * list and webhook responses are rewritten in flight to carry markup payloads;
 * nothing may execute, and the text must appear literally.
 */

import { test, expect } from "./fixtures.js";

const PAYLOADS = {
  memo: `<img src=x onerror="window.__xss='memo'">`,
  webhook_url: `https://x.test/"><script>window.__xss='url'</script>`,
  event: `<svg onload="window.__xss='event'">`,
};

test.describe("dashboard XSS", () => {
  test("hostile merchant fields render literally and never execute", async ({
    page,
    apiKey,
  }) => {
    await page.route(/\/v1\/payments(\?.*)?$/, async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      const list = body.payments || body.data || body.items || body;
      for (const p of Array.isArray(list) ? list : []) {
        p.memo = PAYLOADS.memo;
        p.webhook_url = PAYLOADS.webhook_url;
      }
      await route.fulfill({ response: res, json: body });
    });
    await page.route(/\/v1\/payments\/[^/?]+\/webhooks/, async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      const list = body.deliveries || body.data || body;
      for (const d of Array.isArray(list) ? list : []) {
        d.event = PAYLOADS.event;
        d.url = PAYLOADS.webhook_url;
      }
      await route.fulfill({ response: res, json: body });
    });

    await page.goto("/dashboard");
    await page.getByLabel("API key").fill(apiKey);
    await page.getByRole("button", { name: "Sign in" }).click();
    const first = page.locator("#rows tr").first();
    await expect(first).toBeVisible();
    await first.click();
    await expect(page.locator("#detail")).toBeVisible();
    await page.waitForTimeout(300);

    await expect(page.locator("#rows").getByText(PAYLOADS.memo).first()).toBeVisible();
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    expect(await page.locator("#rows img, #detail img, #detail script").count()).toBe(0);
  });

  test("sign-out leaves no payment ids in the document", async ({
    signedIn: page,
    seedData,
  }) => {
    const ids = Object.values(seedData.payments).map((p) => p.id);
    await page.locator("#rows tr").first().click();
    await expect(page.locator("#detail")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.locator("#sign-out").click();
    await expect(page.locator("#gate")).toBeVisible();

    const html = await page.evaluate(() => document.documentElement.outerHTML);
    for (const id of ids) expect(html).not.toContain(id);
    await expect(page.locator("#rows tr")).toHaveCount(0);
    await expect(page.locator("#summary")).toBeEmpty();
  });
});
