var app = {}

app.Promise = Q.promise;
app.Promise.defer = Q.defer;

app.storage = {
  read: function (id) {
    return localStorage[id] || null;
  },
  write: function (id, data) {
    localStorage[id] = data + "";
  }
}

app.get = function (url, data) {
  var xhr = new XMLHttpRequest();
  var d = new app.Promise.defer();
  xhr.onreadystatechange = function() {
    if (xhr.readyState === 4) {
      if (xhr.status >= 400) {
        d.reject(new Error(xhr));
      }
      else {
        d.resolve(xhr);
      }
    }
  };
  xhr.open(data ? "POST" : "GET", url, true);
  if (data) {
    var arr = [];
    for(e in data) {
      arr.push(e + "=" + encodeURIComponent(data[e]));
    }
    data = arr.join("&");
    xhr.setRequestHeader("Content-Type","application/x-www-form-urlencoded; charset=UTF-8");
  }
  xhr.send(data ? data : "");
  return d.promise;
}

app.tab = {
  open: function (url, inBackground, inCurrent) {
    if (inCurrent) {
      safari.application.activeBrowserWindow.activeTab.url = url;
    }
    else {
      safari.application.activeBrowserWindow.openTab(inBackground ? "background" : "foreground").url = url;
    }
  },
  openOptions: function () {

  },
  list: function () {
    var wins = safari.application.browserWindows;
    var tabs = wins.map(function (win) {
      return win.tabs;
    });
    tabs = tabs.reduce(function (p, c) {
      return p.concat(c);
    }, []);
    return new app.Promise(function (a) {a(tabs)});
  }
}

app.version = function () {
  return safari.extension.displayVersion;
}

app.timer = window;

app.content_script = (function () {
  var callbacks = {};
  safari.application.addEventListener("message", function (e) {
    if (callbacks[e.message.id]) {
      callbacks[e.message.id](e.message.data);
    }
  }, false);
  return {
    send: function (id, data, global) {
      if (global) {
        safari.application.browserWindows.forEach(function (browserWindow) {
          browserWindow.tabs.forEach(function (tab) {
            if (tab.page) tab.page.dispatchMessage(id, data);
          });
        });
      }
      else {
        safari.application.activeBrowserWindow.activeTab.page.dispatchMessage(id, data);
      }
    },
    receive: function (id, callback) {
      callbacks[id] = callback;
    }
  }
})();

app.context_menu = (function () {
  var onSelection = {};
  safari.application.addEventListener("contextmenu", function (e) {
    var link = e.userInfo;
    if (link && onSelection.title) {
      e.contextMenu.appendContextMenuItem("isplus.onSelection", onSelection.title);
    }
  }, false);
  safari.application.addEventListener("command", function (e) {
    var cmd = e.command;
    if (e.command === "isplus.onSelection" && e.userInfo && onSelection.callback) {
      onSelection.callback(e.userInfo)
    }
  }, false);

  return {
    create: function (title, callback) {
      onSelection.title = title;
      onSelection.callback = callback;
    }
  }
})();
