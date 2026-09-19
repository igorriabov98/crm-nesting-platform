import test from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_MATRIX_CELL as empty,reconcileMatrixDraft } from './matrix-draft'
test('refresh rebases untouched rows and preserves a local edit',()=>{
 const view={...empty,canView:true},manage={...view,canManage:true}
 const result=reconcileMatrixDraft({a:empty,b:empty},{a:view,b:empty},{a:empty,b:manage})
 assert.deepEqual(result,{draft:{a:view,b:manage},conflicts:[]})
})
test('competing edits require review and keep the local draft',()=>{
 const base={...empty,canView:true},local={...base,canManage:true},remote={...base,factoryScope:'all' as const}
 assert.deepEqual(reconcileMatrixDraft({a:base},{a:local},{a:remote}),{draft:{a:local},conflicts:['a']})
})
test('convergent edits do not report a conflict',()=>{
 const changed={...empty,canView:true}
 assert.deepEqual(reconcileMatrixDraft({a:empty},{a:changed},{a:changed}),{draft:{a:changed},conflicts:[]})
})
test('remote removal conflicts with a changed local grant',()=>{
 const view={...empty,canView:true},manage={...view,canManage:true}
 assert.deepEqual(reconcileMatrixDraft({a:view},{a:manage},{}),{draft:{a:manage},conflicts:['a']})
})
