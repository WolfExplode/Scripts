"use strict";
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const uid=()=>Math.random().toString(36).slice(2,10);
const TILE_SIZE=96;
const icon=name=>`<svg class="icon" aria-hidden="true" focusable="false"><use href="#icon-${name}"></use></svg>`;
const movementArrow=direction=>`<svg class="movement-arrow ${direction}" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path d="M5 31 24 17l19 14"/></svg>`;
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* TierMaker's stock row palette, indexed by the colour number in templateCode */
const TM_COLORS=['#ff7f7f','#ffbf7f','#ffdf7f','#ffff7f','#bfff7f','#7fff7f','#7fffff','#7fbfff','#7f7fff','#ff7fff'];
const DEFAULT_TIERS=[['S','#ff7f7f'],['A','#ffbf7f'],['B','#ffdf7f'],['C','#ffff7f'],['D','#bfff7f'],['F','#7fff7f']];

/* ============================ STATE ============================ */
let S=null, sel=new Set(), lastClicked=null, undoStack=[], compareSubBoardId=null, comparisonState=null,
  draggedSubBoardId=null;

function blankState(){
  return {v:1,title:'Untitled Tier List',source:'',
    tiers:DEFAULT_TIERS.map(([l,c])=>({id:uid(),label:l,color:c,items:[]})),
    pool:[],items:{},opts:{labels:'find'}};
}
function layoutFromState(){
  return {tiers:S.tiers.map(t=>({id:t.id,items:[...t.items]})),pool:[...S.pool]};
}
function activeSubBoard(){
  return S.subBoards?.find(b=>b.id===S.activeSubBoardId)||S.subBoards?.[0];
}
function storeActiveSubBoard(){
  const sub=activeSubBoard(); if(sub)sub.layout=layoutFromState();
}
function applySubBoardLayout(layout){
  const placements=new Map((layout?.tiers||[]).map(t=>[t.id,t.items||[]]));
  const seen=new Set();
  const valid=ids=>ids.filter(id=>S.items[id]&&!seen.has(id)&&(seen.add(id),true));
  S.tiers.forEach(t=>{ t.items=valid(placements.get(t.id)||[]); });
  S.pool=valid(layout?.pool||[]);
  Object.keys(S.items).forEach(id=>{ if(!seen.has(id))S.pool.push(id); });
}
function ensureSubBoards(){
  if(!Array.isArray(S.subBoards)||!S.subBoards.length){
    S.subBoards=[{id:uid(),name:'Main',layout:layoutFromState()}];
  }
  S.subBoards=S.subBoards.map((sub,i)=>({
    id:sub.id||uid(),name:String(sub.name||`Alternative ${i+1}`),layout:sub.layout||layoutFromState(),
    compareSubBoardId:sub.compareSubBoardId||null
  }));
  S.subBoards.forEach(sub=>{
    if(sub.compareSubBoardId===sub.id||!S.subBoards.some(other=>other.id===sub.compareSubBoardId)){
      sub.compareSubBoardId=null;
    }
  });
  if(!S.subBoards.some(sub=>sub.id===S.activeSubBoardId))S.activeSubBoardId=S.subBoards[0].id;
}
function prepareState(){
  if(!S||!S.tiers)S=blankState();
  S.opts=Object.assign({labels:'find'},S.opts||{}); delete S.opts.size;
  ensureSubBoards(); compareSubBoardId=activeSubBoard().compareSubBoardId||null;
  applySubBoardLayout(activeSubBoard().layout);
}
function applyTitleWidth(){
  const width=Number(S.opts?.titleWidth);
  if(Number.isFinite(width)&&width>=220)document.documentElement.style.setProperty('--title-width',`${width}px`);
  else document.documentElement.style.removeProperty('--title-width');
}
function renderSubBoards(){
  const tabs=$('#subboardTabs'); if(!tabs)return;
  compareSubBoardId=activeSubBoard().compareSubBoardId||null;
  tabs.replaceChildren(...S.subBoards.map(sub=>{
    const tab=document.createElement('div');
    const isCompared=sub.id===S.activeSubBoardId&&compareSubBoardId;
    tab.className='subboard-tab'+(sub.id===S.activeSubBoardId?' active':'')+(isCompared?' comparing':'');
    tab.draggable=true; tab.dataset.subboardDrop=sub.id;
    const name=document.createElement('button');
    name.className='subboard-name'; name.dataset.subboard=sub.id; name.setAttribute('role','tab');
    name.setAttribute('aria-selected',String(sub.id===S.activeSubBoardId));
    name.title='Click to switch · Double-click to rename'; name.textContent=sub.name;
    const remove=document.createElement('button');
    remove.className='subboard-delete'; remove.dataset.deleteSubboard=sub.id;
    remove.title='Delete sub-board'; remove.setAttribute('aria-label',`Delete ${sub.name}`); remove.textContent='×';
    tab.append(name,remove);
    if(isCompared){
      const other=S.subBoards.find(item=>item.id===compareSubBoardId);
      const chip=document.createElement('button');
      chip.className='subboard-compare'; chip.dataset.clearComparison='1'; chip.type='button';
      chip.title='Click to stop comparing'; chip.setAttribute('aria-label',`Stop comparing with ${other.name}`);
      chip.textContent=other.name; tab.appendChild(chip);
    }
    tab.addEventListener('dragstart',e=>{
      draggedSubBoardId=sub.id;
      e.dataTransfer.effectAllowed='link'; e.dataTransfer.setData('text/plain',sub.id);
      tab.classList.add('dragging-tab');
    });
    tab.addEventListener('dragend',()=>{ draggedSubBoardId=null;
      $$('.compare-drop-over,.dragging-tab',tabs).forEach(node=>node.classList.remove('compare-drop-over','dragging-tab'));
    });
    tab.addEventListener('dragover',e=>{
      const source=draggedSubBoardId||e.dataTransfer.getData('text/plain');
      if(source&&source!==sub.id){ e.preventDefault(); e.dataTransfer.dropEffect='link'; tab.classList.add('compare-drop-over'); }
    });
    tab.addEventListener('dragleave',e=>{ if(!tab.contains(e.relatedTarget))tab.classList.remove('compare-drop-over'); });
    tab.addEventListener('drop',e=>{
      e.preventDefault(); tab.classList.remove('compare-drop-over');
      const source=draggedSubBoardId||e.dataTransfer.getData('text/plain');
      if(source&&source!==sub.id)compareSubBoards(sub.id,source);
    });
    return tab;
  }),Object.assign(document.createElement('button'),{
    className:'icon-button subboard-add',type:'button',title:'Add sub-board',ariaLabel:'Add sub-board',
    innerHTML:icon('plus')
  }));
}
function placementPositions(layout){
  const positions=new Map(), seen=new Set();
  const add=(id,tier,index)=>{
    if(S.items[id]&&!seen.has(id)){ seen.add(id); positions.set(id,{tier,index}); }
  };
  (layout?.tiers||[]).forEach((tier,tierIndex)=>(tier.items||[])
    .forEach((id,index)=>add(id,tierIndex,index)));
  (layout?.pool||[]).forEach((id,index)=>add(id,S.tiers.length,index));
  // An item omitted from an older layout is, like an item in its pool, unranked.
  Object.keys(S.items).forEach((id,index)=>{ if(!positions.has(id))positions.set(id,{tier:S.tiers.length,index}); });
  return positions;
}
function sharedPeerCrossings(id,current,target,currentPositions,targetPositions){
  let ahead=0, behind=0;
  currentPositions.forEach((peer,peerId)=>{
    if(peerId===id||peer.tier!==current.tier)return;
    const otherPeer=targetPositions.get(peerId);
    if(!otherPeer||otherPeer.tier!==target.tier)return;
    const peerWasBefore=peer.index<current.index;
    const peerIsBefore=otherPeer.index<target.index;
    if(peerWasBefore===peerIsBefore)return;
    if(peerWasBefore)ahead++;
    else behind++;
  });
  return {ahead,behind};
}
function comparisonFor(id){
  if(!compareSubBoardId)return null;
  const other=S.subBoards.find(sub=>sub.id===compareSubBoardId);
  if(!other)return null;
  if(!comparisonState||comparisonState.otherId!==other.id){
    comparisonState={otherId:other.id,current:placementPositions(layoutFromState()),target:placementPositions(other.layout)};
  }
  const current=comparisonState.current.get(id);
  const target=comparisonState.target.get(id);
  if(!current||!target)return null;
  const currentRanked=current.tier<S.tiers.length;
  const targetRanked=target.tier<S.tiers.length;
  // The pool is a categorical "unranked" state, not an extra tier. A move
  // into or out of it should not be reported as a numeric tier change.
  if(currentRanked!==targetRanked){
    return {rankStatusChange:targetRanked?'ranked':'unranked',other};
  }
  if(!currentRanked)return null;
  const tierPlaces=current.tier-target.tier;
  // Crossing tiers already has a vertical result. Comparing row indexes as
  // well would mix two different kinds of movement.
  if(tierPlaces)return {tierPlaces,positionPlaces:0,other};
  // Within a tier, count only shared peers whose ordering relative to this item
  // actually changed. Board-specific items do not create artificial shifts.
  const {ahead,behind}=sharedPeerCrossings(id,current,target,
    comparisonState.current,comparisonState.target);
  if(!ahead&&!behind)return null;
  if(ahead&&behind)return {tierPlaces:0,positionPlaces:0,movedAhead:ahead,movedBehind:behind,other};
  return {tierPlaces:0,positionPlaces:ahead||-behind,movedAhead:ahead,movedBehind:behind,other};
}
function snapshot(){ storeActiveSubBoard(); undoStack.push(JSON.stringify(S)); if(undoStack.length>40)undoStack.shift(); }
function undo(){ if(!undoStack.length)return toast('Nothing to undo');
  S=JSON.parse(undoStack.pop()); prepareState(); sel.clear(); render(); toast('Undone'); }

/* list helpers -------------------------------------------------- */
const listOf=ref=> ref==='pool' ? S.pool : (S.tiers.find(t=>t.id===ref)||{items:[]}).items;
function removeIds(ids){ const set=new Set(ids);
  S.pool=S.pool.filter(i=>!set.has(i));
  S.tiers.forEach(t=>t.items=t.items.filter(i=>!set.has(i))); }
function completeLayout(layout){
  const placements=new Map((layout?.tiers||[]).map(t=>[t.id,t.items||[]]));
  const seen=new Set();
  const valid=ids=>(ids||[]).filter(id=>S.items[id]&&!seen.has(id)&&(seen.add(id),true));
  const complete={tiers:S.tiers.map(t=>({id:t.id,items:valid(placements.get(t.id))})),
    pool:valid(layout?.pool)};
  Object.keys(S.items).forEach(id=>{ if(!seen.has(id))complete.pool.push(id); });
  return complete;
}
function moveToDestinationInLayout(layout,ids,ref,beforeId){
  const lists=[...(layout.tiers||[]).map(t=>t.items),layout.pool];
  const destination=ref==='pool'?layout.pool:layout.tiers.find(t=>t.id===ref)?.items;
  if(!destination)return false;
  const moving=new Set(ids);
  lists.forEach(list=>{ for(let i=list.length-1;i>=0;i--)if(moving.has(list[i]))list.splice(i,1); });
  const at=beforeId&&!moving.has(beforeId)?destination.indexOf(beforeId):-1;
  destination.splice(at<0?destination.length:at,0,...ids);
  return true;
}
function moveItems(ids,ref,beforeId,syncSubBoards=false){
  ids=ids.filter(i=>S.items[i]); if(!ids.length)return;
  snapshot();
  if(syncSubBoards){
    let synced=0;
    S.subBoards.forEach(sub=>{
      sub.layout=completeLayout(sub.layout);
      if(moveToDestinationInLayout(sub.layout,ids,ref,beforeId))synced++;
    });
    applySubBoardLayout(activeSubBoard().layout);
    persist(); render();
    toast(`Moved on ${synced} sub-board${synced===1?'':'s'}`);
    return;
  }
  removeIds(ids);
  const L=listOf(ref); let at=beforeId?L.indexOf(beforeId):-1;
  if(at<0)at=L.length; L.splice(at,0,...ids); persist(); render();
}
function tierOf(id){ const t=S.tiers.find(t=>t.items.includes(id)); return t?t.label:''; }

