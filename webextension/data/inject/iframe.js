'use strict';

function remove(id) {
  const item = document.querySelector(`[data-id="${id}"]`);
  if (item) {
    item.setAttribute('transition', 'fadeout');
    window.setTimeout(() => {
      item.remove();
      chrome.runtime.sendMessage({
        method: 'remove-item',
        id
      });
    }, 400);
  }
}

function add({id, href, tabId}) {
  const item = document.getElementById('item').cloneNode(true);
  item.setAttribute('type', 'Queue');
  item.setAttribute('data-id', id);
  item.children[1].title = item.children[1].textContent = 'Queue';
  const a = item.children[2].querySelector('a');
  a.textContent = href;
  a.setAttribute('href', href);
  item.children[4].addEventListener('click', () => {
    remove(item.getAttribute('data-id'));
  }, false);
  document.body.appendChild(item);
  item.style.display = 'flex';
  chrome.runtime.sendMessage({
    method: 'scan-item',
    id,
    tabId,
    href
  });
}

function update(o) {
  const item = document.querySelector(`[data-id="${o.id}"]`);
  if (item) {
    if (o.type) {
      item.setAttribute('type', o.type);
    }
    if (o.report) {
      item.children[1].textContent = o.report;
      item.children[1].title = o.report;
    }
    if (o.type === 'defected') {
      const link = item.querySelector('a');
      const href = link.href;

      const a = item.children[3].querySelector('a');
      a.setAttribute('href', '#');
      a.onclick = () => {
        chrome.runtime.sendMessage({
          method: 'open-report',
          id: o.id,
          href
        });
        return false;
      };
      a.textContent = 'results';
      // disable link
      link.replaceWith(document.createTextNode(href));
    }
  }
}

window.addEventListener('message', e => {
  if (e.data.method === 'add') {
    add(e.data);
  }
});

chrome.runtime.onMessage.addListener(request => {
  if (request.method === 'update-item') {
    update(request);
  }
  else if (request.method === 'add-item') {
    add(request);
  }
});

const args = new URLSearchParams(location.search);
add(JSON.parse(args.get('request')));
