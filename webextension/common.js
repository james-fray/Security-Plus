'use strict';

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

chrome.runtime.onMessage.addListener((request, sender) => {
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
            chrome.tabs.sendMessage(tabId, {
              method: 'update-item',
              type: obj.positives ? 'defected' : 'clean',
              report: obj.positives ? (obj.positives < 4 ? 'Suspicious site' : 'Malware site') : 'Clean site',
              id: obj.id,
              result: summary(obj)
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

function summary(obj) {
  const styles = `
table {
  white-space: nowrap;
  font-family: "Helvetica Neue",Helvetica,Arial,sans-serif;
  border-collapse: collapse;
  border-spacing: 0px;
  font-size: 13px;
  line-height: 20px;
  color: #333;
}
th {
  border-bottom: 1px solid #DDD;
  padding: 8px;
  text-align: left;
}
td {
  padding: 8px;
}
tr:nth-child(even) {
  background: #F9F9F9;
}
.clean {
  color: #33AF99;
}
.defected {
  color: #ED3237;
}`;
  const html = `
<html>
  <head>
    <link rel="shortcut icon" href="data:image/png;base64,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">
    <meta charset="utf-8">
    <meta name=viewport content="width=device-width, initial-scale=1">
    <title>Scan Plus Report</title>
    <style><!-- styles --></style>
  </head>
  <table width="100%">
    <tr>
      <th>URL Scanner</th><th>Result</th><th style="width: 100%; text-align: left">Detail</th>
    </tr>
    <!-- body -->
  </table>
</html>`;

  let body = '';
  for (const [key, value] of Object.entries(obj.scans)) {
    body += '<tr><td>' + key + '</td><td class="' + (value.detected ? 'defected' : 'clean') + '">' + value.result + '</td><td>' + (value.detail || '-') + '</td></tr>';
  }

  return html.replace('<!-- body -->', body).replace('<!-- styles -->', styles);
}

// FAQs & Feedback
{
  const {onInstalled, setUninstallURL, getManifest} = chrome.runtime;
  const {name, version} = getManifest();
  const page = getManifest().homepage_url;
  onInstalled.addListener(({reason, previousVersion}) => {
    chrome.storage.local.get({
      'faqs': true,
      'last-update': 0
    }, prefs => {
      if (reason === 'install' || (prefs.faqs && reason === 'update')) {
        const doUpdate = (Date.now() - prefs['last-update']) / 1000 / 60 / 60 / 24 > 45;
        if (doUpdate && previousVersion !== version) {
          chrome.tabs.create({
            url: page + '?version=' + version +
              (previousVersion ? '&p=' + previousVersion : '') +
              '&type=' + reason,
            active: reason === 'install'
          });
          chrome.storage.local.set({'last-update': Date.now()});
        }
      }
    });
  });
  setUninstallURL(page + '?rd=feedback&name=' + encodeURIComponent(name) + '&version=' + version);
}
