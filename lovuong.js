const puppeteer = require("puppeteer");
const fs = require("fs");

(async () => {
  const defaultAdsLibraryURL =
    "https://www.facebook.com/ads/library/?active_status=active&ad_type=political_and_issue_ads&country=VN&is_targeted_country=false&media_type=all";

  // 1) Browser bên trái: scrape
  const browserLeft = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [
      "--window-size=960,1040", // half màn hình ngang
      "--window-position=0,0", // góc trên-trái
    ],
  });
  const pageLeft = await browserLeft.newPage();

  // 2) Browser bên phải: UI input + buttons
  const browserRight = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [
      "--window-size=960,1040",
      "--window-position=960,0", // góc trên-giữa, cạnh phải
    ],
  });
  const pageRight = await browserRight.newPage();

  // 3) Landing page HTML với UTF-8 và font Arial
  const landingHTML = `
  <!DOCTYPE html>
  <html>
    <head>
      <meta charset="UTF-8">
      <title>Facebook Ads Scraper</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        input, button { font-family: Arial, sans-serif; }
      </style>
    </head>
    <body>
      <h2>Facebook Ads Scraper</h2>
      <input
        id="urlInput"
        style="width:100%; padding:8px;"
        placeholder="Dán link Ads Library vào đây"
      />
      <div style="margin-top:10px;">
        <button id="btnOpen" style="padding:8px 12px; margin-right:8px;">
          Open Web
        </button>
        <button id="btnStart" style="padding:8px 12px;">
          Start Scraping
        </button>
      </div>
      <script>
        document.getElementById('btnOpen')
          .onclick = () => window.openWeb();
        document.getElementById('btnStart')
          .onclick = () => {
            const url = document.getElementById('urlInput').value;
            if (url) window.onStart(url);
            else alert('Vui lòng dán link vào ô trên!');
          };
      </script>
    </body>
  </html>`;
  await pageRight.goto("data:text/html," + encodeURIComponent(landingHTML));

  // 4) Expose hàm openWeb() để mở pageLeft tới default URL
  await pageRight.exposeFunction("openWeb", async () => {
    await pageLeft.goto(defaultAdsLibraryURL, {
      waitUntil: "networkidle2",
      timeout: 0,
    });
  });

  // 5) Expose hàm onStart(url) để bắt đầu scrape
  await pageRight.exposeFunction("onStart", async (url) => {
    // 5.1 Điều hướng pageLeft tới URL nhập vào
    await pageLeft.goto(url, { waitUntil: "networkidle2", timeout: 0 });

    // 5.2 Hiển thị overlay “Please wait…”
    await pageRight.evaluate(() => {
      document.body.innerHTML = "<h3>Please wait, fetching data…</h3>";
    });

    // 5.3 Thực hiện scroll + capture XHR
    const data = await autoScrollAndCaptureXHR(pageLeft);

    // 5.4 Ghi ra file
    fs.writeFileSync("data.json", JSON.stringify(data, null, 2), "utf-8");

    // 5.5 Render kết quả lên UI bên phải
    await pageRight.evaluate((json) => {
      document.body.innerHTML = ""; // xoá hết
      // Thêm tiêu đề
      const h2 = document.createElement("h2");
      h2.textContent = "Scrape Completed";
      document.body.appendChild(h2);
      // Thêm <pre> để preview JSON
      const pre = document.createElement("pre");
      pre.id = "dataPreview";
      pre.style =
        "max-height:400px;overflow:auto;white-space:pre-wrap;word-wrap:break-word;border:1px solid #ccc;padding:10px;";
      pre.textContent = json;
      document.body.appendChild(pre);
      // Thêm nút Close Browser
      const btn = document.createElement("button");
      btn.id = "btnClose";
      btn.textContent = "Close Browser";
      btn.style = "margin-top:10px;padding:8px 12px;";
      btn.onclick = () => window.closeBrowsers();
      document.body.appendChild(btn);
    }, JSON.stringify(data, null, 2));
  });

  // 6) Expose hàm closeBrowsers() để đóng cả hai browser
  await pageRight.exposeFunction("closeBrowsers", async () => {
    await browserLeft.close();
    await browserRight.close();
  });

  // 7) Hàm scroll + bắt XHR trả về mảng data
  async function autoScrollAndCaptureXHR(page) {
    const xhrRequests = [];
    page.on("response", async (response) => {
      const url = response.url();
      if (
        url.includes("facebook.com/api/graphql/") &&
        response.request().resourceType() === "xhr"
      ) {
        try {
          const json = await response.json();
          xhrRequests.push(json);
        } catch {}
      }
    });

    let prevHeight = 0;
    let timeoutReached = false;

    // loop scroll
    while (!timeoutReached) {
      await page.evaluate(() => window.scrollBy(0, 10000));
      await new Promise((r) => setTimeout(r, 5000));
      const curr = await page.evaluate(() => document.body.scrollHeight);
      if (curr === prevHeight) break;
      prevHeight = curr;
    }

    return xhrRequests;
  }
})();
