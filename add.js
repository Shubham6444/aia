import { google } from "googleapis";
import express from "express";
import path from "path";
import fs from "fs";
import { authUpdate } from "./server.js";

const app = express();
const PORT = 3000;
const router = express.Router();

// ---------------------------
// Google OAuth Setup
// ---------------------------

const REDIRECT_URL = "http://localhost:3000/oauth2callback-mail";

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URL);

// ---------------------------
// Data Storage Helpers
// ---------------------------
const DATA_DIR = "./data";
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function userFilePath(number) {
  return path.join(DATA_DIR, `${number}.json`);
}

function loadUser(number) {
  const p = userFilePath(number);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p));
}

function saveUser(number, data) {
  const p = userFilePath(number);
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

// ---------------------------
// OAuth Routes

// ---------------------------
router.get("/google-auth-mail", (req, res) => {
  const number = atob(req.query.token);
  if (!number) return res.send("Missing number!");

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/gmail.send"],
    prompt: "consent",
    state: number
  });

  res.redirect(url);
});

router.get("/oauth2callback-mail", async (req, res) => {
  try {
    const code = req.query.code;
    const number = req.query.state;
    if (!number) return res.send("Missing number!");

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    let user = loadUser(number) || { number, notes: [], reminders: [], convMemory: [], youtube: [] };

    user.google = user.google || {};
    user.google.googleMail = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      scope: tokens.scope,
      token_type: tokens.token_type,
      expiry_date: tokens.expiry_date
    };

    saveUser(number, user);
    await authUpdate(number);
  return res.redirect("/dashboard.html");

    // res.send("✅ Gmail Connected & Tokens Saved!");
  } catch (err) {
    console.error(err);
    res.send("OAuth Error: " + err.message);
  }
});

// ---------------------------
// Get Authenticated Client
// ---------------------------
function getAuthenticatedClient(number) {
  const user = loadUser(number);
  if (!user?.google?.googleMail?.refresh_token) throw new Error("User has not authorized Gmail.");

  const client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URL);

  client.setCredentials({
    access_token: user.google.googleMail.access_token,
    refresh_token: user.google.googleMail.refresh_token,
    expiry_date: user.google.googleMail.expiry_date
  });

  // Auto-update tokens
  client.on("tokens", (tokens) => {
    if (tokens.access_token) user.google.googleMail.access_token = tokens.access_token;
    if (tokens.refresh_token) user.google.googleMail.refresh_token = tokens.refresh_token;
    if (tokens.expiry_date) user.google.googleMail.expiry_date = tokens.expiry_date;
    saveUser(number, user);
    console.log("🔄 Tokens auto-updated for:", number);
  });

  return client;
}

// ---------------------------
// Send Gmail Function
// ---------------------------
export async function sendMail(number, toEmail, subject, body) {
  const client = getAuthenticatedClient(number);
  const gmail = google.gmail({ version: "v1", auth: client });

  const message = [
    `From: me`,
    `To: ${toEmail}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    ``,
    body
  ].join("\n");

  const encodedMessage = Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: encodedMessage }
  });

  console.log("📧 Email sent to:", toEmail);
}

// ---------------------------
// Example Usage: Send Mail Route
// ---------------------------
router.get("/send-mail", async (req, res) => {
  try {
    const number = req.query.number;
    if (!number) return res.send("Missing number!");

    const toEmail = "boss@gmail.com";
    const subject = "Sick Leave Request";
    const body = "Hello Sir,\n\nI would like to request 2 days off due to sickness.\n\nThank you,\n[Your Name]";

    await sendMail(number, toEmail, subject, body);

    res.send("✅ Sick leave email sent!");
  } catch (err) {
    console.error(err);
    res.send("Error sending email: " + err.message);
  }
});

export default router;


// const toEmail = "skm11794@gmail.com";
//     const subject = "Sick Leave Request";
//     const body = "Hello Sir,\n\nI would like to request 2 days off due to sickness.\n\nThank you,\n[Your Name]";

//     await sendMail("918081238948", toEmail, subject, body);
