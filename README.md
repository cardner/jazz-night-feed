# Jazz Night RSS Scraper for Zune

A Node.js scraper that creates a Zune-compatible RSS feed for NPR's "Jazz Night In America: The Radio Program" podcast series.

## Features

- **Full scrape**: Complete archive scraping with episode limit (100 episodes max)
- **Incremental updates**: Efficient updates that only check for new episodes
- **Zune compatibility**: Proper RSS 2.0 format with audio enclosures
- **XML validation**: Clean descriptions and proper escaping
- **Channel artwork**: Includes podcast image for better display

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Update the feed URL** in both scripts:
   - Edit `SELF_FEED_URL` in `src/scrape-jazz-night.mjs`
   - Edit `SELF_FEED_URL` in `src/update-jazz-night.mjs`
   
   Replace with your GitHub Pages URL where the feed will be hosted.

## Usage

### Initial Setup (Full Scrape)
Creates the initial RSS feed by scraping up to 100 episodes:

```bash
npm run build
```

This will:
- Scrape NPR's Jazz Night archive page
- Expand episodes until 100 are found or no more are available
- Generate `feeds/jazz-night-zune.xml`

### Regular Updates (Incremental)
Checks for new episodes and adds them to existing feed:

```bash
npm run update
```

This will:
- Check the first 20 episodes on the archive page
- Compare against existing feed
- Add only new episodes found
- Maintain the 100 episode limit
- Much faster than full scrape

### Recommended Workflow

1. **Initial setup**: Run `npm run build` once to create the feed
2. **Regular updates**: Use `npm run update` daily/weekly via cron job or GitHub Actions
3. **Full refresh**: Run `npm run build` occasionally if you want to rebuild from scratch

## Configuration

### Episode Limits
Both scripts use these constants that can be modified:

```javascript
const MAX_EPISODES = 100; // Total episodes in feed
const MAX_NEW_EPISODES_TO_CHECK = 20; // Episodes to check for updates (update script only)
```

### Output Location
```javascript
const OUTPUT_FILE = "feeds/jazz-night-zune.xml";
```

## Feed Format

The generated RSS feed includes:
- **RSS 2.0** format for maximum compatibility
- **Audio enclosures** with proper MIME types
- **Episode metadata**: title, description, publication date
- **Channel artwork** from NPR
- **Atom self-link** for validation
- **Clean descriptions** (HTML tags stripped)

## Deployment

### GitHub Pages
1. Commit the generated `feeds/jazz-night-zune.xml` to your repository
2. Enable GitHub Pages on your repo
3. Subscribe to the feed in Zune using: `https://yourusername.github.io/yourrepo/feeds/jazz-night-zune.xml`

### Automated Updates with GitHub Actions

This repository includes three GitHub Actions workflows for complete automation:

#### 1. **Daily Updates** (`.github/workflows/update-feed.yml`)
- **Schedule**: Runs daily at 6 AM UTC
- **Trigger**: Automatic + manual dispatch
- **Function**: Incremental updates using `npm run update`
- **Smart**: Only commits if new episodes are found

#### 2. **Full Rebuild** (`.github/workflows/full-rebuild.yml`) 
- **Schedule**: Manual trigger only
- **Function**: Complete scrape using `npm run build`
- **Use**: Initial setup or when you want a fresh feed

#### 3. **GitHub Pages Deploy** (`.github/workflows/deploy-pages.yml`)
- **Trigger**: When RSS feed is updated
- **Function**: Deploys feed to GitHub Pages with a nice homepage
- **Output**: Public RSS feed URL for Zune subscription

#### Setup Instructions:

1. **Fork/Clone** this repository
2. **Enable GitHub Actions** in your repository settings
3. **Enable GitHub Pages** and set source to "GitHub Actions"
4. **Run the "Full Rebuild" workflow** manually to create initial feed
5. **Update URLs** in your scraper files with your GitHub Pages URL
6. **Subscribe** to your feed in Zune using the generated URL

The workflows will handle everything automatically from then on!

## Troubleshooting

### "No existing feed found" error
Run `npm run build` first to create the initial feed before using `npm run update`.

### Episodes not updating
- Check that the NPR page structure hasn't changed
- Verify network connectivity
- Check browser console for JavaScript errors

### Zune compatibility issues
- Ensure audio URLs are direct MP3 links
- Verify RSS 2.0 format compliance
- Check that descriptions don't contain HTML

## Dependencies

- **playwright**: Web scraping and browser automation
- **xml2js**: XML parsing and building for incremental updates

## File Structure

```
├── src/
│   ├── scrape-jazz-night.mjs    # Full scraper
│   └── update-jazz-night.mjs    # Incremental updater
├── feeds/
│   └── jazz-night-zune.xml      # Generated RSS feed
├── package.json
└── README.md
```