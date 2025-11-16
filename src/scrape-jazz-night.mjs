// scrape-jazz-night.mjs
//
// Scrapes NPR's "Jazz Night In America: The Radio Program" archive,
// expanding with ".options__load-more", then collects each episode's:
//  - title
//  - date
//  - MP3 download URL
// and builds a Zune-compatible RSS 2.0 feed with channel artwork,
// valid per W3C (no bad HTML in <description>, includes atom:link rel="self").

import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";

// Configuration - can be overridden by environment variables or command line args
const SERIES_URL = process.env.SERIES_URL || process.argv[2] || "https://www.npr.org/series/347174538/jazz-night-radio";
const OUTPUT_FILE = process.env.OUTPUT_FILE || process.argv[3] || "feeds/jazz-night-zune.xml";
const MAX_EPISODES = parseInt(process.env.MAX_EPISODES || process.argv[4] || "100", 10);
const SELF_FEED_URL = process.env.SELF_FEED_URL || process.argv[5] || "https://cardner.github.io/jazz-night-feed/jazz-night-zune.xml";

console.log("Configuration:");
console.log(`  SERIES_URL: ${SERIES_URL}`);
console.log(`  OUTPUT_FILE: ${OUTPUT_FILE}`);
console.log(`  MAX_EPISODES: ${MAX_EPISODES}`);
console.log(`  SELF_FEED_URL: ${SELF_FEED_URL}`);

// Channel metadata
const FEED_TITLE = "Jazz Night In America: The Radio Program (Full Archive)";
const FEED_LINK = SERIES_URL;
const FEED_DESCRIPTION =
  "Scraped archive of NPR's Jazz Night In America radio episodes, with direct MP3 enclosures, formatted for Zune.";
const FEED_LANGUAGE = "en-us";

function escapeXml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Remove any HTML tags so description is plain text that W3C
// HTML checker won't choke on (no stray <iframe>, etc.)
function sanitizeDescription(desc = "") {
  return String(desc)
    .replace(/<[^>]*>/g, "") // strip tags
    .replace(/\s+/g, " ") // collapse whitespace
    .trim();
}

function parseDateToRss(dateText, fallback = new Date()) {
  if (!dateText || dateText.trim() === "") {
    console.log("No date text provided, using fallback");
    return fallback.toUTCString();
  }
  
  // Try parsing the date directly first
  let d = new Date(dateText);
  
  // If that fails, try some common transformations
  if (Number.isNaN(d.getTime())) {
    // Try converting slash dates to standard format
    if (dateText.includes("/")) {
      const parts = dateText.split("/");
      if (parts.length === 3) {
        // Assume MM/DD/YYYY format
        const reformatted = `${parts[0]}/${parts[1]}/${parts[2]}`;
        d = new Date(reformatted);
      }
    }
  }
  
  if (!Number.isNaN(d.getTime())) {
    console.log(`Parsed date: "${dateText}" → ${d.toUTCString()}`);
    return d.toUTCString(); // RFC-1123 is fine for RSS/Zune
  } else {
    console.log(`Failed to parse date: "${dateText}", using fallback: ${fallback.toUTCString()}`);
    return fallback.toUTCString();
  }
}

