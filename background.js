/**
 * Background Service Worker — poe.ninja PoE2 中文化
 * 唯一職責:每天檢查 GitHub 上的翻譯資料版本,有更新才下載並快取。
 */

// ====================================================================
// 字典自動更新(方案 A):每天檢查 GitHub 上的版本，有更新才下載並快取。
// 重的爬取工作在 GitHub Actions 上跑，使用者端只下載小檔案。
// ====================================================================

// 若改用別的 repo，改這三個值即可。
const GH_USER = 'Orangeeewei';
const GH_REPO = 'poe-ninja-pob-zh';
const GH_BRANCH = 'main';
const RAW_BASE = `https://raw.githubusercontent.com/${GH_USER}/${GH_REPO}/${GH_BRANCH}/data`;

const ALARM_NAME = 'updateDict';

async function fetchJson(name) {
  const res = await fetch(`${RAW_BASE}/${name}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${name} HTTP ${res.status}`);
  return res.json();
}

async function checkAndUpdateDict(reason = '') {
  try {
    const remote = await fetchJson('version.json');

    const { dataVersion } = await chrome.storage.local.get('dataVersion');
    if (dataVersion === remote.version) {
      console.log(`[Background] 資料已是最新 (${remote.version})${reason ? ' — ' + reason : ''}`);
      return;
    }

    // 同時更新名稱字典與詞綴模板
    const [dict, stats] = await Promise.all([fetchJson('dict.json'), fetchJson('stat-templates.json')]);
    if (!dict || !dict.names) throw new Error('dict.json 格式不正確');
    if (!stats || !stats.templates) throw new Error('stat-templates.json 格式不正確');

    await chrome.storage.local.set({
      dictData: dict,
      statData: stats,
      dataVersion: remote.version,
      dataBuild: remote.build || 0,   // build 用來和內建比新舊，避免倒退
      dataUpdatedAt: new Date().toISOString(),
    });
    console.log(`[Background] 資料已更新 -> ${remote.version}（名稱 ${remote.names}、詞綴 ${remote.stats}）`);
  } catch (e) {
    // 失敗就沿用既有快取 / 內建資料，不影響使用。
    console.warn('[Background] 資料更新失敗（將沿用現有資料）:', e.message);
  }
}

function ensureAlarm() {
  chrome.alarms.get(ALARM_NAME, (a) => {
    if (!a) chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1440 }); // 每天一次
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) checkAndUpdateDict('alarm');
});

// Service Worker 啟動時的初始化
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Background] poe.ninja PoE2 中文化 installed');
  ensureAlarm();
  checkAndUpdateDict('onInstalled');
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  checkAndUpdateDict('onStartup');
});