/* ============================ SEARCH ============================ */
function parseQuery(q){
  const terms=[]; const re=/(-?)(?:(\w+):)?(?:"([^"]*)"|(\S+))/g; let m;
  while((m=re.exec(q))){ const val=(m[3]??m[4]??'').toLowerCase(); if(!val)continue;
    terms.push({neg:m[1]==='-',field:(m[2]||'').toLowerCase(),val}); }
  return terms;
}
function haystack(it){
  return {any:[it.name,(it.tags||[]).join(' '),it.notes||'',tierOf(it.id)].join(' ').toLowerCase(),
    name:(it.name||'').toLowerCase(), tag:(it.tags||[]).join(' ').toLowerCase(),
    note:(it.notes||'').toLowerCase(), tier:tierOf(it.id).toLowerCase()};
}
function matches(it,terms){
  if(!terms.length)return true; const h=haystack(it);
  return terms.every(t=>{ const f=(t.field&&h[t.field]!==undefined)?h[t.field]:h.any;
    const hit=f.includes(t.val); return t.neg?!hit:hit; });
}
function applyFilter(){
  const q=$('#q').value.trim(), terms=parseQuery(q); let hits=0;
  $$('.item').forEach(el=>{ const it=S.items[el.dataset.id]; if(!it)return;
    const ok=matches(it,terms); if(ok)hits++;
    el.classList.toggle('dim',!!q&&!ok); el.classList.toggle('hit',!!q&&ok); });
  $('#qcount').textContent=q?`${hits} match${hits===1?'':'es'}`:'';
  $('#btnClearSearch').hidden=!q;
}

/* ============================ RENDER ============================ */
function itemNode(id){
  const it=S.items[id]; if(!it)return document.createComment('missing');
  const el=document.createElement('div');
  const comparison=comparisonFor(id);
  el.className='item'+(sel.has(id)?' sel':'')+(it.notes?' hasnote':'')+(comparison?' compared':'');
  el.dataset.id=id; el.draggable=false;
  const tierShift=Math.abs(comparison?.tierPlaces||0), positionShift=Math.abs(comparison?.positionPlaces||0);
  const reorderedAhead=comparison?.movedAhead&&comparison?.movedBehind?comparison.movedAhead:0;
  const reorderedBehind=reorderedAhead?comparison.movedBehind:0;
  const reorderedShift=reorderedAhead+reorderedBehind;
  const statusChange=comparison?.rankStatusChange||null;
  const tierDirection=comparison?.tierPlaces>0?'up':'down';
  const positionDirection=comparison?.positionPlaces>0?'left':'right';
  const statusDirection=statusChange==='ranked'?'up':'down';
  const changes=[];
  if(statusChange)changes.push(statusChange==='ranked'
    ?`${comparison.other.name} ranks this item`
    :`Unranked on ${comparison.other.name}`);
  if(tierShift)changes.push(`${comparison.other.name} ranks this ${tierShift} tier${tierShift===1?'':'s'} ${tierDirection==='up'?'higher':'lower'}`);
  if(reorderedShift)changes.push(`${comparison.other.name} moves this ahead of ${reorderedAhead} shared item${reorderedAhead===1?'':'s'} and behind ${reorderedBehind} shared item${reorderedBehind===1?'':'s'}`);
  else if(positionShift)changes.push(`${comparison.other.name} moves this ${positionDirection==='left'?'ahead of':'behind'} ${positionShift} shared item${positionShift===1?'':'s'}`);
  el.title=it.name+(it.notes?'\n'+it.notes:'')+(changes.length?`\n${changes.join('\n')}`:'');
  const meta=[(it.tags||[]).join(', '),it.notes||''].filter(Boolean).join(' · ');
  el.innerHTML=(it.img?`<img src="${esc(it.img)}" alt="${esc(it.name)}" loading="lazy"
      onerror="this.style.display='none';this.parentNode.classList.add('noimg')">`:'')
    +`<span class="badge">●</span>`
    +(statusChange?`<span class="rank-shift vertical status ${statusDirection}" aria-label="${esc(changes[0])}">${movementArrow(statusDirection)}<b>${statusChange==='ranked'?'R':'U'}</b></span>`:'')
    +(tierShift?`<span class="rank-shift vertical ${tierDirection}" aria-label="${esc(changes[0])}">${movementArrow(tierDirection)}<b>${tierShift}</b></span>`:'')
    +(reorderedShift?`<span class="rank-shift horizontal reordered" aria-label="${esc(changes[changes.length-1])}"><b>↔${reorderedShift}</b></span>`:'')
    +(positionShift?`<span class="rank-shift horizontal ${positionDirection}" aria-label="${esc(changes[changes.length-1])}">${movementArrow(positionDirection)}<b>${positionShift}</b></span>`:'')
    +`<span class="cap">${esc(it.name)}${meta?`<span class="meta"> — ${esc(meta)}</span>`:''}</span>`;
  if(!it.img) el.style.cssText+='background:#2a3040;display:flex;align-items:center;justify-content:center';
  return el;
}
function fillDrop(node,ids){ const f=document.createDocumentFragment();
  ids.forEach(id=>f.appendChild(itemNode(id))); node.replaceChildren(f); }

function render(){
  ensureSubBoards(); renderSubBoards(); comparisonState=null;
  document.body.className='lab-'+S.opts.labels;
  applyTitleWidth();
  $('#title').value=S.title; $('#labmode').value=S.opts.labels;

  const board=$('#board'); board.replaceChildren();
  S.tiers.forEach((t,i)=>{
    const row=document.createElement('div'); row.className='tier'; row.dataset.tier=t.id;
    row.innerHTML=`
      <div class="tlabel" style="background:${esc(t.color)}">
        ${i<9?`<span class="hot">${i+1}</span>`:''}
        <div class="txt" contenteditable="plaintext-only" spellcheck="false">${esc(t.label)}</div>
        <div class="cnt">${t.items.length}</div>
        <div class="tools">
          <button class="icon-button" data-act="color" title="Change colour" aria-label="Change colour">${icon('palette')}</button>
          <button class="icon-button" data-act="up" title="Move tier up" aria-label="Move tier up">${icon('chevron-up')}</button>
          <button class="icon-button" data-act="down" title="Move tier down" aria-label="Move tier down">${icon('chevron-down')}</button>
          <button class="icon-button" data-act="clear" title="Empty this tier" aria-label="Empty this tier">${icon('archive-down')}</button>
          <button class="icon-button danger" data-act="del" title="Delete tier" aria-label="Delete tier">${icon('trash')}</button>
        </div>
      </div>
      <div class="drop" data-list="${t.id}"></div>`;
    fillDrop($('.drop',row),t.items); board.appendChild(row);
  });
  const tierActions=document.createElement('div');
  tierActions.className='tier-actions';
  tierActions.innerHTML='<button id="btnAddTier" class="add-tier">+ Add tier</button>'
    +'<button id="btnRegenerateTierColors" class="add-tier icon-button" title="Generate a new tier color palette" aria-label="Generate a new tier color palette">'
    +icon('palette')+'</button>';
  board.appendChild(tierActions);
  fillDrop($('#pool'),S.pool);
  $('#poolcount').textContent=`${S.pool.length} item${S.pool.length===1?'':'s'}`;
  const total=Object.keys(S.items).length;
  $('#stat').textContent=`${total} items · ${S.tiers.length} tiers · ${total-S.pool.length} ranked`;
  $('#selinfo').textContent=sel.size?`${sel.size} selected`:'';
  applyFilter();
}

/* ============================ SELECTION ============================ */
function setSel(ids){ sel=new Set(ids); syncSel(); }
function syncSel(){ $$('.item').forEach(e=>e.classList.toggle('sel',sel.has(e.dataset.id)));
  $('#selinfo').textContent=sel.size?`${sel.size} selected`:''; }
function flatOrder(){ return [...S.tiers.flatMap(t=>t.items),...S.pool]; }

/* ============================ EVENTS: board ============================ */
document.addEventListener('click',e=>{
  if(e.target.closest('#btnAddTier')){ addTier(); return; }
  if(e.target.closest('#btnRegenerateTierColors')){ regenerateTierColors(); return; }
  const tool=e.target.closest('.tools button');
  if(tool){ const tid=tool.closest('.tier').dataset.tier; tierAction(tid,tool.dataset.act); return; }
  const it=e.target.closest('.item');
  if(it){ const id=it.dataset.id;
    if(e.shiftKey&&lastClicked){ const ord=flatOrder(); const a=ord.indexOf(lastClicked),b=ord.indexOf(id);
      if(a>=0&&b>=0) ord.slice(Math.min(a,b),Math.max(a,b)+1).forEach(x=>sel.add(x)); }
    else if(e.ctrlKey||e.metaKey){ sel.has(id)?sel.delete(id):sel.add(id); lastClicked=id; }
    else { const only=sel.size===1&&sel.has(id); sel.clear(); if(!only)sel.add(id); lastClicked=id; }
    syncSel(); return; }
  if(!e.target.closest('#insp')&&!e.target.closest('header')&&!e.target.closest('dialog')){
    if(e.target.closest('main')&&!e.target.closest('.tlabel')){ sel.clear(); syncSel(); closeInsp(); } }
});
document.addEventListener('dblclick',e=>{ const tab=e.target.closest('[data-subboard]');
  if(tab){ startInlineSubBoardRename(tab); return; }
  const it=e.target.closest('.item'); if(it)openInsp(it.dataset.id); });

function tierAction(tid,act){
  const i=S.tiers.findIndex(t=>t.id===tid), t=S.tiers[i]; if(!t)return; snapshot();
  if(act==='del'){ S.pool.push(...t.items); S.tiers.splice(i,1); }
  else if(act==='clear'){ S.pool.push(...t.items); t.items=[]; }
  else if(act==='up'&&i>0){ S.tiers.splice(i-1,0,S.tiers.splice(i,1)[0]); }
  else if(act==='down'&&i<S.tiers.length-1){ S.tiers.splice(i+1,0,S.tiers.splice(i,1)[0]); }
  else if(act==='color'){ const inp=document.createElement('input'); inp.type='color'; inp.value=t.color;
    inp.oninput=()=>{ t.color=inp.value; $(`.tier[data-tier="${tid}"] .tlabel`).style.background=inp.value; };
    inp.onchange=()=>{ persist(); }; inp.click(); return; }
  persist(); render();
}
document.addEventListener('input',e=>{ if(e.target.classList.contains('txt')){
  const tid=e.target.closest('.tier').dataset.tier;
  const t=S.tiers.find(t=>t.id===tid); if(t){ t.label=e.target.textContent.trim(); persist(); } }});

/* ============================ DRAG & DROP ============================ */
let dragIds=[], dragPreview=null, dropPlaceholders=[], dragBeforeId=null, dragTarget=null,
  heldItemPress=null, dragClientX=0, dragClientY=0, suppressItemClick=false,
  cancelledItemDrag=false;
const SNAP_HOLD_RATIO=.18;
const DRAG_START_DISTANCE=4;

