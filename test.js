import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { Cluster } from "puppeteer-cluster";
import fs from "fs";

(async () => {
  // 1. Apply Stealth Plugin
  puppeteer.use(StealthPlugin());

  // 2. Launch Puppeteer Cluster
  const cluster = await Cluster.launch({
    concurrency: Cluster.CONCURRENCY_PAGE,
    maxConcurrency: 5,
    puppeteer,
    puppeteerOptions: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--start-maximized"],
      defaultViewport: null,
      timeout: 60000
    }
  });

  // 3. Array to hold all extracted data
  const allData = [];

  // 4. Error handling
  cluster.on("taskerror", (err, data, willRetry) => {
    if (willRetry) console.warn(`❗ Error processing ${data.url}, retrying:`, err.message);
    else console.error(`❌ Failed to process ${data.url}:`, err);
  });

  // 5. Define task
  await cluster.task(async ({ page, data: { url } }) => {
    console.log(`▶️ Starting ${url}`);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

    // Scroll to bottom
    let prevHeight = await page.evaluate(() => document.body.scrollHeight);
    while (true) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise(r => setTimeout(r, 2000));
      const newHeight = await page.evaluate(() => document.body.scrollHeight);
      if (newHeight === prevHeight) break;
      prevHeight = newHeight;
    }

    // 6. Extract edges plus additional data
    const data = await page.evaluate(() => {
      const result = [];

      // Helper to capture all edges with metadata
      document.querySelectorAll('script[type="application/json"]').forEach(script => {
        let json;
        try { json = JSON.parse(script.textContent || ''); } catch { return; }
        if (!Array.isArray(json.require)) return;

        json.require.forEach(item => {
          const payload = item[3];
          if (!Array.isArray(payload)) return;
          payload.forEach(block => {
            const bboxReq = block.__bbox?.require;
            if (!Array.isArray(bboxReq)) return;
            bboxReq.forEach(inner => {
              let dataBlock = inner[3];
              if (Array.isArray(dataBlock) && dataBlock.length > 1) dataBlock = dataBlock[1];

              const conn = dataBlock?.__bbox?.result?.data
                ?.ad_library_main
                ?.search_results_connection;
              const systemStatus = dataBlock?.__bbox?.result?.data
                ?.ad_library_system_status?.system_status?.status;

              if (Array.isArray(conn?.edges)) {
                conn.edges.forEach(edge => {
                  if (edge.node) {
                    result.push({
                      node: edge.node,
                      cursor: edge.cursor,
                      totalCount: conn.count,
                      systemStatus: systemStatus
                    });
                  }
                });
              }
            });
          });
        });
      });

      return result;
    });

    console.log(`✅ Extracted ${data.length} items with metadata`);
    allData.push(...data);
  });

  // 7. Queue URL
  const targetUrl = process.argv[2] ||
    "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=VN&is_targeted_country=false&media_type=all&search_type=page&view_all_page_id=1652690478359142";
  await cluster.queue({ url: targetUrl });

  // 8. Wait and close
  await cluster.idle();
  await cluster.close();

  // 9. Write to data.json
  fs.writeFileSync("data.json", JSON.stringify(allData, null, 2), "utf-8");
  console.log(`🎉 Done! Saved ${allData.length} items to data.json`);
})();
