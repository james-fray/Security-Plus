var isSafari = navigator.userAgent.indexOf('Safari') != -1 && navigator.userAgent.indexOf('Chrome') == -1;
console.error(isSafari);

function insert (o) {
  var item = document.getElementById("item").cloneNode(true);
  item.setAttribute("type", o.type);
  item.setAttribute("data-id", o.id);
  item.children[1].textContent = o.report;
  item.children[1].title = o.report;
  var a = item.children[2].querySelector("a");
  a.textContent = o.link;
  a.setAttribute("href", o.link);
  item.children[4].addEventListener("click", function () {
    remove(item.getAttribute("data-id"));
  }, false);
  document.body.appendChild(item);
  item.style.display = isSafari ? "-webkit-flex" : "flex";
}

function remove (id) {
  var item = document.querySelector("[data-id='" + id + "']");
  if (item) {
    item.setAttribute("transition", "fadeout");
    window.setTimeout(function () {
      item.parentNode.removeChild(item);
      parent.postMessage({
        from: "security-plus",
        command: "remove-item",
        id: id
      }, "*");
    }, 400);
  }
}

function update (o) {
  var item = document.querySelector("[data-id='" + o.id + "']");
  if (item) {
    if (o.type) item.setAttribute("type", o.type);
    if (o.report) {
      item.children[1].textContent = o.report;
      item.children[1].title = o.report;
    }
    if (o.result) {
      var a = item.children[3].querySelector("a");
      a.setAttribute("href", o.result);
      a.textContent = "results";
    }
  }
}

window.addEventListener("message", function (e) {
  if (e.data && e.data.command && e.data.from && e.data.from === "security-plus") {
    switch (e.data.command) {
    case "insert-item":
      insert(e.data);
      break;
    case "remove-item":
      remove(e.data.id);
      break;
    case "update-item":
      update(e.data);
      break;
    }
  }
}, false);
