import { google } from "googleapis";
import express from "express";
import path from "path";
import fs from "fs";
// import { imageType } from "tesseract.js";
import { authUpdate } from "./server.js";
const app = express();
const PORT = 3000;
const router = express.Router();

// ---------------------------
// Google OAuth Credentials
// ---------------------------

const REDIRECT_URL = "http://localhost:3000/oauth2callback-calendar";

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URL
);

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
// Google Auth Routes
// ---------------------------

// Step 1: Redirect user to Google OAuth
router.get("/google-auth-calendar", (req, res) => {
  const number = atob(req.query.token);
  console.log(number)
  if (!number) return res.send("Missing number!");

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline", // important for refresh token
    scope: ["https://www.googleapis.com/auth/calendar"],
    prompt: "consent",
    state: number // pass mobile number safely
  });

  res.redirect(url);
});

// Step 2: Callback from Google
router.get("/oauth2callback-calendar", async (req, res) => {
  try {
    const code = req.query.code;
    const number = req.query.state;
    if (!number) return res.send("Missing number!");

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Load or create user
    let user = loadUser(number) || {
      number,
      notes: [],
      reminders: [],
      convMemory: [],
      youtube: []
    };

    // Save tokens in user JSON
    
        user.google = user.google || {};
    user.google.googleCalendar = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      scope: tokens.scope,
      token_type: tokens.token_type,
      expiry_date: tokens.expiry_date
    };

    saveUser(number, user);
    await authUpdate(number);
    console.log("🎉 Google Tokens Saved for:", number);
      return res.redirect("/dashboard.html");

    // res.send("Google Calendar Connected + Tokens Saved!");
  } catch (err) {
    console.error(err);
    res.send("OAuth Error");
  }
});

// ---------------------------
// Auto Refresh Tokens
// ---------------------------

function getAuthenticatedClient(number) {
  let user = loadUser(number);
  if (!user || !user.google.googleCalendar?.refresh_token) {
    throw new Error("User has not authorized Google Calendar.");
  }

  const client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URL);

  client.setCredentials({
    access_token: user.google.googleCalendar.access_token,
    refresh_token: user.google.googleCalendar.refresh_token,
    expiry_date: user.google.googleCalendar.expiry_date
  });

  // Listen for new tokens and auto-save
  client.on("tokens", (tokens) => {
    if (tokens.refresh_token) user.google.googleCalendar.refresh_token = tokens.refresh_token;
    if (tokens.access_token) {
      user.google.googleCalendar.access_token = tokens.access_token;
      user.google.googleCalendar.expiry_date = tokens.expiry_date;
    }
    saveUser(number, user);
    console.log("🔄 Tokens auto-updated for:", number);
  });

  return client;
}

// ---------------------------
// Example: Add Calendar Reminder
// ---------------------------
export async function addReminder(number, summary, description, dateTime, recurrenceRule = null) {
  const auth = getAuthenticatedClient(number);
  const calendar = google.calendar({ version: "v3", auth });

  const event = {
    summary,
    description,
    start: { dateTime, timeZone: "Asia/Kolkata" },
    end: { dateTime, timeZone: "Asia/Kolkata" },
    reminders: {
      useDefault: false,
      overrides: [
        { method: "popup", minutes: 5 },
        { method: "email", minutes: 5 }
      ]
    }
  };

  if (recurrenceRule) {
    event.recurrence = [recurrenceRule]; // <-- set repeating rule
  }

  const res = await calendar.events.insert({
    calendarId: "primary",
    resource: event
  });

  console.log("📅 Reminder Added:", res.data.htmlLink);
  return res.data;
}

// ---------------------------
// Express Example Route
// ---------------------------
app.get("/add-reminder", async (req, res) => {
  try {
    const { number, summary, description, dateTime, recurrence } = req.query;
    if (!number || !summary || !dateTime) return res.send("Missing parameters!");

    const event = await addReminder(number, summary, description || "", dateTime, recurrence);
    res.send(`Reminder added: ${event.htmlLink}`);
  } catch (err) {
    console.error(err);
    res.send("Error adding reminder: " + err.message);
  }
});
export default router;

// await addReminder(
//     "918081238948",
//   "Daily Exercise",
//   "Do workout every day",
//   "2025-12-01T07:00:00+05:30",
//   "RRULE:FREQ=DAILY"
// );
