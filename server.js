/**
 * app.js (IMPROVED)
 * WhatsApp notepad + reminders (robust natural-language parsing + persisted scheduling)
 * 
 * npm i express body-parser express-session bson whatsapp-web.js qrcode cors openai uuid chrono-node node-schedule
 * set OPENAI_API_KEY in env for AI replies (optional)
 */
// Qrcodesec
// mp3

import express from "express";
import bodyParser from "body-parser";
import session from "express-session";
import fs from "fs";
import path from "path";
import { BSON } from "bson";
import { v4 as uuidv4 } from "uuid";
import pkg from "whatsapp-web.js";
const { Client, LocalAuth, MessageMedia } = pkg;
import ytdl from "ytdl-core";

import qrcode from "qrcode";
import cors from "cors";
import OpenAI from "openai";
import * as chrono from "chrono-node";
import schedule from "node-schedule";
import { getBillDetails } from './routes/ws/bill.js';
import aadhaarRoutes from './routes/ws/addhar.js';
import { getDownloadLink } from './routes/ws/ytmp3.js';
import { scrapeFreepik } from './routes/ws/image.js';
import { downloadImagesBazaar } from './routes/ws/img.js';
import { subscribe, checkForNewVideos } from './routes/ws/ytrem.js';
import QRCode from "qrcode";
import { addReminder } from "./api.js"
import addReminderRouter from "./api.js"
import { sendMail } from "./add.js"
import mailRouter from "./add.js"
import { qnafun } from "./qna.js"
import userApi from "./routes/userDataRouter.js"
import { limitUser } from "./function/limiter.js";

import similarity from "string-similarity"; // npm i string-similarity
import nodeHtmlToImage from 'node-html-to-image';

import axios from "axios";

