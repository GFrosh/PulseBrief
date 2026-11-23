declare const chrome: {
  runtime?: { onInstalled?: { addListener(callback: () => void): void }; onStartup?: { addListener(callback: () => void): void } };
  sidePanel?: { setPanelBehavior(options: { openPanelOnActionClick: boolean }): Promise<void> };
};

const configurePanel = () => { void chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }); };
chrome.runtime?.onInstalled?.addListener(configurePanel);
chrome.runtime?.onStartup?.addListener(configurePanel);