function beginDragPreview(item,e,count){
  const rect=item.getBoundingClientRect(), baseWidth=item.offsetWidth||TILE_SIZE;
  dragPreview=item.cloneNode(true);
  dragPreview.className='item drag-preview';
  dragPreview.setAttribute('aria-hidden','true');
  dragPreview.removeAttribute('draggable');
  dragPreview.removeAttribute('data-id');
  dragPreview.style.width=rect.width+'px'; dragPreview.style.height=rect.height+'px';
  dragPreview.style.setProperty('--drag-scale',rect.width/baseWidth);
  dragPreview.dataset.count=count>1?String(count):'';
  dragPreview._offsetX=Math.max(0,Math.min(rect.width,e.clientX-rect.left));
  dragPreview._offsetY=Math.max(0,Math.min(rect.height,e.clientY-rect.top));
  document.body.appendChild(dragPreview); moveDragPreview(e.clientX,e.clientY);
}
function moveDragPreview(x,y){
  if(!dragPreview||(!x&&!y))return;
  dragPreview.style.left=(x-dragPreview._offsetX)+'px';
  dragPreview.style.top=(y-dragPreview._offsetY)+'px';
}
function clearDrag(){
  dragIds=[]; dragBeforeId=null; dragTarget=null; dragPreview?.remove(); dragPreview=null;
  dropPlaceholders.forEach(slot=>slot.remove()); dropPlaceholders=[];
  document.body.classList.remove('card-dragging');
  $$('.dragging').forEach(el=>el.classList.remove('dragging'));
  $$('.drop.over').forEach(el=>el.classList.remove('over'));
}
function cancelItemDrag(){
  if(!dragIds.length)return false;
  heldItemPress=null; cancelledItemDrag=true; suppressItemClick=true; clearDrag();
  return true;
}

/* Find a position in a wrapped flex grid. Horizontal position chooses a slot in
   the nearest visual row; passing the final tile advances to the next row. */
function placementAt(cont,x,y){
  const entries=$$('.item',cont).filter(el=>!el.classList.contains('dragging'))
    .map(el=>({el,rect:el.getBoundingClientRect()}));
  if(!entries.length)return {beforeId:null,anchor:null,empty:true};
  const rows=[];
  for(const entry of entries){
    let row=rows.at(-1);
    if(!row||Math.abs(entry.rect.top-row.top)>Math.max(4,entry.rect.height*.25)){
      row={top:entry.rect.top,bottom:entry.rect.bottom,items:[]}; rows.push(row);
    }
    row.items.push(entry); row.top=Math.min(row.top,entry.rect.top);
    row.bottom=Math.max(row.bottom,entry.rect.bottom);
  }
  if(y>rows.at(-1).bottom)return {beforeId:null,anchor:entries.at(-1),empty:false};
  let rowIndex=0, best=Infinity;
  rows.forEach((row,i)=>{ const distance=y<row.top?row.top-y:y>row.bottom?y-row.bottom:0;
    if(distance<best){best=distance;rowIndex=i;} });
  const row=rows[rowIndex];
  const before=row.items.find(entry=>x<entry.rect.left+entry.rect.width/2);
  if(before)return {beforeId:before.el.dataset.id,anchor:before,empty:false};
  const next=rows[rowIndex+1]?.items[0];
  return next?{beforeId:next.el.dataset.id,anchor:next,empty:false}
    :{beforeId:null,anchor:row.items.at(-1),empty:false};
}
function ensureDropPlaceholders(){
  if(dropPlaceholders.length)return;
  dropPlaceholders=dragIds.map(()=>{ const slot=document.createElement('div');
    slot.className='drop-placeholder'; slot.setAttribute('aria-hidden','true'); return slot; });
}
function seedDropPlaceholders(item,selected){
  ensureDropPlaceholders();
  const source=item.closest('.drop'), sourceItems=$$('.item',source);
  const next=sourceItems.slice(sourceItems.indexOf(item)+1)
    .find(el=>!selected.has(el.dataset.id));
  dragBeforeId=next?.dataset.id||null; dragTarget=source;
  dragIds.forEach((id,index)=>{
    const sourceItem=$$('.item').find(el=>el.dataset.id===id);
    if(sourceItem)sourceItem.before(dropPlaceholders[index]);
  });
}
function pointerInHeldSlot(cont,x,y){
  if(dragTarget!==cont)return false;
  return dropPlaceholders.some(slot=>{ if(slot.parentElement!==cont)return false;
    const rect=slot.getBoundingClientRect();
    const margin=Math.min(rect.width,rect.height)*SNAP_HOLD_RATIO;
    return x>=rect.left-margin&&x<=rect.right+margin&&y>=rect.top-margin&&y<=rect.bottom+margin;
  });
}
function placeDropPlaceholders(cont,placement){
  ensureDropPlaceholders();
  if(placement.empty||!placement.beforeId) cont.append(...dropPlaceholders);
  else placement.anchor.el.before(...dropPlaceholders);
}

function beginItemDrag(item,startX,startY,x,y){
  const id=item.dataset.id;
  if(!sel.has(id)){sel.clear();sel.add(id);syncSel();}
  const selected=new Set(sel);
  dragIds=flatOrder().filter(itemId=>selected.has(itemId));
  beginDragPreview(item,{clientX:startX,clientY:startY},dragIds.length);
  moveDragPreview(x,y); document.body.classList.add('card-dragging');
  requestAnimationFrame(()=>{
    seedDropPlaceholders(item,selected);
    dragIds.forEach(itemId=>$(`.item[data-id="${itemId}"]`)?.classList.add('dragging'));
    updateHeldItemDrag(x,y);
  });
}
function dropAtPoint(x,y,ctrlKey=false,metaKey=false){
  const d=document.elementFromPoint(x,y)?.closest('.drop');
  if(!d||!dragIds.length){ clearDrag(); return; }
  const ids=[...dragIds], destination=d.dataset.list;
  const beforeId=placementAt(d,x,y).beforeId;
  const syncSubBoards=ctrlKey||metaKey;
  clearDrag(); moveItems(ids,destination,beforeId,syncSubBoards);
}
function updateHeldItemDrag(x=dragClientX,y=dragClientY){
  if(!dragIds.length)return;
  dragClientX=x; dragClientY=y; moveDragPreview(x,y);
  const d=document.elementFromPoint(x,y)?.closest('.drop');
  if(!d){ $$('.drop.over').forEach(el=>el.classList.remove('over')); return; }
  $$('.drop.over').forEach(el=>el!==d&&el.classList.remove('over')); d.classList.add('over');
  if(pointerInHeldSlot(d,x,y))return;
  const placement=placementAt(d,x,y);
  dragBeforeId=placement.beforeId; dragTarget=d; placeDropPlaceholders(d,placement);
}

// Item dragging stays in normal mouse mode so wheel zoom and a chorded middle
// button remain available while the primary button continues to hold the item.
document.addEventListener('mousedown',e=>{
  if(e.button!==0)return;
  const item=e.target.closest('.item');
  if(item)heldItemPress={item,startX:e.clientX,startY:e.clientY};
});
window.addEventListener('mousemove',e=>{
  if(!heldItemPress)return;
  if(!(e.buttons&1)){ heldItemPress=null; if(dragIds.length)clearDrag(); return; }
  if(!dragIds.length&&Math.hypot(e.clientX-heldItemPress.startX,e.clientY-heldItemPress.startY)>=DRAG_START_DISTANCE){
    beginItemDrag(heldItemPress.item,heldItemPress.startX,heldItemPress.startY,e.clientX,e.clientY);
  }else if(dragIds.length)updateHeldItemDrag(e.clientX,e.clientY);
});
window.addEventListener('mouseup',e=>{
  if(e.button!==0)return;
  if(cancelledItemDrag){ cancelledItemDrag=false; e.preventDefault();
    setTimeout(()=>{ suppressItemClick=false; },0); return; }
  if(!heldItemPress)return;
  const wasDragging=!!dragIds.length;
  heldItemPress=null;
  if(wasDragging){ e.preventDefault(); suppressItemClick=true;
    dropAtPoint(e.clientX,e.clientY,e.ctrlKey,e.metaKey);
    setTimeout(()=>{ suppressItemClick=false; },0); }
});
window.addEventListener('blur',()=>{ heldItemPress=null; cancelledItemDrag=false; suppressItemClick=false;
  if(dragIds.length)clearDrag(); });
document.addEventListener('click',e=>{
  if(!suppressItemClick)return;
  suppressItemClick=false; e.preventDefault(); e.stopImmediatePropagation();
},true);

/* ============================ KEYBOARD ============================ */
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&cancelItemDrag()){ e.preventDefault(); return; }
  if(e.key==='Escape'&&!$('#settingsMenu').hidden){ $('#settingsMenu').hidden=true; return; }
  const typing=/^(INPUT|TEXTAREA)$/.test(e.target.tagName)||e.target.isContentEditable;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='f'){
    e.preventDefault();
    $('#q').focus();
    $('#q').select();
    return;
  }
  if(e.key==='/'&&!typing){ e.preventDefault(); $('#q').focus(); $('#q').select(); return; }
  if(e.key==='Escape'){ if(typing&&e.target.id==='q'){ $('#q').value=''; applyFilter(); e.target.blur(); }
    else { sel.clear(); syncSel(); closeInsp(); } return; }
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){ e.preventDefault(); quickSave(); return; }
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!typing){ e.preventDefault(); undo(); return; }
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'&&!typing){ e.preventDefault(); selectHits(); return; }
  if(typing)return;
  if(/^[1-9]$/.test(e.key)){ const t=S.tiers[+e.key-1];
    if(t&&sel.size){ moveItems([...sel],t.id,null); toast(`Moved ${sel.size} → ${t.label}`); } return; }
  if(e.key==='0'&&sel.size){ moveItems([...sel],'pool',null); return; }
  if((e.key==='Delete')&&sel.size){ snapshot(); [...sel].forEach(id=>delete S.items[id]);
    removeIds([...sel]); sel.clear(); persist(); render(); return; }
});

/* ============================ INSPECTOR ============================ */
function closeInsp(){ $('#insp').classList.remove('on'); }
function openInsp(id){
  const it=S.items[id]; if(!it)return; const p=$('#insp'); p.classList.add('on');
  p.innerHTML=`
    ${it.img?`<img src="${esc(it.img)}">`:''}
    <label>Name</label><input id="i-name" value="${esc(it.name)}">
    <label>Tags (comma separated)</label><input id="i-tags" value="${esc((it.tags||[]).join(', '))}">
    <label>Notes — searchable</label><textarea id="i-notes" style="min-height:90px">${esc(it.notes||'')}</textarea>
    <label>Image URL</label><input id="i-img" value="${esc(it.img||'')}">
    <label>Source</label><div class="muted" style="font-size:11px;word-break:break-all">${esc(it.src||'—')}</div>
    <div class="row"><button id="i-save" class="primary">Save</button>
      <button id="i-del" class="danger">Delete item</button>
      <div class="spacer"></div><button id="i-close" class="ghost">✕</button></div>`;
  $('#i-close').onclick=closeInsp;
  $('#i-del').onclick=()=>{ snapshot(); delete S.items[id]; removeIds([id]); closeInsp(); persist(); render(); };
  $('#i-save').onclick=()=>{ snapshot();
    it.name=$('#i-name').value.trim(); it.img=$('#i-img').value.trim();
    it.tags=$('#i-tags').value.split(',').map(s=>s.trim()).filter(Boolean);
    it.notes=$('#i-notes').value.trim(); persist(); render(); toast('Saved'); };
  p.querySelectorAll('input,textarea').forEach(el=>el.addEventListener('keydown',ev=>{
    if(ev.key==='Enter'&&el.tagName==='INPUT'){ ev.preventDefault(); $('#i-save').click(); } }));
}

