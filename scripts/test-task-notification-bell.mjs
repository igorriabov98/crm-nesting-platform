import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import ts from 'typescript'
const require=createRequire(import.meta.url),h=React.createElement

test('task inbox count refreshes on Realtime, reconnect, focus and fallback; subscriptions clean up',async()=>{
 const dom=new JSDOM('<div id="root"></div>');globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true
 let unread=0,event,reconnect,fallback,cleared=false,removed=false
 const channel={on(_type,filter,callback){assert.equal(filter.table,'notifications');assert.equal(filter.filter,'user_id=eq.employee');event=callback;return this},subscribe(callback){reconnect=callback;return this}}
 const supabase={from:()=>({select:()=>({eq:()=>({eq:async()=>({count:unread,error:null})})})}),channel:()=>channel,removeChannel(){removed=true}}
 const modules=new Map()
 const wrapper=tag=>({children,...props})=>{for(const key of ['variant','size','render','align','sideOffset','onOpenChange','iconClassName'])delete props[key];return h(tag,props,children)}
 function load(file){
  if(modules.has(file))return modules.get(file).exports
  const loadedModule={exports:{}};modules.set(file,loadedModule)
  vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
   module:loadedModule,exports:loadedModule.exports,console,document:dom.window.document,
   window:{setTimeout:()=>1,clearTimeout(){},setInterval(fn,ms){assert.equal(ms,30000);fallback=fn;return 2},clearInterval(){cleared=true},addEventListener:dom.window.addEventListener.bind(dom.window),removeEventListener:dom.window.removeEventListener.bind(dom.window)},
   require(name){
    if(name==='next/navigation')return {useRouter:()=>({push(){}}),usePathname:()=>'/tasks'}
    if(name==='next/link')return {default:wrapper('a')}
    if(name==='@/lib/supabase/client')return {createClient:()=>supabase}
    if(name==='@/lib/hooks/useNavigationProgress')return {useNavigationProgress:()=>({start(){}})}
    if(name.includes('/notifications/actions'))return {getNotifications:async()=>[],markAsRead:async()=>{},markNotificationsAsRead:async()=>({markedCount:0})}
    if(name==='@/components/ui/popover')return {Popover:wrapper('div'),PopoverTrigger:({render})=>render,PopoverContent:()=>null,PopoverDescription:wrapper('p'),PopoverHeader:wrapper('div'),PopoverTitle:wrapper('h2')}
    if(name==='@/components/ui/button')return {Button:wrapper('button')}
    if(name==='@/components/ui/badge')return {Badge:wrapper('span')}
    if(name==='@/components/ui/skeleton')return {Skeleton:()=>null}
    if(name.includes('NotificationGlyph'))return {NotificationGlyph:()=>null}
    if(name.startsWith('@/'))return load(`src/${name.slice(2)}.ts`)
    return require(name)
   }
  });return loadedModule.exports
 }
 const {NotificationBell}=load('src/components/layout/NotificationBell.tsx'),root=createRoot(document.getElementById('root'))
 const label=()=>document.querySelector('button').getAttribute('aria-label')
 Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'})
 try{
  await act(async()=>root.render(h(NotificationBell,{userId:'employee'})))
  unread=1;await act(async()=>event());assert.match(label(),/непрочитанных: 1/)
  unread=2;await act(async()=>reconnect('SUBSCRIBED'));assert.match(label(),/непрочитанных: 2/)
  unread=3;await act(async()=>window.dispatchEvent(new window.Event('focus')));assert.match(label(),/непрочитанных: 3/)
  unread=4;await act(async()=>fallback());assert.match(label(),/непрочитанных: 4/)
  Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});unread=5;await act(async()=>fallback());assert.match(label(),/непрочитанных: 4/)
  Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});await act(async()=>document.dispatchEvent(new window.Event('visibilitychange')));assert.match(label(),/непрочитанных: 5/)
 }finally{await act(async()=>root.unmount());dom.window.close();delete globalThis.window;delete globalThis.document;delete globalThis.IS_REACT_ACT_ENVIRONMENT}
 assert.ok(cleared&&removed)
})
