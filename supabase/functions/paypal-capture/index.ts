// Cobra un pedido de PayPal y activa DropMusic Pro en la cuenta que lo pagó.
// La clave secreta de PayPal vive solo aquí, como secreto de Supabase: nunca va dentro de la app.
//
// Secretos (Supabase > Edge Functions > Secrets):
//   PAYPAL_CLIENT_ID   Client ID de la app de PayPal (el mismo que usa la web)
//   PAYPAL_SECRET      Secret de esa app de PayPal
//   PAYPAL_ENV         "live" para cobrar de verdad o "sandbox" para pruebas
//   PRO_PRICE          precio de un mes de Pro en USD, por ejemplo "5.00"
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

const paypalBase = Deno.env.get('PAYPAL_ENV') === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'
const price = Number(Deno.env.get('PRO_PRICE') ?? '5.00').toFixed(2)

async function paypalToken() {
  const credentials = btoa(`${Deno.env.get('PAYPAL_CLIENT_ID')}:${Deno.env.get('PAYPAL_SECRET')}`)
  const response = await fetch(`${paypalBase}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  })
  if (!response.ok) throw new Error('PayPal rechazó las credenciales del servidor.')
  return (await response.json()).access_token as string
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return reply(405, { error: 'Método no permitido.' })

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const jwt = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  const { data: userData, error: userError } = await supabase.auth.getUser(jwt)
  const user = userData?.user
  if (userError || !user) return reply(401, { error: 'Inicia sesión para comprar DropMusic Pro.' })

  const { orderId } = await request.json().catch(() => ({ orderId: '' }))
  if (typeof orderId !== 'string' || !/^[A-Z0-9]{8,40}$/.test(orderId)) return reply(400, { error: 'El pedido de PayPal no es válido.' })

  const { data: used } = await supabase.from('payments').select('order_id').eq('order_id', orderId).maybeSingle()
  if (used) return reply(409, { error: 'Este pago ya se usó.' })

  try {
    const token = await paypalToken()
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    let order = await (await fetch(`${paypalBase}/v2/checkout/orders/${orderId}`, { headers })).json()
    const unit = order?.purchase_units?.[0]
    if (unit?.custom_id !== user.id) return reply(403, { error: 'Este pago no es de tu cuenta.' })
    if (unit?.amount?.currency_code !== 'USD' || unit?.amount?.value !== price) return reply(400, { error: 'El monto del pago no coincide con el precio de Pro.' })
    if (order.status === 'APPROVED') {
      order = await (await fetch(`${paypalBase}/v2/checkout/orders/${orderId}/capture`, { method: 'POST', headers })).json()
    }
    const capture = order?.purchase_units?.[0]?.payments?.captures?.[0]
    if (order?.status !== 'COMPLETED' || capture?.status !== 'COMPLETED') return reply(402, { error: 'PayPal todavía no confirmó el pago.' })

    const { error: paymentError } = await supabase.from('payments').insert({ order_id: orderId, user_id: user.id, amount: price, currency: 'USD' })
    if (paymentError) return reply(409, { error: 'Este pago ya se usó.' })

    // Cada pago suma un mes desde hoy o desde que vence el Pro que ya tenía.
    const { data: profile } = await supabase.from('profiles').select('pro_until').eq('id', user.id).single()
    const start = Math.max(Date.now(), profile?.pro_until ? new Date(profile.pro_until).getTime() : 0)
    const proUntil = new Date(start + 30 * 24 * 60 * 60 * 1000).toISOString()
    await supabase.from('profiles').update({ plan: 'pro', pro_until: proUntil }).eq('id', user.id)
    return reply(200, { ok: true, proUntil })
  } catch (error) {
    console.error(error)
    return reply(502, { error: 'No se pudo hablar con PayPal. Si se cobró, escríbenos y lo activamos.' })
  }
})
