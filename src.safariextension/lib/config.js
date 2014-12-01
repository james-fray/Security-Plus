var isFirefox = typeof require !== 'undefined';
if (isFirefox) {
  var app = require('./firefox/firefox.js');
  var os = require("sdk/system").platform;
  config = exports;
}
else {
  var config = {};
}

config.welcome = {
  get version () {
    return app.storage.read("version");
  },
  set version (val) {
    app.storage.write("version", val);
  },
  timeout: 3
}

config.virustotal = {
  report: {
    iteration : 10,
    interval: 15,
  },
  check: {
    interval: 10
  },
  get: {
    max_reqs_min: 4,
    interval: 60
  }
}

// Complex get and set
config.get = function (name) {
  return name.split(".").reduce(function(p, c) {
    return p[c]
  }, config);
}
config.set = function (name, value) {
  function set(name, value, scope) {
    name = name.split(".");
    if (name.length > 1) {
      set.call((scope || this)[name.shift()], name.join("."), value)
    }
    else {
      this[name[0]] = value;
    }
  }
  set(name, value, config);
}
