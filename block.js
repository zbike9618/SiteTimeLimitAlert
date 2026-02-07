// block.js
document.addEventListener('DOMContentLoaded', () => {
    // Apply Dark Mode if enabled
    chrome.storage.local.get(['darkMode'], (result) => {
        if (result.darkMode) {
            document.documentElement.setAttribute('data-theme', 'dark');
        }
    });

    // URLパラメータから元のサイトドメインを取得
    const params = new URLSearchParams(window.location.search);
    const domain = params.get('domain');
    const type = params.get('type'); // 'site' or 'global'
    const originalUrl = params.get('url');

    document.getElementById('domainName').textContent = domain || '不明なサイト';
    if (type === 'global') {
        document.querySelector('h1').textContent = "🌏 全体制限を超えました";
    }

    // Close Button Handling
    document.getElementById('closeBtn').addEventListener('click', () => {
        chrome.tabs.getCurrent((tab) => {
            if (tab) {
                chrome.tabs.remove(tab.id);
            } else {
                // Flashback for Vivaldi/others: window.close() might fail or close browser
                // Try standard close first, then hack
                try {
                    window.close();
                } catch (e) {
                    console.warn('window.close() failed, trying workaround');
                }
                // Vivaldi workaround:
                window.open('', '_self').close();
            }
        });
    });

    // 延長ボタン
    document.getElementById('extendBtn').addEventListener('click', () => {
        if (!domain) return;

        const minutes = parseInt(document.getElementById('extendMinutes').value, 10);

        // バックグラウンドに延長（リミット変更）要求
        chrome.runtime.sendMessage({
            action: 'extendLimit',
            domain: domain,
            type: type,
            minutes: minutes
        }, (response) => {
            if (response && response.success) {
                // 元のURLに戻る
                if (originalUrl && originalUrl !== 'undefined') {
                    window.location.href = originalUrl;
                } else {
                    alert(`${minutes}分 延長しました。\nページを再読み込みしてください。`);
                    history.back();
                }
            } else {
                const reason = response ? response.error : "Unknown Error";
                alert(`設定の更新に失敗しました。\n理由: ${reason}`);
            }
        });
    });
});
