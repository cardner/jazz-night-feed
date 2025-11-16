// update-jazz-night.mjs
//
// Incremental updater for NPR's "Jazz Night In America: The Radio Program" feed.
// Checks for recent episodes and adds only new ones to the existing XML file.
// More efficient than full scrape for regular updates.

import { readFile, writeFile, access } from "node:fs/promises";
import { chromium } from "playwright";
import { parseStringPromise, Builder } from "xml2js";

const SERIES_URL = "https://www.npr.org/series/347174538/jazz-night-radio";
const OUTPUT_FILE = "feeds/jazz-night-zune.xml";
const MAX_EPISODES = 100; // Keep same limit as full scrape
const MAX_NEW_EPISODES_TO_CHECK = 20; // Only check first 20 episodes for updates

// IMPORTANT: set this to the URL where this feed file will be hosted
const SELF_FEED_URL =
  "https://cardner.github.io/jazz-night-feed/jazz-night-zune.xml";

// Channel metadata (same as main scraper)
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

function sanitizeDescription(desc = "") {
  return String(desc)
    .replace(/<[^>]*>/g, "") // strip tags
    .replace(/\s+/g, " ") // collapse whitespace
    .trim();
}

function parseDateToRss(dateText, fallback = new Date()) {
  const d = new Date(dateText);
  if (!Number.isNaN(d.getTime())) {
    return d.toUTCString();
  }
  return fallback.toUTCString();
}

async function checkFileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadExistingFeed() {
  const exists = await checkFileExists(OUTPUT_FILE);
  if (!exists) {
    console.log("No existing feed found. Run 'npm run build' first to create initial feed.");
    process.exit(1);
  }

  const xmlContent = await readFile(OUTPUT_FILE, "utf8");
  const parsed = await parseStringPromise(xmlContent);
  return parsed;
}

function extractExistingAudioUrls(feedData) {
  const items = feedData?.rss?.channel?.[0]?.item || [];
  const audioUrls = new Set();
  
  items.forEach(item => {
    const enclosure = item?.enclosure?.[0];
    if (enclosure?.$.url) {
      audioUrls.add(enclosure.$.url);
    }
  });
  
  return audioUrls;
}

async function scrapeRecentEpisodes(page) {
  console.log(`Checking for recent episodes (up to ${MAX_NEW_EPISODES_TO_CHECK})...`);

  await page.goto(SERIES_URL, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });

  // Check for "The Radio Show" link
  const moreLink = page.locator('a:has-text("The Radio Show")');
  if ((await moreLink.count()) > 0) {
    console.log('Clicking "The Radio Show" link');
    await moreLink.first().click();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1500);
  }

  // Don't expand all - just get what's initially loaded
  const episodes = await page.evaluate((maxCheck) => {
    const anchors = Array.from(document.querySelectorAll("a"));
    const downloadAnchors = anchors.filter((a) => {
      const text = (a.textContent || "").trim();
      const href = a.href || "";
      return /Download/i.test(text) && href.includes("ondemand.npr.org");
    });

    // Only check the first maxCheck episodes
    const episodesToCheck = downloadAnchors.slice(0, maxCheck);
    const results = [];

    for (const a of episodesToCheck) {
      const audioUrl = a.href;
      if (!audioUrl) continue;

      let container =
        a.closest("article") ||
        a.closest("li") ||
        a.closest("section") ||
        a.closest("div");
      if (!container) container = a.parentElement || document.body;

      function findTitleAnchor(start) {
        const MAX_DEPTH = 10;
        let node = start;
        let depth = 0;

        while (node && depth < MAX_DEPTH) {
          const candidates = Array.from(
            node.querySelectorAll("a")
          ).filter((el) => {
            const href = el.href || "";
            const text = (el.textContent || "").trim();
            if (!text) return false;
            if (href.includes("ondemand.npr.org")) return false;
            if (href.includes("player/embed")) return false;
            if (!/\/20\d{2}\//.test(href)) return false;
            return true;
          });

          if (candidates.length > 0) {
            const headingCandidate =
              candidates.find((el) =>
                /H[12]/i.test(el.parentElement?.tagName || "")
              ) || candidates[0];
            return headingCandidate;
          }

          node = node.parentElement;
          depth++;
        }

        return null;
      }

      const titleAnchor = findTitleAnchor(container);
      const title = titleAnchor?.textContent?.trim() || "Untitled episode";
      const link = titleAnchor?.href || audioUrl;

      let contextText = "";
      if (titleAnchor && titleAnchor.parentElement) {
        contextText = titleAnchor.parentElement.textContent || "";
      } else {
        contextText = container.textContent || "";
      }

      const dateMatch = contextText.match(
        /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/
      );
      const dateText = dateMatch ? dateMatch[0] : "";

      let description = "";
      const bulletIndex = contextText.indexOf("•");
      if (bulletIndex !== -1) {
        description = contextText
          .slice(bulletIndex + 1)
          .replace(/\s+/g, " ")
          .trim();
      }

      if (!description) {
        const blocks = Array.from(
          container.querySelectorAll("p, span, div")
        ).map((el) => (el.textContent || "").trim());
        for (const block of blocks) {
          if (
            block &&
            block.length > 40 &&
            !block.includes(title) &&
            !block.includes("Listen ·")
          ) {
            description = block;
            break;
          }
        }
      }

      results.push({
        title,
        link,
        dateText,
        audioUrl,
        description,
      });
    }

    // Remove duplicates
    const seen = new Set();
    return results.filter((ep) => {
      if (seen.has(ep.audioUrl)) return false;
      seen.add(ep.audioUrl);
      return true;
    });
  }, MAX_NEW_EPISODES_TO_CHECK);

  console.log(`Found ${episodes.length} recent episodes to check.`);
  return episodes;
}

