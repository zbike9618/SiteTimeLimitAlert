// block.js
document.addEventListener('DOMContentLoaded', () => {
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
                // Fallback for non-tab context or if getCurrent fails
                window.close();
            }
        });
    });

    // スヌーズボタン
    document.getElementById('snoozeBtn').addEventListener('click', () => {
        if (!domain) return;

        // バックグラウンドにスヌーズ要求
        chrome.runtime.sendMessage({
            action: 'snooze',
            domain: domain,
            type: type
        }, () => {
            // 元のURLに戻る
            if (originalUrl && originalUrl !== 'undefined') {
                window.location.href = originalUrl;
            } else {
                // 履歴を戻るが、ブロックページが履歴に残るとループする恐れがあるので
                // 閉じるか、新しいタブで開くなどが安全だが、今回はhistory.backを試す
                // または window.close() してユーザーに開き直してもらう
                alert("スヌーズしました。ページを再読み込みするか、再度アクセスしてください。");
                history.back();
            }
        });
    });
});
