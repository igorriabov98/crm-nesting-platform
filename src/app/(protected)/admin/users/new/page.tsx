import { redirect } from 'next/navigation'
export default function NewUserRedirect(){redirect('/admin/organization?tab=users&create=user')}