function buildRss(episodes, channelImageUrl) {
  // Sort newest first and limit to MAX_EPISODES
  episodes.sort((a, b) => b.dateObj - a.dateObj);
  episodes = episodes.slice(0, MAX_EPISODES);

  const now = new Date();
  const lastBuildDate = now.toUTCString();

  const itemsXml = episodes
    .map((ep) => {
      const title = escapeXml(ep.title || "Untitled episode");
      const link = escapeXml(ep.link || FEED_LINK);

      const sanitizedDesc = sanitizeDescription(ep.description || "");
      const desc = escapeXml(sanitizedDesc);

      const pubDate = escapeXml(ep.pubDate || lastBuildDate);
      const audioUrl = escapeXml(ep.audioUrl);
      const guid = escapeXml(ep.guid || ep.audioUrl);

      return (
        "  <item>\n" +
        `    <title>${title}</title>\n` +
        `    <link>${link}</link>\n` +
        `    <guid isPermaLink="false">${guid}</guid>\n` +
        `    <pubDate>${pubDate}</pubDate>\n` +
        `    <description>${desc}</description>\n` +
        `    <enclosure url="${audioUrl}" length="0" type="audio/mpeg" />\n` +
        "  </item>"
      );
    })
    .join("\n\n");

  const imageBlock = channelImageUrl
    ? [
        "  <image>",
        `    <url>${escapeXml(channelImageUrl)}</url>`,
        `    <title>${escapeXml(FEED_TITLE)}</title>`,
        `    <link>${escapeXml(FEED_LINK)}</link>`,
        "  </image>",
        // Optional iTunes-style artwork tag
        `  <itunes:image href="${escapeXml(channelImageUrl)}" />`,
        "",
      ].join("\n")
    : "";

  const channelDescription = escapeXml(sanitizeDescription(FEED_DESCRIPTION));

  const rss =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0"\n' +
    '     xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"\n' +
    '     xmlns:atom="http://www.w3.org/2005/Atom">\n' +
    "<channel>\n" +
    `  <title>${escapeXml(FEED_TITLE)}</title>\n` +
    `  <link>${escapeXml(FEED_LINK)}</link>\n` +
    // Atom self-link required by the validator
    `  <atom:link href="${escapeXml(
      SELF_FEED_URL
    )}" rel="self" type="application/rss+xml" />\n` +
    `  <description>${channelDescription}</description>\n` +
    `  <language>${escapeXml(FEED_LANGUAGE)}</language>\n` +
    `  <lastBuildDate>${escapeXml(lastBuildDate)}</lastBuildDate>\n\n` +
    imageBlock +
    itemsXml +
    "\n</channel>\n</rss>\n";

  return rss;
}

async function gotoArchive(page) {
  console.log("Loading series page:", SERIES_URL);

  await page.goto(SERIES_URL, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });

  // If there is a separate archive/“More from …” link, click it.
  const moreLink = page.locator(
    'a:has-text("The Radio Show")'
  );

  if ((await moreLink.count()) > 0) {
    console.log('Clicking "The Radio Show" link');
    await moreLink.first().click();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000); // Match debug script timing
  } else {
    console.log('No dedicated "The Radio Show" archive link found.');
  }
}

