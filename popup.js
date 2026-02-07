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
  // Use async generic immediately invoked function to handle startup
  (async function startup() {
    // Force Vivaldi Repaint (Layout Hack)
    document.body.style.width = '401px';
    requestAnimationFrame(() => {
      document.body.style.width = '400px';
    });

    // 1. First immediate render from storage (Optimistic)
    // We already call loadFromStorage inside updateView, but let's be explicit and safe.
    await safeUpdateView();

    // 2. Start polling after a short delay to allow Vivaldi to settle
    setTimeout(() => {
      // 1秒ごとに表示更新（リアルタイム性）
      const intervalId = setInterval(safeUpdateView, 1000);
    }, 1000);
  })();

  async function safeUpdateView() {
    if (!chrome.runtime?.id) return;
    updateView();
  }

  // Old interval logic removed from here


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

  // Global Error Handler for debugging popup failures
  window.onerror = function (message, source, lineno, colno, error) {
    const statusDiv = document.getElementById('status');
    if (statusDiv) {
      statusDiv.textContent = `Error: ${message}`;
      statusDiv.style.color = 'red';
      statusDiv.style.fontSize = '10px';
    }
  };

  function updateView() {
    // Strategy: Optimistic Rendering
    // 1. Immediately load from storage to ensure UI is not blank.
    loadFromStorage();

    if (!chrome.runtime?.id) return;

    // 2. Try to get real-time stats from background
    try {
      chrome.runtime.sendMessage({ action: 'getRealtimeStats' }, (response) => {
        if (chrome.runtime.lastError) {
          // Background not ready or context invalid, but valid data already loaded from storage.
          console.warn('Background check failed:', chrome.runtime.lastError);
          return;
        }
        if (response) {
          // Update with fresh data (real-time stats)
          renderList(response.settings, response.stats, response.snoozeState);
        }
      });
    } catch (e) {
      console.error('Message send failed:', e);
      // Already rendered from storage, so no further action needed
    }
  }

  function loadFromStorage() {
    try {
      chrome.storage.local.get(['settings', 'dailyStats'], (result) => {
        if (chrome.runtime.lastError) {
          console.error("Storage read failed:", chrome.runtime.lastError);
          // Render with empty data to avoid blank screen
          renderList({}, {}, {});
          return;
        }
        const settings = result.settings || {};
        const stats = result.dailyStats || {};
        const today = new Date().toLocaleDateString();
        const todayStats = stats[today] || {};
        renderList(settings, todayStats, {}); // Storage fallback has no snooze info
      });
    } catch (e) {
      console.error("Storage API error:", e);
      // Failsafe render
      renderList({}, {}, {});
      const statusDiv = document.getElementById('status');
      if (statusDiv) statusDiv.textContent = "Data Load Error";
    }
  }

  function renderList(settings, stats, snoozeState = {}) {
    try {
      if (!settings) settings = {};
      if (!stats) stats = {};

      const settingsList = document.getElementById('settingsList');
      if (!settingsList) return;

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

      if (Object.keys(settings).length === 0) {
        // Show "No Settings" message only if list is empty
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
        const totalUsed = Object.values(stats).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0); // Safety check
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
    } catch (e) {
      console.error("Render Error:", e);
      const status = document.getElementById('status');
      if (status) {
        status.textContent = "Render Error: " + e.message;
        status.style.color = "red";
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
  // Dark Mode Toggle Logic
  const toggleSwitch = document.querySelector('.theme-switch input[type="checkbox"]');

  function switchTheme(e) {
    if (e.target.checked) {
      document.documentElement.setAttribute('data-theme', 'dark');
      chrome.storage.local.set({ darkMode: true });
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
      chrome.storage.local.set({ darkMode: false });
    }
  }

  toggleSwitch.addEventListener('change', switchTheme);

  // Load saved theme
  chrome.storage.local.get(['darkMode'], (result) => {
    if (result.darkMode) {
      toggleSwitch.checked = true;
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  });

  // Global Limit UI adjustment for dark mode (inline styles needing override)
  // Note: Some inline styles in toggleGlobalMode might clash. 
  // We can handle that by relying on CSS classes if possible, but for now strict override.
  const observer = new MutationObserver(() => {
    // Optional: Watch for dynamic changes if needed, but CSS variables handle most.
  });
});

