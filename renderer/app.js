/**
 * GotRecon? — Renderer process (UI logic)
 */

const state = {
  scanning: false,
  history: [],         
  activeIdx: -1,       // (-1 = live)
  current: null,       

  liveDns: [],
  liveCerts: [],
  liveSubs: [],
  liveTyposquats: [],
  typoTotal: 0,
  typoProgress: 0,
};


const $domainInput = document.getElementById('domain-input');
const $scanBtn = document.getElementById('scan-btn');
const $historyCount = document.getElementById('history-count');
const $statusLine = document.getElementById('status-line');
const $errorLine = document.getElementById('error-line');
const $statsBar = document.getElementById('stats-bar');
const $filterInput = document.getElementById('filter-input');
const $filterRow = document.getElementById('filter-row');
const $tabsContainer = document.getElementById('tabs-container');
const $emptyState = document.getElementById('empty-state');
const $historyList = document.getElementById('history-list');

const $statDns = document.getElementById('stat-dns');
const $statSubs = document.getElementById('stat-subs');
const $statCerts = document.getElementById('stat-certs');
const $statIps = document.getElementById('stat-ips');
const $statTypo = document.getElementById('stat-typo');


function badgeClass(type) {
  return 'badge badge-' + type.toLowerCase();
}


function containsCI(haystack, needle) {
  if (!needle) return true;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}


const spinnerChars = ['|', '/', '-', '\\'];
let spinnerIdx = 0;
let spinnerInterval = null;

function startSpinner() {
  if (spinnerInterval) return;
  spinnerInterval = setInterval(() => {
    spinnerIdx = (spinnerIdx + 1) % 4;
    const el = document.getElementById('spinner-char');
    if (el) el.textContent = spinnerChars[spinnerIdx];
  }, 125);
}

function stopSpinner() {
  if (spinnerInterval) {
    clearInterval(spinnerInterval);
    spinnerInterval = null;
  }
}


function showUI(hasData) {
  if (hasData) {
    $statsBar.classList.remove('hidden');
    $filterRow.classList.remove('hidden');
    $tabsContainer.classList.remove('hidden');
    $emptyState.classList.add('hidden');
  } else {
    $statsBar.classList.add('hidden');
    $filterRow.classList.add('hidden');
    $tabsContainer.classList.add('hidden');
    $emptyState.classList.remove('hidden');
  }
}

function updateStats(result) {
  if (!result) return;
  const dns = result.dnsRecords || [];
  const subs = result.subdomains || [];
  const certs = result.certEntries || [];
  const typos = result.typosquats || [];

  let aRecs = 0;
  for (const d of dns) {
    if (d.type === 'A' || d.type === 'AAAA') aRecs++;
  }
  let typoReg = 0;
  for (const t of typos) {
    if (t.checked && t.registered) typoReg++;
  }

  $statDns.textContent = dns.length;
  $statSubs.textContent = subs.length;
  $statCerts.textContent = certs.length;
  $statIps.textContent = aRecs;
  $statTypo.textContent = typoReg;
}

function updateHistoryList() {
  $historyCount.textContent = `History: ${state.history.length}`;

  if (!state.history.length) {
    $historyList.innerHTML = '<div class="text-muted">No scans yet.</div>';
    return;
  }

  let html = '';
  for (let i = state.history.length - 1; i >= 0; i--) {
    const h = state.history[i];
    const active = state.activeIdx === i ? ' active' : '';
    html += `<div class="history-item${active}" data-idx="${i}">
      <div class="domain">${escapeHtml(h.domain)}</div>
      <div class="timestamp">${escapeHtml(h.timestamp)}</div>
    </div>`;
  }
  $historyList.innerHTML = html;

  // Bind clicks
  $historyList.querySelectorAll('.history-item').forEach((el) => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.idx, 10);
      state.activeIdx = idx;
      renderViewResult();
      updateHistoryList();
    });
  });
}


function getViewResult() {
  if (state.activeIdx >= 0 && state.activeIdx < state.history.length) {
    return state.history[state.activeIdx];
  }
  // Return live data assembled from incremental updates
  return {
    domain: state.current ? state.current.domain : '',
    timestamp: state.current ? state.current.timestamp : '',
    dnsRecords: state.liveDns,
    certEntries: state.liveCerts,
    subdomains: state.liveSubs,
    typosquats: state.liveTyposquats,
  };
}


