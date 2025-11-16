// debug-selectors.mjs
// Debug script to compare old vs new selectors

import { chromium } from "playwright";

const SERIES_URL = "https://www.npr.org/series/347174538/jazz-night-radio";

async function debugSelectors() {
  const browser = await chromium.launch({ headless: false });
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

    // Compare different selectors
    const selectorResults = await page.evaluate(() => {
      const results = {};
      
      // Old method: all download anchors
      const oldAnchors = Array.from(document.querySelectorAll("a")).filter((a) => {
        const text = (a.textContent || "").trim();
        const href = a.href || "";
        return /Download/i.test(text) && href.includes("ondemand.npr.org");
      });
      results.oldMethod = oldAnchors.length;
      
      // New method: article.item with li.audio-tool-download
      const articleItems = Array.from(document.querySelectorAll("article.item"));
      results.totalArticleItems = articleItems.length;
      
      const validArticles = articleItems.filter(article => {
        const downloadLi = article.querySelector("li.audio-tool-download");
        if (!downloadLi) return false;
        const downloadAnchor = downloadLi.querySelector("a");
        return downloadAnchor && downloadAnchor.href;
      });
      results.newMethod = validArticles.length;
      
      // Check what we're missing
      results.articlesWithoutDownload = articleItems.length - validArticles.length;
      
      // Sample article structure
      const firstArticle = articleItems[0];
      if (firstArticle) {
        results.firstArticleClasses = firstArticle.className;
        results.firstArticleHasDownload = !!firstArticle.querySelector("li.audio-tool-download");
        results.firstArticleText = firstArticle.textContent.substring(0, 200);
      }
      
      // Check for other potential selectors
      results.articleCount = document.querySelectorAll("article").length;
      results.articleItemCount = document.querySelectorAll("article.item").length;
      results.liAudioToolCount = document.querySelectorAll("li.audio-tool-download").length;
      results.liAudioToolsCount = document.querySelectorAll("li.audio-tool-download").length;
      results.audioToolDownloadCount = document.querySelectorAll(".audio-tool-download").length;
      
      return results;
    });

    console.log("\n=== SELECTOR COMPARISON ===");
    console.log("Old method (download anchors):", selectorResults.oldMethod);
    console.log("New method (article.item + li.audio-tool-download):", selectorResults.newMethod);
    console.log("Total article.item elements:", selectorResults.totalArticleItems);
    console.log("Articles without download:", selectorResults.articlesWithoutDownload);
    console.log("\n=== PAGE STRUCTURE ===");
    console.log("Total articles:", selectorResults.articleCount);
    console.log("article.item count:", selectorResults.articleItemCount);
    console.log("li.audio-tool-download count:", selectorResults.liAudioToolCount);
    console.log("li.audio-tools count:", selectorResults.liAudioToolsCount);
    console.log(".audio-tool-download count:", selectorResults.audioToolDownloadCount);
    
    if (selectorResults.firstArticleClasses) {
      console.log("\n=== FIRST ARTICLE INFO ===");
      console.log("Classes:", selectorResults.firstArticleClasses);
      console.log("Has download:", selectorResults.firstArticleHasDownload);
    }

    // Test clicking "Load More" button and scanning for li.audio-tools > a
    console.log("\n=== TESTING LOAD MORE BUTTON ===");
    
    // Check initial li.audio-tools > a count
    const initialAudioToolsCount = await page.evaluate(() => {
      return document.querySelectorAll("li.audio-tool-download > a").length;
    });
    console.log("Initial li.audio-tool-download > a count:", initialAudioToolsCount);
    
    // Look for and click the load more button
    const loadMoreButton = page.locator(".options__load-more");
    const buttonCount = await loadMoreButton.count();
    console.log("Load more buttons found:", buttonCount);
    
    if (buttonCount > 0) {
      const isVisible = await loadMoreButton.first().isVisible();
      const isEnabled = await loadMoreButton.first().isEnabled();
      console.log("Load more button - visible:", isVisible, "enabled:", isEnabled);
      
      if (isVisible && isEnabled) {
        console.log("Clicking load more button...");
        await loadMoreButton.first().click();
        
        console.log("Waiting 10 seconds for new content to load...");
        await page.waitForTimeout(10000);
        
        // Check li.audio-tools > a count after loading
        const afterLoadAudioToolsCount = await page.evaluate(() => {
          return document.querySelectorAll("li.audio-tool-download > a").length;
        });
        console.log("After load li.audio-tool-download > a count:", afterLoadAudioToolsCount);
        console.log("Difference:", afterLoadAudioToolsCount - initialAudioToolsCount);
        
        // Also check other selectors after load
        const afterLoadResults = await page.evaluate(() => {
          return {
            articleItems: document.querySelectorAll("article.item").length,
            liAudioToolDownload: document.querySelectorAll("li.audio-tool-download").length,
            liAudioTools: document.querySelectorAll("li.audio-tool-download").length,
            audioToolsAnchors: document.querySelectorAll("li.audio-tool-download > a").length
          };
        });
        
        console.log("After load - article.item count:", afterLoadResults.articleItems);
        console.log("After load - li.audio-tool-download count:", afterLoadResults.liAudioToolDownload);
        console.log("After load - li.audio-tool-download count:", afterLoadResults.liAudioTools);
        console.log("After load - li.aaudio-tool-download > a count:", afterLoadResults.audioToolsAnchors);
      } else {
        console.log("Load more button not clickable");
      }
    } else {
      console.log("No load more button found");
    }

    // Wait so we can see the page
    await page.waitForTimeout(5000);

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await browser.close();
  }
}

debugSelectors();