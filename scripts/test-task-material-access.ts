import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { z } from 'zod'
import { getNotificationDestination } from '../src/components/features/notifications/notification-model'

test('material classification action uses technical permission and actor RPC, never general order UPDATE', async () => {
  const file = readFileSync('src/app/(protected)/sales-plan/actions.ts','utf8')
  const source = file.slice(file.indexOf('export async function updateMachineMaterialType('), file.indexOf('// === Обновление ===',file.indexOf('export async function updateMachineMaterialType(')))
  let allowed=true, calls=0
  const loaded={exports:{} as {updateMachineMaterialType:(id:string,type:string)=>Promise<{success:boolean,error:string|null}>}}
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
    module:loaded,exports:loaded.exports,
    requirePermission:async(resource:string,operation:string)=>{
      assert.equal(resource,'technologist_requests');assert.equal(operation,'manage')
      if(!allowed)throw new Error('Недостаточно прав')
      return {supabase:{rpc:async(name:string,args:Record<string,string>)=>{
        assert.equal(name,'crm_set_machine_material_type');assert.equal(args.p_machine_id,'c2000000-0000-4000-8000-000000000020');assert.ok(['standard','non_standard'].includes(args.p_material_type));calls++;return {error:null}
      }}}
    },
    machineIdSchema:z.string().uuid(),materialTypeActionSchema:z.enum(['standard','non_standard','undefined']),
    refreshMaterialUndefinedAgenda:async()=>{},after:()=>{},revalidatePath:()=>{},ROUTES:{},getErrorMessage:(error:Error)=>error.message,
  })
  for(const kind of ['standard','non_standard'])assert.equal((await loaded.exports.updateMachineMaterialType('c2000000-0000-4000-8000-000000000020',kind)).success,true)
  allowed=false;assert.equal((await loaded.exports.updateMachineMaterialType('c2000000-0000-4000-8000-000000000020','standard')).success,false)
  assert.equal(calls,2)
})

test('assignment notification opens the exact task even when it also links an order',()=>{
  assert.deepEqual(getNotificationDestination({id:'n',type:'task_assigned',title:'Task',message:'Assigned',created_at:'',is_read:false,consumable_request_id:null,related_machine_id:'machine',related_task_id:'task'}),{href:'/tasks?task=task',label:'Открыть задачу'})
})
