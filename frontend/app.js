const $ = (id) => document.getElementById(id);
let chartDataCache = {};
let activeDataset = 'davis';
let lastPredictions = {};

async function api(path, options = {}) {
  const response = await fetch(path, {credentials:'same-origin', headers:{'Content-Type':'application/json', ...(options.headers || {})}, ...options});
  let payload = {};
  try { payload = await response.json(); } catch (_) {}
  if (!response.ok) throw new Error(payload.detail || 'Request failed. Please try again.');
  return payload;
}

function showApp() {
  $('authView').classList.add('hidden');
  $('appView').classList.remove('hidden');
  $('userLabel').textContent = 'Guest session';
  $('historyIntro').textContent = 'Guest history is temporary and stays in this browser tab.';
  loadPerformance(activeDataset).then(() => drawChart()).catch(showMessage);
  showSection('predict');
}
$('guestBtn').addEventListener('click', () => showApp());

function showSection(section) {
  const isPredict = section === 'predict';
  $('predictSection').classList.toggle('hidden', !isPredict);
  $('historySection').classList.toggle('hidden', isPredict);
  document.querySelectorAll('.nav-link').forEach(btn => btn.classList.toggle('active', btn.dataset.section === section));
  if (!isPredict) loadHistory();
}
document.querySelectorAll('.nav-link').forEach(btn => btn.addEventListener('click', () => showSection(btn.dataset.section)));

function updateCount(input, output, unit) { $(output).textContent = `${input.value.length} / ${input.maxLength} ${unit}`; }
let inputExamples = {drugs:[], proteins:[]};
async function loadInputExamples() {
  try {
    const response = await fetch('/static/examples.json');
    if (!response.ok) throw new Error('Could not load examples.');
    inputExamples = await response.json();
    const drugSelect = $('drugExample');
    const proteinSelect = $('proteinExample');
    inputExamples.drugs.forEach(item => drugSelect.add(new Option(`${item.label} · ${item.length} characters`, item.id)));
    inputExamples.proteins.forEach(item => proteinSelect.add(new Option(`${item.label} · ${item.length} residues`, item.id)));
  } catch (error) {
    console.warn('Example presets unavailable:', error);
  }
}
function chooseInputExample(kind, selectedId) {
  const isDrug = kind === 'drug';
  const select = $(isDrug ? 'drugExample' : 'proteinExample');
  const field = $(isDrug ? 'smiles' : 'protein');
  const list = isDrug ? inputExamples.drugs : inputExamples.proteins;
  if (selectedId === 'custom') {
    field.value = '';
    field.focus();
  } else {
    const selected = list.find(item => item.id === selectedId);
    if (!selected) return;
    field.value = isDrug ? selected.smiles : selected.sequence;
  }
  updateCount(field, isDrug ? 'smilesCount' : 'proteinCount', isDrug ? 'characters' : 'residues');
}
$('drugExample').addEventListener('change', event => chooseInputExample('drug', event.target.value));
$('proteinExample').addEventListener('change', event => chooseInputExample('protein', event.target.value));
$('smiles').addEventListener('input', () => {
  updateCount($('smiles'), 'smilesCount', 'characters');
  if ($('drugExample').value !== 'custom') $('drugExample').value = 'custom';
});
$('protein').addEventListener('input', () => {
  updateCount($('protein'), 'proteinCount', 'residues');
  if ($('proteinExample').value !== 'custom') $('proteinExample').value = 'custom';
});
$('smiles').addEventListener('input', () => updateCount($('smiles'), 'smilesCount', 'characters'));
$('protein').addEventListener('input', () => updateCount($('protein'), 'proteinCount', 'residues'));
$('dataset').addEventListener('change', async () => {
  activeDataset = $('dataset').value; resetResult();
  await loadPerformance(activeDataset); drawChart();
});
function resetResult() {
  $('resultValue').textContent = '—'; $('resultUnit').textContent = activeDataset === 'davis' ? 'pKd' : 'KIBA score';
  $('resultBadge').textContent = 'Awaiting prediction'; $('resultBadge').className = 'neutral-badge';
  $('meterFill').style.width = '0%'; $('meterMarker').style.display = 'none';
  $('meterNote').textContent = 'Your prediction and interpretation will appear here.';
}
function showMessage(message) { $('formMessage').textContent = message; }
$('predictionForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const smiles = $('smiles').value.trim(); const protein = $('protein').value.replace(/\s+/g,'').toUpperCase();
  if (!smiles || !protein) { showMessage('Please enter both the drug SMILES and protein sequence.'); return; }
  const btn = $('predictBtn'); btn.disabled = true; btn.textContent = 'Running model…'; showMessage('The selected ONNX model is processing your inputs.');
  try {
    const result = await api('/api/predict', {method:'POST', body:JSON.stringify({dataset:activeDataset, smiles, protein_sequence:protein})});
    renderPrediction(result); showMessage('Prediction complete. Guest history is kept temporarily in this browser tab.');
  } catch (error) { showMessage(error.message); }
  finally { btn.disabled = false; btn.innerHTML = '➜ &nbsp; Predict affinity'; }
});
function renderPrediction(result) {
  const value = Number(result.prediction); lastPredictions[result.dataset] = value; drawChart(); $('resultValue').textContent = value.toFixed(3); $('resultUnit').textContent = result.unit;
  $('resultBadge').textContent = result.binding_strength; $('resultBadge').className = 'neutral-badge';
  const range = result.dataset === 'davis' ? [5,10.8] : [0,17.2];
  const pct = Math.max(0,Math.min(100,(value-range[0])/(range[1]-range[0])*100));
  $('meterFill').style.width = `${pct}%`; $('meterMarker').style.display = 'block'; $('meterMarker').style.left = `${pct}%`;
  $('meterNote').textContent = result.dataset === 'davis' ? 'Higher pKd indicates tighter binding.' : 'Higher KIBA score indicates stronger binding on the KIBA scale.';
  const record = {...result, created_at:new Date().toISOString()};
  const arr = JSON.parse(sessionStorage.getItem('affinix_guest_history') || '[]'); arr.unshift(record);
  sessionStorage.setItem('affinix_guest_history', JSON.stringify(arr.slice(0,50)));
}

