// AWON CMS panel verification (Phase 2.5).
//
// Hard proof that the artifact's admin panel actually works: log in, create a
// record, see it in the DOM, reload, and see it persist. Runs in the scoped
// verification browser only (never an agent tool, never the user's session).
// Every step is a receipt; failures are reported honestly per step.
import path from 'path'
import { withScopedBrowser, settlePage } from './browser'
import { verifyDir, verifyRelPath } from './visual'

export interface CmsStep {
  step: string
  pass: boolean
  detail: string
  shot?: string // verify/<runId>/<name> relative path
}

export interface CmsReport {
  runId: string
  cmsUrl: string
  hasCms: boolean
  steps: CmsStep[]
  status: 'pass' | 'partial' | 'fail' | 'error'
  summary: string
}

const TEST_VALUE = 'AWON-VERIFY-RECORD'

function findBtnExpr(words: string): string {
  return `(() => {
    const rx = new RegExp(${JSON.stringify(words)}, 'i')
    const els = [...document.querySelectorAll('button, [role=button], a, input[type=submit]')]
    const hit = els.find(e => rx.test((e.textContent || '').trim()) || rx.test(e.value || ''))
    return hit ? (hit.id ? '#' + hit.id : hit.tagName.toLowerCase() + (hit.className ? '.' + hit.className.split(' ')[0] : '')) : ''
  })()`
}

