// DocFlow frontend. The existing API and serverless upload flow are preserved.
const API_BASE_URL = "https://r20ta0mtoe.execute-api.ap-south-1.amazonaws.com/Prod";
const fileInput = document.querySelector('#file');
const uploadBtn = document.querySelector('#uploadBtn');
const uploadMsg = document.querySelector('#uploadMsg');
const query = document.querySelector('#query');
const rows = document.querySelector('#rows');
const count = document.querySelector('#count');
const apiStatus = document.querySelector('#apiStatus');
const dropzone = document.querySelector('#dropzone');
const dropTitle = document.querySelector('#dropTitle');
const dropSubtitle = document.querySelector('#dropSubtitle');
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['pdf', 'docx', 'txt']);

function configured() {
  return Boolean(API_BASE_URL && !API_BASE_URL.includes('YOUR_'));
}

function setApiStatus(connected, label) {
  apiStatus.classList.toggle('disconnected', !connected);
  apiStatus.innerHTML = `<span class="connection-led"></span>${esc(label)}`;
}

function setMessage(message, kind = '') {
  uploadMsg.className = `message${kind ? ` ${kind}` : ''}`;
  uploadMsg.textContent = message;
}

function setApiError(error) {
  setApiStatus(false, 'API unavailable');
  rows.innerHTML = `<tr><td colspan="5" class="empty error"><span class="empty-mark">!</span><span>${esc(error)}</span></td></tr>`;
}

function guessType(name) {
  const n = name.toLowerCase();
  if (n.endsWith('.pdf')) return 'application/pdf';
  if (n.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return 'text/plain';
}

function fileExtension(name) {
  const parts = String(name || '').split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : 'file';
}

function cleanFileName(name) {
  // The current processor leaves a generated identifier before the original name.
  return String(name || 'Untitled document')
    .replace(/^(?:[a-f\d]{4,8}-){3}[a-f\d]{8,12}-(?=.+\.)/i, '')
    .replace(/^\s+/, '') || 'Untitled document';
}

function formatNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString() : '0';
}

function normalizeSkills(skills) {
  if (Array.isArray(skills)) return skills.map(v => String(v).trim()).filter(Boolean);
  if (typeof skills === 'string' && skills.trim()) return skills.split(/[,;|]/).map(v => v.trim()).filter(Boolean);
  return [];
}

function statusClass(status) {
  const s = String(status || '').toUpperCase();
  if (s === 'PROCESSED' || s === 'COMPLETE' || s === 'COMPLETED') return 'ok';
  if (s === 'FAILED' || s === 'ERROR') return 'failed';
  if (s === 'UPLOADING' || s === 'PROCESSING' || s === 'PENDING') return 'pending';
  return 'unknown';
}

function displayDocument(d) {
  const m = d.metadata || {};
  const fileName = cleanFileName(m.fileName || d.fileName || 'Untitled document');
  const ext = fileExtension(fileName);
  const skills = normalizeSkills(m.skills);
  const maxVisible = 5;
  const visibleSkills = skills.slice(0, maxVisible).map(skill => `<span class="skill">${esc(skill)}</span>`).join('');
  const moreSkills = skills.length > maxVisible ? `<span class="skills-more">+${skills.length - maxVisible}</span>` : '';
  const name = String(m.name || '').trim();
  const email = String(m.email || '').trim();
  const contact = `<div class="contact-name">${esc(name || '—')}</div>${email ? `<span class="contact-email">${esc(email)}</span>` : '<span class="contact-email">No email found</span>'}`;
  const status = String(d.status || 'UNKNOWN').toUpperCase();
  const wordCount = m.wordCount ?? d.wordCount ?? 0;
  return `<tr>
    <td><div class="file-cell"><span class="file-icon ${['docx', 'txt'].includes(ext) ? ext : 'pdf'}">${esc(ext.slice(0, 4).toUpperCase())}</span><div><div class="file-name">${esc(fileName)}</div><span class="file-sub">DOCUMENT FILE</span></div></div></td>
    <td>${contact}</td>
    <td><div class="skills">${visibleSkills || '<span class="contact-email">No skills detected</span>'}${moreSkills}</div></td>
    <td><span class="word-count">${formatNumber(wordCount)}</span></td>
    <td><span class="badge ${statusClass(status)}">${esc(status)}</span></td>
  </tr>`;
}

function updateStats(documents) {
  const total = documents.length;
  const processedDocs = documents.filter(d => statusClass(d.status) === 'ok');
  const totalWords = processedDocs.reduce((sum, d) => sum + (Number((d.metadata || {}).wordCount ?? d.wordCount ?? 0) || 0), 0);
  document.querySelector('#totalStat').textContent = formatNumber(total);
  document.querySelector('#processedStat').textContent = formatNumber(processedDocs.length);
  document.querySelector('#wordsStat').textContent = formatNumber(totalWords);
}

