import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'
import React from 'react'
import * as jsx from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const require = createRequire(import.meta.url)
let liveManage = true
const source = ts.transpileModule(readFileSync('src/components/features/inventory/InventoryPage.tsx','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText
const loaded = {exports:{} as {InventoryPage: React.ComponentType<Record<string,unknown>>}}
vm.runInNewContext(source,{module:loaded,exports:loaded.exports,require(name:string){
  if(name==='react')return React
  if(name==='react/jsx-runtime')return jsx
  if(name==='next/link')return {default:'a'}
  if(name==='next/dynamic')return {default:()=>()=>null}
  if(name==='next/navigation')return {useRouter:()=>({refresh(){},push(){}})}
  if(name==='@/components/providers/PermissionProvider')return {usePermissions:()=>({can:()=>liveManage})}
  if(name.startsWith('@/lib/actions/'))return {}
  if(name.startsWith('@/components/ui/'))return new Proxy({}, {get:(_target,key)=>key==='AlertDialog'?()=>null:key==='Button'?'button':key==='Input'?'input':'span'})
  if(name.includes('ReservationOrdersDialog'))return {ReservationOrdersDialog:()=>null}
  return require(name)
}})
const props={items:[{id:'stock',active_cut_reservations:[],active_whole_bar_reservations:[],material_id:'material',factory_id:'factory',material:{name:'Проверочный материал',category:'components'},unit:'шт',total_quantity:5,reserved_quantity:0,available_quantity:5,display_total_quantity:5,display_reserved_quantity:0,updated_at:'2026-09-19T00:00:00Z'}],factories:[{id:'factory',name:'Завод'}],activeFactoryId:'factory',suppliers:[],steelTypes:[]}
for(const [label,initial,live,expected] of [['Finance view only',false,true,false],['Warehouse manager',true,true,true],['Permission revoked after load',true,false,false]] as const){
 test(label,()=>{
  liveManage=live
  const html=renderToStaticMarkup(<loaded.exports.InventoryPage {...props} canManageInventory={initial}/> )
  assert.ok(html.includes('Проверочный материал'),'View must keep stock data')
  for(const action of ['Приход на склад','Корректировка','Удалить'])assert.equal(html.includes(action),expected,action)
 })
}
