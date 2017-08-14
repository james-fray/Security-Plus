'use strict';

var app = {};

if (!Promise.defer) {
  Promise.defer = function() {
    const deferred = {};
    const promise = new Promise(function(resolve, reject) {
      deferred.resolve = resolve;
      deferred.reject = reject;
    });
    deferred.promise = promise;
    return deferred;
  };
}
app.Promise = Promise;

app.storage = {
  read: function(id) {
    return localStorage[id] || null;
  },
  write: function(id, data) {
    localStorage[id] = String(data);
  }
};

app.get = function(url, data) {
  var xhr = new XMLHttpRequest();
  var d = app.Promise.defer();
  xhr.onreadystatechange = function() {
    if (xhr.readyState === 4) {
      if (xhr.status >= 400) {
        var e = new Error(xhr);
        e.status = xhr.status;
        d.reject(e);
      }
      else {
        d.resolve(xhr);
      }
    }
  };
  xhr.open(data ? 'POST' : 'GET', url, true);
  if (data) {
    var arr = [];
    for (var e in data) {
      arr.push(e + '=' + encodeURIComponent(data[e]));
    }
    data = arr.join('&');
    xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
  }
  xhr.send(data ? data : '');
  return d.promise;
};

app.inject = {
  send: function(id, data, global) {
    var options = global ? {} : {active: true, currentWindow: true};
    chrome.tabs.query(options, function(tabs) {
      tabs.forEach(function(tab) {
        chrome.tabs.sendMessage(tab.id, {method: id, data: data}, function() {});
      });
    });
  },
  receive: function(id, callback) {
    chrome.runtime.onMessage.addListener(function(request, sender) {
      if (request.method === id && sender.tab) {
        callback(request.data);
      }
    });
  }
};

app.tab = {
  open: function(url, inBackground, inCurrent) {
    if (inCurrent) {
      chrome.tabs.update(null, {url: url});
    }
    else {
      chrome.tabs.create({
        url: url,
        active: typeof inBackground === 'undefined' ? true : !inBackground
      });
    }
  },
  openOptions: function() {},
  list: function() {
    var d = app.Promise.defer();
    chrome.tabs.query({
      currentWindow: false
    }, function(tabs) {
      d.resolve(tabs);
    });
    return d.promise;
  }
};

app.context_menu = {
  create: function(title, callback) {  //type: selection, page
    chrome.contextMenus.create({
      'title': title,
      'contexts': ['link'],
    });
    chrome.contextMenus.onClicked.addListener(function(info) {
      callback(info.linkUrl);
    });
  }
};

app.notification = function(title, text) {
  chrome.notifications.create(null, {
    type: 'basic',
    iconUrl: 'data/icons/48.png',
    title: title,
    message: text
  });
};
