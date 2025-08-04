// lovuong_noui.js
import puppeteer from "puppeteer";
import fs from "fs";
import readline from "readline";

async function askQuestion(query) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(query, answer => {
    rl.close();
    resolve(answer.trim());
  }));
}

(async () => {
  // 1) Prompt for URL if none passed on CLI
  let url = process.argv[2];
  if (!url) {
    url = await askQuestion("Please enter the URL to scrape: ");
    if (!url) {
      console.error("❌ No URL provided, exiting.");
      process.exit(1);
    }
  }

  // 2) Launch browser
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: null,
    args: ["--no-sandbox","--disable-setuid-sandbox"]
  });
  const page = await browser.newPage();

  // 3) Intercept XHR GraphQL calls
  const xhrRequests = [];
  page.on("response", async res => {
    const resUrl = res.url();
    if (
      resUrl.includes("https://www.facebook.com/api/graphql/") &&
      res.request().resourceType() === "xhr"
    ) {
      try {
        const json = await res.json();
        xhrRequests.push({ url: resUrl, body: json });
      } catch (e) {
        console.warn(`⚠️ Failed to parse JSON from ${resUrl}: ${e.message}`);
      }
    }
  });

  console.log(`▶️ Loading ${url}`);
  await page.goto(url, { waitUntil: "networkidle2", timeout: 0 });

  // 4) Auto‐scroll to load all results
  let prevHeight = await page.evaluate(() => document.body.scrollHeight);
  let scrollCount = 0;
  while (true) {
    scrollCount++;
    console.log(`🔄 Scrolling pass #${scrollCount}`);
    await page.evaluate(() => window.scrollBy(0, 10000));
    // use Node timeout instead of page.waitForTimeout
    await new Promise(r => setTimeout(r, 2000));
    const newHeight = await page.evaluate(() => document.body.scrollHeight);
    if (newHeight === prevHeight) {
      console.log("✅ No more new content, stopping scroll.");
      break;
    }
    prevHeight = newHeight;
  }

  // 5) Write out all captured XHR responses
  fs.writeFileSync("data.json", JSON.stringify(xhrRequests, null, 2), "utf-8");
  console.log(`🎉 Captured ${xhrRequests.length} XHR responses → data.json`);

  await browser.close();
})();
