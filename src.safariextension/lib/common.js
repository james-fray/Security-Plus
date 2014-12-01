/**** wrapper (start) ****/
var isFirefox = typeof require !== 'undefined',
    isSafari  = typeof safari !== 'undefined',
    isOpera   = typeof chrome !== 'undefined' && navigator.userAgent.indexOf("OPR") !== -1,
    isChrome  = typeof chrome !== 'undefined' && navigator.userAgent.indexOf("OPR") === -1;

if (isFirefox) {
  app = require('./firefox/firefox');
  config = require('./config');
}
/**** wrapper (end) ****/

// welcome
(function () {
  var version = config.welcome.version;
  if (app.version() !== version) {
    app.timer.setTimeout(function () {
      app.tab.open("http://add0n.com/security-plus.html?v=" + app.version() + (version ? "&p=" + version + "&type=upgrade" : "&type=install"));
      config.welcome.version = app.version();
    }, config.welcome.timeout);
  }
})();

//
var key = "26c2e6f73ca56321b60df2f02b92bec014196d1b91ad8345db3db82a0c1630bc";

var virustotal = {
  // limited to at most 4 requests of any nature in any given 1 minute time frame.
  get: (function () {
    var times = [];
    return function (url, data, d) {
      var d = d || app.Promise.defer();
      if (times.length === config.virustotal.get.max_reqs_min) {
        var diff = (new Date()).getTime() - times[0].getTime();
        if (diff < config.virustotal.get.interval * 1000) {
          app.timer.setTimeout(function () {
            virustotal.get(url, data, d);
          }, config.virustotal.get.interval * 1000 - diff + 500);
          console.error('get request is delayed for %i msecs', config.virustotal.get.interval * 1000 - diff + 500);
          return d.promise;
        }
      }
      times.splice(0, times.push(new Date()) - config.virustotal.get.max_reqs_min);
      app.get(url, data).then(d.resolve, d.reject);
      return d.promise;
    }
  })(),
  scan: function (url) {
    var url = "https://www.virustotal.com/vtapi/v2/url/scan";
    return virustotal.get(url, {
      url: url,
      apikey: key
    })
    .then(function (response) {
      if (response.status === 204) {
        throw Error('virustotal -> scan -> exceeded the request rate limit');
      }
      if (!response.responseText && !response.text) {
        throw Error('virustotal -> scan -> server response is empty');
      }
      var j = JSON.parse(response.responseText || response.text);
      if (j.response_code !== 1) {
        throw Error('virustotal -> scan -> server rejection, ' + j.verbose_msg);
      }
      return {
        permalink: j.permalink,
        scan_id: j.scan_id,
        sha256: j.sha256
      }
    });
  },
  report: (function () {
    var num = 0;
    function checkOnce (resource) {
      var url = "http://www.virustotal.com/vtapi/v2/url/report";
      return virustotal.get(url, {
        resource: resource,
        apikey: key
      })
      .then(function (response) {
        if (response.status === 204) {
          throw Error('virustotal -> report -> exceeded the request rate limit');
        }
        if (!response.responseText && !response.text) {
          throw Error('virustotal -> report -> checkOnce -> server response is empty');
        }
        var j = JSON.parse(response.responseText || response.text);
        if (j.response_code !== 1) {
          console.error(j.verbose_msg);
          throw Error('virustotal -> report -> checkOnce -> server rejection, ' + j.verbose_msg);
        }
        return {
          positives: j.positives,
          total: j.total,
          scans: j.scans
        }
      });
    }
    function sumup (resource) {
      var d = app.Promise.defer();
      num += 1;
      checkOnce(resource).then(
        function (o) {
          d.resolve(o);
        },
        function (e) {
          if (num < config.virustotal.report.iteration) {
            app.timer.setTimeout(function () {
              sumup(resource);
            }, config.virustotal.report.interval * 1000);
          }
          else {
            d.reject(Error('virustotal -> report -> sumup -> maximum iteration reached'));
          }
        }
      )
      return d.promise;
    }

    return function (resource) {
      return sumup(resource);
    }
  })(),
  queue: (function () {
    var q = [], onGoing = false;
    function execute() {
      if (onGoing) return;
      if (!q.length) return;

      var o = q.shift();
      function result (callback, id, obj) {
        onGoing = false;
        obj.id = id;
        callback(obj);
        execute();
      }
      app.content_script.send("update-item", {
        type: "progress",
        report: "Scanning",
        id: o.id
      }, true);
      onGoing = true;
      virustotal.scan(o.url)
      .then(function (obj) {
        return new virustotal.report(obj.scan_id);
      })
      .then(result.bind(null, o.callback, o.id), result.bind(null, o.callback, o.id));
    }
    return function (url, id, callback) {
      q.push({
        url: url,
        id: id,
        callback: callback
      });
      execute();
    }
  })()
}