async function loadHistory() {
  const host = $('historyList'); host.innerHTML = '<div class="panel empty-history">Loading history…</div>';
  try {
    const records = JSON.parse(sessionStorage.getItem('affinix_guest_history') || '[]');
    if (!records.length) { host.innerHTML = '<div class="panel empty-history">No predictions yet. Run a prediction from the Predict section.</div>'; return; }
    host.innerHTML = records.map(item => {
      const ds = (item.dataset || '').toUpperCase(); const unit = item.unit || (ds === 'DAVIS' ? 'pKd' : 'KIBA score');
      const when = item.created_at ? new Date(item.created_at).toLocaleString() : '';
      return `<article class="history-card"><div><h3>${escapeHtml(ds)} · ${escapeHtml(when)}</h3><p><b>SMILES:</b> ${escapeHtml(item.smiles || '')}</p><p><b>Protein:</b> ${escapeHtml((item.protein_sequence || '').slice(0,90))}${(item.protein_sequence || '').length>90?'…':''}</p><p><b>Binding strength:</b> ${escapeHtml(item.binding_strength || '—')}</p></div><div class="history-score">${Number(item.prediction).toFixed(3)}<small>${escapeHtml(unit)}</small></div></article>`;
    }).join('');
  } catch (error) { host.innerHTML = `<div class="panel empty-history">${escapeHtml(error.message)}</div>`; }
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function loadPerformance(dataset) {
  if (!chartDataCache[dataset]) {
    const [points, metrics] = await Promise.all([fetch(`/performance_data/${dataset}_scatter_sample.json`).then(r=>r.json()),fetch(`/performance_data/${dataset}_metrics.json`).then(r=>r.json())]);
    chartDataCache[dataset] = {points,metrics};
  }
  const {metrics} = chartDataCache[dataset];
  $('chartSubtitle').textContent = `${dataset === 'davis' ? 'Davis' : 'KIBA'} official test set · ${metrics.sample_points.toLocaleString()} sampled points out of ${metrics.test_rows.toLocaleString()}`;
  $('metricSubtitle').textContent = `${dataset === 'davis' ? 'Davis Fold 1' : 'KIBA Fold 4'} selected model · official held-out test set`;
  // The notebook reports CI, MSE, RMSE, MAE and Pearson. Pearson is intentionally omitted.
  const m = metrics.metrics;
  const cards = [['CI','Concordance Index',m.CI],['MSE','Mean Squared Error',m.MSE],['RMSE','Root Mean Squared Error',m.RMSE],['MAE','Mean Absolute Error',m.MAE]];
  $('metricsGrid').innerHTML = cards.map(([name,label,value])=>`<div class="metric"><b>${name}</b><span>${label}</span><strong>${Number(value).toFixed(4)}</strong></div>`).join('');
}
function drawChart() {
  const data = chartDataCache[activeDataset]; if (!data) return;
  const canvas = $('accuracyChart'); const rect = canvas.getBoundingClientRect(); if (!rect.width) return;
  const dpr = window.devicePixelRatio || 1; canvas.width = rect.width*dpr; canvas.height = rect.height*dpr;
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0);
  const w=rect.width,h=rect.height,L=58,R=18,T=18,B=48,pw=w-L-R,ph=h-T-B;
  const pts=data.points; const userPred=lastPredictions[activeDataset]; const all=pts.flatMap(p=>[Number(p.actual),Number(p.predicted)]).concat(userPred!==undefined?[userPred]:[]).filter(Number.isFinite);
  let min=Math.min(...all),max=Math.max(...all); const pad=(max-min)*.07 || 1; min-=pad; max+=pad;
  const x=v=>L+(v-min)/(max-min)*pw, y=v=>T+ph-(v-min)/(max-min)*ph;
  ctx.clearRect(0,0,w,h); ctx.font='11px Inter,Arial'; ctx.lineWidth=1; ctx.strokeStyle='rgba(130,170,205,.18)'; ctx.fillStyle='#c5d8eb';
  for(let i=0;i<=5;i++){const v=min+(max-min)*i/5;const xx=x(v),yy=y(v);ctx.beginPath();ctx.moveTo(xx,T);ctx.lineTo(xx,T+ph);ctx.stroke();ctx.beginPath();ctx.moveTo(L,yy);ctx.lineTo(L+pw,yy);ctx.stroke();ctx.textAlign='center';ctx.fillText(v.toFixed(1),xx,T+ph+18);ctx.textAlign='right';ctx.fillText(v.toFixed(1),L-9,yy+4);}
  ctx.setLineDash([7,6]);ctx.strokeStyle='#e5edf7';ctx.lineWidth=1.6;ctx.beginPath();ctx.moveTo(x(min),y(min));ctx.lineTo(x(max),y(max));ctx.stroke();ctx.setLineDash([]);
  const vals=pts.map(p=>[Number(p.actual),Number(p.predicted)]).filter(p=>p.every(Number.isFinite));
  const n=vals.length, mx=vals.reduce((s,p)=>s+p[0],0)/n, my=vals.reduce((s,p)=>s+p[1],0)/n;
  const slope=vals.reduce((s,p)=>s+(p[0]-mx)*(p[1]-my),0)/(vals.reduce((s,p)=>s+(p[0]-mx)**2,0)||1); const intercept=my-slope*mx;
  ctx.strokeStyle='#19e2e2';ctx.lineWidth=2.5;ctx.beginPath();ctx.moveTo(x(min),y(intercept+slope*min));ctx.lineTo(x(max),y(intercept+slope*max));ctx.stroke();
  vals.forEach(p=>{ctx.beginPath();ctx.arc(x(p[0]),y(p[1]),2.7,0,Math.PI*2);ctx.fillStyle='rgba(35,190,235,.78)';ctx.fill();});
  if(userPred!==undefined){
  const yp=y(userPred), xp=x(userPred);
  // dashed guide lines from the point to both axes so the value can be read off
  ctx.setLineDash([5,4]);ctx.strokeStyle='rgba(255,209,106,.8)';ctx.lineWidth=1.3;
  ctx.beginPath();ctx.moveTo(L,yp);ctx.lineTo(xp,yp);ctx.stroke();
  ctx.beginPath();ctx.moveTo(xp,yp);ctx.lineTo(xp,T+ph);ctx.stroke();
  ctx.setLineDash([]);
  // highlighted point: soft halo, solid marker, dark outline
  ctx.beginPath();ctx.arc(xp,yp,12,0,Math.PI*2);ctx.fillStyle='rgba(255,209,106,.25)';ctx.fill();
  ctx.beginPath();ctx.arc(xp,yp,6.5,0,Math.PI*2);ctx.fillStyle='#ffd16a';ctx.fill();
  ctx.strokeStyle='#041329';ctx.lineWidth=2;ctx.stroke();
  // label, flipped to the left side when near the right edge
  const label='Your prediction: '+userPred.toFixed(3);
  ctx.font='700 12px Inter,Arial';
  const nearRight = xp > L+pw*0.6;
  ctx.textAlign = nearRight ? 'right' : 'left';
  ctx.fillStyle='#ffd16a';
  ctx.fillText(label, nearRight ? xp-16 : xp+16, yp-12);
}
ctx.fillStyle='#f4f8ff';ctx.font='600 12px Inter,Arial';ctx.textAlign='center';ctx.fillText(activeDataset==='davis'?'Experimental affinity (pKd)':'Experimental affinity (KIBA score)',L+pw/2,h-5);
  ctx.save();ctx.translate(14,T+ph/2);ctx.rotate(-Math.PI/2);ctx.fillText('Predicted affinity',0,0);ctx.restore();
}
window.addEventListener('resize',drawChart);

(function init(){
  loadInputExamples();
})();