function renderDnsTable(records, filter) {
  const panel = document.getElementById('panel-dns');
  if (!records || !records.length) {
    panel.innerHTML = '<div class="text-muted">No DNS records found.</div>';
    return;
  }

  let html = `<table class="data-table"><thead><tr>
    <th style="width:60px">Type</th><th>Name</th><th>Value</th>
    <th style="width:60px">TTL</th><th style="width:70px">Priority</th>
  </tr></thead><tbody>`;

  for (const d of records) {
    if (!containsCI(d.type, filter) && !containsCI(d.value, filter) && !containsCI(d.name, filter)) continue;
    html += `<tr>
      <td><span class="${badgeClass(d.type)}">${escapeHtml(d.type)}</span></td>
      <td>${escapeHtml(d.name)}</td>
      <td style="word-break:break-all">${escapeHtml(d.value)}</td>
      <td>${d.ttl}</td>
      <td>${d.priority > 0 ? d.priority : ''}</td>
    </tr>`;
  }

  html += '</tbody></table>';
  panel.innerHTML = html;
}

function renderSubdomainsTable(subdomains, filter) {
  const panel = document.getElementById('panel-subdomains');
  if (!subdomains || !subdomains.length) {
    panel.innerHTML = '<div class="text-muted">No subdomains found.</div>';
    return;
  }

  let html = `<div class="panel-summary">${subdomains.length} unique subdomains</div>
    <div class="panel-separator"></div>
    <table class="data-table"><thead><tr>
    <th style="width:40px">#</th><th>Subdomain</th>
    <th style="width:140px">IP</th><th style="width:80px">Source</th>
  </tr></thead><tbody>`;

  let idx = 0;
  for (const sd of subdomains) {
    if (!containsCI(sd.name, filter) && !containsCI(sd.ip, filter)) continue;
    idx++;
    const ipCell = sd.ip
      ? escapeHtml(sd.ip)
      : '<span class="text-muted">—</span>';
    html += `<tr>
      <td>${idx}</td>
      <td>${escapeHtml(sd.name)}</td>
      <td>${ipCell}</td>
      <td>${escapeHtml(sd.source)}</td>
    </tr>`;
  }

  html += '</tbody></table>';
  panel.innerHTML = html;
}

function renderCertsTable(certs, filter) {
  const panel = document.getElementById('panel-certificates');
  if (!certs || !certs.length) {
    panel.innerHTML = '<div class="text-muted">No certificate entries found.</div>';
    return;
  }

  let html = `<div class="panel-summary">${certs.length} certificate log entries</div>
    <div class="panel-separator"></div>
    <table class="data-table"><thead><tr>
    <th style="width:90px">ID</th><th>Common Name</th><th>SAN / Name Value</th>
    <th style="width:110px">Not Before</th><th style="width:110px">Not After</th>
  </tr></thead><tbody>`;

  for (const ce of certs) {
    if (!containsCI(ce.commonName, filter) && !containsCI(ce.nameValue, filter)) continue;
    html += `<tr>
      <td>${ce.id}</td>
      <td>${escapeHtml(ce.commonName)}</td>
      <td style="word-break:break-all">${escapeHtml(ce.nameValue)}</td>
      <td>${escapeHtml(ce.notBefore)}</td>
      <td>${escapeHtml(ce.notAfter)}</td>
    </tr>`;
  }

  html += '</tbody></table>';
  panel.innerHTML = html;
}

