// bg
let memoryStats = {};
let settingsCache = {};
let nightModeCache = null; // { enabled: bool, start: "HH:MM", end: "HH:MM" }
let alertedState = {};
let lastResetDate = '';
let snoozeState = {};

initialize();

async function initialize() {
    try {
        await loadData();
    } catch (e) {
        console.error("Failed to load data during initialization:", e);
    }
    setupContextMenu();
    if (chrome.alarms) {
        chrome.alarms.create('saveData', { periodInMinutes: 1 });
    }
}

function setupContextMenu() {
    chrome.contextMenus.create({
        id: "add-site-limit",
        title: "このサイトを制限リストに追加 (30分)",
        contexts: ["page"]
    }, () => {
        if (chrome.runtime.lastError) { }
    });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "add-site-limit") {
        addDomainFromTab(tab);
    }
});

function addDomainFromTab(tab) {
    if (!tab.url) return;
    try {
        const url = new URL(tab.url);
        const domain = url.hostname;

        if (settingsCache[domain]) {
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => alert("このサイトは既にリストに含まれています")
            });
            return;
        }

        settingsCache[domain] = { limit: 30, addedAt: Date.now() };
        chrome.storage.local.set({ settings: settingsCache }, () => {
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: (d) => alert(`「${d}」を30分制限で追加しました`),
                args: [domain]
            });
        });
    } catch (e) { }
}

if (chrome.alarms) {
    chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === 'saveData') saveData();
    });
}

async function loadData() {
    const data = await chrome.storage.local.get(['settings', 'dailyStats', 'lastResetDate', 'nightMode']);
    settingsCache = data.settings || {};
    nightModeCache = data.nightMode || null;
    const today = new Date().toLocaleDateString();
    lastResetDate = data.lastResetDate;

    if (lastResetDate !== today) {
        // Date changed since last session
        memoryStats = {};
        lastResetDate = today;
        // Do NOT clear dailyStats here! Just update the date.
        await chrome.storage.local.set({ lastResetDate: today });
    } else {
        memoryStats = (data.dailyStats && data.dailyStats[today]) ? data.dailyStats[today] : {};
    }
}

async function saveData() {
    if (!lastResetDate) return;
    const today = new Date().toLocaleDateString();

    // Check for day rollover during runtime
    if (today !== lastResetDate) {
        memoryStats = {};
        lastResetDate = today;
        // Do NOT clear dailyStats here! Just update the date.
        await chrome.storage.local.set({ lastResetDate: today });
        return;
    }

    // Standard Save
    const data = await chrome.storage.local.get(['dailyStats']);
    let allStats = data.dailyStats || {};
    allStats[today] = memoryStats;
    await chrome.storage.local.set({ dailyStats: allStats });
}

// Promise to track init
let initPromise = initialize();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Ensure data is loaded before processing
    initPromise.then(() => {
        if (request.action === 'tick') {
            handleTick(request.domain, sender, sendResponse);
        } else if (request.action === 'getRealtimeStats') {
            sendResponse({ stats: memoryStats, settings: settingsCache, snoozeState: snoozeState });
        } else if (request.action === 'extendLimit') {
            const domain = request.domain;
            const minutes = parseInt(request.minutes || 5, 10);

            // Extend now ALWAYS means "Snooze this domain for X minutes"
            // This applies to Site Limit, Global Limit, and Night Mode.
            // We do NOT modify the permanent settings anymore.
            snoozeState[domain] = Date.now() + (minutes * 60 * 1000);
            sendResponse({ success: true, newLimit: 'Snoozed' });
            return true;
        } else if (request.action === 'snooze') {
            // Check if we need to snooze global
            // The request comes with 'domain'. If the user was blocked by 'global', we might want to snooze global.
            // But block.js sends the current url domain.
            // Simplified: If the user snoozes, we just snooze that domain for 5 mins.
            // However, if the block was GLOBAL, we should snooze GLOBAL limit?
            // Let's check the 'type' param passed to block.html if possible, but background doesn't know context easily here.
            // Alternative: Just snooze the domain is safer.
            // However, to satisfy "Global limit snooze", we might need to snooze the __global_limit__ key.
            // Let's support an explicit type in the request if provided.

            if (request.type === 'global') {
                snoozeState['__global_limit__'] = Date.now() + (5 * 60 * 1000);
            } else {
                snoozeState[request.domain] = Date.now() + (5 * 60 * 1000);
            }
            sendResponse({ success: true });
        } else if (request.action === 'resetToday') {
            memoryStats = {};
            sendResponse({ success: true });
        }
    });
    return true; // Async response
});

