import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import path from "path";
import axios from "axios";

puppeteer.use(StealthPlugin());

async function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function download(url, filePath) {
  const res = await axios.get(url, { responseType: "arraybuffer" });
  fs.writeFileSync(filePath, res.data);
}

export async function scrapeFreepik(keyword, count = 1) {

  const searchKey = keyword.toLowerCase().replace(/\s+/g, "-");

  console.log("🔍 Searching:", searchKey);

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0");

  const searchURL = `https://www.freepik.com/free-photos-vectors/${searchKey}`;
  await page.goto(searchURL, { waitUntil: "networkidle2", timeout: 0 });

  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await delay(1500);
  }

  const images = await page.$$eval("figure img[src]", imgs =>
    imgs.map(img => img.src)
  );

  console.log("🖼 Total found:", images.length);

  if (images.length === 0) {
    await browser.close();
    return [];
  }

  const shuffled = images.sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, count);

const folder = path.join(process.cwd(), "imgdata", "downloads");

// Create the folder safely (even nested folders)
if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
}

  const files = [];

  let i = 1;
  for (const img of selected) {
    const filename = `${searchKey}_${Date.now()}_${i++}.jpg`;
    const filepath = path.join(folder, filename);

    console.log("⬇ Downloading:", img);

    await download(img, filepath);
    files.push(filepath);
    await delay(500);
  }

  await browser.close();
  return files;
}