async function loadDocuments() {
  if (!configured()) {
    setApiStatus(false, 'API not configured');
    return;
  }
  const searchText = query.value.trim();
  const searchButton = document.querySelector('#searchBtn');
  searchButton.disabled = true;
  searchButton.classList.add('busy');
  try {
    const q = encodeURIComponent(searchText);
    const res = await fetch(`${API_BASE_URL}/documents${q ? `?q=${q}` : ''}`);
    let data;
    try { data = await res.json(); } catch { data = {}; }
    if (!res.ok) throw new Error(data.error || `Could not load documents (HTTP ${res.status}).`);
    const documents = Array.isArray(data.documents) ? data.documents : [];
    setApiStatus(true, 'API connected');
    count.textContent = `${formatNumber(data.count ?? documents.length)} document${Number(data.count ?? documents.length) === 1 ? '' : 's'}`;
    document.querySelector('#resultLabel').textContent = searchText ? 'FILTERED RESULTS' : 'LIVE LIBRARY';
    updateStats(documents);
    rows.innerHTML = documents.length
      ? documents.map(displayDocument).join('')
      : `<tr><td colspan="5" class="empty"><span class="empty-mark">${searchText ? '⌕' : '＋'}</span><span>${searchText ? 'No documents match that search.' : 'Your library is ready for its first document.'}</span></td></tr>`;
  } catch (error) {
    setApiError(error.message || 'Could not connect to the document service.');
  } finally {
    searchButton.disabled = false;
    searchButton.classList.remove('busy');
  }
}

function validateFile(file) {
  if (!file) return 'Choose a document first.';
  const ext = fileExtension(file.name);
  if (!ALLOWED_EXTENSIONS.has(ext)) return 'Please choose a PDF, DOCX, or TXT file.';
  if (file.size > MAX_FILE_SIZE) return 'This file is larger than 10 MB. Choose a smaller document.';
  if (file.size === 0) return 'This file is empty. Choose another document.';
  return '';
}

function showSelectedFile(file) {
  if (!file) {
    dropTitle.textContent = 'Drop your file here';
    dropSubtitle.innerHTML = 'or <label for="file" class="browse-link">browse your computer</label>';
    return;
  }
  dropTitle.textContent = file.name;
  dropSubtitle.textContent = `${(file.size / (1024 * 1024)).toFixed(file.size < 1024 * 1024 ? 2 : 1)} MB · Ready to upload`;
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  showSelectedFile(file);
  if (file) {
    const problem = validateFile(file);
    if (problem) setMessage(problem, 'error');
    else setMessage('');
  }
});

['dragenter', 'dragover'].forEach(eventName => dropzone.addEventListener(eventName, event => {
  event.preventDefault();
  dropzone.classList.add('dragover');
}));
['dragleave', 'drop'].forEach(eventName => dropzone.addEventListener(eventName, event => {
  event.preventDefault();
  dropzone.classList.remove('dragover');
}));
dropzone.addEventListener('drop', event => {
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  try {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    fileInput.files = transfer.files;
    showSelectedFile(file);
    const problem = validateFile(file);
    setMessage(problem, problem ? 'error' : '');
  } catch {
    setMessage('Use “browse your computer” to select this file.', 'error');
  }
});

uploadBtn.addEventListener('click', async () => {
  if (!configured()) {
    setMessage('Configure API_BASE_URL in frontend/app.js first.', 'error');
    return;
  }
  const file = fileInput.files[0];
  const problem = validateFile(file);
  if (problem) {
    setMessage(problem, 'error');
    return;
  }

  const originalLabel = uploadBtn.innerHTML;
  uploadBtn.disabled = true;
  uploadBtn.innerHTML = '<span>Preparing upload…</span><span class="button-arrow">↻</span>';
  setMessage('Preparing a secure upload link…');
  try {
    const contentType = file.type || guessType(file.name);
    const response = await fetch(`${API_BASE_URL}/upload-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: file.name, contentType })
    });
    let data;
    try { data = await response.json(); } catch { data = {}; }
    if (!response.ok) throw new Error(data.error || `Could not create upload URL (HTTP ${response.status}).`);
    if (!data.uploadUrl) throw new Error('The API did not return an upload URL.');

    uploadBtn.innerHTML = '<span>Uploading file…</span><span class="button-arrow">↻</span>';
    setMessage('Uploading your document to secure storage…');
    const s3Response = await fetch(data.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: file
    });
    if (!s3Response.ok) throw new Error(`Storage upload failed (HTTP ${s3Response.status}). Please try again.`);

    setMessage('Upload complete. DocFlow is extracting the document details.', 'ok');
    fileInput.value = '';
    showSelectedFile(null);
    await loadDocuments();
    // Processing is asynchronous, so refresh after a short delay as well.
    window.setTimeout(loadDocuments, 2500);
    window.setTimeout(loadDocuments, 6500);
  } catch (error) {
    setMessage(error.message || 'Upload failed. Check your connection and try again.', 'error');
  } finally {
    uploadBtn.disabled = false;
    uploadBtn.innerHTML = originalLabel;
  }
});

document.querySelector('#searchBtn').addEventListener('click', loadDocuments);
document.querySelector('#refreshBtn').addEventListener('click', loadDocuments);
query.addEventListener('keydown', event => {
  if (event.key === 'Enter') loadDocuments();
});

document.querySelector('#todayLabel').textContent = new Intl.DateTimeFormat('en-IN', { month: 'short', day: '2-digit', year: 'numeric' }).format(new Date()).toUpperCase();

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

setApiStatus(false, 'Connecting…');
loadDocuments();