function createItemXml(episode) {
  const title = escapeXml(episode.title || "Untitled episode");
  const link = escapeXml(episode.link || FEED_LINK);
  const sanitizedDesc = sanitizeDescription(episode.description || "");
  const desc = escapeXml(sanitizedDesc);
  const pubDate = escapeXml(episode.pubDate);
  const audioUrl = escapeXml(episode.audioUrl);
  const guid = escapeXml(episode.guid || episode.audioUrl);

  return {
    title: [title],
    link: [link],
    guid: [{ _: guid, $: { isPermaLink: "false" } }],
    pubDate: [pubDate],
    description: [desc],
    enclosure: [{ $: { url: audioUrl, length: "0", type: "audio/mpeg" } }]
  };
}

async function updateFeedWithNewEpisodes(existingFeed, newEpisodes, existingUrls) {
  const newEpisodesFiltered = newEpisodes.filter(ep => !existingUrls.has(ep.audioUrl));
  
  if (newEpisodesFiltered.length === 0) {
    console.log("No new episodes found. Feed is up to date.");
    return false;
  }

  console.log(`Found ${newEpisodesFiltered.length} new episodes to add.`);

  // Convert new episodes to proper format
  const processedNewEpisodes = newEpisodesFiltered.map((ep) => {
    const dateObj = ep.dateText ? new Date(ep.dateText) : new Date();
    return {
      ...ep,
      dateObj,
      pubDate: parseDateToRss(ep.dateText || "", dateObj),
      guid: ep.audioUrl,
    };
  });

  // Get existing items
  const existingItems = existingFeed.rss.channel[0].item || [];

  // Create XML objects for new episodes
  const newItemsXml = processedNewEpisodes.map(createItemXml);

  // Combine and sort all episodes
  const allItems = [...newItemsXml, ...existingItems];
  
  // Sort by pubDate (newest first) and limit to MAX_EPISODES
  allItems.sort((a, b) => {
    const dateA = new Date(a.pubDate[0]);
    const dateB = new Date(b.pubDate[0]);
    return dateB - dateA;
  });

  // Limit to MAX_EPISODES
  const limitedItems = allItems.slice(0, MAX_EPISODES);

  // Update the feed
  existingFeed.rss.channel[0].item = limitedItems;
  existingFeed.rss.channel[0].lastBuildDate = [new Date().toUTCString()];

  return true;
}

async function saveFeed(feedData) {
  const builder = new Builder({
    xmldec: { version: '1.0', encoding: 'UTF-8' },
    renderOpts: { pretty: true, indent: '  ' }
  });
  
  const xml = builder.buildObject(feedData);
  await writeFile(OUTPUT_FILE, xml, "utf8");
}

async function main() {
  console.log("Starting incremental update...");

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
    // Load existing feed
    const existingFeed = await loadExistingFeed();
    const existingUrls = extractExistingAudioUrls(existingFeed);
    console.log(`Existing feed has ${existingUrls.size} episodes.`);

    // Scrape recent episodes
    const recentEpisodes = await scrapeRecentEpisodes(page);

    // Update feed with new episodes
    const wasUpdated = await updateFeedWithNewEpisodes(existingFeed, recentEpisodes, existingUrls);

    if (wasUpdated) {
      await saveFeed(existingFeed);
      console.log(`Updated RSS feed saved to ${OUTPUT_FILE}`);
    }

  } catch (err) {
    console.error("Error during incremental update:");
    console.error(err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();