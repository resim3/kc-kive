// Fenêtre sans onglets ni barre d'adresse, assez large pour la version PC (pages dans la barre du haut)
chrome.action.onClicked.addListener(() => {
  chrome.windows.create({ url: 'https://kc-live.vercel.app/', type: 'popup', width: 1100, height: 820 });
});
