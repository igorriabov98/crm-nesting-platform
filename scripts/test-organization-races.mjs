import assert from 'node:assert/strict'
import { spawn,spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
const source=new URL(process.env.ORGANIZATION_TEST_DATABASE_URL || 'postgresql://localhost/crm_unified_organization_test')
assert.ok(['localhost','127.0.0.1'].includes(source.hostname)&&source.pathname.includes('test'),'Local test database required')
const connectionEnv={...process.env,...(source.username?{PGUSER:decodeURIComponent(source.username)}:{}),...(source.password?{PGPASSWORD:decodeURIComponent(source.password)}:{})}
const name=`crm_org_race_test_${process.pid}`,url=new URL(source);url.pathname=`/${name}`
function tool(command,args){const r=spawnSync(command,args,{encoding:'utf8',env:connectionEnv});assert.equal(r.status,0,r.stderr);return r.stdout}
function sql(query){const r=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1',url.toString()],{input:query,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim()}
function concurrent(query){return new Promise(resolve=>{const child=spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1',url.toString()]);let stdout='',stderr='';child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>stderr+=v);child.on('close',status=>resolve({status,stdout,stderr}));child.stdin.end(query)})}
const admin=randomUUID(),employee=randomUUID(),task=randomUUID(),dept=randomUUID()
const actor=`SET request.jwt.claim.sub='${admin}'; SET request.jwt.claim.role='authenticated';`
tool('createdb',['-h',source.hostname,'-p',source.port||'5432','-T',source.pathname.slice(1),name])
try{
 sql(`INSERT INTO users(id,email,full_name,role) VALUES('${admin}','${admin}@test.local','Race admin','engineer'),('${employee}','${employee}@test.local','Race employee','engineer'); INSERT INTO user_system_roles(user_id,role) VALUES('${admin}','crm_admin'); INSERT INTO departments(id,name) VALUES('${dept}','Race department');`)
 const version=sql('SELECT version FROM organization_revision')
 const first=concurrent(`${actor} BEGIN; SELECT 1 FROM organization_revision FOR UPDATE; SELECT pg_sleep(0.5); INSERT INTO tasks(id,assigned_to,task_type,title) VALUES('${task}','${employee}','agenda_pool_distribution','Concurrent duty'); COMMIT;`)
 await new Promise(resolve=>setTimeout(resolve,150))
 const second=concurrent(`${actor} SELECT crm_change_user_status('${employee}',false,${version});`)
 const [created,blocked]=await Promise.all([first,second]);assert.equal(created.status,0,created.stderr);assert.notEqual(blocked.status,0);assert.match(blocked.stderr,/передайте все действующие обязанности/)
 assert.equal(sql(`SELECT is_active FROM users WHERE id='${employee}'`),'t')
 sql(`UPDATE tasks SET status='completed' WHERE id='${task}';`)
 const blocking=concurrent(`${actor} BEGIN; SELECT crm_change_user_status('${employee}',false,(SELECT version FROM organization_revision)); SELECT pg_sleep(0.5); COMMIT;`)
 await new Promise(resolve=>setTimeout(resolve,150))
 const late=concurrent(`INSERT INTO tasks(assigned_to,task_type,title) VALUES('${employee}','agenda_pool_distribution','Too late');`)
 const [done,rejected]=await Promise.all([blocking,late]);assert.equal(done.status,0,done.stderr);assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/заблокированному пользователю/)
 const change=JSON.stringify([{departmentId:dept,subjectScope:'member',resourceKey:'inventory',canView:true,canManage:false,factoryScope:'own',companyViewScope:'own',companyManageScope:'own',expectedRevision:'0'}])
 const winner=concurrent(`${actor} BEGIN; SELECT crm_save_matrix('${change}'::jsonb); SELECT pg_sleep(0.5); COMMIT;`)
 await new Promise(resolve=>setTimeout(resolve,150))
 const loser=concurrent(`${actor} SELECT crm_save_matrix('${change}'::jsonb);`)
 const [saved,conflict]=await Promise.all([winner,loser]);assert.equal(saved.status,0,saved.stderr);assert.notEqual(conflict.status,0);assert.match(conflict.stderr,/Матрица изменена/)
 const token=randomUUID(),generation=sql(`SELECT generation FROM crm_claim_auth_sync('${token}','${employee}')`)
 assert.ok(generation)
 sql(`${actor} SELECT crm_change_user_status('${employee}',true,(SELECT version FROM organization_revision)); SELECT crm_finish_auth_sync('${employee}','${token}','${generation}',NULL);`)
 assert.equal(sql(`SELECT desired_active AND synced_at IS NULL FROM user_auth_sync WHERE user_id='${employee}'`),'t','Old Auth response acknowledged a newer intent')
 console.log('Organization concurrent duties, blocking, matrix CAS and Auth generations: passed')
}finally{tool('dropdb',['-h',source.hostname,'-p',source.port||'5432','--force',name])}
