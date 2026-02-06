// bg
let memoryStats = {};
let settingsCache = {};
let alertedState = {};
let lastResetDate = '';
let snoozeState = {};

initialize();

async function initialize() {
    await loadData();
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
    const data = await chrome.storage.local.get(['settings', 'dailyStats', 'lastResetDate']);
    settingsCache = data.settings || {};
    const today = new Date().toLocaleDateString();
    lastResetDate = data.lastResetDate;

    if (lastResetDate !== today) {
        memoryStats = {};
        lastResetDate = today;
        await chrome.storage.local.set({ lastResetDate: today, dailyStats: {} });
    } else {
        memoryStats = (data.dailyStats && data.dailyStats[today]) ? data.dailyStats[today] : {};
    }
}

async function saveData() {
    if (!lastResetDate) return;
    const today = new Date().toLocaleDateString();
    if (today !== lastResetDate) {
        memoryStats = {};
        lastResetDate = today;
        await chrome.storage.local.set({ lastResetDate: today, dailyStats: {} });
        return;
    }
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

    if (!localSetting && !globalSetting) {
        chrome.action.setBadgeText({ text: "", tabId: sender.tab.id });
        sendResponse({});
        return;
    }

    // 4. Determine Block Status
    let blockReason = null; // 'site' or 'global'

    // Local Limit Check
    if (localLimitSeconds && currentSeconds > localLimitSeconds) {
        blockReason = 'site';
    }
    // Global Limit Check
    // Note: We check global limit regardless of local limit status (e.g. if local limit is 60min but global is 30min).
    // If local limit is ALREADY blocking, we prioritize 'site' reason (or maybe global?).
    // Actually, if both are exceeded, 'global' is a stronger reason? Or 'site'?
    // Let's stick to: if local is exceeded, block as site. If not, check global.
    // However, if global limit is exceeded, we MUST block.
    // If local is exceeded, we are already blocking.
    else if (globalLimitSeconds && globalUsedSeconds > globalLimitSeconds) {
        blockReason = 'global';
    }

    // 5. Update Badge
    let remaining = 999999;
    if (localLimitSeconds) remaining = Math.min(remaining, localLimitSeconds - currentSeconds);
    if (globalLimitSeconds) remaining = Math.min(remaining, globalLimitSeconds - globalUsedSeconds);

    updateBadge(sender.tab.id, remaining);

    // 6. Execution
    if (blockReason) {
        // Check Snooze
        const snoozeEndDomain = snoozeState[domain];
        const snoozeEndGlobal = snoozeState['__global_limit__'];

        // If 'site' block and site is snoozed -> allow
        if (blockReason === 'site' && snoozeEndDomain && Date.now() < snoozeEndDomain) {
            sendResponse({ block: false });
            return;
        }
        // If 'global' block and global is snoozed -> allow
        // Also allow if specific domain is snoozed? (Maybe user wants to snooze just this site despite global limit?)
        // Let's allow specific domain snooze to override global limit for that domain too.
        if (snoozeEndDomain && Date.now() < snoozeEndDomain) {
            sendResponse({ block: false });
            return;
        }
        if (blockReason === 'global' && snoozeEndGlobal && Date.now() < snoozeEndGlobal) {
            sendResponse({ block: false });
            return;
        }

        const redirectUrl = chrome.runtime.getURL(`block.html?domain=${domain}&type=${blockReason}&url=${encodeURIComponent(sender.tab.url)}`);

        // Force redirect from background
        chrome.tabs.update(sender.tab.id, { url: redirectUrl }).catch(() => { });

        sendResponse({ block: true, redirectUrl: redirectUrl });
    } else {
        sendResponse({ block: false });
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
        if (changes.dailyStats) {
            const newVal = changes.dailyStats.newValue || {};
            const today = new Date().toLocaleDateString();
            if (!newVal[today]) memoryStats = {};
        }
    }
});
