const args = new URLSearchParams(location.search);

if (args.has('id')) {
  chrome.runtime.sendMessage({
    method: 'get-report',
    id: args.get('id')
  }, obj => {
    if (obj && obj.scans) {
      document.title = `[${obj.positives}/${obj.total}] ${args.get('href')} :: Security Plus`;

      const tbody = document.querySelector('tbody');
      for (const [key, value] of Object.entries(obj.scans)) {
        const tr = document.createElement('tr');
        const k = document.createElement('td');
        k.textContent = key;
        tr.appendChild(k);
        const r = document.createElement('td');
        r.classList.add(value.detected ? 'defected' : 'clean');
        r.textContent = value.result;
        tr.appendChild(r);
        const e = document.createElement('td');
        e.textContent = value.detail || '-';
        tr.appendChild(e);
        tbody.appendChild(tr);
      }
    }
    else {
      alert('Scan results are expired. Please close this window and rerun your scan');
    }
  });
}