async function expandAllStories(page) {
  console.log(`Expanding stories via .options__load-more (up to ${MAX_EPISODES} episodes)…`);
  
  // Initial wait for page to fully load
  console.log("Waiting for page to fully load...");
  await page.waitForTimeout(3000);
  
  let clickCount = 0;
  const maxClicks = 50; // Prevent infinite loops
  let lastEpisodeCount = 0;
  let noChangeCount = 0;

  while (true) {
    // Skip scrolling to match debug script behavior
    // await page.evaluate(() => {
    //   window.scrollTo(0, document.body.scrollHeight);
    // });
    // await page.waitForTimeout(1200);

    // Check current episode count before clicking
    const currentEpisodeCount = await page.evaluate(() => {
      const articleItems = Array.from(document.querySelectorAll("article.item"));
      return articleItems.filter(article => {
        const downloadLi = article.querySelector("li.audio-tool-download");
        if (!downloadLi) return false;
        const downloadAnchor = downloadLi.querySelector("a");
        return downloadAnchor && downloadAnchor.href;
      }).length;
    });

    if (currentEpisodeCount >= MAX_EPISODES) {
      console.log(`Reached episode limit of ${MAX_EPISODES} (found ${currentEpisodeCount}) — stopping.`);
      break;
    }

    // Safety check for infinite loops
    if (clickCount >= maxClicks) {
      console.log(`Maximum click limit reached (${maxClicks}) — stopping to prevent infinite loop.`);
      break;
    }

    const loadMoreButton = page.locator(".options__load-more");
    const count = await loadMoreButton.count();

    if (count === 0) {
      console.log(`No ".options__load-more" button found (${currentEpisodeCount} episodes found) — stopping.`);
      break;
    }

    const btn = loadMoreButton.first();
    const visible = await btn.isVisible().catch(() => false);
    if (!visible) {
      console.log(`".options__load-more" exists but isn't visible (${currentEpisodeCount} episodes found) — stopping.`);
      break;
    }

    clickCount++;
    console.log(`Clicking ".options__load-more" (click ${clickCount}, ${currentEpisodeCount} episodes found so far)...`);
    try {
      await btn.click({ force: true });
    } catch (e) {
      console.log('Failed clicking ".options__load-more":', e.message);
      break;
    }

    // Wait 10 seconds for content to load after clicking
    console.log("Waiting 10 seconds for new content to load...");
    await page.waitForTimeout(10000);
    
    // Check episode count after waiting to see if new content loaded
    const newEpisodeCount = await page.evaluate(() => {
      const articleItems = Array.from(document.querySelectorAll("article.item"));
      return articleItems.filter(article => {
        const downloadLi = article.querySelector("li.audio-tool-download");
        if (!downloadLi) return false;
        const downloadAnchor = downloadLi.querySelector("a");
        return downloadAnchor && downloadAnchor.href;
      }).length;
    });

    // Check if episode count hasn't changed (indicates no more episodes loading)
    if (newEpisodeCount === lastEpisodeCount) {
      noChangeCount++;
      console.log(`Episode count unchanged: ${newEpisodeCount} (attempt ${noChangeCount}/3)`);
      if (noChangeCount >= 3) {
        console.log(`Episode count unchanged after ${noChangeCount} attempts (${newEpisodeCount} episodes) — stopping.`);
        break;
      }
    } else {
      console.log(`Episode count increased: ${lastEpisodeCount} → ${newEpisodeCount} (+${newEpisodeCount - lastEpisodeCount})`);
      noChangeCount = 0; // Reset counter if count changed
    }
    lastEpisodeCount = newEpisodeCount;
  }
  
  // Final count
  const finalCount = await page.evaluate(() => {
    const articleItems = Array.from(document.querySelectorAll("article.item"));
    return articleItems.filter(article => {
      const downloadLi = article.querySelector("li.audio-tool-download");
      if (!downloadLi) return false;
      const downloadAnchor = downloadLi.querySelector("a");
      return downloadAnchor && downloadAnchor.href;
    }).length;
  });
  
  console.log(`Finished expanding. Final episode count: ${finalCount}`);
}

async function scrapeChannelImage(page) {
  console.log("Looking for channel image…");
  const url = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll("img"));

    const hero =
      imgs.find((img) =>
        /jazz night in america/i.test(
          (img.alt || "") + " " + (img.title || "")
        )
      ) || imgs[0];

    return hero ? hero.src : "";
  });

  if (url) {
    console.log("Channel image found:", url);
  } else {
    console.log("No channel image found; feed will have no <image>.");
  }

  return url;
}

