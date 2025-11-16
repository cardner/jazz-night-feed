# Configuration Options for Jazz Night RSS Scraper

The scraper now supports configurable parameters via environment variables or command line arguments.

## Configuration Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SERIES_URL` | `https://www.npr.org/series/347174538/jazz-night-radio` | NPR series page URL to scrape |
| `OUTPUT_FILE` | `feeds/jazz-night-zune.xml` | Output file path for the RSS feed |
| `MAX_EPISODES` | `100` | Maximum number of episodes to include in feed |
| `SELF_FEED_URL` | `https://cardner.github.io/jazz-night-feed/jazz-night-zune.xml` | Public URL where feed will be hosted |

## Usage Examples

### Using Environment Variables
```bash
# Scrape only 25 episodes
MAX_EPISODES=25 npm run build

# Custom output file and episode limit
MAX_EPISODES=50 OUTPUT_FILE=feeds/custom-feed.xml npm run build

# Full customization
SERIES_URL="https://custom-url.com" \
OUTPUT_FILE="custom-output.xml" \
MAX_EPISODES=75 \
SELF_FEED_URL="https://my-site.com/feed.xml" \
npm run build
```

### Using Command Line Arguments
```bash
# Arguments: [SERIES_URL] [OUTPUT_FILE] [MAX_EPISODES] [SELF_FEED_URL]
npm run build:custom -- "https://www.npr.org/series/347174538/jazz-night-radio" "feeds/custom.xml" "30" "https://my-feed-url.com/feed.xml"
```

### Predefined Scripts
```bash
# Build with 50 episode limit
npm run build:50

# Test build with 10 episodes
npm run build:test

# Standard build (100 episodes)
npm run build
```

## Loop Prevention Features

The scraper now includes several safety mechanisms:

- **Episode Count Tracking**: Shows current episode count with each "load more" click
- **Unchanged Count Detection**: Stops if episode count doesn't change after 3 attempts
- **Maximum Click Limit**: Prevents infinite loops with 50 click maximum
- **Final Count Display**: Shows total episodes found after expansion

## Sample Output
```
Configuration:
  SERIES_URL: https://www.npr.org/series/347174538/jazz-night-radio
  OUTPUT_FILE: feeds/jazz-night-zune.xml
  MAX_EPISODES: 50
  SELF_FEED_URL: https://cardner.github.io/jazz-night-feed/jazz-night-zune.xml

Expanding stories via .options__load-more (up to 50 episodes)…
Clicking ".options__load-more" (click 1, 14 episodes found so far)...
Clicking ".options__load-more" (click 2, 14 episodes found so far)...
Episode count unchanged after 3 attempts (14 episodes) — stopping.
Finished expanding. Final episode count: 14
```

## Date Extraction Improvements

The scraper now extracts dates from NPR's audio URLs when page text doesn't contain dates:
- Extracts dates like `20251014` from URLs and converts to `2025-10-14` format
- Falls back to context text parsing if URL extraction fails
- Provides detailed logging of date parsing success/failure