// debug-dates.mjs
// Quick debug script to see what dates are available on the page

import { chromium } from "playwright";

const SERIES_URL = "https://www.npr.org/series/347174538/jazz-night-radio";

async function debugDates() {
  const browser = await chromium.launch({ headless: false }); // Run with GUI to see what's happening
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  try {
    console.log("Loading page...");
    await page.goto(SERIES_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

    // Check for "The Radio Show" link
    const moreLink = page.locator('a:has-text("The Radio Show")');
    if ((await moreLink.count()) > 0) {
      console.log('Clicking "The Radio Show" link');
      await moreLink.first().click();
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(2000);
    }

    // Get first few episodes and their text content
    const episodeInfo = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll("a"));
      const downloadAnchors = anchors.filter((a) => {
        const text = (a.textContent || "").trim();
        const href = a.href || "";
        return /Download/i.test(text) && href.includes("ondemand.npr.org");
      }).slice(0, 3); // Just first 3 for debugging

      return downloadAnchors.map((a, index) => {
        let container = a.closest("article") || a.closest("li") || a.closest("section") || a.closest("div");
        if (!container) container = a.parentElement || document.body;

        const containerText = container.textContent || "";
        
        // Find title anchor
        function findTitleAnchor(start) {
          const MAX_DEPTH = 10;
          let node = start;
          let depth = 0;

          while (node && depth < MAX_DEPTH) {
            const candidates = Array.from(node.querySelectorAll("a")).filter((el) => {
              const href = el.href || "";
              const text = (el.textContent || "").trim();
              if (!text) return false;
              if (href.includes("ondemand.npr.org")) return false;
              if (href.includes("player/embed")) return false;
              if (!/\/20\d{2}\//.test(href)) return false;
              return true;
            });

            if (candidates.length > 0) {
              return candidates[0];
            }

            node = node.parentElement;
            depth++;
          }
          return null;
        }

        const titleAnchor = findTitleAnchor(container);
        const title = titleAnchor?.textContent?.trim() || "No title found";

        return {
          index: index + 1,
          title: title,
          audioUrl: a.href,
          containerText: containerText.substring(0, 500), // First 500 chars
        };
      });
    });

    console.log("\n=== EPISODE DEBUG INFO ===");
    episodeInfo.forEach(info => {
      console.log(`\nEPISODE ${info.index}:`);
      console.log(`Title: ${info.title}`);
      console.log(`Audio URL: ${info.audioUrl}`);
      console.log(`Container text: ${info.containerText}`);
      console.log("---");
    });

    // Wait a bit so we can see the page
    await page.waitForTimeout(5000);

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await browser.close();
  }
}

debugDates();