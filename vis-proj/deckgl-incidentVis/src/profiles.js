import {escapeHtml as esc} from './details.js';
let controller,sequence=0,lastKey='',selectionKey='',cached,forceRequested=false;
export async function renderProfiles({cells,active,onProfile,onReset}){
 let root=document.getElementById('learned-profiles');
 if(!root){root=document.createElement('section');root.id='learned-profiles';root.className='panel';document.querySelector('#analysis .grid').after(root);}
 if(!cells.length)return;
 const heading=(busy=false)=>`<div class="profile-heading"><h2>Patterns in this selection</h2><button type="button" data-profile-rerun ${busy?'disabled':''}>${busy?'Analysing...':'Rerun analysis'}</button></div>`;
 const selection=JSON.stringify(cells.map(c=>[...c.ids].sort()));
 if(selectionKey&&selection!==selectionKey&&active?.startsWith('Local profile: ')){selectionKey=selection;controller?.abort();sequence++;onReset();return;}
 selectionKey=selection;
 const key=JSON.stringify(cells),seq=++sequence;
 controller?.abort();controller=new AbortController();
 try{
  let data=cached;
  if(key!==lastKey){
   root.innerHTML=heading(true)+'<div class="profile-loading" role="status" aria-live="polite"><span class="profile-spinner" aria-hidden="true"></span><div><b>Finding patterns in your selection</b><p>Checking which groups are reliable. You can keep using the map and charts.</p></div></div>';
   await new Promise(resolve=>setTimeout(resolve,300));
   if(seq!==sequence)return;
   const response=await fetch(`${import.meta.env.VITE_PROFILE_API||'http://127.0.0.1:8001'}/profiles`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cells,force:Boolean(forceRequested),requestId:forceRequested||undefined}),signal:controller.signal});
   if(!response.ok)throw new Error('Backend unavailable');data=await response.json();
  }
  if(seq!==sequence)return;lastKey=key;cached=data;forceRequested=false;
  if(data.status!=='ready'){root.innerHTML=`${heading()}<p>${data.selectedCount} matching collisions · ${esc(data.reason)}</p>`;return;}
  root.innerHTML=`${heading()}<p>${data.labels.length} groups learned from these ${data.selectedCount} collisions. Click a row to highlight; click again to clear.</p><details class="profile-method"><summary>Why ${data.labels.length} groups?</summary><p>We tested two to five groups and selected a simple, stable result. More groups are kept only when they remain distinct and sufficiently supported. This number can change with your selection.</p></details><div style="overflow-x:auto"><table class="profile-table"><thead><tr><th>Common characteristics</th>${data.cells.map(c=>`<th>${esc(c.label)}<small>${c.total} matching collisions</small></th>`).join('')}</tr></thead><tbody>${data.labels.map((label,i)=>`<tr><th><button aria-pressed="${active===`Local profile: ${label}`}" data-profile="${i}">${esc(label)}<small>${data.descriptions[i].map(d=>`${esc(d.label)}: ${d.percent}%`).join(' · ')}</small></button></th>${data.cells.map(c=>{const g=c.groups[i],pct=g.n?Math.round(100*g.severe/g.n):null;return `<td><button data-profile="${i}" title="${g.severe} serious/fatal of ${g.n}; ${g.uncertain} have an uncertain profile assignment"><b>${g.n} collisions</b><span class="profile-track"><i style="width:${100*g.n/Math.max(1,...data.cells.flatMap(cell=>cell.groups.map(group=>group.n)))}%"></i></span><small>${pct===null?'No records':`${pct}% serious / fatal`}${g.n>0&&g.n<10?' · Few records':''}${g.uncertain?' · Some mixed profiles':''}</small></button></td>`;}).join('')}</tr>`).join('')}</tbody></table></div><p class="profile-note">Groups are learned jointly for this comparison. Characteristics are typical, not exact rules. Bar length compares collision counts on the same scale. Severity is observed, not predicted. Small samples and uncertain assignments need care.</p>`;
  root.querySelectorAll('[data-profile]').forEach(b=>b.onclick=()=>{const i=+b.dataset.profile;onProfile(`Local profile: ${data.labels[i]}`,new Set(data.members[i]));});
 }catch(e){if(e.name==='AbortError'||seq!==sequence)return;lastKey='';root.innerHTML=heading()+'<p role="alert">Analysis could not be loaded. Check that the backend is running, then rerun the analysis.</p>';}
 finally{if(seq===sequence){const button=root.querySelector('[data-profile-rerun]');if(button&&!button.disabled)button.onclick=()=>{forceRequested=crypto.randomUUID();lastKey='';if(active?.startsWith('Local profile: '))onReset();else renderProfiles({cells,active,onProfile,onReset});};}}
}