/* ============================ CANVAS PAN/ZOOM ============================ */
(()=>{
  const main=document.querySelector('main'), canvas=$('#canvas');
  const view={x:0,y:0,scale:1};
  // Permit a little extra context around larger boards without making tiles too small.
  const MIN=.85, MAX=5;
  function apply(){
    canvas.style.transform=`translate(${view.x}px,${view.y}px) scale(${view.scale})`;
    // Keep the insertion slot under the held item as the canvas moves beneath it.
    if(dragIds.length)updateHeldItemDrag();
  }

  let dragging=false, lastX=0, lastY=0;
  main.addEventListener('mousedown',e=>{
    if(e.button!==1) return;
    e.preventDefault();
    dragging=true; lastX=e.clientX; lastY=e.clientY; main.classList.add('panning');
  });
  window.addEventListener('mousemove',e=>{
    if(!dragging) return;
    view.x+=e.clientX-lastX; view.y+=e.clientY-lastY;
    lastX=e.clientX; lastY=e.clientY; apply();
  });
  window.addEventListener('mouseup',e=>{
    if(e.button!==1||!dragging) return;
    dragging=false; main.classList.remove('panning');
  });

  main.addEventListener('wheel',e=>{
    e.preventDefault();
    const rect=main.getBoundingClientRect();
    const mx=e.clientX-rect.left, my=e.clientY-rect.top;
    const cx=(mx-view.x)/view.scale, cy=(my-view.y)/view.scale;
    const factor=Math.pow(1.0015,-e.deltaY);
    const newScale=Math.min(MAX,Math.max(MIN,view.scale*factor));
    view.x=mx-cx*newScale; view.y=my-cy*newScale; view.scale=newScale;
    apply();
  },{passive:false});
})();
/* ============================ TOOLBAR ============================ */
$('#title').oninput=e=>{ S.title=e.target.value; persist(); };
(()=>{
  const divider=$('#titleDivider'); let startX=0,startWidth=0,resizing=false;
  const minWidth=220;
  divider.addEventListener('pointerdown',e=>{
    if(!S)return; resizing=true; startX=e.clientX; startWidth=$('#title').getBoundingClientRect().width;
    divider.setPointerCapture(e.pointerId); document.body.classList.add('resizing-title'); e.preventDefault();
  });
  divider.addEventListener('pointermove',e=>{
    if(!resizing)return;
    const maxWidth=Math.max(minWidth,window.innerWidth-680);
    const width=Math.round(Math.max(minWidth,Math.min(maxWidth,startWidth+e.clientX-startX)));
    document.documentElement.style.setProperty('--title-width',`${width}px`);
  });
  const finish=e=>{
    if(!resizing)return; resizing=false; document.body.classList.remove('resizing-title');
    const width=Math.round($('#title').getBoundingClientRect().width);
    S.opts.titleWidth=width; persist();
    if(divider.hasPointerCapture(e.pointerId))divider.releasePointerCapture(e.pointerId);
  };
  divider.addEventListener('pointerup',finish); divider.addEventListener('pointercancel',finish);
})();
$('#q').oninput=applyFilter;
$('#q').onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); selectHits(); } };
$('#btnClearSearch').onclick=()=>{ $('#q').value=''; applyFilter(); $('#q').focus(); };
$('#labmode').onchange=e=>{ S.opts.labels=e.target.value; document.body.className='lab-'+e.target.value; persist(); };
function switchSubBoard(id){
  const next=S.subBoards.find(sub=>sub.id===id); if(!next||next.id===S.activeSubBoardId)return;
  storeActiveSubBoard(); S.activeSubBoardId=next.id; compareSubBoardId=next.compareSubBoardId||null;
  applySubBoardLayout(next.layout);
  sel.clear(); lastClicked=null; persist(); render(); toast(`Switched to "${next.name}"`);
}
function compareSubBoards(viewId,otherId){
  const view=S.subBoards.find(sub=>sub.id===viewId), other=S.subBoards.find(sub=>sub.id===otherId);
  if(!view||!other||view.id===other.id)return;
  storeActiveSubBoard(); S.activeSubBoardId=view.id; view.compareSubBoardId=other.id;
  compareSubBoardId=other.id; applySubBoardLayout(view.layout);
  sel.clear(); lastClicked=null; persist(); render(); toast(`Comparing "${view.name}" with "${other.name}"`);
}
function addSubBoard(){
  const clean=`Alternative ${S.subBoards.length}`;
  snapshot(); storeActiveSubBoard();
  const sub={id:uid(),name:clean,layout:layoutFromState()};
  S.subBoards.push(sub); S.activeSubBoardId=sub.id;
  sel.clear(); lastClicked=null; persist(); render(); toast(`Created sub-board "${clean}"`);
}
function startInlineSubBoardRename(tab){
  const sub=S.subBoards.find(item=>item.id===tab.dataset.subboard); if(!sub)return;
  const input=document.createElement('input'); input.value=sub.name; input.setAttribute('aria-label','Sub-board name');
  tab.replaceChildren(input); input.focus(); input.select();
  let done=false;
  const finish=save=>{ if(done)return; done=true;
    const name=input.value.trim();
    if(save&&name&&name!==sub.name){ snapshot(); sub.name=name; persist(); toast(`Renamed sub-board to "${name}"`); }
    render();
  };
  input.onkeydown=e=>{ if(e.key==='Enter'){e.preventDefault();finish(true);}
    else if(e.key==='Escape'){e.preventDefault();finish(false);} };
  input.onblur=()=>finish(true);
}
$('#subboardTabs').onclick=e=>{
  if(e.target.closest('.subboard-add')){ addSubBoard(); return; }
  if(e.target.closest('[data-clear-comparison]')){
    activeSubBoard().compareSubBoardId=null; compareSubBoardId=null; persist(); render(); toast('Comparison cleared'); return;
  }
  const remove=e.target.closest('[data-delete-subboard]');
  if(remove){
    const id=remove.dataset.deleteSubboard;
    if(S.subBoards.length===1){ toast('A board needs at least one sub-board'); return; }
    if(remove.dataset.confirm!=='1'){
      remove.dataset.confirm='1'; remove.innerHTML=icon('trash'); remove.title='Click again to delete';
      remove.setAttribute('aria-label','Confirm delete sub-board'); return;
    }
    snapshot(); storeActiveSubBoard();
    const deletingActive=id===S.activeSubBoardId;
    S.subBoards=S.subBoards.filter(sub=>sub.id!==id);
    S.subBoards.forEach(sub=>{ if(sub.compareSubBoardId===id)sub.compareSubBoardId=null; });
    if(deletingActive){ S.activeSubBoardId=S.subBoards[0].id; applySubBoardLayout(S.subBoards[0].layout); }
    persist(); render(); toast('Deleted sub-board'); return;
  }
  const tab=e.target.closest('[data-subboard]'); if(tab) switchSubBoard(tab.dataset.subboard);
};
function addTier(){ snapshot();
  S.tiers.push({id:uid(),label:'New',color:TM_COLORS[S.tiers.length%10],items:[]}); persist(); render(); }
function regenerateTierColors(){
  if(!S.tiers.length)return;
  snapshot();
  S.tiers.forEach((tier,index)=>{ tier.color=TM_COLORS[Math.min(index,TM_COLORS.length-1)]; });
  persist(); render(); toast('Regenerated tier colors');
}
function selectHits(){ const terms=parseQuery($('#q').value.trim());
  setSel(Object.values(S.items).filter(it=>matches(it,terms)).map(i=>i.id));
  toast(`${sel.size} selected`); }
$('#btnSortPool').onclick=()=>{ snapshot();
  S.pool.sort((a,b)=>(S.items[a].name||'').localeCompare(S.items[b].name||'')); persist(); render(); };
$('#btnAddImgs').onclick=()=>$('#fileinput').click();
$('#fileinput').onchange=e=>addFiles([...e.target.files]);
$('#btnHelp').onclick=()=>dlgHelp.showModal();
$('#btnSettings').onclick=e=>{ e.stopPropagation(); $('#settingsMenu').hidden=!$('#settingsMenu').hidden; };
document.addEventListener('click',e=>{ if(!e.target.closest('#settingsWrap'))$('#settingsMenu').hidden=true; });
$('#btnImport').onclick=async()=>{ dlgImport.showModal(); refreshHelperState(); renderGameSources(); };
async function refreshHelperState(){
  const el=$('#helperstate'); el.textContent='Checking for the local runtime…';
  helperBase=await findHelper();
  updateRuntimeStatus();
  if(helperBase){ el.innerHTML=`<b style="color:var(--ok)">Local runtime connected</b> (${esc(helperBase)}).
    Paste any <code>tiermaker.com/list/…</code> or <code>/create/…</code> link — it fetches and
    rebuilds tiers, colours, images and placements directly. The Slay the Spire 2 button below
    imports every card or relic from the matching wiki list straight into the pool. Boards also now save to
    this folder's <code>Saved/</code> directory instead of the browser.`; }
  else { el.innerHTML=`<b style="color:var(--accent2)">No local runtime.</b> TierMaker builds its item
    list in JavaScript and blocks readers, and the Slay the Spire 2 wiki blocks plain browser
    fetches outright, so public proxies often come back empty. For a reliable import — and for
    boards to save to disk at all—run <code>TierForge.cmd</code> (or <code>npm run serve</code>)
    and open the page it gives you, or use the
    bookmarklet on the <b>Grab from page</b> tab for TierMaker. Trying the proxies is still
    worth a shot.`; }
}
$('#btnExport').onclick=()=>dlgExport.showModal();
$('#btnBoards').onclick=()=>{ renderBoards(); dlgBoards.showModal(); };
$$('.tabs button').forEach(b=>b.onclick=()=>{ $$('.tabs button').forEach(x=>x.classList.remove('on'));
  b.classList.add('on'); $$('.tabpane').forEach(p=>p.classList.remove('on'));
  $('#tab-'+b.dataset.tab).classList.add('on'); });

function toast(msg){ const t=$('#toast'); t.textContent=msg; t.style.display='block';
  clearTimeout(toast._t); toast._t=setTimeout(()=>t.style.display='none',2200); }
function log(msg){ const l=$('#log'); l.textContent+=msg+'\n'; l.scrollTop=l.scrollHeight; }

/* ============================ FILE DROP ============================ */
let dragDepth=0;
window.addEventListener('dragenter',e=>{ if(!e.dataTransfer.types.includes('Files'))return;
  dragDepth++; $('#drophint').classList.add('on'); });
window.addEventListener('dragleave',()=>{ if(--dragDepth<=0){dragDepth=0;$('#drophint').classList.remove('on');} });
window.addEventListener('drop',e=>{ if(!e.dataTransfer.files.length)return;
  e.preventDefault(); dragDepth=0; $('#drophint').classList.remove('on');
  const files=[...e.dataTransfer.files];
  const j=files.find(f=>/\.json$/i.test(f.name));
  if(j) return j.text().then(t=>loadJSON(t,false));
  addFiles(files.filter(f=>f.type.startsWith('image/'))); });
window.addEventListener('dragover',e=>{ if(e.dataTransfer.types.includes('Files'))e.preventDefault(); });

function prettyName(s){ return s.replace(/\.[a-z0-9]+$/i,'').replace(/[_-]+/g,' ')
  .replace(/([a-z])([A-Z])/g,'$1 $2').replace(/\s+/g,' ').trim()
  .replace(/\b\w/g,c=>c.toUpperCase()); }
async function addFiles(files){ if(!files.length)return; snapshot();
  for(const f of files){ const url=await new Promise(r=>{ const fr=new FileReader();
      fr.onload=()=>r(fr.result); fr.readAsDataURL(f); });
    const id=uid(); S.items[id]={id,name:prettyName(f.name),tags:[],notes:'',img:url,src:f.name};
    S.pool.push(id); }
  persist(); render(); toast(`Added ${files.length} image${files.length===1?'':'s'}`); }

/* ============================ PERSISTENCE ============================
   Boards are JSON files in this folder's Saved/ directory, read and written
   by the local Node runtime (npm run serve / TierForge.cmd)—not
   the browser's localStorage. Without the runtime running, nothing persists
   between reloads; warnNoHelper() says so once. */
const AUTOSAVE='_autosave';
let saveTimer=null, warnedNoHelper=false;
function persist(){
  ensureSubBoards();
  storeActiveSubBoard();
  if(!helperBase){ warnNoHelper(); return; }
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{
    fetch(helperBase+'/boards/'+encodeURIComponent(AUTOSAVE),{method:'PUT',body:JSON.stringify(S)})
      .catch(()=>{});
  },400);
}
function warnNoHelper(){ if(warnedNoHelper)return; warnedNoHelper=true;
  toast('No local runtime—nothing is being saved. Run TierForge.cmd, then reload.'); }
function updateRuntimeStatus(){ const el=$('#runtimeStatus'); if(!el)return;
  el.className='runtime-status '+(helperBase?'online':'offline');
  el.innerHTML=`<i></i>${helperBase?'Saved locally':'Unsaved mode'}`; }
function quickSave(){ const name=S.title||'Board';
  saveBoard(name).then(ok=>toast(ok?'Saved board "'+name+'"':'Not saved—no local runtime')); }
