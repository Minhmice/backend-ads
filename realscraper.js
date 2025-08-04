// extract.js
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import readline from "readline";

// helper to prompt user if no CLI arg
function askQuestion(query) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve =>
    rl.question(query, ans => { rl.close(); resolve(ans.trim()); })
  );
}

(async () => {
  // 0) decide URL
  let url = process.argv[2];
  if (!url) {
    url = await askQuestion("📥 Please enter the URL to scrape: ");
    if (!url) {
      console.error("❌ No URL provided, exiting.");
      process.exit(1);
    }
  }

  // 1) Apply stealth plugin
  puppeteer.use(StealthPlugin());

  // 2) Launch browser
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox","--disable-setuid-sandbox"],
    defaultViewport: null
  });
  const page = await browser.newPage();

  // 3) Intercept XHR GraphQL responses
  const xhrRequests = [];
  page.on("response", async res => {
    try {
      const rurl = res.url();
      if (
        rurl.includes("https://www.facebook.com/api/graphql/") &&
        res.request().resourceType() === "xhr"
      ) {
        const body = await res.json();
        xhrRequests.push({ url: rurl, body });
      }
    } catch {}
  });

  console.log(`▶️ Loading ${url}`);
  await page.goto(url, { waitUntil: "networkidle2", timeout: 0 });

  // 4) Auto-scroll to load all content
  let prevHeight = await page.evaluate(() => document.body.scrollHeight);
  while (true) {
    await page.evaluate(() => window.scrollBy(0, 10000));
    await new Promise(r => setTimeout(r, 2000));
    const newHeight = await page.evaluate(() => document.body.scrollHeight);
    if (newHeight === prevHeight) {
      console.log("✅ No more content to load.");
      break;
    }
    prevHeight = newHeight;
    console.log("🔄 Scrolled, new height:", newHeight);
  }

  // 5) Extract embedded JSON nodes + metadata
  const embedData = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('script[type="application/json"]').forEach(script => {
      let j;
      try { j = JSON.parse(script.textContent || ""); } catch { return; }
      if (!Array.isArray(j.require)) return;

      j.require.forEach(item => {
        const payloadArr = item[3];
        if (!Array.isArray(payloadArr)) return;

        payloadArr.forEach(block => {
          const bboxReq = block.__bbox?.require;
          if (!Array.isArray(bboxReq)) return;

          bboxReq.forEach(inner => {
            let dataBlk = inner[3];
            if (Array.isArray(dataBlk) && dataBlk.length > 1) dataBlk = dataBlk[1];

            const resultRoot = dataBlk?.__bbox?.result;
            const sysStatus = resultRoot?.data?.ad_library_system_status?.system_status?.status;
            const conn = resultRoot?.data?.ad_library_main?.search_results_connection;
            if (!conn || !Array.isArray(conn.edges)) return;

            conn.edges.forEach(edge => {
              if (edge.node) {
                out.push({
                  node: edge.node,
                  cursor: edge.cursor,
                });
              }
            });
          });
        });
      });
    });
    return out;
  });

  console.log(`✅ Extracted ${embedData.length} embedded items`);

  // 6) Write combined output
  const output = {
    xhr: xhrRequests,
    embed: embedData
  };
  fs.writeFileSync("data.json", JSON.stringify(output, null, 2), "utf-8");
  console.log(`🎉 Done! Wrote ${xhrRequests.length} XHR, ${embedData.length} embed items to data.json`);

  await browser.close();
})();
