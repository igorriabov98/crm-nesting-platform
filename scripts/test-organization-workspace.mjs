import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import ts from 'typescript'

const require = createRequire(import.meta.url), h = React.createElement

test('password recovery uses an emailed Supabase recovery link and keeps the reset page public', () => {
  const action = readFileSync('src/lib/actions/organization.ts', 'utf8')
  const form = readFileSync('src/components/features/auth/ResetPasswordForm.tsx', 'utf8')
  const proxy = readFileSync('src/proxy.ts', 'utf8')
  assert.match(action, /crm_prepare_password_reset/)
  assert.match(action, /resetPasswordForEmail\(email,[\s\S]*redirectTo/)
  assert.match(action, /crm_finish_password_reset_request/)
  assert.match(form, /PASSWORD_RECOVERY/)
  assert.match(form, /updateUser\(\{ password \}\)/)
  assert.match(form, /fatalError/)
  assert.match(form, /formError/)
  assert.match(proxy, /pathname === '\/reset-password'/)
})

test('assignment drafts survive review/errors, unresolved supervisors require a choice, duplicate moves require explicit consolidation, settings and tree expose actions', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://crm.test/admin/organization' })
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  let query = new URLSearchParams('tab=users'), calls = [], resetCalls = [], fail = true
  const actions = {
    getOrganizationHistory: async () => ({data:[],error:null}),
    applyOrganizationChange: async input => { calls.push(input); return {success:!fail,error:fail ? 'Сохранение не выполнено' : null} },
    previewOffboarding: async () => ({data:{version:'1', obligations:[]},error:null}),
    sendOrganizationPasswordReset: async userId => { resetCalls.push(userId); return {success:true,email:'member@example.test',error:null} },
  }
  const modules = new Map()
  const ui = tag => ({children, ...props}) => {
    for (const key of ['variant','size','render','nativeButton','onOpenChange']) delete props[key]
    return h(tag, props, children)
  }
  function load(file) {
    const absolute = path.resolve(file)
    if (modules.has(absolute)) return modules.get(absolute).exports
    const loadedModule = {exports:{}}; modules.set(absolute,loadedModule)
    vm.runInNewContext(ts.transpileModule(readFileSync(absolute,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText, {
      module:loadedModule,exports:loadedModule.exports, window:dom.window, FormData:dom.window.FormData, Event:dom.window.Event,
      require(name) {
        if(name==='next/navigation')return {useSearchParams:()=>query,useRouter:()=>({replace(url){query=new URLSearchParams(url.split('?')[1]);render()},push(url){query=new URLSearchParams(url.split('?')[1]);render()},refresh(){}})}
        if(name==='next/link')return {default:ui('a')}
        if(name==='sonner')return {toast:{success(){},error(){}}}
        if(name==='@/lib/actions/organization')return actions
        if(name==='@/components/providers/PermissionProvider')return {ACCESS_REFRESH_EVENT:'access-refresh'}
        if(name==='@/components/features/settings/UserAccessPreview')return {UserAccessPreview:()=>null}
        if(name==='@/components/ui/dialog')return {Dialog:({open,children})=>open?h('div',{'data-dialog':true},children):null,DialogContent:ui('div'),DialogHeader:ui('header'),DialogTitle:ui('h2'),DialogDescription:ui('p')}
        if(name==='@/components/ui/button')return {Button:ui('button')}
        if(name==='@/components/ui/input')return {Input:ui('input')}
        if(name==='@/components/ui/badge')return {Badge:ui('span')}
        if(name.startsWith('@/'))return load(`src/${name.slice(2)}.ts`)
        if(name.startsWith('./'))return load(path.resolve(path.dirname(absolute),`${name}.tsx`))
        return require(name)
      }
    })
    return loadedModule.exports
  }
  const {OrganizationWorkspace} = load('src/components/features/organization/OrganizationWorkspace.tsx')
  const data = {version:'1',currentUserId:'admin',isAdmin:true,permissions:{admin_users:{canView:true,canManage:true},departments:{canView:true,canManage:true}},factories:[],positions:[{id:'position',name:'Менеджер',is_active:true}],departments:[{id:'a',name:'Корневой отдел',parent_id:null,is_active:true},{id:'b',name:'Дочерний отдел',parent_id:'a',is_active:true}],users:[{id:'admin',full_name:'Администратор',email:'admin@example.test',is_active:true,is_admin:true},{id:'member',full_name:'Сотрудник',email:'member@example.test',is_active:true}],memberships:[{id:'source',user_id:'member',department_id:'a',position_id:null,is_primary:true,is_department_head:false,reports_to_user_id:'admin',reports_to_membership_id:null},{id:'destination',user_id:'member',department_id:'b',position_id:'position',is_primary:false,is_department_head:false,reports_to_user_id:null,reports_to_membership_id:null}]}
  const root = createRoot(document.getElementById('root'))
  const render = () => root.render(h(OrganizationWorkspace,{data}))
  const button = text => [...document.querySelectorAll('button')].find(e=>e.textContent.trim()===text && !e.closest('[hidden]'))
  const click = async text => { assert.ok(button(text),`Missing button ${text}`); await act(async()=>button(text).click()) }
  const submit = async () => { await act(async()=>document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}))) }
  const select = async (name,value) => { const el=document.querySelector(`[name="${name}"]`);el.value=value;await act(async()=>el.dispatchEvent(new dom.window.Event('change',{bubbles:true}))) }
  try {
    await act(async()=>render())
    await click('Уточнить'); await submit()
    assert.match(document.querySelector('[role="alert"]').textContent,/Выберите назначение/)
    assert.equal(calls.length,0,'Unresolved default must not be silently saved')
    await select('reports_to_membership_id',''); await select('department_id','b')
    await submit(); await click('Сохранить изменения')
    assert.equal(calls[0].data.department_id,'b'); assert.equal(calls[0].data.reports_to_membership_id,null)
    assert.equal(document.querySelector('[name="department_id"]').value,'b','Department draft reset after server failure')
    assert.equal(document.querySelector('[name="position_id"]').value,'','Position draft reset after server failure')
    await select('position_id','position'); await submit()
    assert.ok(button('Объединить назначения'))
    assert.match(document.body.textContent,/настройки|должность, руководитель и права/)
    await click('Вернуться')
    assert.equal(document.querySelector('[name="position_id"]').value,'position','Review Back lost chosen position')
    await submit(); fail=false; await click('Объединить назначения')
    assert.equal(calls[1].kind,'consolidate_assignment');assert.equal(calls[1].data.target_membership_id,'destination')
    await act(async()=>document.querySelector('[aria-label="Настройки пользователя Сотрудник"]').click())
    assert.ok(button('Редактировать пользователя')); assert.ok(button('Удалить пользователя')); assert.ok(button('Передать дела и заблокировать'))
    await click('Редактировать пользователя')
    assert.equal(document.querySelector('[name="email"]').value,'member@example.test')
    assert.ok(button('Отправить письмо для сброса пароля'))
    await click('Отправить письмо для сброса пароля')
    assert.deepEqual(resetCalls,['member'])
    await click('Отмена')
    // Dismiss the selected user through route navigation; same component retains state.
    await click('Отделы и структура')
    assert.equal(document.querySelector('nav').textContent.includes('ОтделыСтруктура'),false)
    const child=document.getElementById('department-b')
    assert.match(child.textContent,/Корневой отдел/)
    assert.equal(child.closest('li').style.marginInlineStart,'20px')
    assert.ok([...child.querySelectorAll('button')].some(b=>b.textContent.includes('Удалить из отдела')))
    query = new URLSearchParams('tab=structure'); await act(async()=>render())
    assert.ok(document.querySelector('[aria-label="Дерево отделов"]'),'Legacy structure URL must resolve to unified page')
  } finally { await act(async()=>root.unmount());dom.window.close();delete globalThis.window;delete globalThis.document;delete globalThis.IS_REACT_ACT_ENVIRONMENT }
})
