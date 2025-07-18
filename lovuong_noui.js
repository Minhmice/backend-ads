const puppeteer = require("puppeteer");
const fs = require("fs");
const readline = require("readline");
const { Client } = require("pg"); // PostgreSQL client

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

(async () => {
  // Kết nối với PostgreSQL
  const client = new Client({
    user: "n8n_user", // Thay bằng user của bạn
    host: "100.116.141.43",
    database: "postgres", // Thay bằng tên cơ sở dữ liệu của bạn
    password: "n8n_pass", // Thay bằng mật khẩu của bạn
    port: 5432,
  });

  await client.connect();

  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: null,
  });
  const page = await browser.newPage();

  // Set up response interception to capture XHR requests to the specific URL
  const xhrRequests = [];
  let xhrCount = 0;

  page.on("response", async (response) => {
    const url = response.url();
    if (
      url.includes("https://www.facebook.com/api/graphql/") &&
      response.request().resourceType() === "xhr"
    ) {
      try {
        const responseBody = await response.json(); // Get the response as JSON
        xhrRequests.push({ url, responseBody });
        xhrCount++;
      } catch (error) {
        console.log(`Failed to capture XHR request ${url}: ${error.message}`);
      }
    }
  });

  // Ask the user for the URL to scrape
  rl.question("Please enter the URL to scrape: ", async (url) => {
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"
    );
    await page.goto(url, { waitUntil: "networkidle2", timeout: 0 });

    // Auto scroll and count scrolls
    await autoScroll(page);

    // Lọc và chuẩn bị dữ liệu
    const adsData = xhrRequests.map((ad) => {
      const snapshot = ad.responseBody.node.snapshot;
      const brand = snapshot.page_name || "";
      const status = ad.responseBody.node.is_active ? "Active" : "Inactive";
      const startDate = new Date(snapshot.start_date * 1000).toISOString(); // Convert from epoch to date
      const adsFormat = snapshot.display_format || "";
      const adsPlatform = snapshot.publisher_platform.join(", ") || "";
      const imageUrl = snapshot.images[0]?.original_image_url || "";
      const caption = snapshot.caption || "";

      return {
        brand,
        status,
        startDate,
        adsFormat,
        adsPlatform,
        imageUrl,
        caption,
      };
    });

    // Đưa dữ liệu vào PostgreSQL
    for (const ad of adsData) {
      const query = `
        INSERT INTO facebook_ads (brand, status, start_date, ads_format, ads_platform, image_url, caption)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `;
      const values = [
        ad.brand,
        ad.status,
        ad.startDate,
        ad.adsFormat,
        ad.adsPlatform,
        ad.imageUrl,
        ad.caption,
      ];

      try {
        await client.query(query, values);
        console.log(`Data for ad ${ad.brand} inserted successfully.`);
      } catch (err) {
        console.error(`Error inserting data for ad ${ad.brand}:`, err);
      }
    }

    // Write XHR requests to a file (optional, for debugging)
    fs.writeFileSync(
      "data.json",
      JSON.stringify(xhrRequests, null, 2),
      "utf-8"
    );

    await browser.close();
    rl.close();
    await client.end(); // Đóng kết nối PostgreSQL
  });
})();

async function autoScroll(page) {
  const distance = 10000; // Set scroll distance
  let totalHeight = 0;
  let prevHeight = 0; // Height before scrolling
  let scrollCount = 0; // Count scrolls
  let timeoutReached = false;
  let dataLoaded = true; // Flag to check if new data is loaded

  // Set timeout to stop after 2 minutes
  const timeout = setTimeout(() => {
    timeoutReached = true;
  }, 120000); // Timeout after 2 minutes

  while (dataLoaded && !timeoutReached) {
    console.log(`Scrolling... Count: ${scrollCount + 1}`);

    await page.evaluate(() => {
      window.scrollBy(0, 10000);
    });

    totalHeight += distance;
    scrollCount++; // Increment scroll count

    // Log the progress of scrolling
    const progress = Math.min(
      (totalHeight / (await page.evaluate(() => document.body.scrollHeight))) *
        100,
      100
    ).toFixed(2);

    // Wait 5 seconds before the next scroll using Node.js setTimeout
    await new Promise((resolve) => setTimeout(resolve, 5000)); // Delay of 5 seconds

    // Check if new data is loaded by comparing the new height with the previous height
    const currentHeight = await page.evaluate(() => document.body.scrollHeight);
    if (currentHeight === prevHeight) {
      // If the height doesn't change, it means no new data was loaded
      dataLoaded = false;
      console.log("No more data loaded, ending scroll.");
    } else {
      prevHeight = currentHeight;
    }
  }

  // After scroll finishes, get the HTML content of the page
  console.log("Scroll finished. Returning Data");
  return await page.content();
}