async function saveBoard(name){
  if(!helperBase){ warnNoHelper(); return false; }
  ensureSubBoards();
  storeActiveSubBoard();
  try{ const r=await fetch(helperBase+'/boards/'+encodeURIComponent(name),
    {method:'PUT',body:JSON.stringify(S)}); return r.ok; }
  catch(e){ return false; }
}
async function renderBoards(){
  const wrap=$('#boardlist'); $('#boardname').value=S.title;
  if(!helperBase){ wrap.innerHTML=`<div class="muted">No local runtime—boards can't be
    saved or loaded from disk. Run <code>TierForge.cmd</code> (or
    <code>npm run serve</code>) from the TierForge folder, then reload this
    page.</div>`; return; }
  let list=[];
  try{ list=(await (await fetch(helperBase+'/boards')).json()).boards||[]; }catch(e){}
  wrap.innerHTML=list.length?list.map(b=>`<div class="row" style="padding:4px 0;border-bottom:1px solid var(--line)">
      <span data-board-label style="flex:1">${esc(b.name)}</span>
      <small>${new Date(b.mtime).toLocaleString()}</small>
      <button data-load="${esc(b.name)}">Load</button>
      <button data-overwrite="${esc(b.name)}" title="Click once to arm overwrite">Overwrite</button>
      <button class="danger" data-drop="${esc(b.name)}" title="Click once to arm deletion" aria-label="Delete board">✕</button></div>`).join('')
    :'<div class="muted">No saved boards yet.</div>';
  $$('[data-board-label]',wrap).forEach(x=>x.ondblclick=()=>startInlineBoardRename(x));
  $$('button[data-load]',wrap).forEach(x=>x.onclick=async()=>{
    const r=await fetch(helperBase+'/boards/'+encodeURIComponent(x.dataset.load));
    if(!r.ok)return toast('Could not load that board');
    snapshot(); S=JSON.parse(await r.text()); prepareState(); sel.clear(); persist(); render(); dlgBoards.close(); });
  $$('button[data-overwrite]',wrap).forEach(x=>x.onclick=async()=>{
    if(x.dataset.confirm!=='1'){
      x.dataset.confirm='1';
      x.textContent='Confirm';
      x.title='Click again to overwrite this board';
      return;
    }
    x.disabled=true;
    const name=x.dataset.overwrite;
    const r=await fetch(helperBase+'/boards/'+encodeURIComponent(name),
      {method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify((storeActiveSubBoard(),S))});
    if(!r.ok){ x.disabled=false; delete x.dataset.confirm; x.textContent='Overwrite'; return toast('Could not overwrite that board'); }
    renderBoards(); toast('Overwrote board "'+name+'"');
  });
  $$('button[data-drop]',wrap).forEach(x=>x.onclick=async()=>{
    if(x.dataset.confirm!=='1'){
      x.dataset.confirm='1';
      x.textContent='🗑️';
      x.title='Click again to delete this board';
      x.setAttribute('aria-label','Confirm delete board');
      return;
    }
    x.disabled=true;
    await fetch(helperBase+'/boards/'+encodeURIComponent(x.dataset.drop),{method:'DELETE'});
    renderBoards(); });
}
function startInlineBoardRename(label){
  const oldName=label.textContent.trim();
  const input=document.createElement('input'); input.value=oldName; input.style.flex='1';
  label.replaceWith(input); input.focus(); input.select();
  const save=async()=>{
    if(input.dataset.saving)return;
    const newName=input.value.trim();
    if(!newName)return toast('Board name cannot be empty');
    if(newName===oldName)return renderBoards();
    input.dataset.saving='1';
    const r=await fetch(helperBase+'/boards/'+encodeURIComponent(oldName)+'/rename',
      {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:newName})});
    if(!r.ok){ let msg='Could not rename that board'; try{ msg=(await r.json()).error||msg; }catch(e){} delete input.dataset.saving; return toast(msg); }
    const result=await r.json(); renderBoards(); toast('Renamed board to "'+(result.name||newName)+'"');
  };
  input.onkeydown=e=>{
    if(e.key==='Enter'){e.preventDefault();save();}
    else if(e.key==='Escape')renderBoards();
  };
}
$('#btnSaveBoard').onclick=async()=>{ const n=$('#boardname').value.trim()||'Board';
  S.title=n; const ok=await saveBoard(n); renderBoards(); toast(ok?'Saved':'Not saved—no local runtime'); };

/* ============================ TIERMAKER IMPORT ============================

   TierMaker fills its item carousel from
     /api/?type=templates-v2&id=<template>&lastEdited=<ts>&variation=<n>
   which sends CORS headers only for bracketfights.com, and 403s anything that
   doesn't look like a browser. Public proxies get 403/522 on it, and reader
   proxies that *render* the page are rate-limited and silently fall back to the
   raw HTML - which has an empty carousel. So the order of preference is:

     1. the local Node runtime (npm run serve)          - always works
     2. reader proxies, in case one renders the page today
     3. the bookmarklet, which reads the already-built DOM in the user's own tab
*/
const HELPERS=['', 'http://127.0.0.1:8777', 'http://localhost:8777'];
let helperBase=null;
async function findHelper(){
  for(const base of HELPERS){
    if(base===''&&!/^https?:/.test(location.protocol))continue;   // file:// has no same-origin server
    try{ const c=new AbortController(); setTimeout(()=>c.abort(),1500);
      const r=await fetch(base+'/import',{signal:c.signal});
      if(r.ok&&(await r.json()).helper==='tierforge') return base||location.origin;
    }catch(e){}
  }
  return null;
}
/** Runs an import on the runtime as a background job and polls it for progress,
 * handing each new log line to onLine as it arrives (default: the Import
 * dialog's own #log panel) — a plain TierMaker template finishes in a couple
 * of polls, but ~600 embedded wiki images take tens of seconds, and this is
 * what lets you watch it go image by image instead of staring at a spinner. */
async function importViaHelper(base,url,embed,onLine=log,local=false,cache=false,names=null){
  const endpoint=base+'/import/start?'+new URLSearchParams({url,
    ...(embed?{embed:'1'}:{}),...(local&&!embed?{images:'1'}:{}),...(cache?{cache:'1'}:{})});
  const startRes=await fetch(endpoint,Array.isArray(names)?{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({names})
  }:undefined);
  const start=await startRes.json().catch(()=>({}));
  if(!startRes.ok||start.error) throw new Error(start.error||('HTTP '+startRes.status));
  let since=0;
  for(;;){
    await new Promise(r=>setTimeout(r,350));
    const r=await fetch(base+'/import/poll?job='+encodeURIComponent(start.job)+'&since='+since);
    const j=await r.json().catch(()=>null);
    if(!r.ok||!j) throw new Error('local runtime sent a bad response');
    (j.lines||[]).forEach(onLine);
    since=j.total??since;
    if(j.done){
      if(j.error) throw new Error(j.error);
      return j.result;
    }
  }
}

const PROXIES=[
  {name:'r.jina.ai',url:u=>'https://r.jina.ai/'+u,opts:{headers:{'x-return-format':'html'}}},
  {name:'allorigins',url:u=>'https://api.allorigins.win/raw?url='+encodeURIComponent(u),opts:{}},
  {name:'codetabs',url:u=>'https://api.codetabs.com/v1/proxy?quest='+encodeURIComponent(u),opts:{}},
];
async function fetchPage(url){
  let lastErr;
  for(const p of PROXIES){
    try{ log(`  fetching via ${p.name}…`);
      const r=await fetch(p.url(url),p.opts);
      if(!r.ok) throw new Error('HTTP '+r.status);
      const t=await r.text();
      if(t.length<500) throw new Error('empty response');
      if(/Just a moment|challenge-platform/i.test(t.slice(0,3000))) throw new Error('blocked by Cloudflare');
      log(`  ok (${(t.length/1024|0)} KB)`); return t;
    }catch(err){ lastErr=err; log(`  ${p.name} failed: ${err.message}`); }
  }
  throw lastErr||new Error('all proxies failed');
}

function nameFromUrl(u){ try{ return prettyName(decodeURIComponent(u.split('/').pop().split('?')[0])); }
  catch(e){ return 'Item'; } }