export async function verifyCms(artifactId: string, sessionId: string, runId: string, cmsPath: string): Promise<CmsReport> {
  const cmsUrl = `http://localhost:3000/api/awon/preview/${artifactId}/${cmsPath.replace(/^\/+/, '')}`
  const steps: CmsStep[] = []
  const shot = async (b: { screenshot(p: string): Promise<void> }, name: string): Promise<string | undefined> => {
    try {
      const p = path.join(verifyDir(sessionId, runId), name)
      await b.screenshot(p)
      return verifyRelPath(runId, name)
    } catch {
      return undefined
    }
  }

  try {
    await withScopedBrowser(async (b) => {
      await b.setViewport(1280, 860)
      await b.setMedia('light', true)
      await b.open(cmsUrl)
      await settlePage(b, 700)

      // 1. login gate: find a password input
      let hasLogin = false
      try {
        hasLogin = (await b.evalJs('!!document.querySelector("input[type=password]")')) === 'true'
      } catch {}
      if (hasLogin) {
        // try the canonical demo credentials, then any-values; the built cms
        // panels accept demo creds or any input by design
        const combos = [
          { u: 'admin', p: 'admin' },
          { u: 'admin@site.com', p: 'admin123' },
          { u: 'admin', p: 'password' },
        ]
        let loggedIn = false
        let lastErr = 'no attempt made'
        for (const c of combos) {
          try {
            const userSel = await b.evalJs(`(() => { const els = [...document.querySelectorAll('input[type=text],input[type=email],input:not([type])]')]; const e = els.find(i => i.offsetParent !== null); return e ? (e.id ? '#' + e.id : 'input[name="' + e.name + '"]') : '' })()`)
            const passSel = await b.evalJs(`(() => { const e = [...document.querySelectorAll('input[type=password]')].find(i => i.offsetParent !== null); return e ? (e.id ? '#' + e.id : 'input[name="' + e.name + '"]') : '' })()`)
            if (!passSel) break
            if (userSel) await b.fill(userSel, c.u)
            await b.fill(passSel, c.p)
            const submitSel = await b.evalJs(findBtnExpr('login|sign in|log in|submit|enter'))
            if (submitSel) {
              await b.click(submitSel)
              await b.waitFor(600)
            } else {
              await b.pressKey('Enter')
              await b.waitFor(600)
            }
            const gone = (await b.evalJs('!document.querySelector("input[type=password]") || !!document.querySelector("table, .dashboard, main, [class*=panel], [class*=admin]")'))
            if (gone === 'true') {
              loggedIn = true
              break
            }
            lastErr = 'password field still present after submit'
          } catch (e) {
            lastErr = (e as Error).message.slice(0, 120)
          }
        }
        steps.push({ step: 'login', pass: loggedIn, detail: loggedIn ? 'logged into the admin panel (demo credentials accepted by the built gate)' : `could not pass the login gate: ${lastErr}`, shot: await shot(b, 'cms-login.png') })
      } else {
        steps.push({ step: 'login', pass: true, detail: 'no login gate present; panel opened directly', shot: await shot(b, 'cms-login.png') })
      }

      // 2. find a create/add affordance
      const addSel = await b.evalJs(findBtnExpr('\\badd\\b|\\bnew\\b|\\bcreate\\b|add (item|product|post|record|entry)')).catch(() => '')
      steps.push({ step: 'discover-create', pass: !!addSel, detail: addSel ? `create control found (${addSel})` : 'no add/new/create control found in the panel' })

      // 3. create a record through the panel's own UI
      let createdTextInDom = false
      if (addSel) {
        try {
          await b.click(addSel)
          await b.waitFor(400)
          // fill visible text inputs with the test marker
          await b.evalJs(`(() => {
            let n = 0
            for (const i of document.querySelectorAll('input[type=text], input:not([type]), input[type=number], textarea')) {
              if (i.offsetParent === null) continue
              const setter = Object.getOwnPropertyDescriptor(i.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')
              setter?.set?.call(i, '${TEST_VALUE}')
              i.dispatchEvent(new Event('input', { bubbles: true }))
              i.dispatchEvent(new Event('change', { bubbles: true }))
              n++
            }
            return String(n)
          })()`)
          const saveSel = await b.evalJs(findBtnExpr('save|create|submit|confirm|publish|\\badd\\b')).catch(() => '')
          if (saveSel) {
            await b.click(saveSel)
            await b.waitFor(600)
          } else {
            await b.pressKey('Enter')
            await b.waitFor(600)
          }
          createdTextInDom = (await b.evalJs(`document.body.innerText.includes('${TEST_VALUE}')`)) === 'true'
          steps.push({
            step: 'create-record',
            pass: createdTextInDom,
            detail: createdTextInDom ? `record "${TEST_VALUE}" created and visible in the panel` : 'record creation did not surface in the DOM',
            shot: await shot(b, 'cms-create.png'),
          })
        } catch (e) {
          steps.push({ step: 'create-record', pass: false, detail: `create flow error: ${(e as Error).message.slice(0, 140)}`, shot: await shot(b, 'cms-create.png') })
        }
      }

      // 4. reload and assert persistence (localStorage-backed CRUD)
      if (addSel) {
        try {
          await b.reload()
          await settlePage(b, 700)
          // some panels return to login after reload; pass the gate again with the first combo
          const needsLogin = (await b.evalJs('!!document.querySelector("input[type=password]")')) === 'true'
          if (needsLogin) {
            const userSel = await b.evalJs(`(() => { const e = [...document.querySelectorAll('input[type=text],input[type=email],input:not([type])]')].find(i => i.offsetParent !== null); return e ? (e.id ? '#' + e.id : 'input[name="' + e.name + '"]') : '' })()`)
            const passSel = await b.evalJs(`(() => { const e = [...document.querySelectorAll('input[type=password]')].find(i => i.offsetParent !== null); return e ? (e.id ? '#' + e.id : 'input[name="' + e.name + '"]') : '' })()`)
            if (passSel) {
              if (userSel) await b.fill(userSel, 'admin')
              await b.fill(passSel, 'admin')
              const submitSel = await b.evalJs(findBtnExpr('login|sign in|log in|submit|enter'))
              if (submitSel) await b.click(submitSel).catch(() => {})
              await b.waitFor(600)
            }
          }
          const persisted = (await b.evalJs(`document.body.innerText.includes('${TEST_VALUE}')`)) === 'true'
          const stored = (await b.evalJs(`Object.keys(localStorage).some(k => (localStorage.getItem(k) || '').includes('${TEST_VALUE}'))`)) === 'true'
          steps.push({
            step: 'persistence',
            pass: persisted || stored,
            detail: persisted ? 'record survived a full page reload and is rendered by the panel' : stored ? 'record persisted to localStorage but is not re-rendered' : 'record did not survive reload',
            shot: await shot(b, 'cms-persist.png'),
          })
        } catch (e) {
          steps.push({ step: 'persistence', pass: false, detail: `reload check error: ${(e as Error).message.slice(0, 140)}` })
        }
      }

      // 5. site reflects CMS data (best-effort: the public page reads the same store)
      try {
        const entryUrl = cmsUrl.replace(/cms(\d*)\.html$/, 'index.html')
        await b.open(entryUrl)
        await settlePage(b, 600)
        const reflected = (await b.evalJs(`document.body.innerText.includes('${TEST_VALUE}')`)) === 'true'
        steps.push({
          step: 'site-reflection',
          pass: reflected,
          detail: reflected ? 'the public site renders the CMS record (shared localStorage store detected)' : 'public site does not surface the test record (may be expected: separate pages or gated views)',
          shot: await shot(b, 'cms-reflect.png'),
        })
      } catch (e) {
        steps.push({ step: 'site-reflection', pass: false, detail: `reflection check error: ${(e as Error).message.slice(0, 140)}` })
      }
    })
  } catch (e) {
    return {
      runId,
      cmsUrl,
      hasCms: false,
      steps,
      status: 'error',
      summary: `cms verification could not run: ${(e as Error).message.slice(0, 160)}`,
    }
  }

  const passed = steps.filter((s) => s.pass).length
  const required = steps.filter((s) => ['login', 'discover-create', 'create-record', 'persistence'].includes(s.step))
  const allRequiredPassed = required.length > 0 && required.every((s) => s.pass)
  const status: CmsReport['status'] = allRequiredPassed && passed === steps.length ? 'pass' : passed > 0 ? 'partial' : 'fail'
  return {
    runId,
    cmsUrl,
    hasCms: true,
    steps,
    status,
    summary: `${passed}/${steps.length} cms checks passed`,
  }
}
