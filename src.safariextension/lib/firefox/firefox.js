'use strict';

// Load Firefox based resources
var self          = require('sdk/self'),
    data          = self.data,
    sp            = require('sdk/simple-prefs'),
    Request       = require('sdk/request').Request,
    prefs         = sp.prefs,
    pageMod       = require('sdk/page-mod'),
    tabs          = require('sdk/tabs'),
    timers        = require('sdk/timers'),
    loader        = require('@loader/options'),
    contextMenu   = require('sdk/context-menu'),
    array         = require('sdk/util/array'),
    {Cu}          = require('chrome');

Cu.import('resource://gre/modules/Promise.jsm');

var workers = [], content_script_arr = [];
pageMod.PageMod({
  include: ['*'],
  attachTo: ['existing', 'top'],
  contentScriptFile: data.url('./content_script/inject.js'),
  contentScriptWhen: 'start',
  contentScriptOptions: {
    base: loader.prefixURI + loader.name + '/data/'
  },
  onAttach: function(worker) {
    array.add(workers, worker);
    worker.on('pageshow', function() { array.add(workers, this); });
    worker.on('pagehide', function() { array.remove(workers, this); });
    worker.on('detach', function() { array.remove(workers, this); });
    content_script_arr.forEach(function (arr) {
      worker.port.on(arr[0], arr[1]);
    });
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
  var d = new Promise.defer();
  Request({
    url: url,
    content: data,
    onComplete: function (response) {
      d.resolve(response);
    }
  })[data ? 'post' : 'get']();
  return d.promise;
};

exports.content_script = {
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
    content_script_arr.push([id, callback]);
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
  openOptions: function () {

  },
  list: function () {
    var temp = [];
    for each (var tab in tabs) {
      temp.push(tab);
    }
    return Promise.resolve(temp);
  }
};

exports.context_menu = {
  create: function (title, callback) {
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
  }
};

exports.version = function () {
  return self.version;
};

exports.timer = timers;
exports.Promise = Promise;
