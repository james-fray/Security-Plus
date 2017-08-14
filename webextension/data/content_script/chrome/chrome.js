'use strict';

var background = {};
var manifest = {};

background.send = function (id, data) {
  chrome.runtime.sendMessage({method: id, data: data});
};
background.receive = function (id, callback) {
  chrome.runtime.onMessage.addListener(function (request) {
    if (request.method === id) {
      callback(request.data);
    }
  });
};
manifest.url = chrome.extension.getURL('data/');
