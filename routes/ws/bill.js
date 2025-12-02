import puppeteer from 'puppeteer';
import Tesseract from 'tesseract.js';

export async function getBillDetails(district, accountNumber) {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://consumer.uppcl.org/wss/pay_bill_home', { waitUntil: 'networkidle0' });

  // ===== Select district from dropdown =====
  await page.click('.mat-mdc-select-value');
  await page.waitForSelector('mat-option');
  const options = await page.$$('mat-option');
  let districtFound = false;
  for (let option of options) {
    const text = await page.evaluate(el => el.innerText, option);
    if (text.trim() === district) {
      await option.click();
      districtFound = true;
      break;
    }
  }
  if (!districtFound) {
    console.log('District not found:', district);
    await browser.close();
    return null;
  }

  // ===== Fill account number =====
  await page.waitForSelector('#kno');
  await page.type('#kno', accountNumber, { delay: 10 });

  // ===== Solve captcha =====
  const captchaElement = await page.$('#captcha');
  const captchaBuffer = await captchaElement.screenshot();
  const { data: { text } } = await Tesseract.recognize(captchaBuffer, 'eng', {
      tessedit_char_whitelist: '0123456789+-*/'
  });
  console.log('OCR result:', text);

  const match = text.match(/(\d+)\s*([+\-*/])\s*(\d+)/);
  if (!match) {
    console.log('Could not parse captcha:', text);
    await browser.close();
    return null;
  }
  const [_, a, op, b] = match;
  const answer = eval(`${a}${op}${b}`);
  console.log('Captcha answer:', answer);

  await page.waitForSelector('#captchaInput');
  await page.type('#captchaInput', answer.toString(), { delay: 10 });

  // ===== Click View button =====
  await page.waitForSelector('button.btn.btn-prim.notranslate[type="submit"]');
  await page.click('button.btn.btn-prim.notranslate[type="submit"]');
  console.log('Form submitted!');

  // ===== Wait for results or warning =====
  try {
    await page.waitForSelector('.col-6.col-md-3 .details, h2 img[alt="warning"]', { timeout: 10000 });
  } catch (err) {
    console.log('No response received.');
    await browser.close();
    return null;
  }

  // Check if no details found
  const noDetails = await page.$('h2 img[alt="warning"]');
  if (noDetails) {
    console.log('No details found. Please select correct discom.');
    await browser.close();
    return null;
  }

  // ===== Extract bill details =====
  const details = await page.evaluate(() => {
    const name = document.querySelector('.col-6.col-md-3 .details')?.innerText.trim() || '';
    const dueDate = document.querySelectorAll('.details')[1]?.innerText.trim() || '';
    const amountInput = document.querySelector('input[type="number"]')?.value || '';
    return { name, dueDate, amount: amountInput };
  });

  console.log('Bill details fetched:', details);
  await browser.close();
  return details;
}
