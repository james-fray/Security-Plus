/* globals safari */
'use strict';

var background = {};
var manifest = {};

background.send = function (id, obj) {
  safari.self.tab.dispatchMessage('message', {
    id: id,
    data: obj
  });
};
background.receive = (function () {
  var callbacks = {};
  safari.self.addEventListener('message', function (e) {
    if (callbacks[e.name]) {
      callbacks[e.name](e.message);
    }
  }, false);

  return function (id, callback) {
    callbacks[id] = callback;
  };
})();
manifest.url = safari.extension.baseURI + 'data/';

// context menu
document.addEventListener('contextmenu', function handleContextMenu (event) {
  var target = event.target;
  var link = target.closest('a');
  if (link) {
    safari.self.tab.setContextMenuEventUserInfo(event, link.href);
  }
  else {
    var match = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/;
    var selected = window.getSelection().toString();
    if (selected && match.test(selected)) {
      safari.self.tab.setContextMenuEventUserInfo(event, selected);
    }
  }
}, false);
