'use strict';

// Load Firefox based resources
var self        = require('sdk/self'),
    data        = self.data,
    sp          = require('sdk/simple-prefs'),
    Request     = require('sdk/request').Request,
    prefs       = sp.prefs,
    pageMod     = require('sdk/page-mod'),
    tabs        = require('sdk/tabs'),
    timers      = require('sdk/timers'),
    desktop     = require('sdk/system').platform !== 'android',
    array       = require('sdk/util/array'),
    unload      = require('sdk/system/unload'),
    {resolve, defer}     = require('sdk/core/promise'),
    {Cu}        = require('chrome');

var {Services} = Cu.import('resource://gre/modules/Services.jsm');

var workers = [], callbacks = [];
pageMod.PageMod({
  include: ['*'],
  attachTo: ['existing', 'top'],
  contentScriptFile: [
    data.url('./content_script/firefox/firefox.js'),
    data.url('./content_script/inject.js')
  ],
  contentScriptWhen: 'start',
  contentScriptOptions: {
    base: self.data.url('')
  },
  onAttach: function(worker) {
    array.add(workers, worker);
    worker.on('pageshow', function() { array.add(workers, this); });
    worker.on('pagehide', function() { array.remove(workers, this); });
    worker.on('detach', function() { array.remove(workers, this); });
    callbacks.forEach((arr) => worker.port.on(arr[0], arr[1]));
  }
});

exports.storage = {
  read: function (id) {
    return (prefs[id] || prefs[id] + '' === 'false') ? (prefs[id] + '') : null;
  },
  write: function (id, data) {
    data = data + '';
    if (data === 'true' || data === 'false') {
      prefs[id] = data === 'true' ? true : false;
    }
    else if (parseInt(data) + '' === data) {
      prefs[id] = parseInt(data);
    }
    else {
      prefs[id] = data + '';
    }
  }
};

exports.get = function (url, data) {
  var d = defer();
  new Request({
    url: url,
    content: data,
    onComplete: (response) => d.resolve(response)
  })[data ? 'post' : 'get']();
  return d.promise;
};

exports.inject = {
  send: function (id, data, global) {
    workers.forEach(function (worker) {
      if (!global && worker.tab !== tabs.activeTab) {
        return;
      }
      if (!worker) {
        return;
      }
      worker.port.emit(id, data);
    });
  },
  receive: function (id, callback) {
    callbacks.push([id, callback]);
    workers.forEach(function (worker) {
      worker.port.on(id, callback);
    });
  }
};

exports.tab = {
  open: function (url, inBackground, inCurrent) {
    if (inCurrent) {
      tabs.activeTab.url = url;
    }
    else {
      tabs.open({
        url: url,
        inBackground: typeof inBackground === 'undefined' ? false : inBackground
      });
    }
  },
  openOptions: function () {},
  list: function () {
    var temp = [];
    for each (var tab in tabs) {
      temp.push(tab);
    }
    return resolve(temp);
  }
};

exports.context_menu = {
  create: function (title, callback) {
    if (desktop) {
      let contextMenu = require('sdk/context-menu');
      contextMenu.Item({
        label: title,
        image: data.url('./icons/16.png'),
        context: contextMenu.SelectorContext('a'),
        contentScript: 'self.on("click", function (node, data) {' +
                       '  self.postMessage(node.href);' +
                       '});',
        onMessage: function (url) {
          callback(url);
        }
      });
      contextMenu.Item({
        label: title,
        image: data.url('./icons/16.png'),
        context: contextMenu.PredicateContext(o => /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/.test(o.selectionText)),
        contentScript: 'self.on("click", function () {' +
                       '  self.postMessage(window.getSelection().toString());' +
                       '});',
        onMessage: function (url) {
          callback(url);
        }
      });
    }
    else {
      let window = Services.wm.getMostRecentWindow('navigator:browser');

      let id = window.NativeWindow.contextmenus.add(
        title,
        window.NativeWindow.contextmenus.SelectorContext('a'),
        (target) => callback(target.href)
      );

      unload.when(() => {
        window.NativeWindow.contextmenus.remove(id);
      });
    }
  }
};

exports.version = function () {
  return self.version;
};

exports.timer = timers;
exports.Promise = {defer};

//startup
exports.startup = function (callback) {
  if (self.loadReason === 'install' || self.loadReason === 'startup') {
    callback();
  }
};