async function scrapeEpisodes(page) {
  console.log("Collecting episodes from page…");

  const episodes = await page.evaluate(() => {
    // The div[data-item-selector="article.item"] exists but doesn't contain the episodes
    // Use direct search for article.item elements which works reliably
    const articleItems = Array.from(document.querySelectorAll("article.item"));

    const results = [];

    for (const article of articleItems) {
      // Look for li.audio-tool-download within this article
      const downloadLi = article.querySelector("li.audio-tool-download");
      if (!downloadLi) continue;

      // Find the download link within the li element
      const downloadAnchor = downloadLi.querySelector("a[href*='ondemand.npr.org']");
      if (!downloadAnchor || !downloadAnchor.href) continue;

      const audioUrl = downloadAnchor.href;

      // Find the title anchor within the article
      // Look for links that go to NPR article pages (contain year in path)
      const titleAnchor = Array.from(article.querySelectorAll("a")).find((el) => {
        const href = el.href || "";
        const text = (el.textContent || "").trim();
        // Must have text, not be a download/embed link, and have year in path
        return text && 
               !href.includes("ondemand.npr.org") && 
               !href.includes("player/embed") && 
               /\/20\d{2}\//.test(href);
      });

      const title = titleAnchor?.textContent?.trim() || "Untitled episode";
      const link = titleAnchor?.href || audioUrl;

      // Use the entire article as context for extracting information
      const contextText = article.textContent || "";

      // Try multiple date extraction strategies
      let dateText = "";
      
      // Strategy 1: Extract date from the audio URL (most reliable for NPR)
      // NPR URLs often contain dates like: /2025/10/20251014_specials_...
      const urlDateMatch = audioUrl.match(/\/(\d{4})\/\d{2}\/(\d{8})/);
      if (urlDateMatch) {
        const dateStr = urlDateMatch[2]; // e.g., "20251014"
        if (dateStr.length === 8) {
          const year = dateStr.substring(0, 4);
          const month = dateStr.substring(4, 6);
          const day = dateStr.substring(6, 8);
          dateText = `${year}-${month}-${day}`;
        }
      }
      
      // Strategy 2: Look for full month name dates in context
      if (!dateText) {
        let dateMatch = contextText.match(
          /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/
        );
        
        if (dateMatch) {
          dateText = dateMatch[0];
        } else {
          // Strategy 3: Look for abbreviated month dates
          dateMatch = contextText.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}\b/);
          if (dateMatch) {
            dateText = dateMatch[0];
          } else {
            // Strategy 4: Look for ISO-style dates
            dateMatch = contextText.match(/\b\d{4}-\d{2}-\d{2}\b/);
            if (dateMatch) {
              dateText = dateMatch[0];
            } else {
              // Strategy 5: Look for slash dates
              dateMatch = contextText.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/);
              if (dateMatch) {
                dateText = dateMatch[0];
              }
            }
          }
        }
      }

      let description = "";
      const bulletIndex = contextText.indexOf("•");
      if (bulletIndex !== -1) {
        description = contextText
          .slice(bulletIndex + 1)
          .replace(/\s+/g, " ")
          .trim();
      }

      if (!description) {
        // Look for description text in the article
        const blocks = Array.from(
          article.querySelectorAll("p, span, div")
        ).map((el) => (el.textContent || "").trim());
        for (const block of blocks) {
          if (
            block &&
            block.length > 40 &&
            !block.includes(title) &&
            !block.includes("Listen ·") &&
            !block.includes("Download") &&
            !block.includes("Embed")
          ) {
            description = block;
            break;
          }
        }
      }

      // Debug logging for date extraction issues only
      if (!dateText && title) {
        console.log(`No date found for episode: "${title.substring(0, 50)}..."`);
        console.log(`Context text sample: "${contextText.substring(0, 200)}..."`);
      }

      results.push({
        title,
        link,
        dateText,
        audioUrl,
        description,
      });
    }

    const seen = new Set();
    return results.filter((ep) => {
      if (seen.has(ep.audioUrl)) return false;
      seen.add(ep.audioUrl);
      return true;
    });
  });

  console.log(`Found ${episodes.length} episodes with MP3 download links.`);
  
  // Apply episode limit here as well (in case we got more than expected)
  if (episodes.length > MAX_EPISODES) {
    console.log(`Limiting to ${MAX_EPISODES} most recent episodes.`);
    return episodes.slice(0, MAX_EPISODES);
  }
  
  return episodes;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  page.setDefaultNavigationTimeout(120_000);
  page.setDefaultTimeout(60_000);

  try {
    await gotoArchive(page);
    await expandAllStories(page);

    const channelImageUrl = await scrapeChannelImage(page);
    const rawEpisodes = await scrapeEpisodes(page);

    const episodes = rawEpisodes.map((ep) => {
      const dateObj = ep.dateText ? new Date(ep.dateText) : new Date();
      return {
        ...ep,
        dateObj,
        pubDate: parseDateToRss(ep.dateText || "", dateObj),
        guid: ep.audioUrl,
      };
    });

    const rss = buildRss(episodes, channelImageUrl);
    await writeFile(OUTPUT_FILE, rss, "utf8");
    console.log(`Wrote RSS feed to ${OUTPUT_FILE}`);
  } catch (err) {
    console.error("Error while scraping/building feed:");
    console.error(err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
