import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function downloadImagesBazaar(query, total = 1) {
    const browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();

    const searchURL = `https://www.imagesbazaar.com/search/${query}`;
    console.log("Searching:", query);

    await page.goto(searchURL, { waitUntil: "networkidle0", timeout: 0 });
    await delay(3000);

    const imageLinks = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("img"))
            .map(img => img.getAttribute("data-src") || img.src)
            .filter(src => src && src.includes("awsimages"));
    });

    console.log("Found:", imageLinks.length, "images");

    if (imageLinks.length === 0) {
        await browser.close();
        return [];
    }

    const selected = imageLinks.sort(() => 0.5 - Math.random()).slice(0, total);

    const folder = path.join(process.cwd(), "imgdata", "downloads");

// Create the folder safely (even nested folders)
if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
}

    let files = [];

    for (let i = 0; i < selected.length; i++) {
        const url = selected[i];
        const fileName = `imgbz_${Date.now()}_${i}.jpg`;
        const filePath = path.join(folder, fileName);

        const view = await page.goto(url);
        const buffer = await view.buffer();

        fs.writeFileSync(filePath, buffer);
        files.push(filePath);

        console.log("Downloaded:", fileName);
        await delay(500);
    }

    await browser.close();
    return files;
}
