import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.split(/=(.*)/s).slice(0, 2)),
)

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY)
const { data, error } = await supabase.auth.getSession()

const response = await fetch(`${env.SUPABASE_URL}/auth/v1/settings`, {
  headers: { apikey: env.SUPABASE_ANON_KEY },
})

if (error) throw error
if (!response.ok) throw new Error(`API Supabase inaccessible (HTTP ${response.status})`)
console.log(`API Supabase joignable : ${env.SUPABASE_URL}`)
console.log(`Session anonyme active : ${data.session === null ? 'oui' : 'non'}`)
