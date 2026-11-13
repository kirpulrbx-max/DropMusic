// Cuentas de DropMusic y plan Pro. Las cuentas viven en Supabase (inicio de sesión con correo y
// contraseña) y el plan solo lo puede cambiar el servidor después de comprobar el pago con PayPal,
// o un administrador. Si la app se compila sin Supabase, las cuentas no aparecen y todo queda abierto.
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'

export type Plan = 'free' | 'pro'
export type Role = 'user' | 'admin'

export type Profile = {
  id: string
  email: string
  role: Role
  plan: Plan
  proUntil: string | null
}

type ProfileRow = { id: string; email: string; role: Role; plan: Plan; pro_until: string | null }

const supabaseUrl: string = import.meta.env.VITE_SUPABASE_URL ?? ''
const supabaseAnonKey: string = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

export const accountsEnabled = Boolean(supabaseUrl && supabaseAnonKey)
export const proPrice: string = import.meta.env.VITE_PRO_PRICE || '5'
export const checkoutUrl: string = import.meta.env.VITE_CHECKOUT_URL || 'https://kirpulrbx-max.github.io/DropMusic/comprar.html'

let client: SupabaseClient | null = null

function supabase() {
  if (!accountsEnabled) throw new Error('Las cuentas de DropMusic todavía no están disponibles.')
  client ??= createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'dropmusic-auth' },
  })
  return client
}

function toProfile(row: ProfileRow): Profile {
  return { id: row.id, email: row.email, role: row.role, plan: row.plan, proUntil: row.pro_until }
}

// Los administradores siempre tienen Pro. El plan Pro dura hasta "proUntil" (cada pago suma un mes).
export function hasPro(profile: Profile | null) {
  if (!profile) return false
  if (profile.role === 'admin') return true
  return profile.plan === 'pro' && (!profile.proUntil || new Date(profile.proUntil).getTime() > Date.now())
}

function friendlyError(error: { message?: string } | null, fallback: string) {
  const message = error?.message ?? ''
  if (/invalid login credentials/i.test(message)) return 'El correo o la contraseña no son correctos.'
  if (/email not confirmed/i.test(message)) return 'Confirma tu correo con el enlace que te enviamos y vuelve a entrar.'
  if (/already registered|already exists/i.test(message)) return 'Ya existe una cuenta con ese correo. Inicia sesión.'
  if (/password should be at least/i.test(message)) return 'La contraseña debe tener al menos 6 caracteres.'
  if (/rate limit/i.test(message)) return 'Demasiados intentos. Espera un minuto y vuelve a probar.'
  if (/fetch|network/i.test(message)) return 'No hay conexión con el servidor de cuentas.'
  return message || fallback
}

export async function getSession() {
  if (!accountsEnabled) return null
  const { data } = await supabase().auth.getSession()
  return data.session
}

export function onSessionChange(listener: (session: Session | null) => void) {
  if (!accountsEnabled) return () => {}
  const { data } = supabase().auth.onAuthStateChange((_event, session) => listener(session))
  return () => data.subscription.unsubscribe()
}

export async function signIn(email: string, password: string) {
  const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password })
  if (error) throw new Error(friendlyError(error, 'No se pudo iniciar sesión.'))
}

// Devuelve true si la cuenta quedó lista, o false si hay que confirmar el correo primero.
export async function signUp(email: string, password: string) {
  // El enlace del correo de confirmación abre la web de DropMusic, que deja la cuenta lista.
  const { data, error } = await supabase().auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: checkoutUrl } })
  if (error) throw new Error(friendlyError(error, 'No se pudo crear la cuenta.'))
  return Boolean(data.session)
}

export async function sendPasswordReset(email: string) {
  const { error } = await supabase().auth.resetPasswordForEmail(email.trim(), { redirectTo: checkoutUrl })
  if (error) throw new Error(friendlyError(error, 'No se pudo enviar el correo.'))
}

export async function signOut() {
  if (!accountsEnabled) return
  await supabase().auth.signOut()
}

export async function fetchProfile(userId: string) {
  const { data, error } = await supabase().from('profiles').select('id, email, role, plan, pro_until').eq('id', userId).maybeSingle<ProfileRow>()
  if (error) throw new Error(friendlyError(error, 'No se pudo cargar tu cuenta.'))
  return data ? toProfile(data) : null
}

