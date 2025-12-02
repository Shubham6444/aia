import express from "express";
import fs from "fs";
import path from "path";
  import session from "express-session";

const router = express.Router();


// --------------------------------------------------
// DIRECTORY SETUP
// --------------------------------------------------
const DATA_DIR = path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// JSON file path helper
function userFilePath(number) {
  return path.join(DATA_DIR, `${number}.json`);
}

// --------------------------------------------------
// LOAD USER JSON
// --------------------------------------------------
export function loadUserJSON(number) {
  try {
    const file = userFilePath(number);

    if (!fs.existsSync(file)) return null;

    const data = fs.readFileSync(file, "utf8");
    return JSON.parse(data);
  } catch (err) {
    console.error("loadUserJSON error:", err);
    return null;
  }
}

// --------------------------------------------------
// SAVE USER JSON
// --------------------------------------------------
export function saveUserJSON(number, userData) {
  try {
    const file = userFilePath(number);

    const finalData = { number, ...userData };

    fs.writeFileSync(file, JSON.stringify(finalData, null, 2));
    return true;
  } catch (err) {
    console.error("saveUserJSON error:", err);
    return false;
  }
}

// --------------------------------------------------
// AUTO-LOAD OR CREATE USER
// --------------------------------------------------
function getUser(number) {
  let user = loadUserJSON(number);

  if (!user) {
    user = {
      number,
      notes: [],
      reminders: [],
      convMemory: [],
      youtube: [],
      calendar: [],
      google: {}
    };
    saveUserJSON(number, user);
  }

  return user;
}

// ==================================================
//                ROUTES
// ==================================================

/*
-----------------------------------------------------
   GET ALL NOTES
-----------------------------------------------------
*/
router.get("/user/:number/notes", (req, res) => {
  const number = req.params.number;
  const user = getUser(number);

  res.json({
    number,
    notes: user.notes || []
  });
});

/*
-----------------------------------------------------
   GET ALL REMINDERS
-----------------------------------------------------
*/
router.get("/user/:number/reminders", (req, res) => {
  const number = req.params.number;
  const user = getUser(number);

  res.json({
    number,
    reminders: user.reminders || []
  });
});

/*
-----------------------------------------------------
   GET ALL CALENDAR EVENTS
-----------------------------------------------------
*/
router.get("/user/:number/calendar", (req, res) => {
  const number = req.params.number;
  const user = getUser(number);

  res.json({
    number,
    calendar: user.calendar || []
  });
});

/*
-----------------------------------------------------
   GET YOUTUBE CHANNELS
-----------------------------------------------------
*/
router.get("/user/:number/youtube", (req, res) => {
  const number = req.params.number;
  const user = getUser(number);
  res.json({
    number,
    youtubeChannels: user.youtube || []
  });
});

/*
-----------------------------------------------------
   CHECK GOOGLE MAIL AUTH
-----------------------------------------------------
*/

router.get("/user/:number/google", (req, res) => {
  const number = req.params.number;
  const user = getUser(number);

  const mail = user.google?.googleMail || null;
  const cal = user.google?.googleCalendar || null;

  res.json({
    number,
    mailAuthed: !!(mail && mail.refresh_token),
    calendarAuthed: !!(cal && cal.refresh_token),

    data: mail
  });
});

/*
-----------------------------------------------------
   CHECK GOOGLE CALENDAR AUTH
-----------------------------------------------------
// */
// router.get("/user/:number/google-calendar", (req, res) => {
//   const number = req.params.number;
//   const user = getUser(number);

//   const cal = user.google?.googleCalendar || null;
// console.log(cal)
//   res.json({
//     number,
//     calendarAuthed: !!(cal && cal.refresh_token),
//     data: cal
//   });
// });

/*
-----------------------------------------------------
   LOGOUT GOOGLE (DELETE ONLY TOKEN)
-----------------------------------------------------
*/
router.delete("/user/:number/logout", (req, res) => {
  const number = req.params.number;
  const user = getUser(number);

  user.google = {}; // reset google tokens

  saveUserJSON(number, user);

  res.json({
    number,
    message: "Google tokens removed successfully (Logout complete)."
  });
});


export default router;
