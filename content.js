// content.js
(async () => {
    try {
        const hostname = window.location.hostname;
        const result = await chrome.storage.local.get(['settings']);
        const settings = result.settings || {};
        const matchedDomain = Object.keys(settings).find(domain => hostname.includes(domain));

        if (matchedDomain) {
            startHeartbeat(matchedDomain);
        }
    } catch (e) { }
})();

function startHeartbeat(domain) {
    setInterval(() => {
        if (document.hidden) return;
        try {
            chrome.runtime.sendMessage({
                action: 'tick',
                domain: domain
            }, (response) => {
                if (chrome.runtime.lastError) return;

                if (response && response.block) {
                    window.location.href = response.redirectUrl;
                }
            });
        } catch (e) { }
    }, 1000);
}
