import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'

const connection = process.env.SHEET_IMPORT_TEST_DATABASE_URL
assert.ok(connection, 'Set SHEET_IMPORT_TEST_DATABASE_URL to a local full-schema test database')
const url = new URL(connection)
assert.ok(['localhost','127.0.0.1'].includes(url.hostname) && /test/i.test(url.pathname), 'Local test database required')
const lit = value => value === null ? 'NULL' : `'${String(value).replaceAll("'","''")}'`
const json = value => `${lit(JSON.stringify(value))}::jsonb`
function query(sql, actor) {
  const prelude = actor ? `SET ROLE authenticated; SET "request.jwt.claim.sub" = ${lit(actor)}; SET "request.jwt.claim.role" = 'authenticated';` : ''
  const result = spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1','-d',connection],{input:prelude+sql,encoding:'utf8'})
  if(result.status !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}
const id = { factory:randomUUID(), otherFactory:randomUUID(), admin:randomUUID(), manager:randomUUID(), viewer:randomUUID(), technologist:randomUUID(), dept:randomUUID(), viewDept:randomUUID(), techDept:randomUUID() }
const prefix = `Import ${randomUUID()}`
query(`
  INSERT INTO public.factories(id,name) VALUES (${lit(id.factory)},${lit(prefix)}),(${lit(id.otherFactory)},${lit(prefix+' other')});
  INSERT INTO public.users(id,email,full_name,role,factory_id,is_active) VALUES
    (${lit(id.admin)},${lit(id.admin+'@import.test')},'Import admin','engineer',${lit(id.factory)},true),
    (${lit(id.manager)},${lit(id.manager+'@import.test')},'Import manager','engineer',${lit(id.factory)},true),
    (${lit(id.viewer)},${lit(id.viewer+'@import.test')},'Import viewer','engineer',${lit(id.factory)},true),
    (${lit(id.technologist)},${lit(id.technologist+'@import.test')},'Import technologist','technologist',${lit(id.factory)},true);
  INSERT INTO public.user_system_roles(user_id,role) VALUES (${lit(id.admin)},'crm_admin');
  INSERT INTO public.departments(id,name,is_active,factory_id) VALUES (${lit(id.dept)},${lit(prefix+' department')},true,${lit(id.factory)}),(${lit(id.viewDept)},${lit(prefix+' viewers')},true,${lit(id.factory)}),(${lit(id.techDept)},${lit(prefix+' technologists')},true,${lit(id.factory)});
  INSERT INTO public.department_members(user_id,department_id,is_department_head) VALUES (${lit(id.manager)},${lit(id.dept)},false),(${lit(id.viewer)},${lit(id.viewDept)},false),(${lit(id.technologist)},${lit(id.techDept)},false);
  INSERT INTO public.department_access_permissions(department_id,subject_scope,resource_key,can_view,can_manage,factory_scope) VALUES
    (${lit(id.dept)},'member','inventory',true,true,'own'),(${lit(id.viewDept)},'member','inventory',true,false,'own'),
    (${lit(id.techDept)},'member','nesting_catalog',true,true,'own');
  INSERT INTO public.steel_types(name,density_kg_mm3) VALUES (${lit(prefix+' Сталь')},0.00000785);
`)
const base = {row:2,material:prefix+' Лист',grade:prefix+' Сталь',thickness:2,width:1000,length:2000,quantity:10}
function preview(rows,actor=id.admin,factory=id.factory) { return JSON.parse(query(`SELECT public.fn_preview_sheet_inventory_import(${lit(factory)},${json(rows)});`,actor)) }
function commitSQL(rows,p,operation=randomUUID(),previous=null,factory=id.factory) {
  return `SELECT public.fn_commit_sheet_inventory_import(${lit(factory)},${json(rows)},'stock.xlsx',${lit(operation)},${lit(p.previewHash)},${lit(previous)});`
}
function commit(rows,p,operation=randomUUID(),previous=null,actor=id.admin,factory=id.factory) { return JSON.parse(query(commitSQL(rows,p,operation,previous,factory),actor)) }
const count = table => Number(query(`SELECT count(*) FROM public.${table}`))
const before = ['inventory','inventory_transactions','materials','material_variants','steel_types','inventory_sheet_imports'].map(count)
const p = preview([base])
assert.deepEqual(p.errors,[])
assert.equal(p.quantity,10); assert.equal(p.weightKg,314); assert.equal(p.newMaterials,1); assert.equal(p.newGrades,0)
assert.throws(()=>commit([base],p,randomUUID(),null,id.viewer),/Нет права/)
assert.throws(()=>commit([base],p,randomUUID(),null,id.manager,id.otherFactory),/Нет права/)
assert.deepEqual(['inventory','inventory_transactions','materials','material_variants','steel_types','inventory_sheet_imports'].map(count),before,'Preview must be read-only')
assert.match(preview([base],id.manager).errors[0].message,/право/)
assert.throws(()=>preview([base],id.viewer),/Нет права/)
assert.throws(()=>preview([base],id.manager,id.otherFactory),/Нет права/)
assert.throws(()=>query(`SET ROLE anon; SELECT public.fn_preview_sheet_inventory_import(${lit(id.factory)},${json([base])});`),/permission denied/)
assert.throws(()=>query(`INSERT INTO public.inventory_sheet_imports DEFAULT VALUES`,id.manager),/permission denied/)
const operation = randomUUID()
const first = commit([base],p,operation)
assert.equal(first.replayed,false)
const row = JSON.parse(query(`SELECT row_to_json(i) FROM public.inventory i JOIN public.materials m ON m.id=i.material_id WHERE m.name=${lit(base.material)} AND i.factory_id=${lit(id.factory)}`))
assert.equal(row.total_quantity,10); assert.equal(row.available_quantity,10); assert.equal(row.calculated_weight_kg,314)
assert.equal(row.is_business_scrap,false); assert.equal(row.piece_length_mm,null)
assert.equal(query(`SELECT sheet_import_row || '|' || (supplier_id IS NULL)::text FROM public.inventory_transactions WHERE sheet_import_id=${lit(operation)}`),'2|true')
assert.equal(commit([base],p,operation).replayed,true)
assert.equal(query(`SELECT total_quantity FROM public.inventory WHERE id=${lit(row.id)}`),'10')
assert.throws(()=>commit([{...base,quantity:11}],p,operation),/другого импорта/)

const p2 = preview([base])
assert.equal(p2.newMaterials,0); assert.equal(p2.newGrades,0); assert.equal(p2.newVariants,0); assert.equal(p2.previous.id,operation)
assert.throws(()=>commit([base],p2),/уже импортированы/)
assert.throws(()=>commit([base],p),/изменились/)
query(`UPDATE public.inventory SET reserved_quantity=3 WHERE id=${lit(row.id)}`)
const repeated = commit([base],p2,randomUUID(),operation,id.manager)
assert.equal(repeated.quantity,10)
assert.equal(query(`SELECT total_quantity || '|' || reserved_quantity || '|' || available_quantity || '|' || calculated_weight_kg FROM public.inventory WHERE id=${lit(row.id)}`),'20|3|17|628.00')
assert.equal(query(`SELECT count(*) FROM public.inventory_sheet_imports WHERE factory_id=${lit(id.factory)}`,id.viewer),'2','Read-only role can read journal')
assert.match(preview([{...base,density:7.85}]).errors[0].message,/старого шаблона/)
assert.match(preview([{...base,quantity:-1}]).errors[0].message,/Некорректные/)
assert.match(preview([{...base,quantity:1.5}]).errors[0].message,/Некорректные/)
assert.match(preview([base,base]).errors[0].message,/номера строки/)

const split = [{...base,quantity:4},{...base,row:3,quantity:6,material:'  '+base.material.toUpperCase()+'  '}]
assert.equal(preview(split).fingerprint,p2.fingerprint,'Split rows and whitespace must not bypass duplicate protection')
const mixed = [{...base,quantity:2},{...base,row:3,material:prefix+' Лист рифленный',quantity:1}]
const mixedResult = commit(mixed,preview(mixed))
assert.equal(query(`SELECT supplier_id IS NULL FROM public.inventory_transactions WHERE sheet_import_id=${lit(mixedResult.batchId)} AND sheet_import_row=2`),'t')
assert.equal(query(`SELECT count(DISTINCT material_id) FROM public.inventory_transactions WHERE sheet_import_id=${lit(mixedResult.batchId)}`),'2')
const otherPreview=preview([base],id.admin,id.otherFactory)
assert.equal(otherPreview.previous,null)
commit([base],otherPreview,randomUUID(),null,id.admin,id.otherFactory)
assert.equal(query(`SELECT count(*) FROM public.inventory WHERE material_id=${lit(row.material_id)}`),'2')
assert.equal(query(`SELECT count(*) FROM public.inventory_sheet_imports WHERE factory_id=${lit(id.otherFactory)}`,id.viewer),'0','Journal must not expose other factories')

// Exercise the maximum upload against actual stock triggers, not only parsing.
const maximumRows = Array.from({length:2000},(_,i)=>({...base,row:i+2,quantity:1}))
const quantityBefore = Number(query(`SELECT total_quantity FROM public.inventory WHERE id=${lit(row.id)}`))
const maximumResult = commit(maximumRows,preview(maximumRows))
assert.equal(maximumResult.receiptCount,2000)
assert.equal(maximumResult.quantity,2000)
assert.equal(query(`SELECT total_quantity || '|' || reserved_quantity FROM public.inventory WHERE id=${lit(row.id)}`),`${quantityBefore+2000}|3`)
assert.equal(query(`SELECT count(*) FROM public.inventory_transactions WHERE sheet_import_id=${lit(maximumResult.batchId)}`),'2000')

// Force a real failure after the first row has already created catalogue data,
// inventory and a receipt; all these writes, including the journal, must roll back.
const failRows=[{...base,material:prefix+' Rollback',grade:prefix+' Rollback steel'},{...base,row:3,material:prefix+' Rollback',grade:prefix+' Rollback steel',quantity:1}]
const failPreview=preview(failRows); const failOp=randomUUID()
query(`CREATE FUNCTION public.sheet_import_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.sheet_import_id=${lit(failOp)}::uuid AND NEW.sheet_import_row=3 THEN RAISE EXCEPTION 'Forced second-row failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER sheet_import_test_failure BEFORE INSERT ON public.inventory_transactions FOR EACH ROW EXECUTE FUNCTION public.sheet_import_test_failure();`)
try { assert.throws(()=>commit(failRows,failPreview,failOp),/Forced second-row failure/) }
finally { query('DROP TRIGGER sheet_import_test_failure ON public.inventory_transactions; DROP FUNCTION public.sheet_import_test_failure();') }
assert.equal(query(`SELECT count(*) FROM public.materials WHERE name=${lit(prefix+' Rollback')}`),'0')
assert.equal(query(`SELECT count(*) FROM public.steel_types WHERE name=${lit(prefix+' Rollback steel')}`),'0')
assert.equal(query(`SELECT count(*) FROM public.inventory_sheet_imports WHERE id=${lit(failOp)}`),'0')
assert.equal(query(`SELECT count(*) FROM public.tasks WHERE title=${lit('Указать плотность стали: '+prefix+' Rollback steel')}`),'0')

const duplicateName = prefix+' Duplicate Лист'
const duplicateMaterialA = randomUUID(), duplicateMaterialB = randomUUID()
const knownSteel = query(`SELECT id FROM public.steel_types WHERE name=${lit(base.grade)}`)
query(`INSERT INTO public.materials(id,name,category,created_by) VALUES
  (${lit(duplicateMaterialA)},${lit(duplicateName)},'sheet_metal',${lit(id.admin)}),
  (${lit(duplicateMaterialB)},${lit(duplicateName)},'sheet_metal',${lit(id.admin)});
  INSERT INTO public.material_variants(material_id,category,steel_type_id,material_grade,thickness_mm,sheet_size,default_unit) VALUES
  (${lit(duplicateMaterialA)},'sheet_metal',${lit(knownSteel)},${lit(base.grade)},2,'1000x2000','шт'),
  (${lit(duplicateMaterialB)},'sheet_metal',${lit(knownSteel)},${lit(base.grade)},3,'1000x2000','шт');`)
const existingDuplicateRows = [{...base,material:duplicateName,quantity:2}]
const existingDuplicatePreview = preview(existingDuplicateRows)
assert.deepEqual(existingDuplicatePreview.errors,[])
assert.equal(existingDuplicatePreview.rows[0].materialId,duplicateMaterialA)
const existingDuplicateReceipt = commit(existingDuplicateRows,existingDuplicatePreview)
assert.equal(query(`SELECT material_id FROM public.inventory_transactions WHERE sheet_import_id=${lit(existingDuplicateReceipt.batchId)}`),duplicateMaterialA)
const newDuplicateRows = [{...base,material:duplicateName,thickness:1.5,quantity:2}]
const newDuplicatePreview = preview(newDuplicateRows)
assert.deepEqual(newDuplicatePreview.errors,[])
assert.equal(newDuplicatePreview.rows[0].variantId,null)
commit(newDuplicateRows,newDuplicatePreview)
assert.equal(query(`SELECT count(*) FROM public.materials WHERE name=${lit(duplicateName)}`),'3')
query(`INSERT INTO public.material_variants(material_id,category,steel_type_id,material_grade,thickness_mm,sheet_size,default_unit)
VALUES(${lit(duplicateMaterialB)},'sheet_metal',${lit(knownSteel)},${lit(base.grade)},2,'1000x2000','шт')`)
assert.match(preview([{...base,material:duplicateName,quantity:3}]).errors[0].message,/Несколько одинаковых позиций/)

const unknownGrade = prefix+' 235'
const unknownRows = [{...base,material:prefix+' Density pending',grade:unknownGrade,thickness:1.5,quantity:20}]
const unknownPreview = preview(unknownRows)
assert.deepEqual(unknownPreview.errors,[])
assert.equal(unknownPreview.weightKg,null)
assert.deepEqual(unknownPreview.pendingDensityGrades,[unknownGrade])
const unknownReceipt = commit(unknownRows,unknownPreview)
const unknownSteel = query(`SELECT id FROM public.steel_types WHERE name=${lit(unknownGrade)}`)
assert.equal(query(`SELECT density_kg_mm3 IS NULL FROM public.steel_types WHERE id=${lit(unknownSteel)}`),'t')
assert.equal(query(`SELECT calculated_weight_kg IS NULL FROM public.inventory i JOIN public.material_variants v ON v.id=i.material_variant_id WHERE v.steel_type_id=${lit(unknownSteel)} AND i.factory_id=${lit(id.factory)}`),'t')
assert.equal(query(`SELECT weight_kg IS NULL FROM public.inventory_sheet_imports WHERE id=${lit(unknownReceipt.batchId)}`),'t')
assert.equal(query(`SELECT count(*) FROM public.tasks WHERE steel_type_id=${lit(unknownSteel)} AND status='pending'`),'1')
assert.equal(query(`SELECT u.role FROM public.tasks t JOIN public.users u ON u.id=t.assigned_to WHERE t.steel_type_id=${lit(unknownSteel)}`),'technologist')
assert.throws(()=>query(`UPDATE public.tasks SET status='completed' WHERE steel_type_id=${lit(unknownSteel)}`),/Задача закроется после заполнения/)
const unknownRepeatPreview = preview(unknownRows)
commit(unknownRows,unknownRepeatPreview,randomUUID(),unknownReceipt.batchId)
assert.equal(query(`SELECT count(*) FROM public.tasks WHERE steel_type_id=${lit(unknownSteel)}`),'1')
// The local reconstructed DB lacks Supabase's platform grants; retain RLS as the subject of this check.
query('GRANT SELECT, UPDATE ON public.steel_types TO authenticated')
assert.equal(query(`UPDATE public.steel_types SET density_kg_mm3=0.00000785 WHERE id=${lit(unknownSteel)} RETURNING id`,id.viewer),'')
query(`UPDATE public.steel_types SET density_kg_mm3=0.00000785 WHERE id=${lit(unknownSteel)}`,id.technologist)
assert.equal(query(`SELECT status FROM public.tasks WHERE steel_type_id=${lit(unknownSteel)}`),'completed')
assert.equal(query(`SELECT calculated_weight_kg FROM public.inventory i JOIN public.material_variants v ON v.id=i.material_variant_id WHERE v.steel_type_id=${lit(unknownSteel)} AND i.factory_id=${lit(id.factory)}`),'942.00')
assert.equal(query(`SELECT string_agg(weight_kg::text,',' ORDER BY created_at) FROM public.inventory_sheet_imports WHERE source_rows @> ${json([{steelTypeId:unknownSteel}])}`),'471.00,471.00')

function concurrent(sql) {
  return new Promise(resolve=>{
    const child=spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1','-d',connection]); let out='',err=''
    child.stdout.on('data',b=>out+=b); child.stderr.on('data',b=>err+=b)
    child.on('close',code=>resolve({code,out:out.trim(),err}))
    child.stdin.end(`SET ROLE authenticated; SET "request.jwt.claim.sub"=${lit(id.admin)};${sql}`)
  })
}
const raceRows=[{...base,material:prefix+' Concurrent',quantity:7}]
const racePreview=preview(raceRows); const raceId=randomUUID()
const race=await Promise.all([concurrent(commitSQL(raceRows,racePreview,raceId)),concurrent(commitSQL(raceRows,racePreview,raceId))])
assert.ok(race.every(r=>r.code===0),JSON.stringify(race))
assert.deepEqual(race.map(r=>JSON.parse(r.out).replayed).sort(),[false,true])
assert.equal(query(`SELECT sum(quantity) FROM public.inventory_transactions WHERE sheet_import_id=${lit(raceId)}`),'7')
const racePreview2=preview(raceRows)
const distinct=await Promise.all([concurrent(commitSQL(raceRows,racePreview2,randomUUID(),raceId)),concurrent(commitSQL(raceRows,racePreview2,randomUUID(),raceId))])
assert.equal(distinct.filter(r=>r.code===0).length,1,JSON.stringify(distinct))
assert.match(distinct.find(r=>r.code!==0).err,/предыдущий импорт/)
console.log('Sheet import DB: preview, atomic receipt/rollback, catalogue, density, reservations, factories, permissions, replay and concurrent requests OK')
