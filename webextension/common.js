'use strict';

const reports = new Map();

/* polyfill */
if (typeof Promise.defer === 'undefined') {
  Promise.defer = function() {
    const deferred = {};
    const promise = new Promise((resolve, reject) => {
      deferred.resolve = resolve;
      deferred.reject = reject;
    });
    deferred.promise = promise;
    return deferred;
  };
}

const get = function(url, data) {
  const xhr = new XMLHttpRequest();
  const d = Promise.defer();
  xhr.onload = () => d.resolve(xhr);
  xhr.onerror = () => d.reject(Error(xhr.status));
  xhr.ontimeout = () => d.reject(Error('timeout'));
  xhr.open(data ? 'POST' : 'GET', url, true);
  if (data) {
    const arr = [];
    for (const [key, value] of Object.entries(data)) {
      arr.push(key + '=' + encodeURIComponent(value));
    }
    data = arr.join('&');
    xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
  }
  xhr.send(data ? data : '');
  return d.promise;
};

const config = {
  apikey: ''
};
config.virustotal = {
  report: {
    iteration: 10,
    interval: 15
  },
  check: {
    interval: 10
  },
  get: {
    max_reqs_min: 4,
    interval: 60
  },
  key: ''
};

const virustotal = {
  // limited to at most 4 requests of any nature in any given 1 minute time frame.
  get: (() => {
    const times = [];
    return function(url, data, d) {
      d = d || Promise.defer();
      if (times.length === config.virustotal.get.max_reqs_min) {
        const diff = Date.now() - times[0].getTime();
        if (diff < config.virustotal.get.interval * 1000) {
          window.setTimeout(function() {
            virustotal.get(url, data, d);
          }, config.virustotal.get.interval * 1000 - diff + 500);
          return d.promise;
        }
      }
      times.splice(0, times.push(new Date()) - config.virustotal.get.max_reqs_min);
      get(url, data).then(d.resolve, d.reject);
      return d.promise;
    };
  })(),
  scan(url) {
    return virustotal.get('https://www.virustotal.com/vtapi/v2/url/scan', {
      url: url,
      apikey: config.apikey
    }).then(response => {
      if (response.status === 204) {
        throw Error('virustotal -> scan -> exceeded the request rate limit');
      }
      if (!response.responseText && !response.text) {
        throw Error('virustotal -> scan -> server response is empty');
      }
      const j = JSON.parse(response.responseText || response.text);
      if (j.response_code === 0) {
        throw Error('virustotal -> scan -> server rejection, The requested resource is not among the finished, queued or pending scans');
      }
      if (j.response_code !== 1) {
        throw Error('virustotal -> scan -> server rejection, ' + j.verbose_msg);
      }
      return j;
    });
  },
  report() {
    let num = 0;
    function checkOnce(resource) {
      return virustotal.get('https://www.virustotal.com/vtapi/v2/url/report', {
        resource: resource,
        apikey: config.apikey
      }).then(function(response) {
        if (response.status === 204) {
          throw Error('virustotal -> report -> exceeded the request rate limit');
        }
        if (!response.responseText && !response.text) {
          throw Error('virustotal -> report -> checkOnce -> not queued');
        }
        const j = JSON.parse(response.responseText || response.text);
        if (j.response_code !== 1) {
          throw Error('virustotal -> report -> checkOnce -> server rejection, ' + j.verbose_msg);
        }
        return {
          positives: j.positives,
          total: j.total,
          scans: j.scans
        };
      });
    }
    function sumup(resource, d) {
      d = d || Promise.defer();
      num += 1;
      checkOnce(resource).then(o => d.resolve(o), e => {
        if (e.message === 'virustotal -> report -> checkOnce -> not queued') {
          d.reject(Error('virustotal -> report -> sumup -> The requested resource is not among the finished, queued or pending scans. Broken URL?'));
          return;
        }
        if (num < config.virustotal.report.iteration) {
          window.setTimeout(function() {
            sumup(resource, d);
          }, config.virustotal.report.interval * 1000);
        }
        else {
          d.reject(Error('virustotal -> report -> sumup -> maximum iteration reached'));
        }
      });
      return d.promise;
    }

    return function(resource) {
      return sumup(resource);
    };
  },
  queue: (function() {
    const q = [];
    let onGoing = false;
    function execute() {
      if (onGoing || !q.length) {
        return;
      }

      const o = q.shift();
      function result(callback, id, obj) {
        onGoing = false;
        obj.id = id;
        callback(obj);
        execute();
      }
      chrome.tabs.sendMessage(o.tabId, {
        method: 'update-item',
        type: 'progress',
        report: 'Scanning',
        id: o.id
      });
      onGoing = true;
      virustotal.scan(o.url).then(obj => {
        return (virustotal.report())(obj.scan_id);
      }).then(result.bind(null, o.callback, o.id), result.bind(null, o.callback, o.id));
    }
    return function(url, id, tabId, callback) {
      q.push({
        url,
        id,
        tabId,
        callback
      });
      execute();
    };
  })()
};

