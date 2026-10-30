import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { openUrl } from '@tauri-apps/plugin-opener'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowUpRight,
  AudioLines,
  ChevronDown,
  Clock3,
  Compass,
  Disc3,
  Headphones,
  Heart,
  Library,
  ListMusic,
  Music2,
  Pause,
  Play,
  Plus,
  Repeat2,
  Search,
  Settings2,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react'

type Provider = 'Spotify' | 'Apple Music' | 'YouTube Music'
type Section = 'Escuchar' | 'Explorar' | 'Tu colección' | 'Favoritos' | 'Ajustes'

type Track = {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  audioUrl?: string
  artwork: string
  collectionUrl: string
  color: string
  mood: string
  genre: string
  source?: 'Spotify' | 'Jamendo'
}

type SpotifyTrackResult = {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  artwork: string
  url: string
}

type SpotifySearchPage = {
  tracks: SpotifyTrackResult[]
  total: number
  offset: number
  nextOffset: number | null
}

type JamendoTrackResult = {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  artwork: string
  audioUrl: string
  url: string
}

type JamendoSearchPage = {
  tracks: JamendoTrackResult[]
}

type SpotifyPlaybackTrack = {
  id: string | null
  name: string
  uri: string
  duration_ms: number
  artists: { name: string }[]
  album: { name: string; images: { url: string }[] }
}

type SpotifyPlaybackState = {
  paused: boolean
  position: number
  duration: number
  track_window: {
    current_track: SpotifyPlaybackTrack
  }
}

type SpotifyWebPlayer = {
  addListener(event: 'ready', listener: (event: { device_id: string }) => void): boolean
  addListener(event: 'not_ready', listener: (event: { device_id: string }) => void): boolean
  addListener(event: 'player_state_changed', listener: (state: SpotifyPlaybackState | null) => void): boolean
  addListener(
    event: 'initialization_error' | 'authentication_error' | 'account_error' | 'playback_error',
    listener: (event: { message: string }) => void,
  ): boolean
  connect(): Promise<boolean>
  disconnect(): void
  activateElement(): Promise<void>
  togglePlay(): Promise<void>
  previousTrack(): Promise<void>
  nextTrack(): Promise<void>
  seek(position: number): Promise<void>
  setVolume(volume: number): Promise<void>
}

type SpotifySdk = {
  Player: new (options: {
    name: string
    volume: number
    getOAuthToken: (callback: (token: string) => void) => void
  }) => SpotifyWebPlayer
}

declare global {
  interface Window {
    Spotify?: SpotifySdk
    onSpotifyWebPlaybackSDKReady?: () => void
  }
}

type AppSettings = {
  volume: number
  preset: string
  equalizerEnabled: boolean
  bandGains: number[]
  ambientGlow: boolean
  preferredService: Provider
  jamendoClientId: string
}

type ConnectedAccount = {
  name: string
  email?: string
}

type OAuthCallback = {
  state: string
  code?: string
  error?: string
}

const spotifyClientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID
const defaultJamendoClientId = import.meta.env.VITE_JAMENDO_CLIENT_ID ?? ''
let spotifySdkPromise: Promise<void> | null = null
const emptyTrack: Track = {
  id: '',
  title: 'Nada sonando',
  artist: 'Elige una canción',
  album: '',
  duration: 0,
  audioUrl: '',
  artwork: '',
  collectionUrl: '',
  color: '#54856b',
  mood: '',
  genre: '',
}
const bandLabels = ['60 Hz', '250 Hz', '1 kHz', '4 kHz', '12 kHz']
const bandFrequencies = [60, 250, 1000, 4000, 12000]
const presets: Record<string, number[]> = {
  Plano: [0, 0, 0, 0, 0],
  'Bajos cálidos': [5, 3, 0, -1, 0],
  'Voz clara': [-2, 0, 3, 4, 1],
  'Noche suave': [-2, 1, 2, 0, -3],
}

const defaults: AppSettings = {
  volume: 72,
  preset: 'Plano',
  equalizerEnabled: true,
  bandGains: [0, 0, 0, 0, 0],
  ambientGlow: true,
  preferredService: 'Spotify',
  jamendoClientId: defaultJamendoClientId,
}

const tracks: Track[] = []

function loadSpotifyPlaybackSdk() {
  if (window.Spotify) return Promise.resolve()
  if (spotifySdkPromise) return spotifySdkPromise

  const pending = new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Spotify tardó demasiado en cargar el reproductor.')), 20000)
    const previousReady = window.onSpotifyWebPlaybackSDKReady
    window.onSpotifyWebPlaybackSDKReady = () => {
      window.clearTimeout(timeout)
      previousReady?.()
      resolve()
    }

    let script = document.querySelector<HTMLScriptElement>('script[data-spotify-player-sdk]')
    if (!script) {
      script = document.createElement('script')
      script.dataset.spotifyPlayerSdk = 'true'
      script.src = 'https://sdk.scdn.co/spotify-player.js'
      script.async = true
      document.head.append(script)
    }
    script.onerror = () => {
      window.clearTimeout(timeout)
      reject(new Error('No se pudo cargar el reproductor oficial de Spotify. Comprueba tu conexión.'))
    }
  })
  spotifySdkPromise = pending
  void pending.catch(() => {
    if (spotifySdkPromise === pending) spotifySdkPromise = null
  })
  return pending
}

const navigation: { label: Section; icon: LucideIcon }[] = [
  { label: 'Escuchar', icon: AudioLines },
  { label: 'Explorar', icon: Compass },
  { label: 'Tu colección', icon: Library },
  { label: 'Favoritos', icon: Heart },
  { label: 'Ajustes', icon: Settings2 },
]

const providers: { name: Provider; description: string; url: string; guide: string }[] = [
  {
    name: 'Spotify',
    description: 'Busca música y reprodúcela aquí mismo con el reproductor oficial de Spotify. La reproducción integrada requiere Spotify Premium.',
    url: 'https://developer.spotify.com/dashboard',
    guide: 'Spotify Web Playback SDK · requiere Premium',
  },
  {
    name: 'Apple Music',
    description: 'MusicKit requiere credenciales de desarrollador de Apple y autorización oficial.',
    url: 'https://developer.apple.com/musickit/',
    guide: 'Documentación de Apple MusicKit',
  },
  {
    name: 'YouTube Music',
    description: 'Vincula tu cuenta Google con OAuth. Google no ofrece una API pública para controlar YouTube Music.',
    url: 'https://console.cloud.google.com/apis/credentials',
    guide: 'Google Cloud OAuth',
  },
]

const pages: Record<Section, { title: string; subtitle: string }> = {
  Escuchar: { title: 'Tu música, a tu manera.', subtitle: 'Un solo lugar para todo lo que te hace sentir.' },
  Explorar: { title: 'Encuentra tu próximo sonido.', subtitle: 'Una selección de música real, para cada momento.' },
  'Tu colección': { title: 'Todo lo que guardas.', subtitle: 'Álbumes, playlists y momentos que vuelven contigo.' },
  Favoritos: { title: 'Lo que siempre vuelve.', subtitle: 'Tus canciones favoritas, reunidas en un solo lugar.' },
  Ajustes: { title: 'A tu manera.', subtitle: 'Ajusta el sonido, el ambiente y tus servicios.' },
}

function readSettings(): AppSettings {
  try {
    const stored = window.localStorage.getItem('dropmusic-settings')
    if (!stored) return defaults
    const value: unknown = JSON.parse(stored)
    if (typeof value !== 'object' || value === null) return defaults
    const saved = value as Partial<AppSettings>
    return {
      ...defaults,
      ...saved,
      volume: typeof saved.volume === 'number' ? Math.min(100, Math.max(0, saved.volume)) : defaults.volume,
      bandGains: Array.isArray(saved.bandGains) && saved.bandGains.length === bandFrequencies.length
        ? saved.bandGains.map((gain) => Math.min(12, Math.max(-12, Number(gain) || 0)))
        : defaults.bandGains,
      preferredService: providers.some(({ name }) => name === saved.preferredService)
        ? saved.preferredService!
        : defaults.preferredService,
      jamendoClientId: typeof saved.jamendoClientId === 'string'
        ? saved.jamendoClientId.trim()
        : defaults.jamendoClientId,
    }
  } catch (error) {
    console.error('No se pudieron leer los ajustes guardados de DropMusic.', error)
    return defaults
  }
}

function readFavorites(): string[] {
  try {
    const stored = window.localStorage.getItem('dropmusic-favorites')
    if (!stored) return []
    const value: unknown = JSON.parse(stored)
    if (!Array.isArray(value) || !value.every((id): id is string => typeof id === 'string')) return []
    return value.filter((id) => id.startsWith('spotify:') || id.startsWith('jamendo:'))
  } catch (error) {
    console.error('No se pudieron leer los favoritos de DropMusic.', error)
    return []
  }
}

