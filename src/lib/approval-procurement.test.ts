import assert from 'node:assert/strict'
import test from 'node:test'
import { approvedProcurement } from './approval-procurement'
import type { ApprovalSummaryItem } from './technologist-request-approval'
const item: ApprovalSummaryItem = { key:'request_circle:a',category:'request_circle',categoryLabel:'Круг',name:'Hardox',quantity:6000,unit:'мм',weightKg:33,businessScrapReserved:1000,regularStockReserved:4532,wastePercent:null }
test('procurement counts full purchased blanks including kerf, never useful shortage or reserved bars',()=>{
 const plan=approvedProcurement(item,[{stock_length_mm:6000,length_group:'standard',source_type:'new_stock'},{stock_length_mm:5500,length_group:'standard',source_type:'business_remnant'}])
 assert.equal(plan.quantity,6000)
 assert.deepEqual(plan.components,[{length_mm:6000,piece_count:1,is_nonstandard:false}])
})
test('mixed lengths retain each physical blank count',()=>{
 const plan=approvedProcurement(item,[6000,6000,4500].map(stock_length_mm=>({stock_length_mm,length_group:'standard',source_type:'new_stock'})))
 assert.equal(plan.quantity,16500); assert.deepEqual(plan.components.map(x=>[x.piece_count,x.length_mm]),[[2,6000],[1,4500]])
})
test('known warehouse-only plan is zero; missing historical plan is unknown',()=>{
 assert.equal(approvedProcurement(item,[]).quantity,0)
 assert.equal(approvedProcurement(item).unavailable,true)
})
test('ordinary materials subtract approved reservations, preserve original quantity',()=>{
 const sheet={...item,category:'request_sheet_metal',quantity:12,unit:'шт',businessScrapReserved:2,regularStockReserved:5}
 assert.equal(approvedProcurement(sheet).quantity,5);assert.equal(sheet.quantity,12)
 const wire={...sheet,category:'request_pipe',attributes:{pipe_type:'wire'},unit:'кг'}
 assert.equal(approvedProcurement(wire).quantity,5)
})
