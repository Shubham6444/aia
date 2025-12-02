// import puppeteer from "puppeteer";
// import fetch from "node-fetch"; // for URL shortener

// export async function getDownloadLink(videoURL, updateStatus) {
//         const ytURL = videoURL[0];

//     const browser = await puppeteer.launch({
//         headless: false,
//         defaultViewport: null,
//         args: ["--start-maximized"]
//     });

//     const page = await browser.newPage();
//     let downloadURL = null;

//     console.log("🌐 Opening site...");

//     // Listen to network responses to capture progress & download URL
//     page.on("response", async (response) => {
//         const url = response.url();

//         if (url.includes("/analyze")) await updateStatus("🔍 Analyzing video...");
//         if (url.includes("/extract")) await updateStatus("⏳ Extracting formats...");
//         if (url.includes("/convert")) await updateStatus("⚙ Converting...");
//         if (url.includes("/download?")) downloadURL = url;
//     });

//     await page.goto("https://y2mate.nu/ysM1/", { waitUntil: "networkidle2" });

//     await page.type("#v", ytURL, { delay: 30 });

// let type = videoURL.input.slice(0,3);
// if(type == "mp3"){

        

//     await page.click('button[type="submit"]');

//     await page.waitForSelector("button[type='button']", { visible: true });
//     await page.click("button[type='button']");


// }else{

//     await page.click("button[type='button']");
//     await page.click('button[type="submit"]');

//     await page.waitForSelector("button[type='button']", { visible: true });
//     await page.click("button[type='button']");


// }










//     // Wait for download URL
//     let tries = 0;
//     while (!downloadURL && tries < 30) {
//         await new Promise((res) => setTimeout(res, 500));
//         tries++;
//     }

//     await browser.close();

//     if (!downloadURL) return null;

//     // Shorten URL using tinyurl API
//     try {
//         const resp = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(downloadURL)}`);
//         const shortURL = await resp.text();
//         return shortURL;
//     } catch {
//         return downloadURL; // fallback to original iimport puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fetch from "node-fetch"; // for URL shortener
import puppeteer from "puppeteer-extra";       // note: puppeteer-extra, not puppeteer

puppeteer.use(StealthPlugin());

export async function getDownloadLink(videoURL, updateStatus) {
    const ytURL = videoURL[0];
    const type = videoURL.input.slice(0, 3); // "mp3" or "mp4"
    let downloadURL = null;

    const browser = await puppeteer.launch({
        headless: true, // true for headless mode
        defaultViewport: null,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
            "--no-first-run",
            "--no-zygote",
            "--disable-gpu",
            "--start-maximized"
        ]
    });

    const page = await browser.newPage();

    // Mimic real browser
    await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36"
    );

    console.log("🌐 Opening site...");

    // Listen for download URL
    page.on("response", async (response) => {
        const url = response.url();
        if (url.includes("/analyze")) await updateStatus("🔍 Analyzing video...");
        if (url.includes("/extract")) await updateStatus("⏳ Extracting formats...");
        if (url.includes("/convert")) await updateStatus("⚙ Converting...");
        if (url.includes("/download?")) downloadURL = url;
    });

    await page.goto("https://y2mate.nu/ysM1/", { waitUntil: "networkidle2" });

    await page.type("#v", ytURL, { delay: 30 });

    // Wait for submit button to appear
    const submitButtonSelector = 'button[type="submit"]';
    await page.waitForSelector(submitButtonSelector, { visible: true });

    if (type === "mp3") {
        await page.click(submitButtonSelector);
        await page.waitForSelector("button[type='button']", { visible: true });
        await page.click("button[type='button']");
    } else {
        await page.click("button[type='button']");
        await page.click(submitButtonSelector);
        await page.waitForSelector("button[type='button']", { visible: true });
        await page.click("button[type='button']");
    }

    // Wait for download URL (max 15 sec)
    let tries = 0;
    while (!downloadURL && tries < 30) {
        await new Promise((res) => setTimeout(res, 500));
        tries++;
    }

    await browser.close();

    if (!downloadURL) return null;

    // Shorten URL using TinyURL
    try {
        const resp = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(downloadURL)}`);
        const shortURL = await resp.text();
        return shortURL;
    } catch {
        return downloadURL;
    }
}
