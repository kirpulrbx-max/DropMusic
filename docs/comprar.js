// Página de compra de DropMusic Pro: inicia sesión con la cuenta de DropMusic (Supabase), cobra con
// PayPal y le pide al servidor (función paypal-capture) que confirme el pago y active Pro.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm'

const config = window.DROPMUSIC_CONFIG ?? {}
const price = Number(config.proPrice || '5').toFixed(2)
const $ = (id) => document.getElementById(id)
const panels = ['checkout-soon', 'checkout-login', 'checkout-recovery', 'checkout-pay']

document.querySelectorAll('[data-price]').forEach((node) => { node.textContent = String(Number(price)) })

function show(panel) {
  for (const id of panels) $(id).hidden = id !== panel
}

function message(text, kind = '') {
  const node = $('checkout-message')
  node.hidden = !text
  node.textContent = text
  node.className = `checkout-message${kind ? ` ${kind}` : ''}`
}

function friendly(error) {
  const text = error?.message ?? String(error ?? '')
  if (/invalid login credentials/i.test(text)) return 'El correo o la contraseña no son correctos.'
  if (/email not confirmed/i.test(text)) return 'Confirma tu correo con el enlace que te enviamos y vuelve a entrar.'
  if (/already registered|already exists/i.test(text)) return 'Ya existe una cuenta con ese correo. Inicia sesión.'
  if (/rate limit/i.test(text)) return 'Demasiados intentos. Espera un minuto y vuelve a probar.'
  return text || 'Algo salió mal. Inténtalo de nuevo.'
}

if (!config.supabaseUrl || !config.supabaseAnonKey) {
  show('checkout-soon')
} else {
  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, { auth: { storageKey: 'dropmusic-web-auth' } })
  let mode = 'entrar'
  let paypalReady = null

  const setMode = (next) => {
    mode = next
    document.querySelectorAll('.checkout-tabs button').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.mode === next)))
    $('password-field').hidden = next === 'recuperar'
    $('login-password').required = next !== 'recuperar'
    $('login-password').autocomplete = next === 'crear' ? 'new-password' : 'current-password'
    $('login-submit').textContent = next === 'entrar' ? 'Iniciar sesión' : next === 'crear' ? 'Crear mi cuenta' : 'Enviarme el enlace'
    $('forgot').textContent = next === 'recuperar' ? 'Volver a iniciar sesión' : '¿Olvidaste tu contraseña?'
  }

  document.querySelectorAll('.checkout-tabs button').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)))
  $('forgot').addEventListener('click', () => setMode(mode === 'recuperar' ? 'entrar' : 'recuperar'))

  $('login-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const email = $('login-email').value.trim()
    const password = $('login-password').value
    message('')
    $('login-submit').disabled = true
    try {
      if (mode === 'entrar') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else if (mode === 'crear') {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: location.href.split('#')[0] } })
        if (error) throw error
        if (!data.session) {
          message('Te enviamos un correo para confirmar tu cuenta. Ábrelo y vuelve aquí para pagar.')
          setMode('entrar')
        }
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] })
        if (error) throw error
        message('Te enviamos un enlace para crear una contraseña nueva.')
      }
    } catch (error) {
      message(friendly(error), 'error')
    } finally {
      $('login-submit').disabled = false
    }
  })

  $('recovery-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const { error } = await supabase.auth.updateUser({ password: $('recovery-password').value })
    if (error) message(friendly(error), 'error')
    else {
      message('Listo, ya puedes entrar con tu contraseña nueva en la app y aquí.', 'success')
      const { data } = await supabase.auth.getSession()
      void render(data.session)
    }
  })

  $('logout').addEventListener('click', () => { void supabase.auth.signOut() })

  function loadPayPal() {
    paypalReady ??= new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(config.paypalClientId)}&currency=USD&intent=capture`
      script.onload = () => resolve(window.paypal)
      script.onerror = () => reject(new Error('No se pudo cargar PayPal. Revisa tu conexión o desactiva el bloqueador de anuncios.'))
      document.head.append(script)
    })
    return paypalReady
  }

  async function render(session) {
    if (!session) {
      show('checkout-login')
      return
    }
    show('checkout-pay')
    $('account-email').textContent = session.user.email ?? ''
    const { data: profile } = await supabase.from('profiles').select('role, plan, pro_until').eq('id', session.user.id).maybeSingle()
    const until = profile?.pro_until ? new Date(profile.pro_until) : null
    const pro = profile?.role === 'admin' || (profile?.plan === 'pro' && (!until || until > new Date()))
    $('account-plan').textContent = profile?.role === 'admin'
      ? 'Administrador · Pro sin vencimiento'
      : pro ? `Pro activo${until ? ` hasta el ${until.toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''} · un pago más suma otro mes` : 'Plan gratuito'

    const container = $('paypal-buttons')
    if (container.dataset.ready === session.user.id) return
    container.dataset.ready = session.user.id
    container.replaceChildren()
    try {
      const paypal = await loadPayPal()
      await paypal.Buttons({
        style: { shape: 'pill', label: 'pay', height: 45 },
        createOrder: (_data, actions) => actions.order.create({
          intent: 'CAPTURE',
          purchase_units: [{ description: 'DropMusic Pro · 1 mes', custom_id: session.user.id, amount: { currency_code: 'USD', value: price } }],
          application_context: { shipping_preference: 'NO_SHIPPING', brand_name: 'DropMusic' },
        }),
        onApprove: async (data) => {
          message('Confirmando tu pago…')
          const { data: current } = await supabase.auth.getSession()
          const response = await fetch(`${config.supabaseUrl}/functions/v1/paypal-capture`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${current.session?.access_token ?? ''}`, apikey: config.supabaseAnonKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId: data.orderID }),
          })
          const result = await response.json().catch(() => ({}))
          if (!response.ok) {
            message(result.error ?? 'No pudimos confirmar el pago. Si se cobró, escríbenos y lo activamos.', 'error')
            return
          }
          message('¡Listo! Ya tienes DropMusic Pro. Vuelve a la app: se activa sola en unos segundos.', 'success')
          container.dataset.ready = ''
          void render(current.session)
        },
        onCancel: () => message('Cancelaste el pago. No se cobró nada.'),
        onError: (error) => {
          console.error(error)
          message('PayPal no pudo completar el pago. Inténtalo de nuevo.', 'error')
        },
      }).render(container)
    } catch (error) {
      container.dataset.ready = ''
      message(friendly(error), 'error')
    }
  }

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      show('checkout-recovery')
      return
    }
    void render(session)
  })
}
