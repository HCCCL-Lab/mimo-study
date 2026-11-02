document.querySelector('#acceptButton')?.addEventListener('click',e=>{
  e.preventDefault();parent.postMessage({type:'adult-consent-accepted'},location.origin);
});
document.querySelector('form')?.addEventListener('submit',e=>e.preventDefault());
