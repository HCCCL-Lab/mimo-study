const form=document.querySelector('form'), error=document.querySelector('#form-error');
const schooling=form.elements.Qschooling;schooling.type='number';schooling.min='0';schooling.max='50';schooling.id='schooling';
const schoolLabel=schooling.closest('tr').querySelector('td');const label=document.createElement('label');label.htmlFor='schooling';label.textContent=schoolLabel.textContent;schoolLabel.replaceChildren(label);
for(const input of form.querySelectorAll('input[type=radio]')){
  const existing=input.labels[0],label=existing||document.createElement('label');
  input.before(label);const following=input.nextSibling;label.prepend(input);
  if(!existing&&following?.nodeType===Node.TEXT_NODE)label.append(following);
  label.classList.add('radio-option');
}
for(const row of form.querySelectorAll('tr')){
  const inputs=row.querySelectorAll('input[type=radio]');if(!inputs.length)continue;
  const question=row.querySelector('td');question.id=inputs[0].name+'-label';
  const group=inputs[0].closest('td');group.setAttribute('role','group');group.setAttribute('aria-labelledby',question.id);
}
form.onsubmit=e=>{
  e.preventDefault();if(!form.reportValidity())return;
  const values=Object.fromEntries(new FormData(form));
  form.querySelector('[type=submit]').disabled=true;error.textContent='';
  parent.postMessage({type:'adult-demographics',demographics:{age:+values.age,gender:values.gender,schooling:+values.Qschooling,hungarian:({1:'native',2:'second',3:'no'})[values.Qhungarian],sni:values.Qsni==='1'?'yes':'no',course:values.Qkurzus||''}},location.origin);
};
window.addEventListener('message',e=>{
  if(e.origin!==location.origin||e.source!==parent||e.data?.type!=='demographics-error')return;
  error.textContent=e.data.message;form.querySelector('[type=submit]').disabled=false;
});
const notify=()=>parent.postMessage({type:'demographics-height',height:Math.ceil(form.getBoundingClientRect().bottom+scrollY+error.offsetHeight+24)},location.origin);
new ResizeObserver(notify).observe(document.body);notify();
