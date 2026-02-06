function saveGlobalLimit(limit) {
    chrome.storage.local.get(['settings'], (result) => {
        const settings = result.settings || {};
        settings['__global_limit__'] = { limit: limit, addedAt: Date.now() };
        chrome.storage.local.set({ settings: settings }, () => {
            showStatus('全体制限を保存しました');
            document.getElementById('domain').value = '';
            document.getElementById('limit').value = '';
            updateView();
        });
    });
}
