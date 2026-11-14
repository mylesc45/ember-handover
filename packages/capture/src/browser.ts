import { chromium, type Browser } from "playwright-core";

/** Header the proxy honours to skip bridge injection in Handoff's own headless pages. */
export const HEADLESS_HEADER = "x-handoff-headless";

/**
 * Prefer the Chrome the user already has; fall back to a Playwright-managed Chromium if one
 * is installed. Never downloads anything (see DECISIONS.md D28).
 */
export async function launchBrowser(): Promise<{ browser: Browser; kind: "chrome" | "chromium" }> {
  try {
    return { browser: await chromium.launch({ channel: "chrome", headless: true }), kind: "chrome" };
  } catch {
    return { browser: await chromium.launch({ headless: true }), kind: "chromium" };
  }
}
