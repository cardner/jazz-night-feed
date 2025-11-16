// test-date-extraction.mjs
// Test the date extraction logic

function testDateExtraction() {
  console.log("Testing date extraction from NPR URLs...\n");
  
  const testUrls = [
    "https://ondemand.npr.org/anon.npr-mp3/npr/specials/2025/10/20251014_specials_nicole_glover-headline_tbd.mp3",
    "https://ondemand.npr.org/anon.npr-mp3/npr/specials/2025/09/20250923_specials_jnia_marcus_gilmore_ep.mp3",
    "https://ondemand.npr.org/anon.npr-mp3/npr/specials/2025/08/20250814_specials_jnia_shelia_jordan_update.mp3"
  ];
  
  testUrls.forEach((audioUrl, index) => {
    console.log(`Test ${index + 1}:`);
    console.log(`URL: ${audioUrl}`);
    
    // Extract date from URL
    const urlDateMatch = audioUrl.match(/\/(\d{4})\/\d{2}\/(\d{8})/);
    if (urlDateMatch) {
      const dateStr = urlDateMatch[2]; // e.g., "20251014"
      if (dateStr.length === 8) {
        const year = dateStr.substring(0, 4);
        const month = dateStr.substring(4, 6);
        const day = dateStr.substring(6, 8);
        const dateText = `${year}-${month}-${day}`;
        
        // Test date parsing
        const parsedDate = new Date(dateText);
        
        console.log(`Extracted date: ${dateText}`);
        console.log(`Parsed date: ${parsedDate.toUTCString()}`);
        console.log(`Is valid: ${!isNaN(parsedDate.getTime())}`);
      }
    } else {
      console.log("No date found in URL");
    }
    console.log("---");
  });
}

testDateExtraction();