// Panel de administración: solo funciona con una cuenta admin (lo exige la base de datos).
export async function adminListProfiles(search: string) {
  let request = supabase().from('profiles').select('id, email, role, plan, pro_until').order('created_at', { ascending: false }).limit(50)
  if (search.trim()) request = request.ilike('email', `%${search.trim().replace(/[%_]/g, '')}%`)
  const { data, error } = await request.returns<ProfileRow[]>()
  if (error) throw new Error(friendlyError(error, 'No se pudieron cargar las cuentas.'))
  return (data ?? []).map(toProfile)
}

export async function adminSetPlan(userId: string, plan: Plan) {
  // Un Pro dado por el administrador no vence.
  const { error } = await supabase().from('profiles').update({ plan, pro_until: null }).eq('id', userId)
  if (error) throw new Error(friendlyError(error, 'No se pudo cambiar el plan.'))
}

// El último plan conocido se guarda para que Pro siga funcionando sin internet.
const cacheKey = 'dropmusic-account-cache'

export function readCachedProfile(): Profile | null {
  try {
    const stored = window.localStorage.getItem(cacheKey)
    if (!stored) return null
    const value = JSON.parse(stored) as Profile
    return typeof value?.id === 'string' && typeof value.email === 'string' ? value : null
  } catch {
    return null
  }
}

export function writeCachedProfile(profile: Profile | null) {
  try {
    if (profile) window.localStorage.setItem(cacheKey, JSON.stringify(profile))
    else window.localStorage.removeItem(cacheKey)
  } catch (error) {
    console.error('No se pudo guardar tu cuenta en este dispositivo.', error)
  }
}

// ---------- Playlists de la comunidad ----------
// Cualquiera las ve; publicar pide una cuenta con sesión. Solo llevan canciones de Spotify.

export type CommunityTrack = {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  artwork: string
  url: string
  albumId: string
  albumType: string
  artists: { id: string; name: string }[]
}

export type CommunityPlaylist = {
  id: string
  ownerId: string
  ownerName: string
  name: string
  description: string
  cover: string
  tracks: CommunityTrack[]
  createdAt: string
}

type CommunityPlaylistRow = {
  id: string
  owner_id: string
  owner_name: string
  name: string
  description: string
  cover: string
  tracks: CommunityTrack[]
  created_at: string
}

function toCommunityPlaylist(row: CommunityPlaylistRow): CommunityPlaylist {
  return {
    id: row.id,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    name: row.name,
    description: row.description,
    cover: row.cover,
    tracks: Array.isArray(row.tracks) ? row.tracks : [],
    createdAt: row.created_at,
  }
}

function playlistError(error: { message?: string; code?: string } | null, fallback: string) {
  // Sin la tabla (falta correr supabase/playlists.sql) Supabase responde que no existe.
  if (error?.code === '42P01' || /community_playlists/i.test(error?.message ?? '')) return 'La comunidad de playlists todavía no está lista. Vuelve a intentarlo más tarde.'
  return friendlyError(error, fallback)
}

export async function listCommunityPlaylists() {
  const { data, error } = await supabase().from('community_playlists')
    .select('id, owner_id, owner_name, name, description, cover, tracks, created_at')
    .order('created_at', { ascending: false })
    .limit(60)
  if (error) throw new Error(playlistError(error, 'No se pudieron cargar las playlists de la comunidad.'))
  return (data as CommunityPlaylistRow[]).map(toCommunityPlaylist)
}

export async function publishCommunityPlaylist(playlist: { ownerName: string; name: string; description: string; tracks: CommunityTrack[] }) {
  const tracks = playlist.tracks.slice(0, 200)
  const { data, error } = await supabase().from('community_playlists')
    .insert({
      owner_name: playlist.ownerName.trim().slice(0, 40) || 'Alguien de DropMusic',
      name: playlist.name.trim().slice(0, 80),
      description: playlist.description.trim().slice(0, 300),
      cover: tracks[0]?.artwork ?? '',
      tracks,
    })
    .select('id, owner_id, owner_name, name, description, cover, tracks, created_at')
    .single()
  if (error) throw new Error(playlistError(error, 'No se pudo publicar la playlist.'))
  return toCommunityPlaylist(data as CommunityPlaylistRow)
}

export async function deleteCommunityPlaylist(id: string) {
  const { error } = await supabase().from('community_playlists').delete().eq('id', id)
  if (error) throw new Error(playlistError(error, 'No se pudo borrar la playlist.'))
}