/** Pull `.character` tiles out of a TierMaker /create/ page. */
function parseCharacters(html){
  const doc=new DOMParser().parseFromString(html,'text/html'); const out=[];
  doc.querySelectorAll('.character,.draggable-container,[class*="character"]').forEach(el=>{
    let src=''; const bg=el.getAttribute('style')||'';
    const m=bg.match(/url\((?:&quot;|["'])?(.*?)(?:&quot;|["'])?\)/);
    if(m) src=m[1];
    if(!src){ const img=el.querySelector('img'); src=img?.getAttribute('src')||img?.getAttribute('data-src')||''; }
    if(!src||/^data:image\/gif/.test(src))return;
    try{ src=new URL(src,'https://tiermaker.com/').href; }catch(e){ return; }
    const label=(el.getAttribute('title')||el.getAttribute('data-name')||
      el.querySelector('.character-name,.label,.name')?.textContent||
      el.querySelector('img')?.getAttribute('alt')||'').trim();
    const key=el.id||String(out.length+1);
    if(out.some(o=>o.key===key))return;
    out.push({key,src,name:label||nameFromUrl(src)});
  });
  return out;
}
/** templateCode = "template==Label|colorIdx|id|id==…" */
function parseTemplateCode(html){
  const m=html.match(/templateCode\s*=\s*"([^"]+)"/); if(!m)return null;
  const parts=m[1].split('==');
  return {template:parts[0],
    tiers:parts.slice(1).filter(Boolean).map(seg=>{ const f=seg.split('|');
      return {label:f[0],color:TM_COLORS[(+f[1]||0)%10],ids:f.slice(2).filter(x=>x!=='')}; })};
}

function buildFrom(chars,tc,merge,meta){
  if(!merge) S=blankState();
  S.source=meta.url||S.source;
  if(meta.title&&!merge) S.title=meta.title;
  const byKey={};
  for(const c of chars){
    const dup=Object.values(S.items).find(i=>i.img===c.src||i.src===c.src);
    if(dup){ byKey[c.key]=dup.id; continue; }
    const id=uid();
    S.items[id]={id,name:c.name,tags:[],notes:'',img:c.src,src:c.src,tmkey:c.key};
    byKey[c.key]=id; S.pool.push(id);
  }
  if(tc&&tc.tiers.length){
    // rebuild tiers from the saved list; anything unreferenced stays in the pool
    const known=Object.values(S.items).reduce((a,i)=>{ if(i.tmkey)a[i.tmkey]=i.id; return a; },byKey);
    const newTiers=tc.tiers.map(t=>({id:uid(),label:t.label,color:t.color,
      items:t.ids.map(k=>known[k]).filter(Boolean)}));
    if(newTiers.some(t=>t.items.length)){
      const placed=new Set(newTiers.flatMap(t=>t.items));
      S.tiers=merge?[...S.tiers,...newTiers]:newTiers;
      S.pool=S.pool.filter(i=>!placed.has(i));
      S.tiers.forEach(t=>{ if(!newTiers.includes(t)) t.items=t.items.filter(i=>!placed.has(i)); });
    }
  }
  sel.clear(); persist(); render();
}

/** "rgb(255, 127, 127)" / "#f77" -> "#ff7f7f" */
function toHex(c){
  if(!c)return '';
  c=String(c).trim();
  const m=c.match(/^rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if(m) return '#'+[1,2,3].map(i=>Math.round(+m[i]).toString(16).padStart(2,'0')).join('');
  if(/^#[0-9a-f]{3}$/i.test(c)) return '#'+[...c.slice(1)].map(x=>x+x).join('');
  return /^#[0-9a-f]{6}$/i.test(c)?c.toLowerCase():'';
}
/** nearest index into TierMaker's stock palette, for writing templateCode back */
function tmColorIndex(hex){
  const p=toHex(hex)||'#ffffff';
  const rgb=s=>[1,3,5].map(i=>parseInt(s.substr(i,2),16));
  const [r,g,b]=rgb(p);
  let best=0,bd=Infinity;
  TM_COLORS.forEach((c,i)=>{ const [R,G,B]=rgb(c);
    const d=(r-R)**2+(g-G)**2+(b-B)**2; if(d<bd){bd=d;best=i;} });
  return best;
}

const cleanTitle=t=>String(t||'').replace(/\s*[-–|]\s*TierMaker.*$/i,'')
  .replace(/^Create a\s+/i,'').replace(/\s*Tier List( Maker)?\s*$/i,'').trim();

/** The templates-v2 URL a /create/ page would call, read out of that page. */
function apiUrlFrom(html,template){
  const v=html.match(/initList\(\s*"[^"]*"\s*,\s*"[^"]*"\s*,\s*"([^"]*)"/);
  const d=html.match(/dateLastEdited\s*=\s*"([^"]*)"/);
  return 'https://tiermaker.com/api/?'+new URLSearchParams({type:'templates-v2',
    id:template, lastEdited:d?d[1]:'', variation:v?v[1]:''});
}
/** ["template",{src,id},…] — the shape templates-v2 answers with. */
function parseApiItems(data,html){
  if(typeof data==='string'){ try{ data=JSON.parse(data); }catch(e){ return []; } }
  if(!Array.isArray(data))return [];
  const base=(html||'').match(/baseTierImagePath\s*=\s*"([^"]*)"/);
  const root='https://tiermaker.com'+(base?base[1]:'');
  return data.slice(1).map((e,n)=>{
    let src='',key=String(n+1);
    if(e&&typeof e==='object'){ src=e.src||''; key=String(e.id??n+1); }
    else if(typeof e==='string'){ src=root.replace(/\/$/,'')+'/'+e; }
    if(!src)return null;
    src=new URL(src,'https://tiermaker.com/').href;
    return {key,src,name:nameFromUrl(src)};
  }).filter(Boolean);
}

/** Merge an import pack's items into the current pool without touching tiers,
 * for sources (like the STS2 wiki) that carry no tier arrangement of their own. */
function mergeItemsIntoPool(pack){
  const arr=Array.isArray(pack.items)?pack.items:Object.values(pack.items);
  let added=0;
  arr.forEach(it=>{
    const img=it.img||it.src||'';
    if(img && Object.values(S.items).some(i=>i.img===img||i.src===img)) return;
    const id=uid();
    S.items[id]={id,name:it.name||nameFromUrl(img),tags:it.tags||[],notes:it.notes||'',img,src:it.src||img};
    S.pool.push(id); added++;
  });
  return added;
}

/* ============================ GAME WIKI SOURCES ============================
   A small, extensible table of "this game's whole card/character list lives at
   this wiki page" sources. The right one is suggested by matching the board's
   title, but detection is only ever a convenience — every source also gets an
   explicit button, so nothing requires the guess to land. Add more games here
   as they come up; each needs its own parser wired into the runtime's /import. */
const GAME_SOURCES=[
  {id:'sts2-relics', name:'Slay the Spire 2',
   match:/\b(?:slay the spire (?:2|ii|two)|sts ?2)\b.*\brelics?\b|\brelics?\b.*\b(?:slay the spire (?:2|ii|two)|sts ?2)\b/,
   wiki:'https://slaythespire.wiki.gg/wiki/Slay_the_Spire_2:Relics_List', itemType:'relics'},
  {id:'sts2-cards', name:'Slay the Spire 2',
   match:/\bslay the spire (?:2|ii|two)\b|\bsts ?2\b/,
   wiki:'https://slaythespire.wiki.gg/wiki/Slay_the_Spire_2:Cards_List', itemType:'cards'},
];
const normName=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
/* TierMaker sometimes labels its tile from the wiki filename rather than the
   human title ("80px StS2ArcaneScroll"). These aliases let that supplied
   Neow relic list resolve to the Relics List without changing the board name. */
function sourceNameKeys(value){
  const normalized=normName(value), keys=new Set([normalized]);
  let loose=normalized.replace(/^zzzzz\d+/,'').replace(/^\d+px/,'').replace(/^sts2/,'');
  if(loose) keys.add(loose);
  const repeated=/^(.+?)\1$/.exec(loose); if(repeated) keys.add(repeated[1]);
  return [...keys].filter(Boolean);
}
/** Board title first ("Slay the Spire 2 tier list"), falling back to where it
 * came from — a TierMaker board's title is often just the character name
 * ("Ironclad"), but its source URL says "…-slay-the-spire-ii-…". Punctuation
 * is normalized to spaces so "-ii-" and "II" both read as "ii". */
function detectGameSource(board){
  const hay=[board?.title,board?.source].filter(Boolean).join(' ')
    .toLowerCase().replace(/[^a-z0-9]+/g,' ');
  return GAME_SOURCES.find(g=>g.match.test(hay))||null;
}

function renderGameSources(){
  const wrap=$('#gameSources'); if(!wrap)return;
  const detected=detectGameSource(S);
  wrap.innerHTML=GAME_SOURCES.map(g=>`
    <div class="row" style="gap:6px;margin-top:2px">
      <button data-imp="${g.id}" class="${g===detected?'primary':'ghost'}">${esc(g.name)}: import all ${g.itemType}</button>
    </div>`).join('')+`
    <div class="row" style="gap:6px;margin-top:2px">
      <button data-relink-all class="ghost">Relink items</button>
      <span class="muted" style="font-size:12px">checks saved images, cards, and relics${detected?' · ↩ detected from the board title':''}</span>
    </div>`;
  $$('button[data-imp]',wrap).forEach(b=>b.onclick=()=>quickWikiImport(GAME_SOURCES.find(g=>g.id===b.dataset.imp)));
  $('[data-relink-all]',wrap).onclick=()=>relinkItems();
}

function quickWikiImport(src){
  $('#tmurl').value=src.wiki;
  /* Prefer a refreshable local cache for the large wiki card set. */
  $('#localimgs').checked=true; $('#embedimgs').checked=false;
  $('#btnFetch').click();
}
$('#embedimgs').onchange=()=>{ if($('#embedimgs').checked) $('#localimgs').checked=false; };
$('#localimgs').onchange=()=>{ if($('#localimgs').checked) $('#embedimgs').checked=false; };

/** Inventory the board and local image cache before consulting the wiki. Items
 * already linked locally are retained; other local files and wiki entries are
 * matched by punctuation-insensitive name. Only relevant missing wiki images
 * are downloaded. Tags, notes, names and placements stay put. */
async function relinkItems(sources=GAME_SOURCES){
  if(helperBase===null) helperBase=await findHelper();
  if(!helperBase) return toast('Needs the local runtime—run TierForge.cmd, then reload.');
  $('#log').textContent='';
  const items=Object.values(S.items);
  if(!items.length) return toast('There are no items to relink.');
  toast(`Scanning ${items.length} board item(s)…`);
  const localByName={};
  const localFiles=new Set();
  try{
    const r=await fetch(helperBase+'/images');
    if(!r.ok) throw new Error('HTTP '+r.status);
    const files=(await r.json()).images||[];
    files.forEach(file=>{
      file=String(file).replace(/^\/+/, '');
      localFiles.add(file);
      const stem=file.split('/').pop().replace(/\.[^.]+$/,'');
      const candidates=[stem,stem.replace(/^[^_]+_/,'')];
      candidates.forEach(name=>{ if(name&&!localByName[normName(name)]) localByName[normName(name)]=file; });
    });
    log(`Scanned ${files.length} locally saved image file(s).`);
  }catch(e){ log('Could not scan local images: '+e.message); }
  const alreadyLocal=[]; const localMatches=[]; const unresolved=[];
  snapshot();
  items.forEach(it=>{
    const current=String(it.img||'').replace(/^\/+/, '');
    if(localFiles.has(current)){ alreadyLocal.push(it); return; }
    const local=localByName[normName(it.name)];
    if(local){ it.img=local; localMatches.push(it); }
    else unresolved.push(it);
  });
  log(`${alreadyLocal.length} item(s) already point to saved files; ${localMatches.length} more matched the local cache.`);

  let wikiMatches=[]; let missed=[...unresolved];
  const wikiSources=Array.isArray(sources)?sources:(sources?[sources]:[]);
  for(const src of wikiSources){
    if(!missed.length) break;
    log(`Checking ${missed.length} remaining item(s) against ${src.itemType||src.name} wiki metadata…`);
    try{
      const catalog=await importViaHelper(helperBase,src.wiki,false,log);
      const wikiByName={};
      (Array.isArray(catalog.items)?catalog.items:Object.values(catalog.items))
        .forEach(it=>{ sourceNameKeys(it.name).forEach(key=>{ wikiByName[key]=it; }); });
      const wikiItem=it=>sourceNameKeys(it.name).map(key=>wikiByName[key]).find(Boolean);
      const matches=missed.filter(wikiItem);
      missed=missed.filter(it=>!wikiItem(it));
      log(`${matches.length} item(s) matched the ${src.itemType||src.name} catalog.`);
      if(matches.length){
        log(`Saving only those ${matches.length} wiki image(s)…`);
        const pack=await importViaHelper(helperBase,src.wiki,false,log,true,true,
          matches.map(it=>it.name));
        const savedByName={};
        (Array.isArray(pack.items)?pack.items:Object.values(pack.items))
          .filter(it=>/^\/?Images\//i.test(it.img||''))
          .forEach(it=>{ sourceNameKeys(it.name).forEach(key=>{ savedByName[key]=it; }); });
        const saved=[]; const failed=[];
        matches.forEach(it=>{
          const w=sourceNameKeys(it.name).map(key=>savedByName[key]).find(Boolean);
          if(w){ it.img=w.img; it.src=w.src||w.img||it.src; saved.push(it); }
          else failed.push(it);
        });
        wikiMatches.push(...saved); missed.push(...failed);
        if(failed.length) log(`${failed.length} matched wiki image(s) could not be saved and were left unchanged.`);
      }
    }catch(e){
      log(`${src.itemType||src.name} wiki lookup unavailable: ${e.message}`);
    }
  }
  persist(); render();
  const relinked=localMatches.length+wikiMatches.length;
  toast(`Relinked ${relinked} item(s); ${alreadyLocal.length} already local`+
    (missed.length?`; ${missed.length} left unchanged`:''));
  if(missed.length) log('Left unchanged (local/custom or not on this wiki): '+missed.map(it=>it.name).join(', '));
}

/* Imported lists often point at fresh remote URLs even though the same images
 * are already cached locally. Reuse the normal relinker after an import so a
 * refresh does not turn a board back into a remote-only board. The wiki lookup
 * is only attempted when the board identifies a supported game; local cache
 * matching works for every imported list. */
async function autoRelinkImportedItems(){
  if(!$('#autorelink')?.checked || !Object.keys(S.items).length) return;
  log('Auto-relinking imported items to saved images…');
  await relinkItems();
}

$('#btnFetch').onclick=async()=>{
  const raw=$('#tmurl').value.trim(); if(!raw)return toast('Paste a URL first');
  $('#log').textContent=''; const btn=$('#btnFetch'); btn.disabled=true;
  const url=raw.split('#')[0].replace(/^http:/,'https:');
  try{
    if(/slaythespire\.wiki\.gg\//i.test(url)){
      const wikiItemType=/relics?_list/i.test(url)?'relics':'cards';
      if(helperBase===null) helperBase=await findHelper();
      if(!helperBase) throw new Error('This needs the local runtime—run TierForge.cmd from the '
        +'TierForge folder, then reload this page. The wiki blocks plain browser fetches.');
      log('Using local runtime at '+helperBase+' …');
      const pack=await importViaHelper(helperBase,url,$('#embedimgs').checked,log,$('#localimgs').checked);
      if($('#mergeimp').checked){ snapshot(); const added=mergeItemsIntoPool(pack);
        log(`Merged ${added} new ${wikiItemType} into the pool (${pack.items.length-added} already present).`); }
      else { S=normalize(pack); log(`Imported ${pack.items.length} ${wikiItemType}.`); }
      sel.clear(); persist(); render(); await autoRelinkImportedItems();
      return toast('Imported '+pack.items.length+' '+wikiItemType);
    }

    if(!/tiermaker\.com\/(list|create)\//i.test(url))
      throw new Error('Not a tiermaker.com /list/ or /create/ URL, or a slaythespire.wiki.gg page');
    if(/[?&]ref=list-remix/i.test(raw)){
      log('Note: a ?ref=list-remix link carries no list id — TierMaker keeps the');
      log('cloned arrangement in your browser\'s localStorage, so nothing outside');
      log('your tab can read it. You will get the template with empty tiers.');
      log('For the placements: use the bookmarklet on that page, or paste the');
      log('original /list/… link here instead.');
      log('');
    }

    /* --- 1. local runtime: does the whole job server-side --- */
    if(helperBase===null) helperBase=await findHelper();
    if(helperBase){
      log('Using local runtime at '+helperBase+' …');
      const pack=await importViaHelper(helperBase,url,$('#embedimgs').checked,log,$('#localimgs').checked);
      S=normalize(pack); sel.clear(); persist(); render(); await autoRelinkImportedItems();
      log(`Imported ${pack.items.length} items into ${pack.tiers.length} tiers.`);
      return toast('Imported '+pack.items.length+' items');
    }

    /* --- 2. proxies --- */
    log('No local runtime—trying public proxies.');
    let tc=null,template='',title='';
    if(/\/list\//i.test(url)){
      log('Reading list page…');
      const listHtml=await fetchPage(url);
      tc=parseTemplateCode(listHtml);
      title=cleanTitle((listHtml.match(/<title>([^<]*)<\/title>/i)||[])[1]);
      if(!tc) log('! no templateCode found — importing the template only');
      template=tc?tc.template:'';
      if(!template){ const m=url.match(/\/list\/[^/]+\/([^/]+)/); template=m?m[1]:''; }
    } else { const m=url.match(/\/create\/([^/?#]+)/); template=m?m[1]:''; }
    if(!template) throw new Error('could not work out the template name');
    log('Template: '+template);

    log('Reading template page…');
    const tplHtml=await fetchPage('https://tiermaker.com/create/'+template);
    let chars=parseCharacters(tplHtml);
    if(chars.length) log(`Found ${chars.length} items in the rendered page`);
    else{
      log('Page came back unrendered — asking the templates-v2 API…');
      try{ chars=parseApiItems(await fetchPage(apiUrlFrom(tplHtml,template)),tplHtml);
           log(`API returned ${chars.length} items`); }
      catch(e){ log('  API through a proxy failed: '+e.message); }
    }
    if(!chars.length) throw new Error('no items came back');
    title=title||cleanTitle((tplHtml.match(/<title>([^<]*)<\/title>/i)||[])[1])||template;
    buildFrom(chars,tc,$('#mergeimp').checked,{url,title});
    log(`Imported ${chars.length} items into ${S.tiers.length} tiers.`);
    if($('#embedimgs').checked) await embedAll(log);
    await autoRelinkImportedItems();
    toast('Imported '+chars.length+' items');
  }catch(err){
    log('ERROR: '+err.message);
    log('');
    log('TierMaker builds its item list in JavaScript and blocks readers, so proxies');
    log('often come back empty. Two things that always work:');
    log('  1. npm run serve   (then reload this page from it)');
    log('  2. the bookmarklet on the "Grab from page" tab');
  }
  finally{ btn.disabled=false; }
};

$('#btnParsePaste').onclick=()=>{
  const txt=$('#pastegrab').value.trim();
  if(txt.length<50)return toast('Paste the bookmarklet output first');
  if(txt[0]==='{'||txt[0]==='[') return loadJSON(txt,false);
  const html=txt;
  const chars=parseCharacters(html), tc=parseTemplateCode(html);
  if(!chars.length&&!tc){
    $('#grabhint').textContent = /initList\(/.test(html)
      ? 'That is the raw page source — its items are added by JavaScript. Use the bookmarklet.'
      : 'Nothing recognisable in that text.';
    return;
  }
  if(!chars.length) $('#grabhint').textContent='Tiers only — no items in that paste.';
  const title=cleanTitle((html.match(/<title>([^<]*)<\/title>/i)||[])[1]);
  buildFrom(chars,tc,$('#mergepaste').checked,{title});
  toast(`Parsed ${chars.length} items${tc?` + ${tc.tiers.length} tiers`:''}`);
};

/* The bookmarklet runs ON tiermaker.com, so /create/ and /api/ are same-origin:
   no CORS, no Cloudflare challenge, no reader proxy.

   It captures the arrangement that is actually on screen by reading the built
   .tier-row elements - label text, the label holder's real background colour, and
   the item ids in each row. That is what makes ?ref=list-remix work: TierMaker's
   clone button stashes the list in localStorage[<template>TierListMakerCode] and
   the create page rebuilds the rows from it, so by the time you click this the
   list is right there in the DOM. It also picks up any rearranging you have done
   by hand. templateCode and that localStorage key are read as fallbacks, and the
   item catalogue comes from templates-v2. */
const bookmarklet='javascript:'+[
"(function(){var L=location.href,H=document.documentElement.innerHTML,",
"TC=(H.match(/templateCode\\s*=\\s*\"([^\"]+)\"/)||[])[1]||'',",
"P=location.pathname.split('/').filter(Boolean),X=P.indexOf('create'),Y=P.indexOf('list'),",
"T=TC?TC.split('==')[0]:(X>=0?(P[X+1]||''):(Y>=0?(P[Y+2]||P[Y+1]||''):'')),",
"LS='';try{LS=localStorage.getItem(T+'TierListMakerCode')||''}catch(e){}",
"R=function(){return [].map.call(document.querySelectorAll('.tier-row'),function(r){",
"var h=r.querySelector('.label-holder'),l=r.querySelector('.label');",
"return{label:((l||h||{}).textContent||'').trim(),color:h?getComputedStyle(h).backgroundColor:'',",
"ids:[].map.call(r.querySelectorAll('.character'),function(c){return c.id})}})",
".filter(function(x){return x.ids.length||x.label})},",
"D=function(){return [].map.call(document.querySelectorAll('.character'),function(e,n){",
"var m=(e.getAttribute('style')||'').match(/url\\(['\"]?(.*?)['\"]?\\)/),i=e.querySelector('img');",
"return{key:e.id||String(n+1),src:m?m[1]:(i?i.src:''),name:e.title||(i?i.alt:'')||''}}).filter(function(x){return x.src})},",
"F=function(c){var rows=R(),o=JSON.stringify({tierforge:1,title:document.title,url:L,",
"chars:c,rows:rows,templateCode:TC||LS});",
"var msg='TierForge: copied '+c.length+' items'+(rows.length?' and '+rows.length+' tiers':'')+'. Paste it into the Grab tab.';",
"var q=function(){prompt('TierForge: clipboard access was denied. Copy this payload, then paste it into the Grab tab:',o)};",
"if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(o).then(function(){alert(msg)},q);else q()};",
"fetch('/create/'+T).then(function(r){return r.text()}).then(function(h){",
"var v=(h.match(/initList\\(\\s*\"[^\"]*\"\\s*,\\s*\"[^\"]*\"\\s*,\\s*\"([^\"]*)\"/)||[])[1]||'',",
"d=(h.match(/dateLastEdited\\s*=\\s*\"([^\"]*)\"/)||[])[1]||'',",
"b=(h.match(/baseTierImagePath\\s*=\\s*\"([^\"]*)\"/)||[])[1]||'';",
"return fetch('/api/?type=templates-v2&id='+encodeURIComponent(T)+'&lastEdited='+encodeURIComponent(d)+'&variation='+encodeURIComponent(v))",
".then(function(r){return r.json()}).then(function(j){return j.slice(1).map(function(e,n){",
"var s=typeof e==='string'?(b.replace(/\\/$/,'')+'/'+e):((e&&e.src)||'');",
"return{key:String((e&&e.id)||n+1),src:s,name:''}}).filter(function(x){return x.src})})})",
".then(function(c){F(c.length?c:D())},function(){var c=D();c.length?F(c):alert('TierForge: nothing found on this page')})})()"
].join('');
$('#bmk').setAttribute('href',bookmarklet);
async function copyBookmarklet(e){
  e?.preventDefault();
  try{ await navigator.clipboard.writeText(bookmarklet); toast('Bookmark code copied'); }
  catch(err){
    const code=prompt('Copy this code into a new bookmark\'s URL field:',bookmarklet);
    if(code!==null) toast('Copy the shown code into a bookmark URL');
  }
}
$('#bmk').onclick=copyBookmarklet;
$('#copyBmk').onclick=copyBookmarklet;

/* JSON in ------------------------------------------------------- */
$('#btnParseJson').onclick=()=>loadJSON($('#pastejson').value,false);
$('#btnJsonFile').onclick=()=>$('#jsonfile').click();
$('#jsonfile').onchange=e=>e.target.files[0]?.text().then(t=>loadJSON(t,false));
function loadJSON(text,quiet){
  let o; try{ o=JSON.parse(text); }catch(err){ return toast('Invalid JSON: '+err.message); }
  snapshot();
  if(Array.isArray(o)){ // a raw templates-v2 response pasted straight in
    const chars=parseApiItems(o,'');
    if(!chars.length) return toast('That array holds no items');
    buildFrom(chars,null,false,{title:cleanTitle(String(o[0]||''))||'Imported template'});
    dlgImport.close(); return toast('Imported '+chars.length+' items');
  }
  if(o.chars){ // bookmarklet payload
    // Rows scraped off the live page beat templateCode: they carry the arrangement
    // actually on screen (remix pages, hand-rearranged pages) and the real colours.
    const tc = (o.rows&&o.rows.length&&o.rows.some(r=>r.ids&&r.ids.length))
      ? {tiers:o.rows.map((r,i)=>({label:r.label||String(i+1),
          color:toHex(r.color)||TM_COLORS[i%10], ids:(r.ids||[]).map(String)}))}
      : (o.templateCode?parseTemplateCode('templateCode = "'+o.templateCode+'"'):null);
    buildFrom(o.chars.filter(c=>c.src).map(c=>({...c,name:c.name||nameFromUrl(c.src)})),tc,
      $('#mergepaste')?.checked||false,{url:o.url,title:cleanTitle(o.title)});
    dlgImport.close();
    return toast(`Imported ${o.chars.length} items`+(tc?` into ${tc.tiers.length} tiers`:''));
  }
  if(o.items&&o.tiers){ // full board / import pack
    S=normalize(o); sel.clear(); persist(); render(); dlgImport.close();
    return toast('Loaded "'+S.title+'"');
  }
  toast('Unrecognised JSON shape');
}
function normalize(o){
  const st=blankState(); st.title=o.title||st.title; st.source=o.source||'';
  if(o.opts)Object.assign(st.opts,o.opts);
  delete st.opts.size;
  st.items={}; const map={};
  const arr=Array.isArray(o.items)?o.items:Object.values(o.items);
  arr.forEach(it=>{ const id=it.id||uid();
    st.items[id]={id,name:it.name||nameFromUrl(it.img||''),tags:it.tags||[],
      notes:it.notes||'',img:it.img||it.src||'',src:it.src||'',tmkey:it.tmkey||it.key||''};
    map[it.id||'']=id; if(it.key)map[it.key]=id; if(it.tmkey)map[it.tmkey]=id; });
  const tierMap={};
  st.tiers=(o.tiers||[]).map((t,i)=>{ const id=uid(); if(t.id)tierMap[t.id]=id;
    return {id,label:t.label??t.name??String(i),color:t.color||TM_COLORS[i%10],
      items:(t.items||t.ids||[]).map(x=>map[x]||(st.items[x]?x:null)).filter(Boolean)};
  });
  if(!st.tiers.length)st.tiers=blankState().tiers;
  const placed=new Set(st.tiers.flatMap(t=>t.items));
  st.pool=(o.pool||[]).map(x=>map[x]||x).filter(x=>st.items[x]&&!placed.has(x));
  Object.keys(st.items).forEach(id=>{ if(!placed.has(id)&&!st.pool.includes(id))st.pool.push(id); });
  if(Array.isArray(o.subBoards)&&o.subBoards.length){
    const remapIds=ids=>(ids||[]).map(id=>map[id]||(st.items[id]?id:null)).filter(Boolean);
    st.subBoards=o.subBoards.map((sub,i)=>({id:sub.id||uid(),name:sub.name||`Alternative ${i+1}`,
      layout:{tiers:(sub.layout?.tiers||[]).map(t=>({id:tierMap[t.id]||t.id,items:remapIds(t.items)})),
        pool:remapIds(sub.layout?.pool)}}));
    st.activeSubBoardId=o.activeSubBoardId;
  }
  return st;
}

/* plain text ---------------------------------------------------- */
$('#btnParseText').onclick=()=>{
  const lines=$('#pastetext').value.split('\n').map(s=>s.trim()).filter(Boolean);
  if(!lines.length)return; snapshot();
  lines.forEach(l=>{ const [name,tags,notes]=l.split('|').map(s=>(s||'').trim());
    const id=uid(); S.items[id]={id,name,tags:tags?tags.split(',').map(s=>s.trim()).filter(Boolean):[],
      notes:notes||'',img:'',src:''}; S.pool.push(id); });
  persist(); render(); toast('Added '+lines.length+' items');
};

/* ============================ EXPORT ============================ */
function download(name,blob){ const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),5000); }
const slug=s=>(s||'tierlist').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');

$('#expJson').onclick=()=>{ const out=JSON.stringify(S,null,1);
  $('#expout').value=out.length<400000?out:'(too large to preview — file downloaded)';
  download(slug(S.title)+'.tierforge.json',new Blob([out],{type:'application/json'})); };
$('#expMd').onclick=()=>{ let s=`# ${S.title}\n\n`;
  S.tiers.forEach(t=>{ s+=`## ${t.label}\n`;
    s+=t.items.map(i=>`- ${S.items[i].name}${S.items[i].tags?.length?` _(${S.items[i].tags.join(', ')})_`:''}`
      +`${S.items[i].notes?` — ${S.items[i].notes}`:''}`).join('\n')||'- _(empty)_'; s+='\n\n'; });
  if(S.pool.length)s+=`## Unranked\n`+S.pool.map(i=>`- ${S.items[i].name}`).join('\n')+'\n';
  $('#expout').value=s; };
$('#expCsv').onclick=()=>{ const q=v=>`"${String(v??'').replace(/"/g,'""')}"`;
  let s='tier,rank,name,tags,notes,image\n';
  S.tiers.forEach(t=>t.items.forEach((i,n)=>{ const it=S.items[i];
    s+=[q(t.label),n+1,q(it.name),q((it.tags||[]).join('; ')),q(it.notes),q(it.img)].join(',')+'\n'; }));
  S.pool.forEach((i,n)=>{ const it=S.items[i];
    s+=[q(''),n+1,q(it.name),q((it.tags||[]).join('; ')),q(it.notes),q(it.img)].join(',')+'\n'; });
  $('#expout').value=s;
  download(slug(S.title)+'.csv',new Blob([s],{type:'text/csv'})); };
$('#expCopy').onclick=()=>{ $('#expout').select(); navigator.clipboard.writeText($('#expout').value);
  toast('Copied'); };

/* ---- back to TierMaker -------------------------------------------------
   TierMaker's own "clone this list" button does exactly one thing:
     localStorage.setItem(template + "TierListMakerCode", templateCode)
   then sends you to /create/<template>?ref=list-remix, which rebuilds the rows
   from it. So a board that came from a TierMaker template can be pushed back
   the same way - we just have to regenerate the code and write that key. */
function templateCodeFor(){
  const tpl=(S.source.match(/tiermaker\.com\/(?:list\/[^/]+|create)\/([^/?#]+)/i)||[])[1]
    || Object.values(S.items).map(i=>i.src||'').map(s=>(s.match(/template_images\/[^/]+\/[^/]+\/([^/]+)\//)||[])[1]).find(Boolean);
  if(!tpl) return null;
  const rows=S.tiers.map(t=>[t.label.replace(/[|=]/g,' '),tmColorIndex(t.color),
    ...t.items.map(id=>S.items[id]?.tmkey).filter(Boolean)]);
  const lost=Object.keys(S.items).filter(id=>!S.items[id].tmkey).length;
  return {tpl, code:[tpl,...rows.map(r=>r.join('|'))].join('=='), lost,
    placed:rows.reduce((a,r)=>a+r.length-2,0)};
}
$('#expTm').onclick=()=>{
  const r=templateCodeFor();
  const el=$('#explog');
  if(!r){ el.textContent='This board did not come from a TierMaker template, so there is nothing to push back to.';
    $('#expout').value=''; return; }
  $('#expout').value=r.code;
  const url='https://tiermaker.com/create/'+r.tpl+'?ref=list-remix';
  const push='javascript:'+["(function(){try{localStorage.setItem(",
    JSON.stringify(r.tpl+'TierListMakerCode'),",",JSON.stringify(r.code),
    ");location.href=",JSON.stringify(url),
    "}catch(e){alert('TierForge: could not write to TierMaker storage - '+e)}})()"].join('');
  el.innerHTML=`Rebuilt TierMaker code for <b>${esc(r.tpl)}</b> — ${r.placed} placed item(s)`
    +(r.lost?`, ${r.lost} of your own item(s) can't go back (TierMaker only knows its own template)`:'')
    +`.<br><br>Open <a href="${esc(url)}" target="_blank">${esc(url)}</a> first, then click this
      once you are on tiermaker.com: <a id="push" style="font-weight:700;padding:2px 8px;
      background:var(--panel2);border:1px solid var(--line);border-radius:6px">⬆ TierForge push</a>
      — drag it to your bookmarks bar to reuse it.<br>
      <small class="muted">It writes the same localStorage key TierMaker's own clone button uses,
      then reloads the remix page. Tier colours snap to TierMaker's ten stock rows.</small>`;
  $('#push').setAttribute('href',push);
};

/* image proxy that returns CORS headers, so canvas stays untainted */
const isRemote=u=>/^https?:\/\//i.test(u);
const corsUrl=u=>isRemote(u)
  ? 'https://images.weserv.nl/?url='+encodeURIComponent(u.replace(/^https?:\/\//,'')) : u;
function loadImg(src,anon){ return new Promise(res=>{ const i=new Image();
  // crossOrigin on a file:// or relative src throws "unique security origin" - only set it
  // when the request really is cross-origin.
  if(anon) i.crossOrigin='anonymous';
  i.onload=()=>res(i); i.onerror=()=>res(null); i.src=src; }); }
async function loadForCanvas(src){                  // proxy first: remote hosts rarely send CORS
  if(!isRemote(src)) return loadImg(src,false);     // data:, relative, or file:// - load as-is
  return (await loadImg(corsUrl(src),true)) || (await loadImg(src,true)); }

$('#expEmbed').onclick=()=>embedAll(m=>{ $('#explog').textContent=m; });
async function embedAll(report=()=>{}){
  const list=Object.values(S.items).filter(i=>i.img&&isRemote(i.img));
  if(!list.length){ report('Everything is already embedded.'); return; }
  let ok=0,fail=0;
  for(const it of list){
    report(`Embedding ${ok+fail+1}/${list.length}…`);
    try{ const r=await fetch(corsUrl(it.img)); if(!r.ok)throw 0;
      const b=await r.blob();
      it.img=await new Promise(res=>{ const fr=new FileReader(); fr.onload=()=>res(fr.result); fr.readAsDataURL(b); });
      ok++; }catch(e){ fail++; }
  }
  persist(); render(); report(`Embedded ${ok} image${ok===1?'':'s'}${fail?`, ${fail} failed`:''}.`);
}

$('#expPng').onclick=async()=>{
  const el=$('#explog'); el.textContent='Loading images…';
  const scale=Number($('#pngScale').value)||4;
  const S_=S, subBoardName=activeSubBoard()?.name||'Main',
    exportTitle=`${S_.title} — ${subBoardName}`,
    tileSize=TILE_SIZE, pad=3, labelw=Math.max(120,tileSize*1.6);
  const perRow=Math.max(4,Math.round(1400/(tileSize+pad)));
  const cvs=document.createElement('canvas'), ctx=cvs.getContext('2d');
  const rows=S_.tiers.map(t=>({...t,lines:Math.max(1,Math.ceil(t.items.length/perRow))}));
  const width=labelw+perRow*(tileSize+pad)+pad;
  const height=rows.reduce((a,r)=>a+r.lines*(tileSize+pad)+pad,0)+40;
  // Use a larger backing canvas while keeping all drawing coordinates in board pixels.
  // This preserves the layout but produces a sharper, print-friendly PNG.
  cvs.width=width*scale; cvs.height=height*scale;
  ctx.scale(scale,scale);
  ctx.imageSmoothingEnabled=true;
  ctx.imageSmoothingQuality='high';
  ctx.fillStyle='#0f1115'; ctx.fillRect(0,0,width,height);
  ctx.font='bold 20px Segoe UI,sans-serif'; ctx.fillStyle='#e7eaf0'; ctx.textBaseline='middle';
  ctx.fillText(exportTitle,10,20);
  const cache=new Map(); let y=40, failed=0;
  for(const r of rows){
    const h=r.lines*(tileSize+pad)+pad;
    ctx.fillStyle=r.color; ctx.fillRect(0,y,labelw,h);
    ctx.fillStyle='#111'; ctx.font='bold 18px Segoe UI,sans-serif';
    ctx.textAlign='center';
    wrapText(ctx,r.label,labelw/2,y+h/2,labelw-12,20);
    ctx.textAlign='left';
    for(let k=0;k<r.items.length;k++){
      const it=S_.items[r.items[k]]; if(!it)continue;
      const x=labelw+pad+(k%perRow)*(tileSize+pad), yy=y+pad+Math.floor(k/perRow)*(tileSize+pad);
      ctx.fillStyle='#000'; ctx.fillRect(x,yy,tileSize,tileSize);
      if(it.img){ if(!cache.has(it.img))cache.set(it.img,await loadForCanvas(it.img));
        const img=cache.get(it.img);
        if(img){ const s=Math.min(tileSize/img.width,tileSize/img.height);
          ctx.drawImage(img,x+(tileSize-img.width*s)/2,yy+(tileSize-img.height*s)/2,img.width*s,img.height*s); }
        else failed++; }
      if(!it.img||!cache.get(it.img)){ ctx.fillStyle='#e7eaf0'; ctx.font='11px Segoe UI,sans-serif';
        ctx.textAlign='center'; wrapText(ctx,it.name,x+tileSize/2,yy+tileSize/2,tileSize-6,12); ctx.textAlign='left'; }
      el.textContent='Drawing…';
    }
    y+=h;
  }
  try{ cvs.toBlob(b=>{ download(slug(`${S_.title}-${subBoardName}`)+'.png',b);
    el.textContent=`Done${failed?` — ${failed} image(s) could not be loaded; run "Embed all images" and retry.`:''}`; }); }
  catch(err){ el.textContent='Canvas is tainted — run "Embed all images" first, then export again.'; }
};
function wrapText(ctx,text,x,y,maxw,lh){
  const words=String(text).split(/\s+/), lines=[]; let cur='';
  for(const w of words){ const t=cur?cur+' '+w:w;
    if(ctx.measureText(t).width>maxw&&cur){ lines.push(cur); cur=w; } else cur=t; }
  if(cur)lines.push(cur);
  const start=y-(lines.length-1)*lh/2;
  lines.slice(0,6).forEach((l,i)=>ctx.fillText(l,x,start+i*lh));
}

/* ============================ BOOT ============================ */
(async()=>{
  helperBase=await findHelper();
  updateRuntimeStatus();
  if(helperBase){
    try{ const r=await fetch(helperBase+'/boards/'+encodeURIComponent(AUTOSAVE));
      if(r.ok) S=JSON.parse(await r.text()); }
    catch(e){}
  }
  if(!S||!S.tiers)S=blankState();
  const hadSize=Object.prototype.hasOwnProperty.call(S.opts||{},'size');
  prepareState();
  if(hadSize)persist();
  render();
  if(!helperBase) warnNoHelper();
})();