chrome.runtime.onMessage.addListener((request, sender, response) => {
  if (request.method === 'remove-item') {
    chrome.tabs.sendMessage(sender.tab.id, request);
  }
  else if (request.method === 'scan-item') {
    const {tabId, id, href} = request;
    chrome.storage.local.get({
      key: ''
    }, prefs => {
      if (prefs.key) {
        config.apikey = prefs.key;
        virustotal.queue(href, id, tabId, obj => {
          if (obj instanceof Error) {
            chrome.tabs.sendMessage(tabId, {
              method: 'update-item',
              type: 'failed',
              report: 'Failed, ' + obj.message.split(' -> ').pop(),
              id: obj.id
            });
          }
          else {
            reports.set(obj.id.toString(), obj);
            chrome.tabs.sendMessage(tabId, {
              method: 'update-item',
              type: obj.positives ? 'defected' : 'clean',
              report: obj.positives ? (obj.positives < 4 ? 'Suspicious site' : 'Malware site') : 'Clean site',
              id: obj.id
            });
          }
        });
      }
      else {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: '/data/icons/48.png',
          title: chrome.runtime.getManifest().name,
          message: 'API key is missing'
        }, () => chrome.runtime.openOptionsPage());
      }
    });
  }
  else if (request.method === 'get-report') {
    response(reports.get(request.id));
  }
  else if (request.method === 'open-report') {
    setTimeout(() => {
      delete reports.delete(request.id);
    }, 10000);
    chrome.tabs.create({
      url: 'data/report/index.html?id=' + request.id + '&href=' + encodeURIComponent(request.href),
      index: sender.tab.index + 1
    });
  }
});

//
const pp = (() => {
  const ids = [];
  let i = 0;
  return {
    generate() {
      i += 1;
      ids.push(i);
      return i;
    },
    remove(id) {
      const index = ids.indexOf(id);
      if (index !== -1) {
        ids.splice(index, 1);
        return true;
      }
      return false;
    }
  };
})();

chrome.contextMenus.create({
  id: 'scan',
  title: 'Scan Link for Viruses',
  contexts: ['link']
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  const id = pp.generate();

  chrome.tabs.executeScript({
    runAt: 'document_start',
    file: 'data/inject/inject.js'
  }, () => chrome.tabs.sendMessage(tab.id, {
    method: 'add-item',
    id,
    href: info.linkUrl,
    tabId: tab.id
  }));
});

/* FAQs & Feedback */
{
  const {management, runtime: {onInstalled, setUninstallURL, getManifest}, storage, tabs} = chrome;
  if (navigator.webdriver !== true) {
    const page = getManifest().homepage_url;
    const {name, version} = getManifest();
    onInstalled.addListener(({reason, previousVersion}) => {
      management.getSelf(({installType}) => installType === 'normal' && storage.local.get({
        'faqs': true,
        'last-update': 0
      }, prefs => {
        if (reason === 'install' || (prefs.faqs && reason === 'update')) {
          const doUpdate = (Date.now() - prefs['last-update']) / 1000 / 60 / 60 / 24 > 45;
          if (doUpdate && previousVersion !== version) {
            tabs.query({active: true, currentWindow: true}, tbs => tabs.create({
              url: page + '?version=' + version + (previousVersion ? '&p=' + previousVersion : '') + '&type=' + reason,
              active: reason === 'install',
              ...(tbs && tbs.length && {index: tbs[0].index + 1})
            }));
            storage.local.set({'last-update': Date.now()});
          }
        }
      }));
    });
    setUninstallURL(page + '?rd=feedback&name=' + encodeURIComponent(name) + '&version=' + version);
  }
}
