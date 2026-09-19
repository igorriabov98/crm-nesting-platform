import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync,readdirSync,readFileSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const base=`crm_org_migration_test_${process.pid}`,restored=`${base}_restore`,url=`postgresql://localhost/${base}`,backupDir=mkdtempSync(join(tmpdir(),'crm-organization-test-'))
const admin='d0000000-0000-4000-8000-000000000001',employee='d0000000-0000-4000-8000-000000000002',dept='d0000000-0000-4000-8000-000000000010'
function run(command,args,options={}){const result=spawnSync(command,args,{encoding:'utf8',maxBuffer:32*1024*1024,...options});assert.equal(result.status,0,result.stderr||result.stdout);return result.stdout.trim()}
function sql(text,db=url){return run('psql',['-X','-qAt','-v','ON_ERROR_STOP=1',db],{input:text})}
const snapshot=`SELECT jsonb_build_object('users',(SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM users u),'matrix',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM department_access_permissions p),'members',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM department_members m));`
try{
 run(process.execPath,['scripts/test-inventory-transfers-full-schema.mjs'],{env:{...process.env,FULL_SCHEMA_TEST_DATABASE_URL:url,FULL_SCHEMA_MIGRATION_BEFORE:'20260919120000',FULL_SCHEMA_REPLAY_ONLY:'true'}})
 sql(`CREATE TABLE IF NOT EXISTS auth.users(id uuid PRIMARY KEY,email text);
 INSERT INTO auth.users VALUES('${admin}','migration-admin@test.local'),('${employee}','migration-member@test.local');
 INSERT INTO users(id,email,full_name,role) VALUES('${admin}','migration-admin@test.local','Migration admin','engineer'),('${employee}','migration-member@test.local','Migration member','engineer');
 INSERT INTO departments(id,name,is_active) VALUES('${dept}','Migration fixture',true); INSERT INTO departments(name,is_active) VALUES('Финансовый отдел',true);
 INSERT INTO department_members(user_id,department_id,position_id,is_department_head) SELECT '${admin}','${dept}',id,true FROM positions WHERE name='Администратор CRM' LIMIT 1;
 UPDATE departments SET head_user_id='${admin}' WHERE id='${dept}';
 INSERT INTO department_members(user_id,department_id,is_department_head) VALUES('${employee}','${dept}',false);
 INSERT INTO department_access_permissions(department_id,subject_scope,resource_key,can_view,can_manage) VALUES('${dept}','member','inventory',true,false);`)
 const before=sql(snapshot),adminBefore=sql(`SELECT crm_user_is_admin('${admin}')`)
 const memberIds=sql('SELECT string_agg(id::text,\',\' ORDER BY id) FROM department_members')
 const rights=sql(`SET request.jwt.claim.sub='${employee}'; SELECT private.crm_has_permission('inventory','view'),private.crm_has_permission('inventory','manage');`)
 run('pg_dump',['-Fc','--no-owner','-f',join(backupDir,'before.dump'),url])
 for(const migration of readdirSync('supabase/migrations').filter(f=>/^20260919.*\.sql$/.test(f)).sort())sql('BEGIN;\n'+readFileSync(join('supabase/migrations',migration),'utf8')+'\nCOMMIT;')
 assert.equal(sql(`SELECT crm_user_is_admin('${admin}')`),adminBefore,'Admin cutover changed authority')
 assert.equal(sql('SELECT string_agg(id::text,\',\' ORDER BY id) FROM department_members'),memberIds,'Membership IDs changed')
 assert.equal(sql(`SET request.jwt.claim.sub='${employee}'; SELECT private.crm_has_permission('inventory','view'),private.crm_has_permission('inventory','manage');`),rights,'Ordinary rights changed')
 assert.equal(sql(`SELECT count(*) FROM department_members WHERE is_primary`),'2','Sole memberships must become primary')
 run('createdb',['-h','localhost',restored]);run('pg_restore',['--no-owner','--exit-on-error','-d',`postgresql://localhost/${restored}`,join(backupDir,'before.dump')])
 assert.equal(sql(snapshot,`postgresql://localhost/${restored}`),before,'Backup restoration changed users, assignments or matrix')
 assert.equal(sql(`SELECT crm_user_is_admin('${admin}')`,`postgresql://localhost/${restored}`),adminBefore)
 console.log('Organization forward migration and full backup restoration: passed')
}finally{
 run('dropdb',['-h','localhost','--if-exists','--force',base]);run('dropdb',['-h','localhost','--if-exists','--force',restored]);rmSync(backupDir,{recursive:true,force:true})
}