function renderTyposquatsTable(typosquats, filter) {
  const panel = document.getElementById('panel-typosquats');
  if (!typosquats || !typosquats.length) {
    panel.innerHTML = '<div class="text-muted">No typosquat data. Run a scan to check.</div>';
    return;
  }

  // Count stats
  let checked = 0, registered = 0, recent = 0;
  for (const t of typosquats) {
    if (!t.checked) continue;
    checked++;
    if (t.registered) registered++;
    if (t.recent) recent++;
  }

  // Get filter states from checkboxes (if they exist)
  const showOnlyRegistered = document.getElementById('chk-registered')?.checked || false;
  const showOnlyRecent = document.getElementById('chk-recent')?.checked || false;

  let html = `<div class="typo-summary">
    <span class="checked">${checked} / ${typosquats.length} permutations checked</span>
    &nbsp;&nbsp;<span class="registered">${registered} registered</span>`;
  if (recent > 0) {
    html += `&nbsp;&nbsp;<span class="recent">${recent} recently registered (&lt; 90 days)</span>`;
  }
  html += `</div>`;

  html += `<div class="typo-controls">
    <label><input type="checkbox" id="chk-registered" ${showOnlyRegistered ? 'checked' : ''}>Show only registered</label>
    <label><input type="checkbox" id="chk-recent" ${showOnlyRecent ? 'checked' : ''}>Show only recent</label>
  </div>`;

  html += `<table class="data-table"><thead><tr>
    <th>Domain</th><th style="width:100px">Technique</th>
    <th style="width:80px">Registered</th><th style="width:130px">IP</th>
    <th style="width:120px">Reg. Date</th><th style="width:60px">Recent</th>
  </tr></thead><tbody>`;

  for (const t of typosquats) {
    if (!t.checked) continue;
    if (showOnlyRegistered && !t.registered) continue;
    if (showOnlyRecent && !t.recent) continue;
    if (!containsCI(t.domain, filter) && !containsCI(t.technique, filter) && !containsCI(t.ip, filter)) continue;

    const rowClass = t.recent ? 'typo-recent' : t.registered ? 'typo-registered' : 'typo-unregistered';
    const regCell = t.registered
      ? '<span class="text-green">YES</span>'
      : '<span class="text-muted">no</span>';
    const ipCell = t.ip ? escapeHtml(t.ip) : '<span class="text-muted">—</span>';
    const dateCell = t.registeredDate ? escapeHtml(t.registeredDate) : '<span class="text-muted">—</span>';
    const recentCell = t.recent ? '<span class="text-warn">!!</span>' : '';

    html += `<tr class="${rowClass}">
      <td>${escapeHtml(t.domain)}</td>
      <td>${escapeHtml(t.technique)}</td>
      <td>${regCell}</td>
      <td>${ipCell}</td>
      <td>${dateCell}</td>
      <td>${recentCell}</td>
    </tr>`;
  }

  html += '</tbody></table>';
  panel.innerHTML = html;

  // Bind checkbox events (re-render on change)
  const chkReg = document.getElementById('chk-registered');
  const chkRec = document.getElementById('chk-recent');
  if (chkReg) chkReg.addEventListener('change', () => renderActiveTab());
  if (chkRec) chkRec.addEventListener('change', () => renderActiveTab());
}


function getActiveTab() {
  const active = document.querySelector('.tab.active');
  return active ? active.dataset.tab : 'dns';
}

function renderActiveTab() {
  const result = getViewResult();
  const filter = $filterInput.value;
  const tab = getActiveTab();

  switch (tab) {
    case 'dns':          renderDnsTable(result.dnsRecords, filter); break;
    case 'subdomains':   renderSubdomainsTable(result.subdomains, filter); break;
    case 'certificates': renderCertsTable(result.certEntries, filter); break;
    case 'typosquats':   renderTyposquatsTable(result.typosquats, filter); break;
  }
}

function renderViewResult() {
  const result = getViewResult();
  const hasData = (result.dnsRecords && result.dnsRecords.length) ||
                  (result.certEntries && result.certEntries.length) ||
                  (result.subdomains && result.subdomains.length) ||
                  (result.typosquats && result.typosquats.length) ||
                  state.scanning;

  showUI(hasData);
  updateStats(result);
  renderActiveTab();
}


document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
    renderActiveTab();
  });
});


$filterInput.addEventListener('input', () => {
  renderActiveTab();
});


$domainInput.addEventListener('input', () => {
  $scanBtn.disabled = !$domainInput.value.trim();
});

$domainInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && $domainInput.value.trim() && !state.scanning) {
    startScan();
  }
});


$scanBtn.addEventListener('click', () => {
  if (state.scanning) {
    stopScan();
  } else {
    startScan();
  }
});


