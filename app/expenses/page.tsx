import { supabase } from '@/lib/supabase'
import ExpensesClient from '@/components/expenses/ExpensesClient'

export const revalidate = 0

export default async function ExpensesPage() {
  const { data: expenses } = await supabase
    .from('expenses')
    .select('*')
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })

  return <ExpensesClient initialExpenses={expenses ?? []} />
}
