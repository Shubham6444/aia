import fs from "fs";

// ===== LOAD FILE =====
let rateLimitData = {};
if (fs.existsSync("use.json")) {
    rateLimitData = JSON.parse(fs.readFileSync("use.json", "utf8"));
}

// ===== SAVE FUNCTION =====
function saveData() {
    fs.writeFileSync("use.json", JSON.stringify(rateLimitData, null, 2));
}

// ===== RATE LIMIT SYSTEM =====
export function limitUser(number) {
    const now = Date.now();

    // First time data
    if (!rateLimitData[number]) {
        rateLimitData[number] = {
            minuteCalls: [],
            dayCalls: [],
            totalCalls: 0
        };
    }

    let user = rateLimitData[number];

    // Keep only last 1 minute requests
    user.minuteCalls = user.minuteCalls.filter(t => now - t < 30000);

    // Keep only last 24 hours requests
    user.dayCalls = user.dayCalls.filter(t => now - t < 86400000);

    // CHECK LIMITS
    if (user.minuteCalls.length >= 10) {
        return { blocked: true, reason: "MINUTE_LIMIT" };
    }
    if (user.dayCalls.length >= 20) {
        return { blocked: true, reason: "DAILY_LIMIT" };
    }

    // Add new timestamps
    user.minuteCalls.push(now);
    user.dayCalls.push(now);

    // Increase lifetime counter
    user.totalCalls++;

    // SAVE changes to file
    saveData();

    return { blocked: false, total: user.totalCalls };
}
