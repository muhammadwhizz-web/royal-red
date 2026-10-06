// probe the VERIFY tab dashboard for verify-shot images via agent-browser.
// exits 0 and prints the url when found; exits 1 otherwise.
import { execFileSync } from 'child_process'

function ab(args: string[]): string {
  try {
    return execFileSync('agent-browser', args, { encoding: 'utf8', timeout: 20000 })
  } catch (e) {
    return String((e as { stdout?: string }).stdout ?? '')
  }
}

// ensure the VERIFY tab is active (full pointer sequence, Radix-safe)
const switchJs = `var L=document.querySelectorAll('[role=tab]'); var t=null; for(var i=0;i<L.length;i++){ if(L[i].textContent==='VERIFY'){ t=L[i]; break } } if(t){ var r=t.getBoundingClientRect(); var o={bubbles:true,cancelable:true,view:window,clientX:r.x+r.width/2,clientY:r.y+r.height/2}; t.dispatchEvent(new PointerEvent('pointerdown',o)); t.dispatchEvent(new MouseEvent('mousedown',o)); t.dispatchEvent(new PointerEvent('pointerup',o)); t.dispatchEvent(new MouseEvent('mouseup',o)); t.dispatchEvent(new MouseEvent('click',o)); 'dispatched' } else { 'no tab' }`
ab(['eval', switchJs])

const probeJs = `var I=document.querySelectorAll('img'); var out=''; for(var i=0;i<I.length;i++){ var s=I[i].getAttribute('src')||''; if(s.indexOf('verify-shot')>-1){ out=s; break } } out`
for (let attempt = 0; attempt < 5; attempt++) {
  const out = ab(['eval', probeJs]).trim().replace(/^"|"$/g, '')
  if (out.includes('verify-shot')) {
    console.log(out)
    process.exit(0)
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1200)
}
process.exit(1)