async function startScan() {
  const domain = $domainInput.value.trim();
  if (!domain) return;

  state.scanning = true;
  state.activeIdx = -1;
  state.liveDns = [];
  state.liveCerts = [];
  state.liveSubs = [];
  state.liveTyposquats = [];
  state.typoTotal = 0;
  state.typoProgress = 0;

  // Normalize domain for display
  let displayDomain = domain;
  if (displayDomain.includes('://')) displayDomain = displayDomain.split('://')[1];
  displayDomain = displayDomain.replace(/\/+$/, '').trim();

  state.current = {
    domain: displayDomain,
    timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
  };

  $scanBtn.textContent = 'Stop';
  $scanBtn.classList.add('stop');
  $scanBtn.disabled = false;
  $errorLine.textContent = '';

  showUI(true);
  updateStats(getViewResult());
  startSpinner();

  // Clear listeners from previous scan
  window.api.removeAllListeners();

  // Wire up IPC listeners for incremental updates
  window.api.onStatus((data) => {
    renderStatus(data);
  });

  window.api.onDns((dnsRecords) => {
    state.liveDns = dnsRecords;
    updateStats(getViewResult());
    if (getActiveTab() === 'dns') renderActiveTab();
  });

  window.api.onCerts((certs) => {
    state.liveCerts = certs;
    updateStats(getViewResult());
    if (getActiveTab() === 'certificates') renderActiveTab();
  });

  window.api.onSubdomains((subs) => {
    state.liveSubs = subs;
    updateStats(getViewResult());
    if (getActiveTab() === 'subdomains') renderActiveTab();
  });

  window.api.onTypoTotal((total) => {
    state.typoTotal = total;
  });

  window.api.onTypoProgress(({ progress, entry }) => {
    state.typoProgress = progress;
    // Update the entry in live list
    const existing = state.liveTyposquats.find((t) => t.domain === entry.domain);
    if (existing) {
      Object.assign(existing, entry);
    } else {
      state.liveTyposquats.push(entry);
    }
    updateStats(getViewResult());
    // Throttle typosquat tab rendering (every 10 entries)
    if (progress % 10 === 0 || progress === state.typoTotal) {
      if (getActiveTab() === 'typosquats') renderActiveTab();
    }
  });

  window.api.onTyposquats((typos) => {
    state.liveTyposquats = typos;
    updateStats(getViewResult());
    if (getActiveTab() === 'typosquats') renderActiveTab();
  });

  window.api.onError((msg) => {
    $errorLine.textContent = msg;
  });

  // Start scan in main process
  const result = await window.api.startScan(domain);

  // Scan finished
  state.scanning = false;
  stopSpinner();
  $scanBtn.textContent = 'Scan';
  $scanBtn.classList.remove('stop');
  $scanBtn.disabled = !$domainInput.value.trim();

  if (result && !result.error) {
    // Archive to history
    state.history.push(result);
    state.activeIdx = state.history.length - 1;
    updateHistoryList();
    renderViewResult();
  }
}

function stopScan() {
  window.api.stopScan();
}


function renderStatus(data) {
  if (!data) {
    $statusLine.innerHTML = '';
    return;
  }

  const domain = state.current ? state.current.domain : '';

  switch (data.phase) {
    case 'dns':
    case 'certs':
    case 'subips':
    case 'typo':
      $statusLine.innerHTML = `
        <span class="status-badge scanning">[ SCANNING ]</span>
        <span>${escapeHtml(domain)} — ${escapeHtml(data.message)}</span>
        <span id="spinner-char" class="spinner">${spinnerChars[spinnerIdx]}</span>`;
      break;
    case 'done':
      stopSpinner();
      $statusLine.innerHTML = `
        <span class="status-badge done">[ DONE ]</span>
        <span>${escapeHtml(domain)} — ${escapeHtml(state.current?.timestamp || '')}</span>`;
      break;
    case 'cancelled':
      stopSpinner();
      $statusLine.innerHTML = `
        <span class="status-badge cancelled">[ CANCELLED ]</span>
        <span>${escapeHtml(domain)} — Scan cancelled.</span>`;
      break;
  }
}


showUI(false);
$scanBtn.disabled = true;