//
var pp = (function () {
  var ids = [], i = 0;
  return {
    generate: function () {
      i += 1;
      ids.push(i);
      return i;
    },
    remove: function (id) {
      var index = ids.indexOf(id);
      if (index !== -1) {
        ids.splice(index, 1);
        return true;
      }
      return false;
    }
  }
})();

app.content_script.receive("removed-item", function (id) {
  pp.remove(id);
});
app.context_menu.create("Scan file for viruses, or all kinds of malware", onContextmenu);
function onContextmenu (url) {
  if (!url) return;
  var id = pp.generate();

  app.content_script.send("insert-item", {
    type: "queue",
    report: "Queue",
    link: url,
    id: id
  });
  virustotal.queue(url, id, function (obj) {
    console.error(obj);
    if (obj instanceof Error) {
      app.content_script.send("update-item", {
        type: "failed",
        report: "Failed, " + obj.message.split(" -> ").pop(),
        id: obj.id,
        result: summary(obj)
      }, true);
    }
    else {
      app.content_script.send("update-item", {
        type: obj.positives ? "defected" : "clean",
        report: obj.positives ? "Link is defected" : "Link is clean",
        id: obj.id,
        result: summary(obj)
      }, true);
    }
  });
}

function summary (obj) {
  var styles =
    'table {' +
    '  white-space: nowrap;' +
    '  font-family: "Helvetica Neue",Helvetica,Arial,sans-serif;' +
    '  border-collapse: collapse;' +
    '  border-spacing: 0px;' +
    '  font-size: 13px;' +
    '  line-height: 20px;' +
    '  color: #333;' +
    '}' +
    'th {' +
    '  border-bottom: 1px solid #DDD;' +
    '  padding: 8px;' +
    '  text-align: left;' +
    '}' +
    'td {' +
    '  padding: 8px;' +
    '}' +
    'tr:nth-child(even) {' +
    '  background: #F9F9F9;' +
    '}' +
    '.clean {' +
    '  color: #33AF99;' +
    '}' +
    '.defected {' +
    '  color: #ED3237;' +
    '}';
  var html =
    '<html>' +
    '  <head>' +
    '    <title>Scan Plus Report</title>' +
    '    <style><!-- styles --></style>' +
    '  </head>' +
    '  <table width="100%">' +
    '    <tr>' +
    '      <th>URL Scanner</th><th>Result</th><th style="width: 100%; text-align: left">Detail</th>' +
    '    </tr>' +
    '    <!-- body -->' +
    '  </table>' +
    '</html>';

  var body = "";
  for (var i in obj.scans) {
    body += '<tr><td>' + i + '</td><td class="' + (obj.scans[i].detected ? "defected" : "clean") + '"">' + obj.scans[i].result + '</td><td>' + (obj.scans[i].detail || "-") + '</td></tr>';
  }

  return "data:text/html," + encodeURIComponent(html.replace("<!-- body -->", body).replace("<!-- styles -->", styles));
}