function handleTick(domain, sender, sendResponse) {
    if (!sender.tab) { sendResponse({}); return; }

    // 0. Check Night Mode (Highest Priority? Or should we count stats first?)
    // Counting stats is fine even if blocked by night mode (to track usage).
    // Let's count first.

    // 1. Increment Count
    memoryStats[domain] = (memoryStats[domain] || 0) + 1;
    const currentSeconds = memoryStats[domain];

    // 2. Fetch Settings
    const localSetting = settingsCache[domain];
    const globalSetting = settingsCache['__global_limit__'];

    // 3. Calculate Limits
    let localLimitSeconds = localSetting ? localSetting.limit * 60 : null;
    let globalLimitSeconds = globalSetting ? globalSetting.limit * 60 : null;
    let globalUsedSeconds = 0;

    if (globalSetting) {
        globalUsedSeconds = Object.values(memoryStats).reduce((a, b) => a + b, 0);
    }

    if (!localSetting && !globalSetting && !nightModeCache?.enabled) {
        chrome.action.setBadgeText({ text: "", tabId: sender.tab.id });
        sendResponse({});
        return;
    }

    // 4. Determine Block Status
    let blockReason = null; // 'site', 'global', 'night'

    // Night Mode Check
    if (checkNightMode(nightModeCache)) {
        blockReason = 'night';
    }
    // Local Limit Check
    else if (localLimitSeconds && currentSeconds > localLimitSeconds) {
        blockReason = 'site';
    }
    // Global Limit Check
    else if (globalLimitSeconds && globalUsedSeconds > globalLimitSeconds) {
        blockReason = 'global';
    }

    // 5. Update Badge
    let remaining = 999999;
    if (localLimitSeconds) remaining = Math.min(remaining, localLimitSeconds - currentSeconds);
    if (globalLimitSeconds) remaining = Math.min(remaining, globalLimitSeconds - globalUsedSeconds);
    // Night mode doesn't really have "remaining" in the same way, unless we calc time to start?
    // For now, leave badge as based on usage limits.

    updateBadge(sender.tab.id, remaining);

    // 6. Execution
    if (blockReason) {
        // Check Snooze
        const snoozeEndDomain = snoozeState[domain];
        const snoozeEndGlobal = snoozeState['__global_limit__'];
        const snoozeEndNight = snoozeState['__night_mode__']; // Special key for night mode snooze?

        // Allow snooze overrides
        if (snoozeEndDomain && Date.now() < snoozeEndDomain) {
            sendResponse({ block: false });
            return;
        }
        if (blockReason === 'global' && snoozeEndGlobal && Date.now() < snoozeEndGlobal) {
            sendResponse({ block: false });
            return;
        }
        // If Night Mode is active, do we allow specific domain snooze to override it?
        // Yes, if user snoozes "youtube.com", they probably want to see it even at night.
        // What about global night snooze? 
        // Let's rely on domain snooze for simplicity for now, OR support night snooze if we add a button for it.
        // Implementation Plan said "standard block behavior". Block page has "Extend".
        // If user extends 5 mins, it sends 'snooze' action with domain.
        // This sets snoozeState[domain].
        // So the check `snoozeEndDomain` above covers it!
        // We just need to make sure block.html sends the right request.

        const redirectUrl = chrome.runtime.getURL(`block.html?domain=${domain}&type=${blockReason}&url=${encodeURIComponent(sender.tab.url)}`);

        // Force redirect from background
        chrome.tabs.update(sender.tab.id, { url: redirectUrl }).catch(() => { });

        sendResponse({ block: true, redirectUrl: redirectUrl });
    } else {
        sendResponse({ block: false });
    }
}

function checkNightMode(config) {
    if (!config || !config.enabled || !config.start || !config.end) return false;

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const [startH, startM] = config.start.split(':').map(Number);
    const [endH, endM] = config.end.split(':').map(Number);
    const startTotal = startH * 60 + startM;
    const endTotal = endH * 60 + endM;

    if (startTotal < endTotal) {
        // Same day range (e.g. 09:00 - 17:00) - Unlikely for "Night" but possible
        return currentMinutes >= startTotal && currentMinutes < endTotal;
    } else {
        // Crossover (e.g. 22:00 - 06:00)
        return currentMinutes >= startTotal || currentMinutes < endTotal; // After start OR before end
    }
}

function updateBadge(tabId, remainingSeconds) {
    if (remainingSeconds < 0) remainingSeconds = 0;
    const minutes = Math.ceil(remainingSeconds / 60);

    let color = "#4caf50";
    if (minutes <= 5) color = "#ff9800";
    if (minutes <= 1) color = "#f44336";

    const text = minutes > 99 ? "99+" : minutes.toString();
    chrome.action.setBadgeText({ text: text, tabId: tabId });
    chrome.action.setBadgeBackgroundColor({ color: color, tabId: tabId });
}

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
        if (changes.settings) settingsCache = changes.settings.newValue || {};
        if (changes.nightMode) nightModeCache = changes.nightMode.newValue || null;
        if (changes.dailyStats) {
            const newVal = changes.dailyStats.newValue || {};
            const today = new Date().toLocaleDateString();
            if (!newVal[today]) memoryStats = {};
        }
    }
});

// Immediate Global Limit Check on Navigation/Activation
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url && !tab.url.startsWith('chrome://') && !tab.url.includes('block.html')) {
        checkGlobalLimit(tab);
    }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
    chrome.tabs.get(activeInfo.tabId, (tab) => {
        if (chrome.runtime.lastError || !tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.includes('block.html')) return;
        checkGlobalLimit(tab);
    });
});

function checkGlobalLimit(tab) {
    if (!settingsCache['__global_limit__']) return;

    const globalSetting = settingsCache['__global_limit__'];
    const globalLimitSeconds = globalSetting.limit * 60;
    const globalUsedSeconds = Object.values(memoryStats).reduce((a, b) => a + b, 0);

    if (globalUsedSeconds > globalLimitSeconds) {
        // Check Snooze
        const snoozeEndGlobal = snoozeState['__global_limit__'];
        if (snoozeEndGlobal && Date.now() < snoozeEndGlobal) return;

        // Also check specific domain snooze
        try {
            const url = new URL(tab.url);
            const domain = url.hostname;
            const snoozeEndDomain = snoozeState[domain];
            if (snoozeEndDomain && Date.now() < snoozeEndDomain) return;
        } catch (e) { }

        const redirectUrl = chrome.runtime.getURL(`block.html?domain=GLOBAL_LIMIT&type=global&url=${encodeURIComponent(tab.url)}`);
        chrome.tabs.update(tab.id, { url: redirectUrl }).catch(() => { });
    }
}
