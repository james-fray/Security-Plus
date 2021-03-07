'use strict';

if (typeof window.page === 'undefined') {
  window.page = {
    initiate(request, callback) {
      if (typeof window.iframe !== 'undefined') {
        callback();
      }
      else {
        window.iframe = document.createElement('iframe');
        window.iframe.style = `
          overflow: hidden;
          position: fixed;
          background-color: transparent;
          bottom: 30px;
          left: 10%;
          width: 80%;
          z-index: 2147483647;
          border: none;`;
        window.iframe.src = chrome.runtime.getURL('/data/inject/iframe.html?request=' + encodeURIComponent(JSON.stringify(request)));
        window.iframe.onload = callback;
        document.body.appendChild(window.iframe);
      }
    },
    unload() {
      if (window.iframe) {
        window.iframe.remove();
        delete window.iframe;
        window.page.count = 0;
      }
    },
    resize() {
      window.iframe.style.height = `${window.page.count * 34 + 15}px`;
    }
  };
  chrome.runtime.onMessage.addListener(request => {
    if (request.method === 'remove-item') {
      window.page.count -= 1;
      if (window.page.count) {
        window.page.resize();
      }
      else {
        window.page.unload();
      }
    }
    else if (request.method === 'add-item') {
      window.page.initiate(request, () => {
        window.page.count = (window.page.count || 0) + 1;
        window.page.resize();
      });
    }
  });
}
