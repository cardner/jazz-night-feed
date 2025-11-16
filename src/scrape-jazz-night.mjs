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

const SERIES_URL = "https://www.npr.org/series/347174538/jazz-night-radio";
const OUTPUT_FILE = "feeds/jazz-night-zune.xml";
const MAX_EPISODES = 100; // Upper limit for episodes to scrape

// IMPORTANT: set this to the URL where this feed file
// will be hosted (e.g. your GitHub Pages URL).
const SELF_FEED_URL =
  "https://cardner.github.io/jazz-night-feed/jazz-night-zune.xml";

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
  const d = new Date(dateText);
  if (!Number.isNaN(d.getTime())) {
    return d.toUTCString(); // RFC-1123 is fine for RSS/Zune
  }
  return fallback.toUTCString();
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
    await page.waitForTimeout(1500);
  } else {
    console.log('No dedicated "The Radio Show" archive link found.');
  }
}

async function expandAllStories(page) {
  console.log(`Expanding stories via .options__load-more (up to ${MAX_EPISODES} episodes)…`);

  while (true) {
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(1200);

    // Check if we already have enough episodes
    const currentEpisodeCount = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll("a"));
      const downloadAnchors = anchors.filter((a) => {
        const text = (a.textContent || "").trim();
        const href = a.href || "";
        return /Download/i.test(text) && href.includes("ondemand.npr.org");
      });
      return downloadAnchors.length;
    });

    if (currentEpisodeCount >= MAX_EPISODES) {
      console.log(`Reached episode limit of ${MAX_EPISODES} — stopping.`);
      break;
    }

    const loadMoreButton = page.locator(".options__load-more");
    const count = await loadMoreButton.count();

    if (count === 0) {
      console.log('No ".options__load-more" button found — stopping.');
      break;
    }

    const btn = loadMoreButton.first();
    const visible = await btn.isVisible().catch(() => false);
    if (!visible) {
      console.log('".options__load-more" exists but isn’t visible — stopping.');
      break;
    }

    console.log('Clicking ".options__load-more"…');
    try {
      await btn.click({ force: true });
    } catch (e) {
      console.log('Failed clicking ".options__load-more":', e.message);
      break;
    }

    await page.waitForTimeout(2500);
  }
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
    const anchors = Array.from(document.querySelectorAll("a"));
    const downloadAnchors = anchors.filter((a) => {
      const text = (a.textContent || "").trim();
      const href = a.href || "";
      return /Download/i.test(text) && href.includes("ondemand.npr.org");
    });

    const results = [];

    for (const a of downloadAnchors) {
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
            // NPR article URLs generally have a year in the path
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
    episodes = episodes.slice(0, MAX_EPISODES);
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
