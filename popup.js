// popup.js
document.addEventListener('DOMContentLoaded', () => {
  const domainInput = document.getElementById('domain');
  const limitInput = document.getElementById('limit');
  const limitLabel = document.getElementById('limitLabel');
  const addBtn = document.getElementById('addBtn');
  const statusDiv = document.getElementById('status');
  const settingsList = document.getElementById('settingsList');
  const isGlobalCb = document.getElementById('isGlobal');

  // 初期表示
  updateView();

  // 1秒ごとに表示更新（リアルタイム性）
  // 1秒ごとに表示更新（リアルタイム性）
  setInterval(updateView, 1000);

  // Enter Key Navigation
  domainInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      limitInput.focus();
    }
  });

  limitInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addBtn.click();
    }
  });

  // 追加・更新ボタンの処理 (Below)

  function saveGlobalLimit(limit) {
    chrome.storage.local.get(['settings'], (result) => {
      const settings = result.settings || {};
      settings['__global_limit__'] = { limit: limit, addedAt: Date.now() };
      chrome.storage.local.set({ settings: settings }, () => {
        showStatus('全体制限を保存しました');
        document.getElementById('domain').value = '';
        document.getElementById('limit').value = '';

        // Reset UI
        document.getElementById('isGlobal').checked = false;
        toggleGlobalMode(false);

        updateView();
      });
    });
  }

  function updateView() {
    // バックグラウンドから最新のstatsとsettingsを取得
    chrome.runtime.sendMessage({ action: 'getRealtimeStats' }, (response) => {
      if (chrome.runtime.lastError) {
        loadFromStorage();
        return;
      }
      if (response) {
        renderList(response.settings, response.stats, response.snoozeState);
      }
    });
  }

  function loadFromStorage() {
    chrome.storage.local.get(['settings', 'dailyStats'], (result) => {
      const settings = result.settings || {};
      const stats = result.dailyStats || {};
      const today = new Date().toLocaleDateString();
      const todayStats = stats[today] || {};
      renderList(settings, todayStats, {}); // Storage fallback has no snooze info
    });
  }

  function renderList(settings, stats, snoozeState = {}) {
    // Remove deleted domains
    const existingItems = document.querySelectorAll('.site-item');
    existingItems.forEach(item => {
      const domain = item.getAttribute('data-domain');
      // Check if it's the global limit item or a standard domain
      if (domain === '__global_limit__') {
        if (!settings['__global_limit__']) item.remove();
      } else {
        if (!settings[domain]) item.remove();
      }
    });

    if (!settings || Object.keys(settings).length === 0) {
      if (document.querySelectorAll('.site-item').length === 0) {
        settingsList.innerHTML = '<p style="text-align:center; color:#888;" id="no-settings">設定されたサイトはありません</p>';
      }
      return;
    } else {
      const noMsg = document.getElementById('no-settings');
      if (noMsg) noMsg.remove();
    }

    // グラフ用: 最初のドメインまたは現在選択されているドメイン
    const firstDomain = Object.keys(settings)[0];
    const currentGraphDomain = document.querySelector('.chart-title')?.getAttribute('data-domain') || firstDomain;
    renderGraph(currentGraphDomain);

    // Global Limit Display
    if (settings['__global_limit__']) {
      const gl = settings['__global_limit__'];
      const totalUsed = Object.values(stats).reduce((a, b) => a + b, 0);
      const glMin = Math.floor(totalUsed / 60);

      let glItem = document.querySelector('.site-item[data-domain="__global_limit__"]');
      const isOver = glMin >= gl.limit;
      const htmlContent = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <strong>🌏 全体制限 (GLOBAL)</strong>
              <span style="font-weight:bold; color:${isOver ? 'red' : 'green'}">${glMin}分 / ${gl.limit}分</span>
            </div>
            <div style="display:flex; justify-content:end; margin-top:5px;">
               <button class="delete-btn" data-domain="__global_limit__">削除</button>
            </div>
        `;

      if (!glItem) {
        glItem = document.createElement('div');
        glItem.className = 'site-item';
        glItem.style.border = '2px solid #ff9800';
        glItem.setAttribute('data-domain', '__global_limit__');
        glItem.innerHTML = htmlContent;
        // Prepend global limit
        settingsList.prepend(glItem);

        // Re-attach listener
        glItem.querySelector('.delete-btn').addEventListener('click', (e) => {
          deleteSetting('__global_limit__');
        });
      } else {
        // Update content if changed (or just innerHTML for simplicity as it lacks inputs)
        // To avoid listener loss, we only update specific parts or accept re-attaching.
        // For simplicity/robustness with buttons, let's update text parts specifically or use a helper.
        // But here, re-setting innerHTML kills listeners. 
        // So we should only update text nodes.

        glItem.querySelector('span').textContent = `${glMin}分 / ${gl.limit}分`;
        glItem.querySelector('span').style.color = isOver ? 'red' : 'green';
      }
    }

    for (const [domain, config] of Object.entries(settings)) {
      if (domain === '__global_limit__') continue;

      const currentSeconds = stats[domain] || 0;
      const currentMinutes = Math.floor(currentSeconds / 60);
      const displaySeconds = currentSeconds % 60;

      const limitMinutes = config.limit;
      const isOver = currentMinutes >= limitMinutes;

      const snoozeEnd = snoozeState && (snoozeState[domain] || snoozeState['__global__'] && domain === '__global_limit__');
      const isSnoozing = snoozeEnd && Date.now() < snoozeEnd;

      let timeStr = `${currentMinutes}分 ${displaySeconds}秒`;
      let color = isOver ? '#d32f2f' : '#388e3c';

      if (isSnoozing) {
        timeStr += ' <span style="color:#ff9800; font-size:11px;">(延長中)</span>';
        color = '#ff9800';
      } else if (isOver) {
        color = '#d32f2f';
      }

      let item = document.querySelector(`.site-item[data-domain="${domain}"]`);

      if (!item) {
        item = document.createElement('div');
        item.className = 'site-item';
        item.setAttribute('data-domain', domain);

        item.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; cursor:pointer;" class="domain-row" data-d="${domain}">
              <strong>${domain}</strong>
              <span class="time-display" style="font-size:14px; font-weight:bold; color:${color}">
                ${timeStr}
              </span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:5px;">
              <span class="limit-display" style="font-size:12px; color:#666;">制限: ${limitMinutes}分</span>
              <div>
                <button class="edit-btn" data-domain="${domain}" data-limit="${limitMinutes}">編集</button>
                <button class="delete-btn" data-domain="${domain}">削除</button>
              </div>
            </div>
          `;
        settingsList.appendChild(item);

        // Add listeners for new item
        item.querySelector('.domain-row').addEventListener('click', () => renderGraph(domain));
        item.querySelector('.edit-btn').addEventListener('click', (e) => {
          const d = e.target.getAttribute('data-domain');
          const l = e.target.getAttribute('data-limit');
          document.getElementById('domain').value = d;
          document.getElementById('limit').value = l;
          document.getElementById('domain').focus();
          window.scrollTo(0, 0);
          showStatus('設定を変更して「追加・更新」を押してください', '#2196f3');
        });
        item.querySelector('.delete-btn').addEventListener('click', (e) => {
          const d = e.target.getAttribute('data-domain');
          deleteSetting(d);
        });

      } else {
        // Update existing
        const timeSpan = item.querySelector('.time-display');
        timeSpan.innerHTML = timeStr; // Use innerHTML for (延長中) span
        timeSpan.style.color = color;

        const limitSpan = item.querySelector('.limit-display');
        limitSpan.textContent = `制限: ${limitMinutes}分`;

        // Ensure button attributes are up to date (for edit)
        item.querySelector('.edit-btn').setAttribute('data-limit', limitMinutes);
      }
    }
  }

  function renderGraph(domain) {
    if (!domain) return;
    const title = document.querySelector('.chart-title');
    if (title) {
      if (title.getAttribute('data-domain') !== domain) {
        title.textContent = `${domain} の過去7日間 (分)`;
        title.setAttribute('data-domain', domain);
      }
    }

    const container = document.getElementById('chartStats');
    const labelsContainer = document.getElementById('chartLabels');
    if (!container || !labelsContainer) return;

    // Do NOT clear innerHTML here to prevent flicker
    // container.innerHTML = ''; 
    // labelsContainer.innerHTML = '';

    chrome.storage.local.get(['dailyStats'], (result) => {
      const allStats = result.dailyStats || {};
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        days.push(d.toLocaleDateString());
      }

      const dataPoints = days.map(day => {
        const dayStats = allStats[day] || {};
        const seconds = dayStats[domain] || 0;
        return Math.floor(seconds / 60);
      });

      const maxVal = Math.max(...dataPoints, 10);

      // Check if we need to build from scratch (first run or domain switch)
      // Check if number of bars matches
      const existingBars = container.querySelectorAll('.chart-bar');
      const shouldRebuild = existingBars.length !== days.length;

      if (shouldRebuild) {
        container.innerHTML = '';
        labelsContainer.innerHTML = '';

        days.forEach((day, index) => {
          const val = dataPoints[index];
          const percent = (val / maxVal) * 100;

          const bar = document.createElement('div');
          bar.className = 'chart-bar';
          bar.style.height = `${percent}%`;
          bar.title = `${day}: ${val}分`;
          container.appendChild(bar);

          const label = document.createElement('div');
          label.className = 'chart-label'; // Use class from CSS
          // Inline styles redundant if CSS has them, but keeping for safety
          label.style.width = '12%';

          const datePart = day.split('/').pop() || day.split('-').pop();
          label.textContent = datePart;
          labelsContainer.appendChild(label);
        });
      } else {
        // Update existing
        days.forEach((day, index) => {
          const val = dataPoints[index];
          const percent = (val / maxVal) * 100;

          const bar = existingBars[index];
          if (bar) {
            bar.style.height = `${percent}%`;
            bar.title = `${day}: ${val}分`;
          }

          // Labels (dates) usually don't change unless day rolls over, but update anyway
          const datePart = day.split('/').pop() || day.split('-').pop();
          if (labelsContainer.children[index]) {
            labelsContainer.children[index].textContent = datePart;
          }
        });
      }
    });
  }

  function deleteSetting(domain) {
    chrome.storage.local.get(['settings'], (result) => {
      const settings = result.settings || {};
      delete settings[domain];
      chrome.storage.local.set({ settings: settings }, () => {
        showStatus('削除しました');
        updateView();
      });
    });
  }

  // チェックボックス切り替え
  isGlobalCb.addEventListener('change', () => {
    toggleGlobalMode(isGlobalCb.checked);
  });

  function toggleGlobalMode(isGlobal) {
    if (isGlobal) {
      domainInput.disabled = true;
      domainInput.style.backgroundColor = '#f0f0f0';
      domainInput.style.color = '#aaa';
      domainInput.value = '（全サイト合計）';

      addBtn.textContent = '全体制限を保存';
      limitLabel.textContent = '全体での制限時間 (分)';
      limitLabel.style.color = '#ff9800';
      statusDiv.textContent = '登録済みサイト全ての合計時間で制限します';
    } else {
      domainInput.disabled = false;
      domainInput.style.backgroundColor = '';
      domainInput.style.color = '';
      domainInput.value = '';

      addBtn.textContent = '追加・更新';
      limitLabel.textContent = '制限時間 (分)';
      limitLabel.style.color = '#333';
      statusDiv.textContent = '';
    }
  }

  // 追加・更新ボタンの処理
  addBtn.addEventListener('click', () => {
    const limit = parseInt(limitInput.value);

    // Global Limit Handling
    if (isGlobalCb.checked) {
      if (!limit) {
        showStatus('時間を入力してください', 'red');
        return;
      }
      saveGlobalLimit(limit);
      return;
    }
    // Individual Domain Handling
    const domain = domainInput.value.trim();
    if (!domain || !limit) {
      showStatus('ドメインと時間を正しく入力してください', 'red');
      return;
    }

    // 保存処理
    chrome.storage.local.get(['settings'], (result) => {
      const settings = result.settings || {};
      settings[domain] = {
        limit: limit, // 分
        addedAt: Date.now()
      };

      chrome.storage.local.set({ settings: settings }, () => {
        showStatus('保存しました');
        domainInput.value = '';
        limitInput.value = '';
        updateView(); // 即座に更新
      });
    });
  });

  function showStatus(text, color = '#4caf50') {
    statusDiv.textContent = text;
    statusDiv.style.color = color;
    setTimeout(() => {
      statusDiv.textContent = '';
    }, 3000);
  }
});
