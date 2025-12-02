import fs from "fs";

const replies = JSON.parse(
  fs.readFileSync("./reply.json", "utf8")
);
const abusiveWords = [
  "madarchod", "bsdk", "bhosdike", "randi", "randi ke", "chutiya",
  "gandu", "loda", "gaand", "bhadwa", "bhosdiwale", "mc", "bc",
  "maderchod", "lavde", "kuthri", "kutta", "harami", "suar", "fuck",
  "motherfucker", "bitch", "asshole"
];
function isAbusive(msg) {
  const text = msg.toLowerCase();

  return abusiveWords.some(w => text.includes(w));
}

export function qnafun(prompt) {
  const ask = prompt.toLowerCase().trim();


   if (isAbusive(prompt)) {
      let warning = "⚠️ *Warning!*\nAbusive language is not allowed. Please talk respectfully.";
      

      return warning;
        }
  // 1️⃣ Exact match
  if (replies[ask]) return replies[ask];

  // 2️⃣ Optional: Similar match (contains)
  for (const key in replies) {
    if (ask.includes(key)) {
      return replies[key];
    }
  }

  // 3️⃣ Default fallback
//   return "Sorry, I don’t have an answer yet.";
}
