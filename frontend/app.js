
const API_BASE_URL = "https://r20ta0mtoe.execute-api.ap-south-1.amazonaws.com/Prod";
const fileInput = document.querySelector('#file');
const uploadBtn = document.querySelector('#uploadBtn');
const uploadMsg = document.querySelector('#uploadMsg');
const query = document.querySelector('#query');
const rows = document.querySelector('#rows');
const count = document.querySelector('#count');
const apiStatus = document.querySelector('#apiStatus');

function configured(){ return API_BASE_URL && !API_BASE_URL.includes('YOUR_'); }
apiStatus.textContent = configured() ? 'API connected' : 'Set API URL in app.js';

async function loadDocuments(){
  if(!configured()) return;
  try{
    const q = encodeURIComponent(query.value.trim());
    const res = await fetch(`${API_BASE_URL}/documents${q ? `?q=${q}` : ''}`);
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || 'Search failed');
    count.textContent = `${data.count} document${data.count === 1 ? '' : 's'}`;
    rows.innerHTML = data.documents.length ? data.documents.map(d => {
      const m = d.metadata || {};
      return `<tr><td>${esc(m.fileName || d.fileName || '-')}</td><td>${esc(m.name || '-')}</td><td>${esc(m.email || '-')}</td><td><div class="skills">${(m.skills||[]).map(s=>`<span class="skill">${esc(s)}</span>`).join('')}</div></td><td>${m.wordCount || 0}</td><td><span class="badge ok">${esc(d.status)}</span></td></tr>`;
    }).join('') : '<tr><td colspan="6" class="empty">No matching documents.</td></tr>';
  }catch(e){ rows.innerHTML=`<tr><td colspan="6" class="empty error">${esc(e.message)}</td></tr>`; }
}

uploadBtn.onclick = async () => {
  if(!configured()){ uploadMsg.className='message error'; uploadMsg.textContent='Configure API_BASE_URL in frontend/app.js first.'; return; }
  const file=fileInput.files[0];
  if(!file){ uploadMsg.className='message error'; uploadMsg.textContent='Choose a document first.'; return; }
  uploadBtn.disabled=true; uploadMsg.className='message'; uploadMsg.textContent='Creating secure upload URL...';
  try{
    const r=await fetch(`${API_BASE_URL}/upload-url`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fileName:file.name,contentType:file.type || guessType(file.name)})});
    const data=await r.json(); if(!r.ok) throw new Error(data.error||'Could not create upload URL');
    uploadMsg.textContent='Uploading document...';
    const s=await fetch(data.uploadUrl,{method:'PUT',headers:{'Content-Type':file.type || guessType(file.name)},body:file});
    if(!s.ok) throw new Error('S3 upload failed');
    uploadMsg.className='message ok'; uploadMsg.textContent='Uploaded. Processing Lambda will extract the document shortly.';
    fileInput.value=''; setTimeout(loadDocuments,3000);
  }catch(e){ uploadMsg.className='message error'; uploadMsg.textContent=e.message; }
  finally{ uploadBtn.disabled=false; }
};

document.querySelector('#searchBtn').onclick=loadDocuments;
query.addEventListener('keydown',e=>{if(e.key==='Enter')loadDocuments()});
function guessType(name){const n=name.toLowerCase();if(n.endsWith('.pdf'))return'application/pdf';if(n.endsWith('.docx'))return'application/vnd.openxmlformats-officedocument.wordprocessingml.document';return'text/plain'}
function esc(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
loadDocuments();
