'use strict';

var app = app || require('./firefox/firefox');
var config = config ||require('./config');

//
var key = '26c2e6f73ca56321b60df2f02b92bec014196d1b91ad8345db3db82a0c1630bc';

var virustotal = {
  // limited to at most 4 requests of any nature in any given 1 minute time frame.
  get: (function () {
    var times = [];
    return function (url, data, d) {
      d = d || app.Promise.defer();
      if (times.length === config.virustotal.get.max_reqs_min) {
        var diff = (new Date()).getTime() - times[0].getTime();
        if (diff < config.virustotal.get.interval * 1000) {
          app.timer.setTimeout(function () {
            virustotal.get(url, data, d);
          }, config.virustotal.get.interval * 1000 - diff + 500);
          return d.promise;
        }
      }
      times.splice(0, times.push(new Date()) - config.virustotal.get.max_reqs_min);
      app.get(url, data).then(d.resolve, d.reject);
      return d.promise;
    };
  })(),
  scan: function (url) {
    return virustotal.get('https://www.virustotal.com/vtapi/v2/url/scan', {
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
      if (j.response_code === 0) {
        throw Error('virustotal -> scan -> server rejection, The requested resource is not among the finished, queued or pending scans');
      }
      if (j.response_code !== 1) {
        throw Error('virustotal -> scan -> server rejection, ' + j.verbose_msg);
      }
      return {
        permalink: j.permalink,
        scan_id: j.scan_id,
        sha256: j.sha256
      };
    });
  },
  report: function () {
    var num = 0;
    function checkOnce (resource) {
      return virustotal.get('https://www.virustotal.com/vtapi/v2/url/report', {
        resource: resource,
        apikey: key
      })
      .then(function (response) {
        if (response.status === 204) {
          throw Error('virustotal -> report -> exceeded the request rate limit');
        }
        if (!response.responseText && !response.text) {
          throw Error('virustotal -> report -> checkOnce -> not queued');
        }
        var j = JSON.parse(response.responseText || response.text);
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
    function sumup (resource, d) {
      d = d || app.Promise.defer();
      num += 1;
      checkOnce(resource).then(
        function (o) {
          d.resolve(o);
        },
        function (e) {
          if (e.message === 'virustotal -> report -> checkOnce -> not queued') {
            d.reject(Error('virustotal -> report -> sumup -> The requested resource is not among the finished, queued or pending scans. Broken URL?'));
            return;
          }
          if (num < config.virustotal.report.iteration) {
            app.timer.setTimeout(function () {
              sumup(resource, d);
            }, config.virustotal.report.interval * 1000);
          }
          else {
            d.reject(Error('virustotal -> report -> sumup -> maximum iteration reached'));
          }
        }
      );
      return d.promise;
    }

    return function (resource) {
      return sumup(resource);
    };
  },
  queue: (function () {
    var q = [], onGoing = false;
    function execute() {
      if (onGoing || !q.length) {
        return;
      }

      var o = q.shift();
      function result (callback, id, obj) {
        onGoing = false;
        obj.id = id;
        callback(obj);
        execute();
      }
      app.inject.send('update-item', {
        type: 'progress',
        report: 'Scanning',
        id: o.id
      }, true);
      onGoing = true;
      virustotal.scan(o.url)
      .then(function (obj) {
        return (new virustotal.report())(obj.scan_id);
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
    };
  })()
};

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
  };
})();

app.inject.receive('removed-item', function (id) {
  pp.remove(id);
});
function onContextmenu (url) {
  if (!url) {
    return;
  }
  var id = pp.generate();

  app.inject.send('insert-item', {
    type: 'queue',
    report: 'Queue',
    link: url,
    id: id
  });
  virustotal.queue(url, id, function (obj) {
    if (obj instanceof Error) {
      app.inject.send('update-item', {
        type: 'failed',
        report: 'Failed, ' + obj.message.split(' -> ').pop(),
        id: obj.id,
        result: summary(obj)
      }, true);
    }
    else {
      app.inject.send('update-item', {
        type: obj.positives ? 'defected' : 'clean',
        report: obj.positives ? (obj.positives < 4 ? 'Suspicious site' : 'Malware site') : 'Clean site',
        id: obj.id,
        result: summary(obj)
      }, true);
    }
  });
}
app.inject.receive('valid-link', function (link) {
  console.error(link);
});
app.context_menu.create('Scan file for viruses, or all kinds of malware', onContextmenu);

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
    '    <link rel="shortcut icon" href="data:image/png;base64,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">' +
    '    <meta charset="utf-8">' +
    '    <meta name=viewport content="width=device-width, initial-scale=1">' +
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

  var body = '';
  for (var i in obj.scans) {
    body += '<tr><td>' + i + '</td><td class="' + (obj.scans[i].detected ? 'defected' : 'clean') + '">' + obj.scans[i].result + '</td><td>' + (obj.scans[i].detail || '-') + '</td></tr>';
  }

  return 'data:text/html,' + encodeURIComponent(html.replace('<!-- body -->', body).replace('<!-- styles -->', styles));
}

app.startup(function () {
  var version = config.welcome.version;
  if (app.version() !== version) {
    app.timer.setTimeout(function () {
      app.tab.open(
        'http://add0n.com/security-plus.html?v=' + app.version() +
        (version ? '&p=' + version + '&type=upgrade' : '&type=install')
      );
      config.welcome.version = app.version();
    }, config.welcome.timeout);
  }
});
