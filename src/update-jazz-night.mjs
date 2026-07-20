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

function unescapeXml(str = "") {
  return String(str)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Undo accumulated XML entity escaping (e.g. &amp;amp; from double-escape bugs). */
function fullyUnescapeXml(str = "") {
  let s = String(str);
  for (let i = 0; i < 5 && /&(?:amp|lt|gt|quot|apos);/i.test(s); i++) {
    s = unescapeXml(s);
  }
  return s;
}

/**
 * Stable key for episode identity. Strips query params so NPR tracking/
 * size params don't create false "new" episodes, and normalizes residual
 * HTML entities from previously double-escaped feed entries.
 */
function normalizeAudioUrl(url = "") {
  let s = fullyUnescapeXml(url).trim();
  try {
    const u = new URL(s);
    return `${u.origin}${u.pathname}`;
  } catch {
    return s.split("?")[0];
  }
}

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
    return d.toUTCString();
  } else {
    console.log(`Failed to parse date: "${dateText}", using fallback: ${fallback.toUTCString()}`);
    return fallback.toUTCString();
  }
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

  items.forEach((item) => {
    const enclosure = item?.enclosure?.[0];
    if (enclosure?.$.url) {
      audioUrls.add(normalizeAudioUrl(enclosure.$.url));
    }
    const guid = item?.guid?.[0]?._ ?? item?.guid?.[0];
    if (typeof guid === "string" && guid) {
      audioUrls.add(normalizeAudioUrl(guid));
    }
  });

  return audioUrls;
}

/** Fix fields that were pre-escaped before xml2js wrote them (double-escape). */
function repairItemXmlEntities(item) {
  if (item.title?.[0]) item.title[0] = fullyUnescapeXml(item.title[0]);
  if (item.link?.[0]) item.link[0] = fullyUnescapeXml(item.link[0]);
  if (item.description?.[0]) {
    item.description[0] = fullyUnescapeXml(item.description[0]);
  }
  if (item.pubDate?.[0]) item.pubDate[0] = fullyUnescapeXml(item.pubDate[0]);

  const guidNode = item.guid?.[0];
  if (guidNode && typeof guidNode._ === "string") {
    guidNode._ = fullyUnescapeXml(guidNode._);
  } else if (typeof guidNode === "string") {
    item.guid[0] = fullyUnescapeXml(guidNode);
  }

  const enclosure = item.enclosure?.[0];
  if (enclosure?.$.url) {
    enclosure.$.url = fullyUnescapeXml(enclosure.$.url);
  }

  return item;
}

function itemAudioKey(item) {
  const enclosureUrl = item?.enclosure?.[0]?.$.url;
  if (enclosureUrl) return normalizeAudioUrl(enclosureUrl);
  const guid = item?.guid?.[0]?._ ?? item?.guid?.[0];
  if (typeof guid === "string") return normalizeAudioUrl(guid);
  return "";
}

/** Keep first occurrence of each episode (caller should sort newest-first). */
function dedupeItemsByAudioUrl(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = itemAudioKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
    // Look for article elements with class "item" that contain download links
    const articleItems = Array.from(document.querySelectorAll("article.item"));
    
    const validArticles = articleItems.filter(article => {
      const downloadLi = article.querySelector("li.audio-tool-download");
      if (!downloadLi) return false;
      const downloadAnchor = downloadLi.querySelector("a[href*='ondemand.npr.org']");
      return downloadAnchor && downloadAnchor.href;
    });

    // Only check the first maxCheck episodes
    const articlesToCheck = validArticles.slice(0, maxCheck);
    const results = [];

    for (const article of articlesToCheck) {
      const downloadLi = article.querySelector("li.audio-tool-download");
      const downloadAnchor = downloadLi.querySelector("a[href*='ondemand.npr.org']");
      const audioUrl = downloadAnchor.href;

      // Find the title anchor within the article
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
  // Do NOT pre-escape: xml2js Builder escapes once on write.
  // Pre-escaping caused & → &amp;amp; and broke URL dedupe on the next run.
  const title = episode.title || "Untitled episode";
  const link = episode.link || FEED_LINK;
  const desc = sanitizeDescription(episode.description || "");
  const pubDate = episode.pubDate;
  const audioUrl = episode.audioUrl;
  const guid = episode.guid || episode.audioUrl;

  return {
    title: [title],
    link: [link],
    guid: [{ _: guid, $: { isPermaLink: "false" } }],
    pubDate: [pubDate],
    description: [desc],
    enclosure: [{ $: { url: audioUrl, length: "0", type: "audio/mpeg" } }],
  };
}

async function updateFeedWithNewEpisodes(existingFeed, newEpisodes, existingUrls) {
  const existingItemsRaw = existingFeed.rss.channel[0].item || [];
  const existingItems = existingItemsRaw.map(repairItemXmlEntities);
  const beforeDedupe = existingItems.length;
  const dedupedExisting = dedupeItemsByAudioUrl(existingItems);
  const removedDupes = beforeDedupe - dedupedExisting.length;

  if (removedDupes > 0) {
    console.log(`Removed ${removedDupes} duplicate episode(s) from existing feed.`);
  }

  const newEpisodesFiltered = newEpisodes.filter(
    (ep) => !existingUrls.has(normalizeAudioUrl(ep.audioUrl))
  );

  if (newEpisodesFiltered.length === 0 && removedDupes === 0) {
    console.log("No new episodes found. Feed is up to date.");
    return false;
  }

  if (newEpisodesFiltered.length > 0) {
    console.log(`Found ${newEpisodesFiltered.length} new episodes to add.`);
  }

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

  const newItemsXml = processedNewEpisodes.map(createItemXml);
  const allItems = [...newItemsXml, ...dedupedExisting];

  allItems.sort((a, b) => {
    const dateA = new Date(a.pubDate[0]);
    const dateB = new Date(b.pubDate[0]);
    return dateB - dateA;
  });

  // Dedupe again after merge (normalized URL), then cap
  const limitedItems = dedupeItemsByAudioUrl(allItems).slice(0, MAX_EPISODES);

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