const DATA_DIR = path.resolve("./data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const BOOK_JSON = "./data/book.json";
const ADMIN_NUMBERS = ["918081238948"];
const ADMIN_NUMBER = "9180812389481";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "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";
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(session({
  secret: "change_this_secret",
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));
app.use(express.static("public"));


app.use('/aadhaar', aadhaarRoutes);
// 👉 Single server me multiple route imports
app.use("/", addReminderRouter);
app.use("/", mailRouter);
app.use("/", userApi);

// <CHANGE> WhatsApp client initialization
const waClient = new Client({
  authStrategy: new LocalAuth({ clientId: "notepad-bson" }),
  puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});
let waQr = null;
let waReady = false;

waClient.on("qr", qr => { waQr = qr; });
waClient.on("ready", () => { console.log("✅ WhatsApp ready"); global.isWAReady = true; waReady = true; waQr = null; });
waClient.on("authenticated", () => console.log("WhatsApp authenticated"));
waClient.on("auth_failure", e => console.error("WA auth failure:", e));
waClient.initialize();

// // ---------- BSON helpers ----------
// function userFilePath(number) { return path.join(DATA_DIR, `${number}.bson`); }
// function saveUserBSON(number, user) { user.number = number; fs.writeFileSync(userFilePath(number), BSON.serialize(user)); }
// function loadUserByNumber(number) {
//   try {
//     const p = userFilePath(number);
//     if (!fs.existsSync(p)) return null;
//     return BSON.deserialize(fs.readFileSync(p));
//   } catch (e) { console.error("loadUser error", e); return null; }
// }

// function ensureUser(number) {
//   let u = loadUserByNumber(number);
//   if (!u) {
//     u = { number, notes: [], reminders: [], createdAt: new Date().toISOString(), convMemory: [], pendingConfirmation: null };
//     saveUserBSON(number, u);
//   } else {
//     if (!u.convMemory) u.convMemory = [];
//     if (!u.reminders) u.reminders = [];
//     if (!u.notes) u.notes = [];
//   }
//   return u;
// }
// ---------- JSON helpers ----------

function userFilePath(number) {
  return path.join(DATA_DIR, `${number}.json`);
}

function saveUserBSON(number, user) {
  user.number = number;
  const filePath = userFilePath(number);
  fs.writeFileSync(filePath, JSON.stringify(user, null, 2), "utf8");
}

function loadUserByNumber(number) {
  try {
    const filePath = userFilePath(number);
    if (!fs.existsSync(filePath)) return null;

    const data = fs.readFileSync(filePath, "utf8");
    return JSON.parse(data);
  } catch (err) {
    console.error("loadUser error:", err);
    return null;
  }
}

function ensureUser(number) {
  let u = loadUserByNumber(number);

  if (!u) {
    u = {
      number,
      notes: [],
      reminders: [],
      createdAt: new Date().toISOString(),
      convMemory: [],
      pendingConfirmation: null,
    };
    saveUserBSON(number, u);
  } else {
    if (!u.convMemory) u.convMemory = [];
    if (!u.reminders) u.reminders = [];
    if (!u.notes) u.notes = [];
  }

  return u;
}

// ---------- scheduling ----------
const scheduledJobs = {};
function scheduleJobForReminder(number, reminder) {
  const key = `${number}-${reminder.id}`;
  if (scheduledJobs[key]) return;

  const when = new Date(reminder.time);
  if (isNaN(when.getTime())) return;
  if (when.getTime() <= Date.now()) return;

  const job = schedule.scheduleJob(when, async () => {
    try {
      // AI ka message direct
      let txt = reminder.msg ? String(reminder.msg).trim() : "Aapka reminder";

      // Clean unwanted words
      txt = txt.replace(/\b(mujhe|yaad|dilao|dilana|please|pls|karo|kr|kar)\b/gi, "").trim();
      if (!txt) txt = "Aapko kuch karna hai";

      txt = txt.charAt(0).toUpperCase() + txt.slice(1);

      // 🔥 FINAL SEND — NO MORE formatReminderText()
      const message = `📬 Sir, ${txt}`;

      if (waReady) await waClient.sendMessage(`${number}@c.us`, message);

      console.log("Reminder sent to", number, message);
    } catch (e) {
      console.error("Reminder send failed", e);
    } finally {
      // Remove reminder after sending
      const user = loadUserByNumber(number);
      if (user && Array.isArray(user.reminders)) {
        user.reminders = user.reminders.filter(r => r.id !== reminder.id);
        saveUserBSON(number, user);
      }
      delete scheduledJobs[key];
    }
  });

  scheduledJobs[key] = job;
}

function restoreAllReminders() {
  for (const f of fs.readdirSync(DATA_DIR).filter(x => x.endsWith(".bson"))) {
    try {
      const number = f.replace(".bson", "");
      const u = loadUserByNumber(number);
      if (u?.reminders) for (const r of u.reminders) {
        if (r.time && r.time > Date.now()) scheduleJobForReminder(number, r);
      }
    } catch (e) { console.error("restore fail", e); }
  }
}




// ===== ⏰ REMINDER KEYWORDS =====
const reminderKeywords = [
  "yaad", "yaad dilao", "yaad dilana", "yaad dilwadijiye", "dilao", "dilana",
  "remind", "reminder", "remind me", "remind karo", "remind krdo", "remind karna",
  "remind later", "remind tomorrow", "remind next week",
  "notification", "notify", "notifikation", "alert", "alert karo", "alert dilao",
  "alarm", "alarm set", "alarm lagao", "alarm banao", "alarm chalu karo",
  "schedule", "schedule karo", "scheduled", "timing", "time set", "time bata",
  "later", "baad me", "baad main", "bad main", "bad me", "thodi der baad",
  "jab", "jab time ho", "jab samay", "jab waqt", "jab tak", "jab meeting ho",
  "kal", "kal ko", "agle din", "agle kal", "next day", "next time",
  "aaj", "aaj shaam", "aaj subah", "aaj dopahar", "aaj raat",
  "subah", "morning", "savere", "bhore", "dophar", "dopahar", "noon", "afternoon",
  "shaam", "evening", "night", "raat", "midnight",
  "meeting", "meeting hai", "meeting schedule", "meeting remind", "meeting alert",
  "call", "call karna", "call schedule", "call reminder", "call alert",
  "appointment", "appointment set", "appointment reminder", "appointment dilao",
  "plan", "plan hai", "plan set", "plan reminder", "task", "task set",
  "kaam", "kaam karna", "kaam remind", "kaam yaad", "do kaam", "work reminder",
  "birthday", "bday", "anniversary", "party", "event", "function",
  "meeting alert", "reminder alert", "meeting time", "meeting fix",
  "doctor", "medicine", "tablet", "tablet khana", "medicine lena", "pill time",
  "office", "office time", "class", "exam", "study", "exam reminder",
  "sambhal", "sambhalna", "dhyan", "dhyan dilao", "notice", "notice karna",
  "watch", "watch time", "timing alert", "notify me", "ping me", "poke me",
  "remind tomorrow morning", "remind tomorrow evening", "remind in 5 minutes",
  "set alarm for", "set reminder for", "set meeting", "set event",
  "set call", "set appointment", "set task", "set schedule",
  "after 5 minutes", "after 10 minutes", "after 1 hour", "next monday",
  "every day", "daily remind", "weekly reminder", "monthly reminder",
  "recurring reminder", "repeat reminder", "again remind", "follow up reminder",
  "alert me later", "tell me later", "yaad karwa", "yaad karwao",
  "time pe bolna", "time pe yaad dilana", "bata dena", "batao mujhe",
  "mujhe yaad dilana", "mujhe bata dena", "mujhe remind karna", "mujhe alert karna",
  "yaad dilade", "yaad dila dena", "remind krde", "remind kardena", "set a reminder",
];

function isReminderKeyword(text) {
  const t = text.toLowerCase();
  return reminderKeywords.some(k => t.includes(k));
}















let ImgWorking = false;
let working = false;
const userAadhaarMap = {};   // { "919452937825": "123412341234" }

function sanitizeUserInput(raw) {
  if (!raw || typeof raw !== "string") return null;

  // Remove leading/trailing whitespace
  raw = raw.trim();

  // Limit length (max 500 chars or 100 words)
  const words = raw.split(/\s+/);
  if (words.length > 100) {
    raw = words.slice(0, 100).join(" ");
  }

  // Reject potentially malicious patterns
  const forbiddenPatterns = [
    /<script>/i,      // scripts
    /<\/?[\w\s="/.':;#-\/]+>/gi,  // HTML tags
    /select\s+.*from/i, // SQL injection
    /drop\s+table/i,
    /union\s+select/i,
    // /http[s]?:\/\/\S+/i, // links (optional)
  ];

  for (const pattern of forbiddenPatterns) {
    if (pattern.test(raw)) return null;
  }

  return raw; // safe input
}


export async function authUpdate(number) {


  await waClient.sendMessage(`${number}@c.us`, "🎉 Google Auth Sucessfully");


}


// <CHANGE> Main message handler with enhanced NLP
async function handleIncomingWhatsApp(msg) {
  const from = msg.from;
  // console.log(msg.type)


  const raw = (msg.body || "").trim();
  if (!raw) return;
  const chat = await msg.getChat();

  // // Show typing indicator
  // await chat.sendStateTyping();
  // await waClient.sendPresenceAvailable();
  // // await chat.clearState();



  // 1️⃣ Sanitize input
  const safeText = sanitizeUserInput(raw);
  if (!safeText) {
    console.log(`Blocked potentially malicious message from ${from}`);
    await msg.reply("❌ Message blocked due to unsafe content.");
    return;
  }
  if (!from.endsWith("@c.us")) return;
  const number = from.replace("@c.us", "");
  ensureUser(number);
  let user = loadUserByNumber(number);


  user.convMemory = user.convMemory || [];
  user.convMemory.push({ role: "user", content: raw, ts: Date.now() });
  if (user.convMemory.length > 12) user.convMemory.splice(0, user.convMemory.length - 12);
  saveUserBSON(number, user);


 if(number.startsWith("1")){
  console.log(number)
      return;
    }
    
  // Show typing indicator
  await chat.sendStateTyping();
  await waClient.sendPresenceAvailable();
  // await chat.clearState();

//------------------------
    const check = limitUser(number);

  console.log(check)

  if(check.reason == "DAILY_LIMIT"){

await waClient.sendMessage(
  `${number}@c.us`,
  "⛔ *Daily Limit Reached*\n\nYou've used all your free (30) requests for today. 😊\n\n🔄 Please try again after *12:00 AM* when your daily limit resets.\n\n📌 Tip: Use your requests wisely for important tasks!"
);
return
  }


    if(check.reason == "MINUTE_LIMIT"){

      await waClient.sendMessage(`${number}@c.us`, "Please use dealy 1 min 10 message");

      return

    }

   
//-----------------------------------------




















  // bill info

  const numberMatch = raw.match(/\d{10,}/); // 10+ digit number
  if (numberMatch && /bill/i.test(raw)) {
    const billNumber = numberMatch[0];

    try {


      const billInfo = await getBillDetails("PrayagRaj", billNumber);

      if (!billInfo) {
        throw new Error("No bill found for this number.");
      }

      const reply = `📄 Bill Details :\nName:  ${billInfo.name}\nAmount: ₹${billInfo.amount}\nDue: ${billInfo.dueDate}\n`;
      await waClient.sendMessage(`${number}@c.us`, reply);
    } catch (e) {
      await waClient.sendMessage(`${number}@c.us`, `⚠️ Bill details fetch failed: ${e.message}`);
    }
    return;
  }



  if (raw.startsWith("mp3") || raw.startsWith("mp4")) {
    const urlMatch = raw.match(/https?:\/\/\S+/);
    if (!urlMatch) {
      await msg.reply("❌ Invalid YouTube link.");
      return;
    }

    // Check if server is busy
    if (working) {
      await msg.reply("⏳ Server is busy. Please wait for the current process to finish.");
      return;
    }

    working = true; // lock the server

    try {
      const downloadURL = await getDownloadLink(urlMatch, updateStatus); // pass updateStatus if needed

      if (!downloadURL) {
        await waClient.sendMessage(`${number}@c.us`, "❌ Failed to retrieve download link.");
      } else {
        await waClient.sendMessage(`${number}@c.us`, `✅ Download link ready:\n${downloadURL}`);
      }

    } catch (err) {
      console.log(err);
      await waClient.sendMessage(`${number}@c.us`, "❌ Error: " + err.message);
    } finally {
      working = false; // release lock
    }
    return
  }
  //-------------------------------------------Qrcodesec--------------------
  // Check if message starts with "qr"
  if (raw.toLowerCase().startsWith("qrcode")) {
    const text = raw.slice(2).trim(); // get text after "qr"

    if (!text) {
      await msg.reply("❌ Please provide text to generate QR code.");
      return;
    }

    try {
      msg.reply("wait few Sec.....");
      const saveFolder = path.resolve("qrcodes");
      fs.mkdirSync(saveFolder, { recursive: true });
      const filePath = path.join(saveFolder, `qr_${Date.now()}.png`);

      // Generate QR code
      await QRCode.toFile(filePath, text, {
        color: {
          dark: "#000000",
          light: "#ffffff"
        },
        width: 300
      });

      // Send QR code image to user
      const media = MessageMedia.fromFilePath(filePath);
      await waClient.sendMessage(msg.from, media);

    } catch (err) {
      console.log(err);
      await msg.reply("❌ Failed to generate QR code.");
    }
    return
  }


  // img girl
  if (raw.startsWith("image")) {

    // Remove "img" text
    const parts = raw.replace("image", "").trim().split(" ");

    // Check if server is busy
    if (ImgWorking) {
      await msg.reply("⏳ Server is busy. Please wait for the current process to finish.");
      return;
    }

    // ImgWorking = true; // lock the server

    let count = 1;
    let keywordParts = [];

    for (const p of parts) {
      if (!isNaN(p)) count = parseInt(p);
      else keywordParts.push(p);
    }

    // Limit check
    if (count > 10) {
      return msg.reply("❌ Max limit is *10 images* only.");
    }
    if (count < 1) count = 1;

    const keyword = keywordParts.join(" ").trim();
    if (!keyword) {
      return msg.reply("❌ Example:\n*img indian girl 5*");
    }



    // ---- START DOWNLOADING ----

    await waClient.sendMessage(`${number}@c.us`, "⏳ Fetching image links...");
    ImgWorking = true; // lock the server

    const files = await downloadImagesBazaar(keyword, count);

    if (!files.length) {
      await waClient.sendMessage(`${number}@c.us`, "❌ No images found.");
      ImgWorking = false; // release lock
      return;
    }
    // Add this at the top of your file (before using delay)
    function delay(ms) {
      ImgWorking = false; // release lock
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Loop for sending download progress
    for (let i = 0; i < files.length; i++) {
      await waClient.sendMessage(`${number}@c.us`, `⏳ Downloading... (${i + 1}/${files.length})`);
      await delay(800);
    }

    // Completed
    await waClient.sendMessage(`${number}@c.us`, "✅ Download complete! Sending images...");

    // const files = await downloadImagesBazaar(keyword, count);

    if (!files.length) return msg.reply("❌ No images found.");

    // Send images one-by-one
    for (const file of files) {
      const media = MessageMedia.fromFilePath(file);
      await waClient.sendMessage(msg.from, media);
    }

    await waClient.sendMessage(msg.from, "✅ Done!");
    ImgWorking = false; // release lock

    return
  }

  //-----------------pdf


  // Helper: Load books
  function loadBooks() {
    if (!fs.existsSync(BOOK_JSON)) fs.writeFileSync(BOOK_JSON, JSON.stringify([]));
    return JSON.parse(fs.readFileSync(BOOK_JSON));
  }

  // Helper: Save books
  function saveBooks(books) {
    fs.writeFileSync(BOOK_JSON, JSON.stringify(books, null, 2));
  }

  // Handlerm
  const fromn = msg.from.split("@")[0]; // get number

  // ---- ADMIN ADD PDF ----
  if (raw.startsWith("pdf ") && ADMIN_NUMBERS[0].includes(fromn)) {
    const bookName = raw.replace("pdf ", "").trim();
    if (msg.hasMedia) {
      const media = await msg.downloadMedia();
      const folder = "./books";
      if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
      const filePath = `${folder}/${bookName}.pdf`;
      fs.writeFileSync(filePath, Buffer.from(media.data, "base64"));

      const books = loadBooks();
      books.push({ name: bookName, filePath, uploader: from });
      saveBooks(books);

      await msg.reply(`✅ PDF "${bookName}" added successfully!`);
    } else {
      await msg.reply("❌ Please attach a PDF file with this command.");
    }
    return;
  }

  // ---- LIST BOOKS ----
  if (raw === "books") {
    const books = loadBooks();
    if (!books.length) return msg.reply("❌ No books available.");
    let list = "📚 Available Books:\n";
    books.forEach((b, i) => {
      list += `${i + 1}. ${b.name}\n`;
    });
    return msg.reply(list + "\nReply with the book number to download.");
  }

  // ---- SEND BOOK BY NUMBER ----
  if (!isNaN(raw)) {
    const index = parseInt(raw) - 1;
    const books = loadBooks();
    if (!books[index]) return msg.reply("❌ Invalid book number.");
    const media = MessageMedia.fromFilePath(books[index].filePath);
    await msg.reply(`📄 Sending "${books[index].name}"...`);
    await waClient.sendMessage(msg.from, media);
    return;
  }



  let qn = await qnafun(raw);

  if (qn) {
    // const chat = await msg.getChat();

    // // Show typing indicator
    // await chat.sendStateTyping();

    // Delay (Human typing effect)
    // await new Promise(res => setTimeout(res, 1500));

    // Stop typing indicator

    // Send reply
    await waClient.sendMessage(msg.from, qn);
    //  await chat.clearState();

    return;
  }



  //----------------------voice
  try {
    if (raw.startsWith("voice")) {
      let userText = raw.replace("voice ", "").trim();
      // Limit to 100 words
      let words = raw.split(/\s+/); // split by spaces
      if (words.length > 100) {
        userText = words.slice(0, 100).join(" ");
      }

      // 4️⃣ Send userText to ChatGPT for response
      const gptResponse = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "user", content: userText }
        ]
      });

      const replyText = gptResponse.choices[0].message.content;

      // 5️⃣ Convert GPT reply to speech using OpenAI TTS
      const ttsResponse = await openai.audio.speech.create({
        model: "gpt-4o-mini-tts",
        voice: "alloy",
        input: replyText
      });

      // Ensure temp folder exists
      const tempFolder = "./temp";
      if (!fs.existsSync(tempFolder)) fs.mkdirSync(tempFolder, { recursive: true });

      const ttsFile = `${tempFolder}/${msg.from}_reply.mp3`;
      const buffer = Buffer.from(await ttsResponse.arrayBuffer());
      fs.writeFileSync(ttsFile, buffer);

      // Send MP3 back
      const mediaMessage = MessageMedia.fromFilePath(ttsFile);
      await waClient.sendMessage(msg.from, mediaMessage);
      return
    }
  } catch (err) {
    console.error("Error handling voice message:", err);
    await msg.reply("❌ Failed to process your voice message.");
  }

  //------------------------------------------------------------------------------------------------------------



  // ===== 📝 NOTE KEYWORDS (for saving or writing notes) =====
  const noteKeywords = [
    "yaad ker lo", "save ker lo", "Mind it",
  ];


  function isNoteKeyword(text) {
    const t = text.toLowerCase();
    return noteKeywords.some(k => t.includes(k));
  }

  // <CHANGE> Step 1: Check for explicit save/note keywords
  if (raw.endsWith("+++") || (isNoteKeyword(raw) && !isReminderKeyword(raw))) {
    let content = raw.replace(/\+{3,}$/, "").trim();
    content = content.replace(new RegExp(`\\b(${noteKeywords.join("|")})\\b`, "gi"), "").trim();
    if (!content) content = raw;

    user.notes = user.notes || [];
    user.notes.unshift({ id: uuidv4(), content, createdAt: Date.now(), done: false });
    saveUserBSON(number, user);
    await waClient.sendMessage(`${number}@c.us`, `✅ data save kar diya: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`);
    return;
  }


  // ==========================
  // Poll every 1 minute
  // ==========================
  (async () => {
    setInterval(async () => {
      const newVideos = await checkForNewVideos();
      if (newVideos.length > 0) {
        for (const reminder of newVideos) {
          // Log to console
          console.log(`[REMINDER][${reminder.number}] ${reminder.channelName} uploaded a new video: ${reminder.title} → ${reminder.url}`);

          // Send via WhatsApp
          await waClient.sendMessage(
            `${reminder.number}@c.us`,
            `📢 ${reminder.channelName} uploaded a new video: ${reminder.title}\nWatch here: ${reminder.url}`
          );
        }
      }
    }, 60 * 60 * 1000);
  })();




  // //-------------------------------------ai-----------------------
  // //-------------------------------------AI Handler-----------------------
  try {

    // ---------------- LOAD NOTES (just context) ----------------
    // const notesText = (user.notes || [])
    //     .slice(0, 100)
    //     .map((n, i) => `${i + 1}. ${n.content}`)
    //     .join("\n");
    function formatTime(ts) {
      if (!ts) return "No time";
      const d = new Date(ts);
      return d.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour12: true
      });
    }

    const notesText = (user.notes || [])
      .slice(0, 100)
      .map((n, i) => {
        const t = formatTime(n.createdAt);   // <-- IMPORTANT
        return `${i + 1}. *${n.content}*\n🕒 ${t}`;
      })
      .join("\n\n");

    // ----------------- LOAD askDB -----------------
    const askDBFile = "./askdb.json";

    function loadAskDB() {
      if (!fs.existsSync(askDBFile)) return [];
      return JSON.parse(fs.readFileSync(askDBFile));
    }

    function saveAskDB(data) {
      fs.writeFileSync(askDBFile, JSON.stringify(data, null, 2));
    }

    const askDB = loadAskDB();

    // ----------------- CHECK IF MESSAGE EXISTS -----------------
    let existingEntry = askDB.find(entry => entry.message === raw);

    let intent, aiReply;

    if (existingEntry) {
      // Use existing intent & aiReply if already available
      intent = existingEntry.intent;
      aiReply = existingEntry.aiReply || "";
      console.log("ℹ️ Reusing existing data from askDB");
    } else {
      // ----------------- CLASSIFY INTENT -----------------
      const classifierPrompt = `
You are an intent classifier.

Classify the user's message into EXACTLY one of these:

- REMINDER → ONLY if the message clearly contains a time or date 
              (like "kal 5 baje", "25 ko", "8:30 pm", "sham 7", etc.)
- NOTE      → if the user wants to save information must user say for saving 
- YOUTUBE   → if user wants latest YouTuber video notification (must include any one word channel name,and video) 
- NOTECHAT  → note conversation asking notes info
- CHAT      → normal conversation out of not infomition or hwo to use
- CALENDAR  → when user want to add reminder on calendar (must include calendar word)
- MAIL      → user want send mail anyon must include (mail id example : abc@domain.com)

IMPORTANT:
If there is NO TIME mentioned in the message,

then DO NOT classify it as REMINDER.

Return ONLY one word: REMINDER, NOTE, YOUTUBE, or CHAT

Message: "${raw}"
`;

      const classifyRes = await openai.chat.completions.create({
        model: "gpt-5-nano",
        messages: [
          { role: "system", content: "You classify user intent strictly." },
          { role: "user", content: classifierPrompt },
        ],
      });

      intent = classifyRes.choices?.[0]?.message?.content?.trim()?.toUpperCase() || "CHAT";
    }
    console.log(intent)

    // ----------------- STEP 1: YOUTUBE -----------------
    if (intent === "YOUTUBE") {
      if (!aiReply) {
        const extractPrompt = `
You are a helpful assistant.
Extract the YouTube channel name from the following message.
Return ONLY the channel name, nothing else.

Message: "${raw}"
`;
        const extractRes = await openai.chat.completions.create({
          model: "gpt-5-nano",
          messages: [
            { role: "system", content: "Extract YouTube channel names strictly." },
            { role: "user", content: extractPrompt },
          ],
        });

        const channelName = extractRes.choices?.[0]?.message?.content?.trim();

        if (channelName) {
          user.youtube = user.youtube || [];
          if (!user.youtube.includes(channelName)) {
            user.youtube.push(channelName);
            await subscribe(number, `Jab ${channelName} new video upload`);
            let aiReplysws = `✅ YouTube reminder added: ${channelName}`;
            aiReply = `${channelName}`;
            await waClient.sendMessage(`${number}@c.us`, aiReplysws);
            saveUserBSON(number, user);
            // console.log(user)
          } else {
            aiReply = `ℹ️ Already Added: ${channelName}`;
            await waClient.sendMessage(`${number}@c.us`, aiReply);
          }
        } else {
          aiReply = "⚠️ Could not detect a YouTube channel in the message.";
          await waClient.sendMessage(`${number}@c.us`, aiReply);
        }
      } else {

        //---------using exitong channles
        if (aiReply) {
          user.youtube = user.youtube || [];
          if (!user.youtube.includes(aiReply)) {
            user.youtube.push(aiReply);
            await subscribe(number, `Jab ${aiReply} new video upload`);
            let aiReplysws = `✅ YouTube reminder added: ${aiReply}`;
            aiReply = `${aiReply}`;
            await waClient.sendMessage(`${number}@c.us`, aiReplysws);
            saveUserBSON(number, user);
            // console.log(user)
          } else {
            aiReply = `ℹ️ Already added: ${aiReply}`;
            await waClient.sendMessage(`${number}@c.us`, aiReply);
          }
        } else {
          aiReply = "⚠️ Could not detect a YouTube channel in the message.";
          await waClient.sendMessage(`${number}@c.us`, aiReply);
        }

      }

    }

    // ----------------- STEP 2: REMINDER -----------------
    if (intent === "REMINDER") {
      if (!aiReply) {
        const extractPrompt = `
You extract reminder information.

Return JSON only with keys:
- action: short action text
- clean_message: 5-8 word reminder text
- datetime: final alarm time in ISO format

Message: "${raw}"
            `;

        const extractRes = await openai.chat.completions.create({
          model: "gpt-5-nano",
          messages: [
            { role: "system", content: "You extract reminder info." },
            { role: "user", content: extractPrompt },
          ],
        });

        let info;
        try {
          info = JSON.parse(extractRes.choices[0].message.content.trim());
        } catch (e) {
          await waClient.sendMessage(`${number}@c.us`, "❌ Time samajh nahi aaya, please exact time likho.");
          return;
        }

        const reminder = {
          id: uuidv4(),
          msg: info.clean_message,
          action: info.action,
          time: new Date(info.datetime).getTime()
        };

        if (!reminder.time || isNaN(reminder.time)) {
          await waClient.sendMessage(`${number}@c.us`, "❌ Reminder ka time sahi nahi mila. Time clearly batao.");
          return;
        }

        user.reminders = user.reminders || [];
        user.reminders.push(reminder);
        saveUserBSON(number, user);

        console.log(reminder);
        scheduleJobForReminder(number, reminder, "ai");

        aiReply = `⏰ Reminder set:\n${info.clean_message}\n📅 ${info.datetime}`;
        await waClient.sendMessage(`${number}@c.us`, aiReply);
      }
    }

    // ----------------- STEP 3: NOTE -----------------
    if (intent === "NOTE") {
      // if (!aiReply) {
      const noteCleanPrompt = `
Convert the following message into a short English note.
Do NOT add extra info. 
Just rewrite the important task in one clean sentence.

Message: "${raw}"
            `;

      const noteRes = await openai.chat.completions.create({
        model: "gpt-5-nano",
        messages: [
          { role: "system", content: "You rewrite user notes cleanly." },
          { role: "user", content: noteCleanPrompt },
        ],
      });

      aiReply = noteRes.choices?.[0]?.message?.content?.trim() || "Note could not be generated";

      user.notes = user.notes || [];
      user.notes.unshift({
        id: uuidv4(),
        content: aiReply,
        createdAt: Date.now(),
        done: false,
      });

      saveUserBSON(number, user);

      await waClient.sendMessage(`${number}@c.us`, `✅ Note saved: "${aiReply.substring(0, 50)}${aiReply.length > 50 ? "..." : ""}"`);
      // }
    }

    // ----------------- STEP 4: CHAT -----------------
    if (intent === "NOTECHAT") {
      // if (!aiReply) {
      const chatPrompt = `
You are a friendly Hindi/English assistant.
Reply in max 1–2 lines.

IDENTITY RULES:
• Never mention OpenAI.
• If user asks about:
  - who you are
  - who created you
  - system/server/backend
  - any AI personal details
  → Always say: "I was created by InTechOps. (DEVLOPER SHUBHAM.)."

SECURITY RULE:


BEHAVIOR:
1) Agar user notes save kare:
     → hamesha short answer do, WhatsApp format me do not inclut word WhatsApp format:
       "✔ Note save ho gaya:\ntext *impotent text* text"

2) Agar user “show notes”, “my notes”, “all notes”, “notes dikhao”,"one note simler do not add date time when he mentin date then add date"
      bole:
     → saare notes WhatsApp formatted list me return karo,
       including passwords.
    → if ask spesifc notes give fone one

3) Agar user indirectly notes ka data pooche 
   (e.g. "mere notes me kya likha?", "tumne kya save kiya?")

4) Date me add kro Jub tak date na mage 
   



User's saved notes:
${notesText || "No notes saved"}

User message: "${raw}"
`;




      const chatRes = await openai.chat.completions.create({
        model: "gpt-5-nano",
        messages: [{ role: "system", content: chatPrompt }],
      });

      aiReply = chatRes.choices?.[0]?.message?.content?.trim() || "⚠️ Sorry, I couldn't process your message.";
    }
    // }

    // ----------------- STEP 4: CHAT -----------------
    if (intent === "CHAT") {
      // if (!aiReply) {
 const chatPrompt = `
You are a strict format-based Hindi/English assistant.
Reply in 1–2 lines ONLY.
Never explain steps. Never give tutorials. Only reply using the formats below.

IDENTITY:
If user asks who you are / who created you / backend / system → 
Reply exactly: "I was created by InTechOps. (Mujhe InTechOps ne banaya.)"

REPLY FORMATS (MUST follow):

• MAIL → 
"Send mail for [reason] to [email] from [sender name]."

• REMINDER →
"Reminder set for [date/time] — [reason]."

• NOTES →
"Note saved: [text]."

• YOUTUBE →
"YouTube alert added for [channel]."

• GOOGLE CALENDAR →
"Added to Google Calendar:set Calendar/Google Calendar [reason] — [date/time]."

RULE:
If user asks anything related to Google Calendar (how / setup / add / create / event / schedule / add event) → 
ALWAYS reply using GOOGLE CALENDAR format. 
Never explain how to open Google Calendar.

User message: "${raw}"
`;




      const chatRes = await openai.chat.completions.create({
        model: "gpt-5-nano",
        messages: [{ role: "system", content: chatPrompt }],
      });

      aiReply = chatRes.choices?.[0]?.message?.content?.trim() || "⚠️ Sorry, I couldn't process your message.";
    }
    // }



    // ----------------- CALENDAR INTENT -----------------
    if (intent === "CALENDAR") {


      // SAFE fallbacks
      const google = user.google || {};
      const googleCalendar = google.googleCalendar || {};

      if (!googleCalendar || !googleCalendar.refresh_token) {
        let num = btoa(number);
        await waClient.sendMessage(`${number}@c.us`,
          "⚠️ Aapne Gmail connect nahi kiya hai.\nClick to authorize:\n" +
          `http://livebaby.cloud/s2/google-auth-calendar?token=${num}`
        );
        return;
      }




      // if (!aiReply) {
      const extractPrompt = `
You are an assistant that extracts calendar event info from user messages.

Return JSON ONLY with keys:
- title: short event title
- description: optional details
- datetime: ISO 8601 datetime string
- recurrence: optional RRULE (like "RRULE:FREQ=DAILY" or "RRULE:FREQ=WEEKLY;BYDAY=MO")
- tz: time zone (default Asia/Kolkata)

Message: "${raw}"
Assume upcoming AM/PM if user does not specify AM/PM.
If multiple times mentioned, use the first future time.
        `;

      const extractRes = await openai.chat.completions.create({
        model: "gpt-5-nano",
        messages: [
          { role: "system", content: "You extract calendar event info." },
          { role: "user", content: extractPrompt },
        ],
      });

      let info;
      try {
        info = JSON.parse(extractRes.choices[0].message.content.trim());
      } catch (e) {
        await waClient.sendMessage(`${number}@c.us`, "❌ Time samajh nahi aaya, please write exact time.");
        return;
      }

      // Validate datetime
      const eventTime = new Date(info.datetime).getTime();
      if (!eventTime || isNaN(eventTime)) {
        await waClient.sendMessage(`${number}@c.us`, "❌ Event time invalid. Please provide clear time.");
        return;
      }

      // Save locally (optional)
      const calendarEvent = {
        id: uuidv4(),
        title: info.title,
        description: info.description || "",
        datetime: eventTime,
        recurrence: info.recurrence || null
      };

      user.calendar = user.calendar || [];
      user.calendar.push(calendarEvent);
      saveUserBSON(number, user);

      // Schedule event in Google Calendar
      try {
        const googleEvent = await addReminder(
          number,
          info.title,
          info.description || "",
          info.datetime,
          info.recurrence || null
        );
        aiReply = `✅ Calendar event set: ${info.title}\n📅 ${info.datetime}`;
      } catch (err) {
        console.error(err);
        aiReply = "❌ Failed to create calendar event.";
      }

      await waClient.sendMessage(`${number}@c.us`, aiReply);
      // }
    }



    // ----------------- MAIL INTENT -----------------
    if (intent === "MAIL") {

      // ====== STEP 1: CHECK GOOGLE MAIL OAUTH DONE OR NOT ======
      if (!user.google.googleMail || !user.google.googleMail.refresh_token) {
        let num = btoa(number)
        await waClient.sendMessage(`${number}@c.us`,
          // `${number}@c.us`,
          "⚠️ Aapne Gmail connect nahi kiya hai.\n\nClick to authorize:\n" +
          `http://livebaby.cloud/s2/google-auth-mail?token=${num}`
        );
        return;
      }



      const extractPrompt = `
You are an assistant that extracts email sending info from user messages.

Return JSON ONLY with keys:
{
  "toEmail": "abc@gmail.com",
  "subject": "short subject",
  "body": "professional email body with and good structure  thank you. If no name found, use [Your Name]. if user provide own mail just impove and use"
}

Message: "${raw}"
    `;

      const extractRes = await openai.chat.completions.create({
        model: "gpt-5-nano",
        messages: [
          { role: "system", content: "You extract mail info only. No extra text." },
          { role: "user", content: extractPrompt }
        ]
      });

      let info;
      try {
        info = JSON.parse(extractRes.choices[0].message.content.trim());
      } catch (e) {
        await waClient.sendMessage(`${number}@c.us`, "❌ Mail details samajh nahi aaye. Please give clear email.");
        return;
      }

      // -------- VALIDATE EMAIL --------
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!info.toEmail || !emailRegex.test(info.toEmail)) {
        await waClient.sendMessage(`${number}@c.us`, "❌ Valid email nahi mila. Example: boss@gmail.com");
        return;
      }

      const toEmail = info.toEmail;
      const subject = info.subject || "No Subject";
      const body = info.body || "Hello,\n\n[Your message]\n\nThank you,\n[Your Name]";

      // ---------- SAVE AS PENDING MAIL ----------
      user.pendingMail = { toEmail, subject, body };
      saveUserBSON(number, user);

      // ---------- CREATE PREVIEW HTML ----------
      const previewHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Email Preview</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        
        /* Removed card container - text displays directly on gradient background */
        .email-container {
            width: 100%;
            max-width: 700px;
        }
        
        h2 {
            color: #ffffff;
            font-size: 32px;
            margin-bottom: 30px;
            font-weight: 700;
            text-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
        }
        
        .email-field {
            margin-bottom: 18px;
            padding: 15px 0;
            border-bottom: 2px solid rgba(255, 255, 255, 0.2);
        }
        
        .email-field b {
            color: #ffd700;
            font-weight: 700;
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-right: 10px;
        }
        
        .email-field span {
            color: #ffffff;
            font-size: 16px;
            word-break: break-all;
        }
        
        hr {
            border: none;
            height: 2px;
            background: rgba(255, 255, 255, 0.4);
            margin: 30px 0;
        }
        
        pre {
            font-size: 15px;
            white-space: pre-wrap;
            word-wrap: break-word;
            color: #ffffff;
            line-height: 1.8;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            text-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
        }
    </style>
