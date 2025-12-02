import fs from "fs";
import axios from "axios";
import express from "express";

const app = express();
app.use(express.json());

const subscriptionsFile = "./subscriptions.json";
// const API_KEY = "AIzaSyC45Ffq_XxxDZojO3rEE24vjDvsf0rifuw";
const API_KEY = "AIzaSyDTiixS7Yy8Ka_T21CX39biaowSJXHAqoo";

// ==========================
// Helper Functions
// ==========================
function loadSubscriptions() {
  if (!fs.existsSync(subscriptionsFile)) return [];
  return JSON.parse(fs.readFileSync(subscriptionsFile));
}

function saveSubscriptions(subs) {
  fs.writeFileSync(subscriptionsFile, JSON.stringify(subs, null, 2));
}

// Get YouTube channel ID dynamically
async function getChannelIdByName(channelName) {
  try {
    const res = await axios.get("https://www.googleapis.com/youtube/v3/search", {
      params: { part: "snippet", type: "channel", q: channelName, maxResults: 1, key: API_KEY }
    });
    return res.data.items[0]?.snippet?.channelId || null;
  } catch (err) {
    console.error("Error fetching channel ID:", err.message);
    return null;
  }
}

// Get latest video from channel
async function getLatestVideo(channelId) {
  try {
    const channelRes = await axios.get("https://www.googleapis.com/youtube/v3/channels", {
      params: { part: "contentDetails", id: channelId, key: API_KEY }
    });
    const uploadsPlaylistId = channelRes.data.items[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) return null;

    const playlistRes = await axios.get("https://www.googleapis.com/youtube/v3/playlistItems", {
      params: { part: "snippet", playlistId: uploadsPlaylistId, maxResults: 1, key: API_KEY }
    });
    const latest = playlistRes.data.items[0]?.snippet;
    if (!latest) return null;

    return { id: latest.resourceId.videoId, title: latest.title };
  } catch (err) {
    console.error("Error fetching latest video:", err.message);
    return null;
  }
}

// ==========================
// Subscription Functions
// ==========================

export async function subscribe(number, raw) {
  const match = raw.match(/(?:Jab\s+)?(.+?)\s+(new video|video upload)/i);
  if (!match) {
    console.log({ error: "No channel found in message." });
    return;
  }

  const channelName = match[1].trim();
  const channelId = await getChannelIdByName(channelName);
  if (!channelId) {
    console.log({ error: `Channel "${channelName}" not found.` });
    return;
  }

  let subs = loadSubscriptions();
  let user = subs.find(u => u.number === number);
  if (!user) {
    user = { number, channels: [] };
    subs.push(user);
  }

  if (!user.channels.find(c => c.channelId === channelId)) {
    user.channels.push({ channelId, channelName, lastVideoId: "" });
    saveSubscriptions(subs);
    console.log(`[${number}] ✅ Subscribed to ${channelName}`);
  } else {
    console.log({ info: `Already tracking ${channelName}` });
  }
}

async function unsubscribe(number, channelName) {
  let subs = loadSubscriptions();
  let user = subs.find(u => u.number === number);
  if (!user) {
    console.log({ error: "User not found." });
    return;
  }

  const before = user.channels.length;
  user.channels = user.channels.filter(c => c.channelName !== channelName);
  saveSubscriptions(subs);

  if (before === user.channels.length) {
    console.log({ info: "Channel not found." });
  } else {
    console.log({ success: `Unsubscribed from ${channelName}` });
  }
}







// ==========================
// Polling Function
// ==========================
export async function checkForNewVideos() {
  const reminders = []; // reset every poll
  const subs = loadSubscriptions();

  for (const user of subs) {
    for (const channel of user.channels) {
      const latestVideo = await getLatestVideo(channel.channelId);
      if (!latestVideo) continue;

      if (latestVideo.id !== channel.lastVideoId) {
        channel.lastVideoId = latestVideo.id;

        // Push as an object with all useful info
        reminders.push({
          number: user.number,
          channelName: channel.channelName,
          videoId: latestVideo.id,
          title: latestVideo.title,
          url: `https://youtube.com/watch?v=${latestVideo.id}`
        });
      }
    }
  }

  saveSubscriptions(subs);
  return reminders;
}
