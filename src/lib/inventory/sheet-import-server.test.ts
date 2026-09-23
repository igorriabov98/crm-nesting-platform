import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
import ExcelJS from 'exceljs'
import * as xlsx from './sheet-import-xlsx'
import * as types from './sheet-import-types'
import { assertFactoryAccess } from '@/lib/permissions/factory-scope'
import { ROUTES } from '@/lib/constants/routes'

const factory = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const other = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'
const require = createRequire(import.meta.url)
let denied = false
const calls: Array<{name:string;args?:Record<string,unknown>}> = []
let rpcError: {message:string;code:string} | null = null
const preview = { rows:[], errors:[], quantity:10,weightKg:314,pendingDensityGrades:[],fingerprint:'b'.repeat(64),previewHash:'a'.repeat(64),previous:null,newMaterials:0,newGrades:0,newVariants:0 }
const changedPaths: string[] = []
const moduleRef = {exports:{} as {
  sheetImportUploadResponse: (request:Request,commit:boolean)=>Promise<Response>
  sheetImportTemplateResponse: ()=>Promise<Response>
}}
const source=ts.transpileModule(readFileSync(new URL('./sheet-import-server.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
vm.runInNewContext(source,{module:moduleRef,exports:moduleRef.exports,Buffer,File,Request,Response,URL,Error,require(name:string){
  if(name==='server-only')return {}
  if(name==='next/cache')return {revalidatePath:(path:string)=>changedPaths.push(path)}
  if(name==='@/lib/permissions/server')return {requirePermission:async()=>{
    if(denied){const e=new Error('Недостаточно прав');e.name='PermissionDeniedError';throw e}
    return {factoryId:factory,role:'engineer',permissionDetails:{isAdminPosition:false,factoryScopes:{inventory:{manage:'own'}}},supabase:{rpc:async(name:string,args?:Record<string,unknown>)=>{
      calls.push({name,args})
      return {data:name==='fn_sheet_inventory_import_catalog'?{grades:[]}:name==='fn_preview_sheet_inventory_import'?preview:{batchId:'done',quantity:10,weightKg:314,receiptCount:1,replayed:false},error:rpcError}
    }}}
  }}
  if(name==='@/lib/permissions/factory-scope')return {assertFactoryAccess}
  if(name==='@/lib/constants/routes')return {ROUTES}
  if(name==='./sheet-import-xlsx')return xlsx
  if(name==='./sheet-import-types')return types
  return require(name)
}})
async function request(options:{factory?:string;quantity?:number;origin?:string;commit?:boolean}={}){
  const book=new ExcelJS.Workbook();const sheet=book.addWorksheet('Импорт')
  sheet.addRow([...types.SHEET_IMPORT_HEADERS]);sheet.addRow(['Лист','S235',2,1000,2000,options.quantity??10])
  const data=new FormData();data.set('file',new File([new Uint8Array(await book.xlsx.writeBuffer())],'stock.xlsx'))
  data.set('factoryId',options.factory??factory)
  data.set('rows','[{"quantity":999}]') // Never trust client supplied parsed rows.
  if(options.commit){data.set('operationId',other);data.set('previewHash',preview.previewHash)}
  return new Request('https://crm.example/api/inventory/sheet-import/preview',{method:'POST',body:data,headers:{origin:options.origin??'https://crm.example'}})
}
test('HTTP boundary authenticates, parses the actual file, previews without mutation and commits with session RPC',async()=>{
  calls.length=0
  let response=await moduleRef.exports.sheetImportUploadResponse(await request(),false)
  assert.equal(response.status,200);assert.equal(calls[0].name,'fn_preview_sheet_inventory_import')
  assert.equal((calls[0].args?.p_rows as types.SheetImportRow[])[0].quantity,10)
  assert.equal(changedPaths.length,0)
  response=await moduleRef.exports.sheetImportUploadResponse(await request({commit:true}),true)
  assert.equal(response.status,200);assert.equal(calls[1].name,'fn_commit_sheet_inventory_import')
  assert.equal(calls[1].args?.p_operation_id,other);assert.ok(!('p_performed_by' in calls[1].args!))
  assert.ok(changedPaths.includes(ROUTES.INVENTORY_HISTORY))
})
test('HTTP rejects permission, factory, origin, invalid file and missing preview before commit',async()=>{
  denied=true
  assert.equal((await moduleRef.exports.sheetImportUploadResponse(await request(),false)).status,403)
  denied=false;calls.length=0
  assert.equal((await moduleRef.exports.sheetImportUploadResponse(await request({factory:other}),false)).status,403)
  assert.equal((await moduleRef.exports.sheetImportUploadResponse(await request({origin:'https://outside.example'}),true)).status,403)
  assert.equal((await moduleRef.exports.sheetImportUploadResponse(await request({quantity:-1,commit:true}),true)).status,400)
  assert.equal((await moduleRef.exports.sheetImportUploadResponse(await request(),true)).status,400)
  assert.equal(calls.length,0)
})
test('HTTP enforces streaming size limit and exposes stale preview as conflict',async()=>{
  const huge=new Request('https://crm.example/import',{method:'POST',body:new Uint8Array(4*1024*1024)})
  assert.equal((await moduleRef.exports.sheetImportUploadResponse(huge,true)).status,413)
  rpcError={message:'Повторите проверку',code:'40001'}
  assert.equal((await moduleRef.exports.sheetImportUploadResponse(await request({commit:true}),true)).status,409)
  rpcError=null
})
test('template route returns an actual xlsx and enforces inventory/manage',async()=>{
  const response=await moduleRef.exports.sheetImportTemplateResponse()
  assert.equal(response.status,200)
  assert.match(response.headers.get('content-type')!,/spreadsheetml/)
  assert.ok((await response.arrayBuffer()).byteLength>1000)
  denied=true;assert.equal((await moduleRef.exports.sheetImportTemplateResponse()).status,403);denied=false
})