function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`
}

function toSpotifyTrack(track: SpotifyTrackResult): Track {
  return {
    id: `spotify:${track.id}`,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
    artwork: track.artwork,
    collectionUrl: track.url,
    audioUrl: '',
    color: '#54856b',
    mood: 'Spotify',
    genre: '',
    source: 'Spotify',
  }
}

function toJamendoTrack(track: JamendoTrackResult): Track {
  return {
    id: `jamendo:${track.id}`,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
    artwork: track.artwork,
    collectionUrl: track.url,
    audioUrl: track.audioUrl,
    color: '#b58a54',
    mood: 'Jamendo',
    genre: '',
    source: 'Jamendo',
  }
}

function TrackRows({
  visibleTracks,
  activeTrackId,
  favoriteIds,
  onPlay,
  onToggleFavorite,
}: {
  visibleTracks: Track[]
  activeTrackId: string
  favoriteIds: string[]
  onPlay: (id: string) => void
  onToggleFavorite: (id: string) => void
}) {
  if (visibleTracks.length === 0) {
    return <div className="empty-search"><Search size={20} /><p>No encontramos canciones con esa búsqueda.</p></div>
  }

  return (
    <div className="track-list">
      {visibleTracks.map((track) => {
        const isFavorite = favoriteIds.includes(track.id)
        return (
          <div className={`track-row${track.id === activeTrackId ? ' track-active' : ''}`} key={track.id}>
            <button
              aria-label={track.source === 'Spotify'
                ? `Reproducir ${track.title} en DropMusic`
                : `Reproducir ${track.source === 'Jamendo' ? '' : 'vista previa de '}${track.title} por ${track.artist}`}
              className="track-play-button"
              onClick={() => onPlay(track.id)}
              type="button"
            >
              <span className="track-art-wrap">
                <img alt="" className="track-art" loading="lazy" src={track.artwork} />
                <span className="track-hover-play"><Play fill="currentColor" size={14} /></span>
              </span>
              <span className="track-meta"><strong>{track.title}</strong><span>{track.artist} <i>·</i> {track.album}</span></span>
            </button>
            <a className="track-source" href={track.collectionUrl} rel="noreferrer" target="_blank">
              {(track.source ?? 'MÚSICA').toUpperCase()} <ArrowUpRight size={10} />
            </a>
            <span className="track-duration">{formatTime(track.duration)}</span>
            <button
              aria-label={isFavorite ? `Quitar ${track.title} de favoritos` : `Añadir ${track.title} a favoritos`}
              aria-pressed={isFavorite}
              className={`track-favorite icon-button${isFavorite ? ' liked' : ''}`}
              onClick={() => onToggleFavorite(track.id)}
              type="button"
            ><Heart fill={isFavorite ? 'currentColor' : 'none'} size={15} /></button>
          </div>
        )
      })}
    </div>
  )
}

function randomBase64Url(size: number) {
  const bytes = window.crypto.getRandomValues(new Uint8Array(size))
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

async function createCodeChallenge(verifier: string) {
  const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

function ProviderDialog({
  provider,
  account,
  onClose,
  onConnected,
  onDisconnected,
}: {
  provider: Provider
  account?: ConnectedAccount
  onClose: () => void
  onConnected: (provider: Provider, account: ConnectedAccount) => void
  onDisconnected: (provider: Provider) => void
}) {
  const details = providers.find(({ name }) => name === provider)
  const [linkError, setLinkError] = useState('')
  const [connecting, setConnecting] = useState(false)
  const oauthUnlistenRef = useRef<(() => void) | null>(null)
  const clientId = provider === 'Spotify'
    ? import.meta.env.VITE_SPOTIFY_CLIENT_ID
    : provider === 'YouTube Music'
      ? import.meta.env.VITE_GOOGLE_CLIENT_ID
      : ''
  const supportsOAuth = Boolean(clientId) && (provider === 'Spotify' || provider === 'YouTube Music')

  useEffect(() => () => oauthUnlistenRef.current?.(), [])
  if (!details) return null
  const providerUrl = details.url

  function openProviderGuide(event: MouseEvent<HTMLAnchorElement>) {
    if (!isTauri()) return
    event.preventDefault()
    void openUrl(providerUrl).catch((error: unknown) => {
      console.error(`No se pudo abrir la guía oficial de ${provider}.`, error)
      setLinkError('No se pudo abrir la guía. Inténtalo de nuevo desde el navegador.')
    })
  }

  async function connectAccount() {
    if (!supportsOAuth) return
    if (!isTauri()) {
      setLinkError('Abre DropMusic en la aplicación de escritorio para completar la autorización segura.')
      return
    }

    setConnecting(true)
    setLinkError('')

    try {
      const state = randomBase64Url(32)
      const codeVerifier = randomBase64Url(32)
      const codeChallenge = await createCodeChallenge(codeVerifier)
      let redirectUri = ''
      const unlisten = await listen<OAuthCallback>('dropmusic-oauth-callback', ({ payload }) => {
        if (payload.state !== state) return
        oauthUnlistenRef.current?.()
        oauthUnlistenRef.current = null
        setConnecting(false)

        if (payload.error) {
          setLinkError(payload.error === 'timeout'
            ? 'La autorización tardó demasiado. Inténtalo de nuevo.'
            : 'La autorización fue cancelada o rechazada.')
          return
        }
        if (!payload.code) {
          setLinkError('El proveedor no devolvió un código de autorización válido.')
          return
        }

        void invoke<ConnectedAccount>('exchange_oauth_code', {
          provider: provider === 'Spotify' ? 'spotify' : 'google',
          code: payload.code,
          redirectUri,
          codeVerifier,
          clientId,
        }).then((connectedAccount) => {
          onConnected(provider, connectedAccount)
          setLinkError('')
        }).catch((error: unknown) => {
          console.error(`No se pudo confirmar la cuenta de ${provider}.`, error)
          setLinkError(error instanceof Error ? error.message : String(error))
        })
      })
      oauthUnlistenRef.current = unlisten
      redirectUri = await invoke<string>('start_oauth_callback', {
        state,
        provider: provider === 'Spotify' ? 'spotify' : 'google',
      })
      const authorizeUrl = new URL(provider === 'Spotify'
        ? 'https://accounts.spotify.com/authorize'
        : 'https://accounts.google.com/o/oauth2/v2/auth')
      authorizeUrl.searchParams.set('client_id', clientId)
      authorizeUrl.searchParams.set('response_type', 'code')
      authorizeUrl.searchParams.set('redirect_uri', redirectUri)
      authorizeUrl.searchParams.set('state', state)
      authorizeUrl.searchParams.set('code_challenge', codeChallenge)
      authorizeUrl.searchParams.set('code_challenge_method', 'S256')
      authorizeUrl.searchParams.set('scope', provider === 'Spotify'
        ? 'user-read-private user-read-email user-read-playback-state user-modify-playback-state user-top-read streaming'
        : 'openid profile')
      if (provider === 'YouTube Music') authorizeUrl.searchParams.set('prompt', 'select_account')
      if (provider === 'Spotify') authorizeUrl.searchParams.set('show_dialog', 'true')
      await openUrl(authorizeUrl.toString())
    } catch (error) {
      oauthUnlistenRef.current?.()
      oauthUnlistenRef.current = null
      setConnecting(false)
      console.error(`No se pudo iniciar OAuth para ${provider}.`, error)
      setLinkError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section aria-labelledby="provider-title" aria-modal="true" className="provider-dialog" role="dialog">
        <button aria-label="Cerrar" className="icon-button dialog-close" onClick={onClose} type="button"><X size={18} /></button>
        <div className="dialog-mark"><Headphones size={23} strokeWidth={1.6} /></div>
        <p className="eyebrow">CONEXIÓN SEGURA</p>
        <h2 id="provider-title">Conecta {provider}</h2>
        <p className="dialog-copy">{details.description}</p>
        <div className={`connection-status${account ? ' connection-status-connected' : ''}`}>
          <span className="connection-status-dot" />
          <span>{account ? `Vinculada como ${account.name}` : 'Cuenta sin vincular'}</span>
          {!account && <span className="status-required">{supportsOAuth ? 'OAuth listo' : 'Configura OAuth'}</span>}
        </div>
        <p className="provider-security-note">
          {provider === 'Spotify'
            ? 'Requiere Spotify Premium. Autoriza los permisos de sugerencias y reproducción para escuchar en el reproductor de DropMusic. La sesión se guarda cifrada en Windows; DropMusic nunca recibe tu contraseña.'
            : 'DropMusic no almacena contraseñas ni tokens. La cuenta se confirma en el navegador oficial.'}
        </p>
        {supportsOAuth ? (
          <button className="primary-button dialog-action" disabled={connecting} onClick={() => { void connectAccount() }} type="button">
            {connecting ? 'Esperando autorización…' : account ? provider === 'Spotify' ? 'Actualizar permisos Spotify' : 'Vincular otra cuenta' : provider === 'Spotify' ? 'Conectar Spotify' : 'Vincular cuenta Google'}
            {!connecting && <ArrowUpRight size={15} />}
          </button>
        ) : (
          <a className="primary-button dialog-action" href={details.url} onClick={openProviderGuide} rel="noreferrer" target="_blank">
            Configurar conexión <ArrowUpRight size={15} />
          </a>
        )}
        {account && provider === 'Spotify' && (
          <button className="provider-disconnect-button" onClick={() => onDisconnected(provider)} type="button">Desvincular cuenta</button>
        )}
        {linkError && <p className="connection-notice" role="status">{linkError}</p>}
        {supportsOAuth && <a className="provider-guide-link" href={details.url} onClick={openProviderGuide} rel="noreferrer" target="_blank">Abrir guía oficial</a>}
        <p className="dialog-footnote">{details.guide}</p>
      </section>
    </div>
  )
}

function App() {
  const [settings, setSettings] = useState(readSettings)
  const [activeSection, setActiveSection] = useState<Section>('Escuchar')
  const [activeTrackId, setActiveTrackId] = useState('')
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [favoriteIds, setFavoriteIds] = useState(readFavorites)
  const [shuffle, setShuffle] = useState(false)
  const [repeat, setRepeat] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null)
  const [connectedAccounts, setConnectedAccounts] = useState<Partial<Record<Provider, ConnectedAccount>>>({})
  const [spotifySuggestedTracks, setSpotifySuggestedTracks] = useState<Track[]>([])
  const [spotifySuggestionsLoaded, setSpotifySuggestionsLoaded] = useState(false)
  const [spotifySuggestionsError, setSpotifySuggestionsError] = useState('')
  const [spotifyTracks, setSpotifyTracks] = useState<Track[]>([])
  const [spotifyTotal, setSpotifyTotal] = useState(0)
  const [spotifyNextOffset, setSpotifyNextOffset] = useState<number | null>(null)
  const [spotifyLoading, setSpotifyLoading] = useState(false)
  const [spotifyError, setSpotifyError] = useState('')
  const [jamendoTracks, setJamendoTracks] = useState<Track[]>([])
  const [jamendoLoading, setJamendoLoading] = useState(false)
  const [jamendoError, setJamendoError] = useState('')
  const [activeCatalogTrack, setActiveCatalogTrack] = useState<Track | null>(null)
  const [spotifyDeviceId, setSpotifyDeviceId] = useState('')
  const [spotifyPlayerReady, setSpotifyPlayerReady] = useState(false)
  const [spotifyPlayerStatus, setSpotifyPlayerStatus] = useState('')
  const [spotifyPlayerError, setSpotifyPlayerError] = useState('')
  const [playbackError, setPlaybackError] = useState('')
  const audioRef = useRef<HTMLAudioElement>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const filtersRef = useRef<BiquadFilterNode[]>([])
  const spotifyPlayerRef = useRef<SpotifyWebPlayer | null>(null)
  const spotifyVolumeRef = useRef(settings.volume / 100)
  const spotifySearchRequestRef = useRef(0)
  const jamendoSearchRequestRef = useRef(0)
  const spotifySuggestionRequestRef = useRef(0)
  const spotifyLastStateRef = useRef<{ id: string | null; paused: boolean; position: number } | null>(null)
  const trackEndRef = useRef<() => void>(() => {})

  const activeTrack = activeCatalogTrack ?? tracks.find((track) => track.id === activeTrackId) ?? emptyTrack
  const query = search.trim().toLowerCase()
  const allTracks = useMemo(
    () => [...tracks, ...spotifySuggestedTracks, ...spotifyTracks, ...jamendoTracks]
      .filter((track, index, list) => list.findIndex((item) => item.id === track.id) === index),
    [spotifySuggestedTracks, spotifyTracks, jamendoTracks],
  )
  const configuredJamendoClientId = settings.jamendoClientId.trim() || defaultJamendoClientId
  const spotifySuggestionsLoading = Boolean(connectedAccounts.Spotify)
    && !spotifySuggestionsLoaded
    && !spotifySuggestionsError
  const progressDuration = activeTrack.duration
  const searchResults = useMemo(
    () => allTracks.filter((track) => `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(query)),
    [allTracks, query],
  )
  const albums = useMemo(
    () => allTracks.filter((track, index, list) => list.findIndex((item) => item.album === track.album) === index),
    [allTracks],
  )
  const featuredTracks = useMemo(
    () => [...spotifySuggestedTracks, ...spotifyTracks, ...jamendoTracks]
      .filter((track, index, list) => list.findIndex((item) => item.id === track.id) === index),
    [spotifySuggestedTracks, spotifyTracks, jamendoTracks],
  )
  const [featuredTrackIndex, setFeaturedTrackIndex] = useState(0)
  const featuredTrack = featuredTracks.length > 0
    ? featuredTracks[featuredTrackIndex % featuredTracks.length]
    : null
  const page = pages[activeSection]
  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }))
  }

  useEffect(() => {
    try {
      window.localStorage.setItem('dropmusic-settings', JSON.stringify(settings))
    } catch (error) {
      console.error('No se pudieron guardar los ajustes de DropMusic.', error)
    }
  }, [settings])

  useEffect(() => {
    try {
      window.localStorage.setItem('dropmusic-favorites', JSON.stringify(favoriteIds))
    } catch (error) {
      console.error('No se pudieron guardar los favoritos de DropMusic.', error)
    }
  }, [favoriteIds])

  useEffect(() => {
    setFeaturedTrackIndex(Math.floor(Math.random() * Math.max(1, featuredTracks.length)))
    if (featuredTracks.length < 2) return
    const timer = window.setInterval(() => {
      setFeaturedTrackIndex((current) => {
        let next: number
        do {
          next = Math.floor(Math.random() * featuredTracks.length)
        } while (next === current % featuredTracks.length)
        return next
      })
    }, 12000)
    return () => window.clearInterval(timer)
  }, [featuredTracks])

  useEffect(() => {
    if (!isTauri() || !spotifyClientId) return
    let active = true
    void invoke<ConnectedAccount | null>('spotify_get_account', { clientId: spotifyClientId })
      .then((account) => {
        if (active && account) setConnectedAccounts((current) => ({ ...current, Spotify: account }))
      })
      .catch((error: unknown) => {
        console.error('No se pudo restaurar la sesión guardada de Spotify.', error)
        if (active) setSpotifyError(error instanceof Error ? error.message : String(error))
      })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const requestId = ++spotifySuggestionRequestRef.current
    if (!connectedAccounts.Spotify || !isTauri() || !spotifyClientId) return
    void invoke<SpotifySearchPage>('spotify_get_top_tracks', { clientId: spotifyClientId })
      .then((page) => {
        if (requestId === spotifySuggestionRequestRef.current) {
          setSpotifySuggestedTracks(page.tracks.map(toSpotifyTrack))
          setSpotifySuggestionsLoaded(true)
        }
      })
      .catch((error: unknown) => {
        if (requestId !== spotifySuggestionRequestRef.current) return
        console.error('No se pudieron cargar las sugerencias personales de Spotify.', error)
        setSpotifySuggestionsError(error instanceof Error ? error.message : String(error))
      })
    return () => { spotifySuggestionRequestRef.current += 1 }
  }, [connectedAccounts.Spotify])

  useEffect(() => {
    if (!connectedAccounts.Spotify || !isTauri() || !spotifyClientId) return
    let active = true
    let player: SpotifyWebPlayer | null = null

    void loadSpotifyPlaybackSdk().then(() => {
      if (!active) return
      const spotifySdk = window.Spotify
      if (!spotifySdk) {
        setSpotifyPlayerError('El SDK de Spotify terminó de cargar, pero no encontró el reproductor.')
        return
      }
      player = new spotifySdk.Player({
        name: 'DropMusic',
        volume: spotifyVolumeRef.current,
        getOAuthToken: (callback) => {
          void invoke<string>('spotify_get_playback_token', { clientId: spotifyClientId })
            .then(callback)
            .catch((error: unknown) => {
              console.error('Spotify no pudo autorizar el reproductor integrado.', error)
              if (active) setSpotifyPlayerError(error instanceof Error ? error.message : String(error))
            })
        },
      })
      spotifyPlayerRef.current = player
      player.addListener('ready', ({ device_id }) => {
        if (!active) return
        setSpotifyDeviceId(device_id)
        setSpotifyPlayerReady(true)
        setSpotifyPlayerStatus('Reproductor de Spotify listo')
        void player?.setVolume(spotifyVolumeRef.current).catch((error: unknown) => {
          console.error('No se pudo aplicar el volumen de Spotify.', error)
          setSpotifyPlayerError(error instanceof Error ? error.message : String(error))
        })
      })
      player.addListener('not_ready', () => {
        if (!active) return
        setSpotifyPlayerReady(false)
        setSpotifyPlayerStatus('El reproductor de Spotify se desconectó')
      })
      player.addListener('player_state_changed', (state) => {
        if (!active) return
        if (!state) return
        const track = state.track_window.current_track
        // Spotify no avisa cuando termina una canción: pasa de sonando a pausado en la posición 0.
        const previous = spotifyLastStateRef.current
        spotifyLastStateRef.current = { id: track.id, paused: state.paused, position: state.position }
        if (previous && !previous.paused && previous.position > 0 && previous.id === track.id
          && state.paused && state.position === 0) {
          trackEndRef.current()
        }
        setElapsedSeconds(Math.floor(state.position / 1000))
        setIsPlaying(!state.paused)
        if (!track.id) return
        const selectedTrack = toSpotifyTrack({
          id: track.id,
          title: track.name,
          artist: track.artists.map((artist) => artist.name).join(', '),
          album: track.album.name,
          duration: Math.floor(track.duration_ms / 1000),
          artwork: track.album.images[0]?.url ?? '',
          url: `https://open.spotify.com/track/${track.id}`,
        })
        setActiveTrackId(selectedTrack.id)
        setActiveCatalogTrack(selectedTrack)
      })
      player.addListener('initialization_error', ({ message }) => {
        if (active) setSpotifyPlayerError(`No se pudo iniciar el reproductor de Spotify: ${message}`)
      })
      player.addListener('authentication_error', ({ message }) => {
        if (active) setSpotifyPlayerError(`Vuelve a autorizar DropMusic en Ajustes para reproducir en Spotify. ${message}`)
      })
      player.addListener('account_error', ({ message }) => {
        if (active) setSpotifyPlayerError(`La reproducción integrada requiere Spotify Premium. ${message}`)
      })
      player.addListener('playback_error', ({ message }) => {
        if (active) setSpotifyPlayerError(`Spotify no pudo reproducir esta canción: ${message}`)
      })
      void player.connect().then((connected) => {
        if (active && !connected) {
          setSpotifyPlayerError('Spotify no pudo conectar el reproductor. Comprueba tu conexión e inténtalo de nuevo.')
        }
      }).catch((error: unknown) => {
        if (active) setSpotifyPlayerError(error instanceof Error ? error.message : String(error))
      })
    }).catch((error: unknown) => {
      if (active) setSpotifyPlayerError(error instanceof Error ? error.message : String(error))
    })

    return () => {
      active = false
      player?.disconnect()
      if (spotifyPlayerRef.current === player) spotifyPlayerRef.current = null
    }
  }, [connectedAccounts.Spotify])

  useEffect(() => {
    const requestId = ++spotifySearchRequestRef.current
    if (!connectedAccounts.Spotify || !isTauri() || !spotifyClientId || query.length < 2) return
    const timer = window.setTimeout(() => {
      if (requestId !== spotifySearchRequestRef.current) return
      setSpotifyLoading(true)
      setSpotifyError('')
      setSpotifyTracks([])
      setSpotifyTotal(0)
      setSpotifyNextOffset(null)
      void invoke<SpotifySearchPage>('spotify_search_tracks', {
        clientId: spotifyClientId,
        query: search.trim(),
        offset: 0,
      }).then((page) => {
        if (requestId !== spotifySearchRequestRef.current) return
        setSpotifyTracks(page.tracks.map(toSpotifyTrack))
        setSpotifyTotal(page.total)
        setSpotifyNextOffset(page.nextOffset)
      }).catch((error: unknown) => {
        if (requestId !== spotifySearchRequestRef.current) return
        console.error('No se pudo buscar en el catálogo de Spotify.', error)
        setSpotifyError(error instanceof Error ? error.message : String(error))
      }).finally(() => {
        if (requestId === spotifySearchRequestRef.current) setSpotifyLoading(false)
      })
    }, 350)

    return () => window.clearTimeout(timer)
  }, [connectedAccounts.Spotify, query, search])

  useEffect(() => {
    const requestId = ++jamendoSearchRequestRef.current
    if (!isTauri() || query.length < 2 || !configuredJamendoClientId) return

    const timer = window.setTimeout(() => {
      if (requestId !== jamendoSearchRequestRef.current) return
      setJamendoLoading(true)
      setJamendoError('')
      void invoke<JamendoSearchPage>('jamendo_search_tracks', {
        clientId: configuredJamendoClientId,
        query: search.trim(),
      }).then((page) => {
        if (requestId !== jamendoSearchRequestRef.current) return
        setJamendoTracks(page.tracks.map(toJamendoTrack))
      }).catch((error: unknown) => {
        if (requestId !== jamendoSearchRequestRef.current) return
        console.error('No se pudo buscar en el catálogo de Jamendo.', error)
        setJamendoError(error instanceof Error ? error.message : String(error))
      }).finally(() => {
        if (requestId === jamendoSearchRequestRef.current) setJamendoLoading(false)
      })
    }, 350)

    return () => window.clearTimeout(timer)
  }, [configuredJamendoClientId, query, search])

  useEffect(() => {
    spotifyVolumeRef.current = settings.volume / 100
    if (audioRef.current) audioRef.current.volume = settings.volume / 100
    if (spotifyPlayerRef.current) {
      void spotifyPlayerRef.current.setVolume(settings.volume / 100).catch((error: unknown) => {
        console.error('No se pudo cambiar el volumen de Spotify.', error)
        setSpotifyPlayerError(error instanceof Error ? error.message : String(error))
      })
    }
  }, [settings.volume])

  useEffect(() => {
    filtersRef.current.forEach((filter, index) => {
      filter.gain.value = settings.equalizerEnabled ? settings.bandGains[index] : 0
    })
  }, [settings.bandGains, settings.equalizerEnabled])

  const handleAudioError = useCallback(() => {
    const message = 'Jamendo no pudo reproducir esta pista. Comprueba tu conexión o inténtalo de nuevo.'
    setIsPlaying(false)
    setPlaybackError(message)
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    if (activeTrack.source === 'Spotify') {
      audio.pause()
      return
    }
    if (!isPlaying) {
      audio.pause()
      return
    }
    void audio.play().catch((error: unknown) => {
      console.error(`No se pudo reproducir ${activeTrack.title}.`, error)
      handleAudioError()
    })
  }, [activeTrack, handleAudioError, isPlaying])

  useEffect(() => {
    if (activeTrack.source !== 'Spotify' || !isPlaying) return
    const timer = window.setInterval(() => {
      setElapsedSeconds((current) => Math.min(activeTrack.duration, current + 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [activeTrack, isPlaying])

  function prepareAudio() {
    const audio = audioRef.current
    if (!audio) return false
    if (!audioContextRef.current) {
      try {
        const context = new window.AudioContext()
        const source = context.createMediaElementSource(audio)
        const types: BiquadFilterType[] = ['lowshelf', 'peaking', 'peaking', 'peaking', 'highshelf']
        const filters = bandFrequencies.map((frequency, index) => {
          const filter = context.createBiquadFilter()
          filter.type = types[index]
          filter.frequency.value = frequency
          filter.Q.value = index === 0 || index === bandFrequencies.length - 1 ? 0.8 : 1
          filter.gain.value = settings.equalizerEnabled ? settings.bandGains[index] : 0
          return filter
        })
        let previous: AudioNode = source
        for (const filter of filters) {
          previous.connect(filter)
          previous = filter
        }
        previous.connect(context.destination)
        audioContextRef.current = context
        filtersRef.current = filters
      } catch (error) {
        console.error('No se pudo inicializar el ecualizador de audio.', error)
        setPlaybackError('No se pudo activar el procesamiento de audio en este dispositivo.')
        return false
      }
    }

    if (audioContextRef.current.state === 'suspended') {
      void audioContextRef.current.resume().catch((error: unknown) => {
        console.error('No se pudo reactivar el procesamiento de audio.', error)
        setPlaybackError('El sistema bloqueó el audio. Vuelve a pulsar reproducir.')
      })
    }
    return true
  }

  function playTrack(id: string) {
    const spotifyTrack = allTracks.find((track) => track.id === id && track.source === 'Spotify')
    if (spotifyTrack) {
      if (!spotifyPlayerRef.current || !spotifyDeviceId || !spotifyClientId) {
        setSpotifyPlayerError('El reproductor de Spotify todavía está conectando. Inténtalo de nuevo en unos segundos.')
        return
      }
      setSpotifyPlayerError('')
      setPlaybackError('')
      setActiveCatalogTrack(spotifyTrack)
      setActiveTrackId(spotifyTrack.id)
      setElapsedSeconds(0)
      setIsPlaying(true)
      void spotifyPlayerRef.current.activateElement().catch((error: unknown) => {
        console.error('No se pudo activar el reproductor integrado de Spotify.', error)
      })
      void invoke('spotify_start_playback', {
        clientId: spotifyClientId,
        deviceId: spotifyDeviceId,
        trackId: spotifyTrack.id.replace(/^spotify:/, ''),
      }).then(() => {
        setSpotifyPlayerError('')
        setSpotifyPlaybackOption('shuffle', shuffle)
        setSpotifyPlaybackOption('repeat', repeat)
      }).catch((error: unknown) => {
        console.error(`No se pudo reproducir ${spotifyTrack.title} en DropMusic.`, error)
        setIsPlaying(false)
        setSpotifyPlayerError(error instanceof Error ? error.message : String(error))
      })
      return
    }
    const jamendoTrack = jamendoTracks.find((track) => track.id === id)
    if (jamendoTrack) {
      if (!prepareAudio()) return
      setPlaybackError('')
      setElapsedSeconds(0)
      setActiveCatalogTrack(jamendoTrack)
      setActiveTrackId(id)
      setIsPlaying(true)
      return
    }
    setPlaybackError('Esta canción ya no está disponible en el catálogo actual.')
    setIsPlaying(false)
  }

  function setSpotifyPlaybackOption(option: 'shuffle' | 'repeat', enabled: boolean) {
    if (!spotifyClientId || !spotifyDeviceId) {
      setSpotifyPlayerError('El reproductor de Spotify todavía no está listo para cambiar este ajuste.')
      return
    }
    void invoke('spotify_set_playback_option', {
      clientId: spotifyClientId,
      deviceId: spotifyDeviceId,
      option,
      enabled,
    }).catch((error: unknown) => {
      console.error(`No se pudo cambiar ${option} en Spotify.`, error)
      if (option === 'shuffle') {
        setShuffle((current) => current === enabled ? !enabled : current)
      } else {
        setRepeat((current) => current === enabled ? !enabled : current)
      }
      setSpotifyPlayerError(error instanceof Error ? error.message : String(error))
    })
  }

  function toggleShuffle() {
    if (activeTrack.source === 'Spotify' && (!spotifyClientId || !spotifyDeviceId)) {
      setSpotifyPlayerError('El reproductor de Spotify todavía no está listo para cambiar este ajuste.')
      return
    }
    const enabled = !shuffle
    setShuffle(enabled)
    if (activeTrack.source === 'Spotify') {
      setSpotifyPlaybackOption('shuffle', enabled)
    }
  }

  function toggleRepeat() {
    if (activeTrack.source === 'Spotify' && (!spotifyClientId || !spotifyDeviceId)) {
      setSpotifyPlayerError('El reproductor de Spotify todavía no está listo para cambiar este ajuste.')
      return
    }
    const enabled = !repeat
    setRepeat(enabled)
    if (activeTrack.source === 'Spotify') {
      setSpotifyPlaybackOption('repeat', enabled)
    }
  }

  function togglePlayback() {
    if (!activeTrack.source) {
      setPlaybackError('Busca una canción en Spotify o Jamendo para empezar a escuchar.')
      return
    }
    if (activeTrack.source === 'Spotify') {
      if (!spotifyPlayerRef.current) {
        setSpotifyPlayerError('El reproductor de Spotify no está conectado.')
        return
      }
      void spotifyPlayerRef.current.togglePlay().catch((error: unknown) => {
        console.error('No se pudo cambiar la reproducción de Spotify.', error)
        setSpotifyPlayerError(error instanceof Error ? error.message : String(error))
      })
      return
    }
    if (isPlaying) {
      setIsPlaying(false)
      return
    }
    if (!prepareAudio()) return
    setPlaybackError('')
    setIsPlaying(true)
  }

  function skipTrack(direction: 1 | -1) {
    if (activeTrack.source === 'Spotify') {
      const queue = [...spotifySuggestedTracks, ...spotifyTracks]
        .filter((track, index, list) => list.findIndex((item) => item.id === track.id) === index)
      
      // Si tenemos una lista local de Spotify, navegamos por ella para asegurar consistencia
      if (queue.length > 1) {
        const currentIndex = queue.findIndex((track) => track.id === activeTrackId)
        let nextIndex: number
        if (shuffle) {
          do {
            nextIndex = Math.floor(Math.random() * queue.length)
          } while (nextIndex === currentIndex)
        } else if (currentIndex < 0) {
          nextIndex = direction > 0 ? 0 : queue.length - 1
        } else {
          nextIndex = (currentIndex + direction + queue.length) % queue.length
        }
        playTrack(queue[nextIndex].id)
        return
      }

      // Si no hay lista local o solo hay una canción, usamos el salto nativo de Spotify
      if (!spotifyDeviceId || !spotifyClientId) {
        setSpotifyPlayerError('El reproductor de Spotify todavía no está listo para cambiar de canción.')
        return
      }
      setSpotifyPlayerError('')
      void invoke('spotify_skip_track', {
        clientId: spotifyClientId,
        deviceId: spotifyDeviceId,
        direction: direction < 0 ? 'previous' : 'next',
      }).catch((error: unknown) => {
        console.error('No se pudo cambiar de canción en Spotify.', error)
        setSpotifyPlayerError(error instanceof Error ? error.message : String(error))
      })
      return
    }

    const queue = activeTrack.source === 'Jamendo'
      ? [activeTrack, ...jamendoTracks].filter((track, index, list) => list.findIndex((item) => item.id === track.id) === index)
      : []
    if (queue.length === 0) {
      setIsPlaying(false)
      return
    }
    const currentIndex = queue.findIndex((track) => track.id === activeTrackId)
    let nextIndex: number
    if (shuffle && queue.length > 1) {
      do {
        nextIndex = Math.floor(Math.random() * queue.length)
      } while (nextIndex === currentIndex)
    } else if (currentIndex < 0) {
      nextIndex = direction > 0 ? 0 : queue.length - 1
    } else {
      nextIndex = (currentIndex + direction + queue.length) % queue.length
    }
    playTrack(queue[nextIndex].id)
  }

  function handleTrackEnd() {
    if (activeTrack.source === 'Spotify') {
      // Con repetir activo, Spotify vuelve a empezar la canción por su cuenta.
      if (!repeat) skipTrack(1)
      return
    }
    if (repeat && audioRef.current) {
      audioRef.current.currentTime = 0
      void audioRef.current.play().catch((error: unknown) => {
        console.error('No se pudo repetir la vista previa.', error)
        handleAudioError()
      })
    } else {
      skipTrack(1)
    }
  }

  useEffect(() => {
    trackEndRef.current = handleTrackEnd
  })

  function toggleFavorite(id: string) {
    setFavoriteIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  function selectPreset(name: string) {
    if (!presets[name]) return
    setSettings((current) => ({ ...current, preset: name, bandGains: [...presets[name]] }))
  }

  function selectSection(section: Section) {
    setActiveSection(section)
    setSearch('')
    setSpotifyLoading(false)
    setSpotifyError('')
    setJamendoError('')
  }

  function connectProvider(provider: Provider) {
    setSelectedProvider(provider)
  }

  function handleAccountConnected(provider: Provider, account: ConnectedAccount) {
    setConnectedAccounts((current) => ({ ...current, [provider]: account }))
    if (provider === 'Spotify') {
      setSpotifyError('')
      setSpotifySuggestionsError('')
      setSpotifySuggestionsLoaded(false)
      setSpotifyPlayerError('')
      setSpotifyPlayerReady(false)
      setSpotifyDeviceId('')
      setSpotifyPlayerStatus('Conectando el reproductor de Spotify…')
    }
  }

  async function disconnectSpotify() {
    try {
      await invoke('spotify_disconnect')
      setConnectedAccounts((current) => {
        const remaining = { ...current }
        delete remaining.Spotify
        return remaining
      })
      setSpotifyTracks([])
      setSpotifySuggestedTracks([])
      setSpotifySuggestionsLoaded(false)
      setSpotifyTotal(0)
      setSpotifyNextOffset(null)
      setSpotifyError('')
      setSpotifySuggestionsError('')
      setSpotifyPlayerError('')
      setSpotifyPlayerReady(false)
      setSpotifyDeviceId('')
      setSpotifyPlayerStatus('')
      if (activeTrack.source === 'Spotify') {
        setActiveCatalogTrack(null)
        setIsPlaying(false)
      }
      setSelectedProvider(null)
    } catch (error) {
      console.error('No se pudo desvincular la cuenta de Spotify.', error)
      setSpotifyError(error instanceof Error ? error.message : String(error))
    }
  }

  async function loadMoreSpotify() {
    if (spotifyNextOffset === null || !spotifyClientId || !connectedAccounts.Spotify) return
    const requestId = spotifySearchRequestRef.current
    setSpotifyLoading(true)
    setSpotifyError('')
    try {
      const page = await invoke<SpotifySearchPage>('spotify_search_tracks', {
        clientId: spotifyClientId,
        query: search.trim(),
        offset: spotifyNextOffset,
      })
      if (requestId !== spotifySearchRequestRef.current) return
      setSpotifyTracks((current) => [...current, ...page.tracks.map(toSpotifyTrack)])
      setSpotifyNextOffset(page.nextOffset)
    } catch (error) {
      if (requestId !== spotifySearchRequestRef.current) return
      console.error('No se pudieron cargar más resultados de Spotify.', error)
      setSpotifyError(error instanceof Error ? error.message : String(error))
    } finally {
      if (requestId === spotifySearchRequestRef.current) setSpotifyLoading(false)
    }
  }

  function renderTracks(visibleTracks: Track[]) {
    return (
      <TrackRows
        activeTrackId={activeTrackId}
        favoriteIds={favoriteIds}
        onPlay={playTrack}
        onToggleFavorite={toggleFavorite}
        visibleTracks={visibleTracks}
      />
    )
  }

  function renderSpotifyCatalog() {
    if (!connectedAccounts.Spotify) return null
    return (
      <section aria-labelledby="spotify-catalog-heading" className="spotify-catalog-section">
        <div className="section-heading">
          <div><p className="eyebrow">CATÁLOGO DE SPOTIFY</p><h2 id="spotify-catalog-heading">Busca en Spotify</h2></div>
          {query.length >= 2 && <span className="track-count">{spotifyTotal.toLocaleString()} resultados</span>}
        </div>
        {query.length < 2 ? (
          <p className="spotify-catalog-hint">Busca canciones o artistas con el buscador superior. Spotify entrega hasta 10 resultados por página y limita cada consulta a 1.000 resultados.</p>
        ) : spotifyError ? (
          <p className="spotify-catalog-error" role="status">{spotifyError}</p>
        ) : spotifyLoading && spotifyTracks.length === 0 ? (
          <p className="spotify-catalog-hint" role="status">Buscando en el catálogo de Spotify…</p>
        ) : (
          <>
            {renderTracks(spotifyTracks)}
            {spotifyTracks.length === 0 && !spotifyLoading && <p className="spotify-catalog-hint">No se encontraron canciones. Prueba otra búsqueda.</p>}
            {spotifyNextOffset !== null && (
              <button className="spotify-load-more" disabled={spotifyLoading} onClick={() => { void loadMoreSpotify() }} type="button">
                {spotifyLoading ? 'Cargando…' : 'Cargar más canciones'}
              </button>
            )}
          </>
        )}
      </section>
    )
  }

  function renderSpotifySuggestions() {
    return (
      <section aria-labelledby="spotify-suggestions-heading" className="spotify-suggestions-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">PARA TI · SPOTIFY</p>
            <h2 id="spotify-suggestions-heading">Sugerencias de Spotify</h2>
          </div>
          {connectedAccounts.Spotify && spotifySuggestedTracks.length > 0 && (
            <span className="track-count">{spotifySuggestedTracks.length} canciones</span>
          )}
        </div>
        {!connectedAccounts.Spotify ? (
          <div className="spotify-suggestions-empty">
            <p>Conecta Spotify para ver aquí tus canciones más escuchadas y reproducirlas sin salir de DropMusic.</p>
            <button className="secondary-button" onClick={() => connectProvider('Spotify')} type="button">
              Conectar Spotify <ArrowUpRight size={14} />
            </button>
          </div>
        ) : spotifySuggestionsError ? (
          <div className="spotify-suggestions-empty">
            <p className="spotify-catalog-error" role="status">{spotifySuggestionsError}</p>
            <button className="secondary-button" onClick={() => connectProvider('Spotify')} type="button">
              Actualizar permisos <ArrowUpRight size={14} />
            </button>
          </div>
        ) : spotifySuggestionsLoading ? (
          <p className="spotify-catalog-hint" role="status">Cargando tus sugerencias de Spotify…</p>
        ) : spotifySuggestedTracks.length > 0 ? (
          renderTracks(spotifySuggestedTracks)
        ) : (
          <p className="spotify-catalog-hint">Spotify todavía no tiene suficiente historial para crear sugerencias.</p>
        )}
        {connectedAccounts.Spotify && (
          <p className="spotify-player-status" role="status">
            <span className={spotifyPlayerReady ? 'spotify-player-dot spotify-player-dot-ready' : 'spotify-player-dot'} />
            {spotifyPlayerError || spotifyPlayerStatus || 'Conectando el reproductor de Spotify…'}
          </p>
        )}
      </section>
    )
  }

  function renderJamendoCatalog() {
    return (
      <section aria-labelledby="jamendo-catalog-heading" className="spotify-catalog-section">
        <div className="section-heading">
          <div><p className="eyebrow">CATÁLOGO LIBRE</p><h2 id="jamendo-catalog-heading">Explora Jamendo</h2></div>
          {query.length >= 2 && configuredJamendoClientId && <span className="track-count">{jamendoTracks.length} canciones</span>}
        </div>
        {!configuredJamendoClientId ? (
          <p className="spotify-catalog-hint">
            Jamendo necesita un Client ID gratuito. Créalo en{' '}
            <a href="https://devportal.jamendo.com/" rel="noreferrer" target="_blank">Jamendo Developer Portal</a>
            {' '}y pégalo en Ajustes para buscar y reproducir música independiente.
          </p>
        ) : query.length < 2 ? (
          <p className="spotify-catalog-hint">Busca por título para escuchar música independiente con licencia abierta de Jamendo.</p>
        ) : jamendoError ? (
          <p className="spotify-catalog-error" role="status">{jamendoError}</p>
        ) : jamendoLoading && jamendoTracks.length === 0 ? (
          <p className="spotify-catalog-hint" role="status">Buscando en el catálogo de Jamendo…</p>
        ) : (
          <>
            {renderTracks(jamendoTracks)}
            {jamendoTracks.length === 0 && !jamendoLoading && <p className="spotify-catalog-hint">Jamendo no encontró canciones con esa búsqueda.</p>}
          </>
        )}
      </section>
    )
  }

  const exploreTracks = allTracks.filter((track) =>
    `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(query),
  )
  const favoriteTracks = allTracks.filter((track) =>
    favoriteIds.includes(track.id) && `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(query),
  )

  return (
    <div
      className={`app-shell min-h-screen${settings.ambientGlow ? '' : ' no-ambient'}`}
      style={{ '--ambient-color': activeTrack.color } as CSSProperties}
    >
      <div aria-hidden="true" className="ambient-glow" />
      <audio
        crossOrigin="anonymous"
        onEnded={handleTrackEnd}
        onError={handleAudioError}
        onTimeUpdate={() => setElapsedSeconds(Math.floor(audioRef.current?.currentTime ?? 0))}
        preload="none"
        ref={audioRef}
        src={activeTrack.audioUrl}
      />

      <aside className="sidebar">
        <a aria-label="DropMusic, inicio" className="brand" href="#inicio">
          <span className="brand-mark"><AudioLines size={21} strokeWidth={2.2} /></span>
          <span>drop<span className="brand-light">music</span></span>
        </a>
        <div className="sidebar-section">
          <span className="sidebar-label">MENÚ</span>
          <nav aria-label="Navegación principal" className="main-nav">
            {navigation.map(({ label, icon: Icon }) => (
              <button
                aria-current={activeSection === label ? 'page' : undefined}
                className={`nav-item${activeSection === label ? ' active' : ''}`}
                key={label}
                onClick={() => selectSection(label)}
                type="button"
              >
                <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
                {label === 'Favoritos' && favoriteIds.length > 0 && <span className="nav-count">{favoriteIds.length}</span>}
              </button>
            ))}
          </nav>
        </div>
        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <div className="tip-icon"><Sparkles size={16} /></div>
            <p>Música de verdad. <span>Spotify y Jamendo en un solo lugar.</span></p>
            <button aria-label="Explorar música" className="tip-arrow" onClick={() => selectSection('Explorar')} type="button"><ArrowUpRight size={15} /></button>
          </div>
          <button className="profile-button" onClick={() => selectSection('Ajustes')} type="button">
            <span className="avatar">D</span><span className="profile-copy"><strong>DropMusic</strong><small>Preferencias de escucha</small></span><ChevronDown className="profile-chevron" size={16} />
          </button>
        </div>
      </aside>

      <main className="main-content" id="inicio">
        <header className="topbar">
          <div className="breadcrumbs"><span>DROP MUSIC</span><span className="breadcrumb-slash">/</span><span>{activeSection.toUpperCase()}</span></div>
          <div className="topbar-actions">
            <label className="search-box">
              <Search size={16} />
              <input
                aria-label="Buscar en tu música y Spotify"
                onChange={(event) => {
                  setSearch(event.target.value)
                  setSpotifyTracks([])
                  setSpotifyTotal(0)
                  setSpotifyNextOffset(null)
                  setSpotifyLoading(false)
                  setSpotifyError('')
                  setJamendoTracks([])
                  setJamendoLoading(false)
                  setJamendoError('')
                }}
                placeholder={connectedAccounts.Spotify ? 'Buscar en tu música y Spotify...' : 'Buscar canciones...'}
                value={search}
              />
              <kbd>⌘ K</kbd>
            </label>
            <button aria-label="Abrir ajustes" className="icon-button notification-button" onClick={() => selectSection('Ajustes')} type="button"><Settings2 size={18} /></button>
            <button className="top-connect-button" onClick={() => selectSection('Ajustes')} type="button"><Plus size={16} /> Conectar servicio</button>
          </div>
        </header>

        <div className={`content-grid${activeSection === 'Ajustes' ? ' settings-grid' : ''}`}>
          <section aria-label={activeSection} className="feed-column">
            <div className="greeting">
              <p className="eyebrow">TU ESPACIO MUSICAL</p><h1>{page.title}</h1><p className="greeting-subtitle">{page.subtitle}</p>
            </div>

            {activeSection === 'Explorar' ? (
              <>
                <section aria-labelledby="explore-heading" className="explore-banner">
                  <span className="featured-tag"><Sparkles size={13} /> DROP MUSIC PICKS</span>
                  <h2 id="explore-heading">Música real.<br />Descubre nuevos sonidos.</h2>
                  <p>Explora tus sugerencias de Spotify y busca música completa en Spotify y Jamendo.</p>
                </section>
                {renderSpotifySuggestions()}
                <div className="section-heading">
                  <div><p className="eyebrow">MÚSICA DISPONIBLE</p><h2>Canciones para explorar</h2></div>
                  <span className="track-count">{exploreTracks.length} canciones</span>
                </div>
                <div className="explore-track-grid">
                  {exploreTracks.map((track) => {
                    const isFavorite = favoriteIds.includes(track.id)
                    return (
                      <article className="explore-track-card" key={track.id}>
                        <button aria-label={`Reproducir ${track.title}`} className="explore-artwork" onClick={() => playTrack(track.id)} type="button">
                          <img alt={`Portada de ${track.album}`} loading="lazy" src={track.artwork} />
                          <span className="explore-play"><Play fill="currentColor" size={17} /></span><span className="explore-mood">{track.mood}</span>
                        </button>
                        <div className="explore-track-meta">
                          <span><strong>{track.title}</strong><small>{track.artist}</small></span>
                          <button aria-label={isFavorite ? `Quitar ${track.title} de favoritos` : `Añadir ${track.title} a favoritos`} className={`icon-button${isFavorite ? ' liked' : ''}`} onClick={() => toggleFavorite(track.id)} type="button">
                            <Heart fill={isFavorite ? 'currentColor' : 'none'} size={16} />
                          </button>
                        </div>
                      </article>
                    )
                  })}
                </div>
                {exploreTracks.length === 0 && <div className="empty-search"><Search size={20} /><p>Conecta Spotify o busca una canción para descubrir música.</p></div>}
                {renderSpotifyCatalog()}
                {renderJamendoCatalog()}
              </>
            ) : activeSection === 'Tu colección' ? (
              <>
                <section aria-label="Resumen de la colección" className="collection-summary">
                  <span className="collection-stat"><Disc3 size={18} /><strong>{albums.length}</strong><small>álbumes y EPs</small></span>
                  <span className="collection-stat"><Music2 size={18} /><strong>{allTracks.length}</strong><small>canciones cargadas</small></span>
                  <span className="collection-stat"><Heart size={18} /><strong>{favoriteIds.length}</strong><small>favoritos</small></span>
                </section>
                <section aria-labelledby="collection-heading" className="recent-section">
                  <div className="section-heading"><div><p className="eyebrow">TU BIBLIOTECA</p><h2 id="collection-heading">{search ? 'Resultados' : 'Álbumes y sencillos'}</h2></div><span className="track-count">{albums.length} lanzamientos</span></div>
                  <div className="album-grid">
                    {albums.filter((album) => `${album.album} ${album.artist}`.toLowerCase().includes(query)).map((album) => (
                      <button className="album-card" key={`${album.source ?? 'apple'}:${album.album}`} onClick={() => playTrack(allTracks.find((track) => track.album === album.album)?.id ?? album.id)} type="button">
                        <span className="album-card-art"><img alt={`Portada de ${album.album}`} loading="lazy" src={album.artwork} /><span><Play fill="currentColor" size={17} /></span></span><strong>{album.album}</strong><small>{album.artist}</small>
                      </button>
                    ))}
                  </div>
                </section>
                <section aria-labelledby="songs-heading" className="collection-songs">
                  <div className="section-heading"><div><p className="eyebrow">TU MÚSICA</p><h2 id="songs-heading">Canciones</h2></div><span className="track-count">{searchResults.length} canciones</span></div>
                  {searchResults.length > 0
                    ? renderTracks(searchResults)
                    : <div className="empty-search"><Library size={20} /><p>Busca música o conecta un servicio para llenar tu colección.</p></div>}
                </section>
              </>
            ) : activeSection === 'Favoritos' ? (
              <section aria-labelledby="favorites-heading" className="favorites-page">
                <div className="section-heading"><div><p className="eyebrow">GUARDADOS POR TI</p><h2 id="favorites-heading">Tu lista personal</h2></div><span className="track-count">{favoriteIds.length} canciones</span></div>
                {favoriteIds.length > 0 ? renderTracks(favoriteTracks) : (
                  <div className="favorites-empty">
                    <span><Heart size={27} /></span><h3>Tu banda sonora, a tu manera.</h3>
                    <p>Toca el corazón en cualquier canción para guardarla aquí. Tus favoritos se quedan en este dispositivo.</p>
                    <button className="primary-button" onClick={() => selectSection('Explorar')} type="button"><Compass size={15} /> Explorar música</button>
                  </div>
                )}
              </section>
            ) : activeSection === 'Ajustes' ? (
              <div className="settings-page">
                <section aria-labelledby="connections-heading" className="settings-panel">
                  <div className="settings-panel-heading">
                    <span className="settings-icon"><Headphones size={17} /></span><div><h2 id="connections-heading">Servicios de música</h2><p>Vincula tus cuentas sin compartir contraseñas con DropMusic.</p></div>
                  </div>
                  <div className="provider-card-list">
                    {providers.map(({ name, description }) => (
                      <article className="provider-card" key={name}>
                        <div className={`provider-card-logo provider-logo-${name === 'Apple Music' ? 'apple' : name === 'YouTube Music' ? 'youtube' : 'spotify'}`}><Music2 size={18} /></div>
                        <div className="provider-card-copy"><h3>{name}</h3><p>{description}</p><span><span className={`connection-status-dot${connectedAccounts[name] ? ' connection-status-dot-connected' : ''}`} /> {connectedAccounts[name]?.name ?? 'Sin vincular'}</span></div>
                        <button className="secondary-button" onClick={() => connectProvider(name)} type="button">
                          {connectedAccounts[name] ? 'Gestionar' : 'Conectar'} <ArrowUpRight size={14} />
                        </button>
                      </article>
                    ))}
                  </div>
                  <p className="settings-disclaimer">Spotify Web Playback SDK reproduce las canciones aquí mismo con una cuenta Premium y los permisos autorizados. YouTube Music no ofrece una API pública de reproducción; Apple Music requiere configurar MusicKit.</p>
                  <label className="jamendo-client-field">
                    <span><strong>Client ID de Jamendo</strong><small>Clave pública de aplicación; se guarda solo en este dispositivo.</small></span>
                    <input
                      autoComplete="off"
                      onChange={(event) => {
                        updateSetting('jamendoClientId', event.target.value)
                        setJamendoTracks([])
                        setJamendoLoading(false)
                        setJamendoError('')
                      }}
                      placeholder="Pega aquí tu Client ID"
                      spellCheck={false}
                      value={settings.jamendoClientId}
                    />
                    <a href="https://devportal.jamendo.com/" rel="noreferrer" target="_blank">Crear Client ID gratuito <ArrowUpRight size={12} /></a>
                  </label>
                  {spotifyError && <p className="spotify-catalog-error" role="status">{spotifyError}</p>}
                </section>

                <section aria-labelledby="equalizer-heading" className="settings-panel equalizer-panel">
                  <div className="settings-panel-heading">
                    <span className="settings-icon"><SlidersHorizontal size={17} /></span><div><h2 id="equalizer-heading">Ecualizador</h2><p>Ajusta el sonido de las pistas reproducidas en DropMusic.</p></div>
                    <label className="toggle-switch" title="Activar ecualizador"><input aria-label="Activar ecualizador" checked={settings.equalizerEnabled} onChange={(event) => updateSetting('equalizerEnabled', event.target.checked)} type="checkbox" /><span /></label>
                  </div>
                  <div aria-label="Preajustes del ecualizador" className="preset-list">
                    {Object.keys(presets).map((preset) => <button aria-pressed={settings.preset === preset} className={`preset-button${settings.preset === preset ? ' preset-active' : ''}`} key={preset} onClick={() => selectPreset(preset)} type="button">{preset}</button>)}
                  </div>
                  <div className={`equalizer-bands${settings.equalizerEnabled ? '' : ' equalizer-disabled'}`}>
                    {bandFrequencies.map((frequency, index) => (
                      <label className="equalizer-band" key={frequency}>
                        <span className="eq-gain">{settings.bandGains[index] > 0 ? '+' : ''}{settings.bandGains[index]} dB</span>
                        <input aria-label={`Ecualizador ${bandLabels[index]}`} disabled={!settings.equalizerEnabled} max="12" min="-12" onChange={(event) => {
                          const bandGains = [...settings.bandGains]
                          bandGains[index] = Number(event.target.value)
                          setSettings((current) => ({ ...current, bandGains, preset: 'Personalizado' }))
                        }} style={{ '--eq-value': `${((settings.bandGains[index] + 12) / 24) * 100}%` } as CSSProperties} type="range" value={settings.bandGains[index]} />
                        <span className="eq-frequency">{bandLabels[index]}</span>
                      </label>
                    ))}
                  </div>
                  <div className="eq-scale"><span>−12 dB</span><span>0</span><span>+12 dB</span></div>
                  <p className="eq-play-hint"><AudioLines size={13} /> El ecualizador se aplica a la reproducción de audio compatible.</p>
                </section>

                <section aria-labelledby="playback-settings-heading" className="settings-panel">
                  <div className="settings-panel-heading"><span className="settings-icon"><ListMusic size={17} /></span><div><h2 id="playback-settings-heading">Reproducción</h2><p>Tus preferencias del reproductor.</p></div></div>
                  <label className="setting-select-row">
                    <span><strong>Servicio preferido</strong><small>Fuente sugerida cuando vincules tu cuenta.</small></span>
                    <select onChange={(event) => updateSetting('preferredService', event.target.value as Provider)} value={settings.preferredService}>
                      {providers.map(({ name }) => <option key={name} value={name}>{name}</option>)}
                    </select>
                  </label>
                  <div className="setting-toggle-row">
                    <span><strong>Brillo ambiental</strong><small>Colores suaves tomados de la portada del álbum.</small></span>
                    <label className="toggle-switch"><input aria-label="Brillo ambiental" checked={settings.ambientGlow} onChange={(event) => updateSetting('ambientGlow', event.target.checked)} type="checkbox" /><span /></label>
                  </div>
                  <label className="setting-volume-row">
                    <span><strong>Volumen del reproductor</strong><small>{settings.volume}%</small></span>
                    <input aria-label="Volumen de vista previa en ajustes" className="range-input setting-volume" max="100" min="0" onChange={(event) => updateSetting('volume', Number(event.target.value))} style={{ '--range-progress': `${settings.volume}%` } as CSSProperties} type="range" value={settings.volume} />
                  </label>
                </section>
              </div>
            ) : (
              <>
                <section aria-labelledby="featured-heading" className="featured-card">
                  <button
                    aria-label={featuredTrack
                      ? `Reproducir ${featuredTrack.title} de ${featuredTrack.artist}`
                      : 'Explorar música'}
                    className="featured-media-button"
                    onClick={() => {
                      if (!featuredTrack) {
                        selectSection('Explorar')
                        return
                      }
                      selectSection('Escuchar')
                      playTrack(featuredTrack.id)
                    }}
                    type="button"
                  >
                    {featuredTrack && <img alt="" className="featured-image" src={featuredTrack.artwork} />}
                    <span className={`featured-scrim${featuredTrack ? '' : ' featured-empty-scrim'}`} />
                  </button>
                  <div className="featured-content">
                    <span className="featured-tag"><Sparkles size={13} /> UN POCO DE CALMA, UN POCO DE TODO</span>
                    <h2 id="featured-heading">{featuredTrack ? featuredTrack.title : 'Un poco de calma, un poco de todo.'}</h2>
                    <p>{featuredTrack
                      ? `${featuredTrack.artist} · ${featuredTrack.album}`
                      : 'Conecta Spotify o busca música en Jamendo para descubrir canciones aquí.'}</p>
                    <span className="featured-play">
                      {featuredTrack ? <><Play fill="currentColor" size={16} /> Escuchar ahora</> : 'Explorar música'}
                    </span>
                  </div>
                  {featuredTrack && <span aria-live="polite" className="featured-index">{featuredTrack.title} <span>· {featuredTrack.artist}</span></span>}
                </section>
                <section aria-labelledby="recent-heading" className="recent-section">
                  <div className="section-heading"><div><p className="eyebrow">{search ? 'CATÁLOGO REAL' : 'DESCUBRE TU PRÓXIMA CANCIÓN'}</p><h2 id="recent-heading">{search ? 'Resultados' : 'Una selección para escuchar'}</h2></div><button className="text-button" onClick={() => selectSection('Explorar')} type="button">Explorar todo <ArrowUpRight size={15} /></button></div>
                  {renderTracks(searchResults.slice(0, 5))}
                </section>
                {renderSpotifySuggestions()}
                {renderSpotifyCatalog()}
                {renderJamendoCatalog()}
                {playbackError && <div aria-live="polite" className="demo-notice"><span className="demo-indicator error-indicator" /><span>{playbackError}</span>{activeTrack.collectionUrl && <a href={activeTrack.collectionUrl} rel="noreferrer" target="_blank">Abrir en {activeTrack.source ?? 'servicio'} <ArrowUpRight size={11} /></a>}</div>}
              </>
            )}
            {activeSection !== 'Escuchar' && playbackError && <p className="playback-error" role="status">{playbackError} {activeTrack.collectionUrl && <a href={activeTrack.collectionUrl} rel="noreferrer" target="_blank">Abrir en {activeTrack.source ?? 'servicio'} <ArrowUpRight size={11} /></a>}</p>}
          </section>

          <aside aria-label="En reproducción" className="now-playing-column">
            <div className="now-playing-heading">
              <div><p className="eyebrow">AHORA MISMO</p><h2>Tu espacio sonoro</h2></div>
              {activeTrack.collectionUrl && <a aria-label={`Abrir ${activeTrack.title} en ${activeTrack.source ?? 'servicio'}`} className="icon-button subtle-icon-button" href={activeTrack.collectionUrl} rel="noreferrer" target="_blank"><ArrowUpRight size={16} /></a>}
            </div>
            <div className="now-playing-card">
              <div className="album-art-large">
                {activeTrack.artwork
                  ? <img alt={`Portada de ${activeTrack.album}`} src={activeTrack.artwork} />
                  : <div aria-hidden="true" className="album-art-placeholder"><Music2 size={54} /></div>}
                <div className="album-art-overlay" />
                <span className="album-art-label"><AudioLines size={13} /> {activeTrack.source === 'Spotify' ? 'SPOTIFY · EN DROP MUSIC' : activeTrack.source === 'Jamendo' ? 'JAMENDO · STREAMING' : 'EN ESPERA'}</span><span className="album-art-orbit orbit-one" /><span className="album-art-orbit orbit-two" />
              </div>
              <div className="now-track-details">
                <div><h3>{activeTrack.title}</h3><p>{activeTrack.artist} <span>·</span> {activeTrack.album}</p></div>
                <button aria-label={favoriteIds.includes(activeTrack.id) ? 'Quitar de favoritos' : 'Añadir a favoritos'} aria-pressed={favoriteIds.includes(activeTrack.id)} className={`icon-button like-button${favoriteIds.includes(activeTrack.id) ? ' liked' : ''}`} disabled={!activeTrack.id} onClick={() => toggleFavorite(activeTrack.id)} type="button"><Heart fill={favoriteIds.includes(activeTrack.id) ? 'currentColor' : 'none'} size={19} /></button>
              </div>
              <div className="soundscape-label"><span className="soundscape-dot" /> {activeTrack.source === 'Spotify' ? 'REPRODUCCIÓN COMPLETA' : activeTrack.source === 'Jamendo' ? 'STREAMING DE JAMENDO' : 'LISTO PARA REPRODUCIR'} <span className="soundscape-spacer" /><span>{activeTrack.genre.toUpperCase()}</span></div>
              <div aria-hidden="true" className={`visualizer${isPlaying ? ' visualizer-playing' : ''}`}>{Array.from({ length: 31 }, (_, index) => <span key={index} style={{ '--bar-index': index } as CSSProperties} />)}</div>
            </div>
            <section aria-labelledby="up-next-heading" className="up-next-section">
              <div className="up-next-heading"><div><p className="eyebrow">SIGUIENTE</p><h3 id="up-next-heading">Para seguir el mood</h3></div><Clock3 size={16} /></div>
              {(activeTrack.source === 'Spotify'
                ? [...spotifySuggestedTracks, ...spotifyTracks]
                : activeTrack.source === 'Jamendo' ? jamendoTracks : [])
                .filter((track, index, list) => track.id !== activeTrackId && list.findIndex((item) => item.id === track.id) === index)
                .slice(0, 3).map((track) => (
                <button className="up-next-row" key={track.id} onClick={() => playTrack(track.id)} type="button"><img alt="" loading="lazy" src={track.artwork} /><span><strong>{track.title}</strong><small>{track.artist}</small></span><span className="up-next-duration">{formatTime(track.duration)}</span></button>
              ))}
              {activeTrack.source && !(
                activeTrack.source === 'Spotify'
                  ? [...spotifySuggestedTracks, ...spotifyTracks].some((track) => track.id !== activeTrackId)
                  : jamendoTracks.some((track) => track.id !== activeTrackId)
              ) && <p className="spotify-catalog-hint">Busca o carga más canciones para ver qué sigue.</p>}
            </section>
            <div className="service-prompt">
            <div className="service-prompt-icon"><Music2 size={17} /></div><div><strong>{settings.preferredService} · preferido</strong><span>{connectedAccounts[settings.preferredService]?.name ?? 'Cuenta aún no vinculada.'}</span></div>
              <button aria-label={`Conectar ${settings.preferredService}`} className="small-icon-button" onClick={() => connectProvider(settings.preferredService)} type="button"><Plus size={17} /></button>
            </div>
          </aside>
        </div>
      </main>

      <footer aria-label="Controles del reproductor" className="player-bar">
        <div className="player-track">
          {activeTrack.artwork
            ? <img alt="" src={activeTrack.artwork} />
            : <span aria-hidden="true" className="player-art-placeholder"><Music2 size={17} /></span>}
          <div className="player-track-meta"><strong>{activeTrack.title}</strong><span>{activeTrack.artist}</span></div>
          <button aria-label={favoriteIds.includes(activeTrack.id) ? 'Quitar de favoritos' : 'Añadir a favoritos'} aria-pressed={favoriteIds.includes(activeTrack.id)} className={`player-like icon-button${favoriteIds.includes(activeTrack.id) ? ' liked' : ''}`} disabled={!activeTrack.id} onClick={() => toggleFavorite(activeTrack.id)} type="button"><Heart fill={favoriteIds.includes(activeTrack.id) ? 'currentColor' : 'none'} size={17} /></button>
        </div>
        <div className="player-center">
          <div className="playback-buttons">
            <button aria-label={shuffle ? 'Desactivar aleatorio' : 'Activar aleatorio'} aria-pressed={shuffle} className={`icon-button player-extra${shuffle ? ' control-active' : ''}`} onClick={toggleShuffle} type="button"><Shuffle size={16} /></button>
            <button aria-label="Pista anterior" className="icon-button skip-button" disabled={!activeTrack.source} onClick={() => skipTrack(-1)} type="button"><SkipBack fill="currentColor" size={17} /></button>
            <button aria-label={isPlaying ? 'Pausar reproducción' : 'Reproducir canción'} className="play-button" disabled={!activeTrack.source} onClick={togglePlayback} type="button">{isPlaying ? <Pause fill="currentColor" size={17} /> : <Play fill="currentColor" size={17} />}</button>
            <button aria-label="Siguiente pista" className="icon-button skip-button" disabled={!activeTrack.source} onClick={() => skipTrack(1)} type="button"><SkipForward fill="currentColor" size={17} /></button>
            <button aria-label={repeat ? 'Desactivar repetición' : 'Repetir canción'} aria-pressed={repeat} className={`icon-button player-extra${repeat ? ' control-active' : ''}`} onClick={toggleRepeat} type="button"><Repeat2 size={16} /></button>
          </div>
          <div className="progress-row">
            <span>{formatTime(elapsedSeconds)}</span>
            <input aria-label="Progreso de la canción" className="range-input progress-input" disabled={!progressDuration} max={Math.max(1, progressDuration)} min="0" onChange={(event) => {
              const time = Number(event.target.value)
              setElapsedSeconds(time)
              if (activeTrack.source === 'Spotify') {
                if (spotifyPlayerRef.current) {
                  void spotifyPlayerRef.current.seek(time * 1000).catch((error: unknown) => {
                    console.error('No se pudo cambiar la posición de reproducción de Spotify.', error)
                    setSpotifyPlayerError(error instanceof Error ? error.message : String(error))
                  })
                }
              } else if (audioRef.current) {
                audioRef.current.currentTime = time
              }
            }} style={{ '--range-progress': `${progressDuration ? (elapsedSeconds / progressDuration) * 100 : 0}%` } as CSSProperties} type="range" value={Math.min(progressDuration, elapsedSeconds)} />
            <span>{formatTime(progressDuration)}</span>
          </div>
        </div>
        <div className="player-volume"><Volume2 size={17} /><input aria-label="Volumen" className="range-input volume-input" max="100" min="0" onChange={(event) => updateSetting('volume', Number(event.target.value))} style={{ '--range-progress': `${settings.volume}%` } as CSSProperties} type="range" value={settings.volume} /></div>
      </footer>

      {selectedProvider && (
        <ProviderDialog
          account={connectedAccounts[selectedProvider]}
          onClose={() => setSelectedProvider(null)}
          onConnected={handleAccountConnected}
          onDisconnected={() => { void disconnectSpotify() }}
          provider={selectedProvider}
        />
      )}
    </div>
  )
}

export default App