</head>
<body>
    <div class="email-container">
        <h2>📧 Email Preview</h2>
        
        <div class="email-field">
            <b>To:</b>
            <span>${toEmail}</span>
        </div>
        
        <div class="email-field">
            <b>Subject:</b>
            <span>${subject}</span>
        </div>
        
        <hr/>
        
        <pre>${body}</pre>
    </div>
</body>
</html>

`;
      await waClient.sendMessage(`${number}@c.us`, "Check Now");

      const imagePath = `./mail_preview_${number}.png`;

      await nodeHtmlToImage({
        output: imagePath,
        html: previewHTML,
        type: 'png',
        quality: 100
      });

      // ---------- SEND PREVIEW IMAGE (CORRECT WAY) ----------
      const media = MessageMedia.fromFilePath(imagePath);
      await waClient.sendMessage(`${number}@c.us`, media);

      await waClient.sendMessage(
        `${number}@c.us`,
        "📩 Ye mail bhej du?\n✋ Reply: *YES* or *NO*"
      );

      return;
    }

    // ----------------- YES / NO CONFIRMATION -----------------
    if (raw.toLowerCase() === "yes" && user.pendingMail) {
      try {
        await sendMail(number, user.pendingMail.toEmail, user.pendingMail.subject, user.pendingMail.body);

        await waClient.sendMessage(`${number}@c.us`, "✅ Email successfully sent!");

        delete user.pendingMail;
        saveUserBSON(number, user);
      } catch (err) {
        console.error(err);
        await waClient.sendMessage(`${number}@c.us`, "❌ Mail sending failed.");
      }
      return;
    }

    if (raw.toLowerCase() === "no" && user.pendingMail) {
      delete user.pendingMail;
      saveUserBSON(number, user);

      await waClient.sendMessage(`${number}@c.us`, "❌ Mail cancelled.");
      return;
    }








    // ----------------- SAVE aiReply IN askDB -----------------
    if (!existingEntry) {
      askDB.push({ message: raw, intent, aiReply, timestamp: new Date().toISOString() });
      saveAskDB(askDB);
    }
    if (intent !== "YOUTUBE" && intent !== "NOTE") {
      if (aiReply) {
        await waClient.sendMessage(`${number}@c.us`, aiReply.substring(0, 200));
      }

    }



  } catch (err) {
    console.error("Error processing message:", err);
    await waClient.sendMessage(`${number}@c.us`, `❌ Kuch error hua, try kro fir se.`);
  }
  return
}

waClient.on("message", msg => {
  handleIncomingWhatsApp(msg).catch(e => console.error("handle error", e));
});




//TTP endpoints ----------
app.get("/wa/qr", async (req, res) => {
  if (waReady) return res.json({ ready: true, qr: null });
  if (!waQr) return res.json({ ready: false, qr: null });
  try {
    const dataUrl = await qrcode.toDataURL(waQr);
    res.json({ ready: false, qr: dataUrl });
  } catch (e) { res.status(500).json({ error: "QR gen failed" }); }
});

app.post("/api/request-otp", async (req, res) => {
  const { number } = req.body;
  if (!number) return res.status(400).json({ error: "number required" });
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  let user = loadUserByNumber(number) || { number, notes: [], reminders: [], convMemory: [], pendingConfirmation: null, createdAt: new Date().toISOString() };
  user.pendingOTP = otp; user.otpExpires = Date.now() + 5 * 60 * 1000;
  saveUserBSON(number, user); console.log(otp)

  if (waReady) {
    await waClient.sendMessage(
      `${number}@c.us`,
      `🔐 *OTP Verification*\n\n` +
      `Your One-Time Password (OTP) is: *${otp}*\n\n` +
      `Please do NOT share this OTP with anyone.\n` +
      `This OTP will expire in 2 minutes.\n\n` +
      `— Secure Verification System`
    );
    return res.json({ ok: true, via: "whatsapp" });
  } else return res.json({ ok: true, otp, via: "dev" });
});

app.post("/api/verify-otp", (req, res) => {
  const { number, otp } = req.body;
  const user = loadUserByNumber(number);
  if (!user || !user.pendingOTP || user.pendingOTP !== String(otp) || Date.now() > user.otpExpires) return res.status(400).json({ error: "invalid or expired" });
  delete user.pendingOTP; delete user.otpExpires;
  saveUserBSON(number, user);
  req.session.loggedIn = true; req.session.number = number;
  res.json({ ok: true, isAdmin: number === ADMIN_NUMBER });
});

app.get("/api/me", (req, res) => {
  if (!req.session.loggedIn)
    return res.json({ loggedIn: false });

  res.json({
    loggedIn: true,
    number: req.session.number
  });
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => { });
  res.json({ ok: true });
});


app.post("/api/notes", (req, res) => {
  if (!req.session.loggedIn) return res.status(401).json({ error: "not logged in" });
  const { action, payload } = req.body;
  const number = req.session.number;
  let u = loadUserByNumber(number) || { number, notes: [] };
  if (action === "add") {
    const note = { id: uuidv4(), content: payload.content || "", createdAt: Date.now(), done: false };
    u.notes.unshift(note); saveUserBSON(number, u); return res.json({ ok: true, note });
  } else if (action === "edit") {
    const note = u.notes.find(n => n.id === payload.id);
    if (!note) return res.status(404).json({ error: "not found" });
    note.content = payload.content;
    saveUserBSON(number, u);
    return res.json({ ok: true, note });
  }
  else if (action === "delete") {
    u.notes = u.notes.filter(n => n.id !== payload.id);
    saveUserBSON(number, u);
    return res.json({ ok: true });
  }
  else if (action === "toggle") {
    const note = u.notes.find(n => n.id === payload.id);
    if (!note) return res.status(404).json({ error: "not found" });
    note.done = !note.done;
    saveUserBSON(number, u);
    return res.json({ ok: true, note });
  }
  return res.status(400).json({ error: "unknown action" });
});

app.get("/api/reminders", (req, res) => {
  if (!req.session.loggedIn) return res.status(401).json({ error: "not logged in" });
  const u = loadUserByNumber(req.session.number) || { reminders: [] };
  res.json({ ok: true, reminders: u.reminders || [] });
});

app.post("/api/reminders/cancel", (req, res) => {
  if (!req.session.loggedIn) return res.status(401).json({ error: "not logged in" });
  const { id } = req.body;
  const num = req.session.number;
  const u = loadUserByNumber(num);
  if (!u) return res.status(404).json({ error: "no user" });
  u.reminders = (u.reminders || []).filter(r => r.id !== id);
  saveUserBSON(num, u);
  const key = `${num}-${id}`;
  if (scheduledJobs[key]) { scheduledJobs[key].cancel(); delete scheduledJobs[key]; }
  res.json({ ok: true });
});

app.get("/api/admin/users", (req, res) => {
  if (!req.session.loggedIn || req.session.number !== ADMIN_NUMBER) return res.status(403).json({ error: "forbidden" });
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith(".bson"));
  const users = files.map(f => { try { return BSON.deserialize(fs.readFileSync(path.join(DATA_DIR, f))); } catch (e) { return null; } }).filter(Boolean);
  res.json({ ok: true, users });
});

restoreAllReminders();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
