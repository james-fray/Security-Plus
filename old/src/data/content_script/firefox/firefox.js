/* globals self, iframe */
'use strict';

var background = {};
var manifest = {};

background.send = self.port.emit;
background.receive = self.port.on;
manifest.url = self.options.base;

self.port.on('detach', () => iframe.unload());
