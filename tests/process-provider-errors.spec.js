const { test, expect } = require("@playwright/test");

test("shows a safe actionable provider failure instead of a generic analyzer error @smoke", async ({ page }) => {
  await page.route("**/process/analyze", route => route.fulfill({
    status: 502,
    contentType: "application/json",
    headers: { "cache-control": "no-store" },
    body: JSON.stringify({
      error: "process_provider_rate_limited",
      providerStatus: 429,
      providerCode: "insufficient_quota",
      providerRequestId: "req-safe-123"
    })
  }));
  await page.goto("/state.html");

  const failure = await page.evaluate(async () => {
    try {
      await processFetch("/process/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      });
      return null;
    } catch (error) {
      return {
        code: error.code,
        status: error.status,
        providerStatus: error.providerStatus,
        providerCode: error.providerCode,
        providerRequestId: error.providerRequestId,
        message: processAnalysisFailureMessage(error)
      };
    }
  });

  expect(failure).toEqual({
    code: "process_provider_rate_limited",
    status: 502,
    providerStatus: 429,
    providerCode: "insufficient_quota",
    providerRequestId: "req-safe-123",
    message: "Der Prozess-Agent hat den Aufruf wegen Rate-Limit oder fehlender API-Quota abgelehnt (HTTP 429, insufficient_quota). Die Aufnahme wurde erkannt, aber nicht analysiert."
  });
});
