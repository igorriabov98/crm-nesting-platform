import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const url=new URL(process.env.ORGANIZATION_TEST_DATABASE_URL || 'postgresql://localhost/crm_unified_organization_test')
assert.ok(['localhost','127.0.0.1'].includes(url.hostname)&&url.pathname.includes('test'),'Organization tests require a local test database')
for(const suite of ['organization_access_test.sql','organization_rls_test.sql']){
const result=spawnSync('psql',['-X','-v','ON_ERROR_STOP=1',url.toString(),'-f',fileURLToPath(new URL(`../supabase/tests/${suite}`,import.meta.url))],{stdio:'inherit'})
assert.equal(result.status,0,'Organization database properties failed')

}
