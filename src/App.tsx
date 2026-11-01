import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { openUrl } from '@tauri-apps/plugin-opener'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowLeft,
  ArrowUpRight,
  AudioLines,
  ChevronDown,
  Clock3,
  Disc3,
  Headphones,
  Heart,
  Library,
  ListMusic,
  Maximize2,
  Mic2,
  Minimize2,
  Music2,
  Palette,
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
type Section = 'Escuchar' | 'Tu colección' | 'Favoritos' | 'Personalización' | 'Ajustes'

type ArtistRef = { id: string; name: string }

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
  albumId?: string
  albumType?: string
  artists?: ArtistRef[]
}

type SpotifyTrackResult = {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  artwork: string
  url: string
  albumId: string
  albumType: string
  artists: ArtistRef[]
}

type Album = {
  id: string
  title: string
  artist: string
  artists: ArtistRef[]
  artwork: string
  year: string
  albumType: string
  totalTracks: number
  url: string
}

type Artist = {
  id: string
  name: string
  image: string
  genres: string[]
  followers: number | null
  url: string
}

type SpotifyCatalogResults = {
  tracks: SpotifyTrackResult[]
  albums: Album[]
  artists: Artist[]
}

type ArtistPage = {
  artist: Artist
  topTracks: Track[]
  albums: Album[]
}

type AlbumPage = {
  album: Album
  tracks: Track[]
}

type Detail = { kind: 'artist' | 'album'; id: string }

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
  artists: { name: string; uri: string }[]
  album: { name: string; uri: string; images: { url: string }[] }
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

type ThemeId =
  | 'original' | 'zen' | 'soft' | 'glass' | 'retro' | 'terminal' | 'brutal' | 'amoled' | 'blocks' | 'militech' | 'funky'
  | 'arasaka' | 'netrunner' | 'nightcity' | 'shinobi' | 'aincrad' | 'cazador' | 'hyrule' | 'pokedex' | 'vaporwave' | 'lofi' | 'aurora'

type ThemeCategory = 'Esenciales' | 'Cyberpunk' | 'Anime' | 'Videojuegos' | 'Ambientes'

const themeCategories: ThemeCategory[] = ['Esenciales', 'Cyberpunk', 'Anime', 'Videojuegos', 'Ambientes']

type ThemeOption = {
  id: ThemeId
  name: string
  vibe: string
  category: ThemeCategory
  // Estos temas pintan todo el texto con sus propios colores (los claros y Terminal).
  ink: boolean
  // Fondo animado dibujado con CSS (sin videos ni imágenes descargadas).
  scene?: boolean
  preview: { bg: string; surface: string; accent: string; text: string; font: string }
}

const themes: ThemeOption[] = [
  { id: 'original', name: 'DropMusic original', vibe: 'El estilo de siempre: oscuro, suave y con brillo de la portada.', category: 'Esenciales', ink: false, preview: { bg: '#101013', surface: '#1d1b22', accent: '#c7a6ff', text: '#f4f3f6', font: 'Inter, "Segoe UI", sans-serif' } },
  { id: 'zen', name: 'Minimalismo japonés', vibe: 'Limpio, tipografía firme, mucho espacio y un solo acento bermellón.', category: 'Esenciales', ink: true, preview: { bg: '#f3efe6', surface: '#fbf9f4', accent: '#c8382c', text: '#1c1b19', font: '"Yu Mincho", "Hiragino Mincho ProN", serif' } },
  { id: 'soft', name: 'Soft UI', vibe: 'Botones y portadas esculpidos con sombras suaves, como silicona mate.', category: 'Esenciales', ink: true, preview: { bg: '#e3e8ef', surface: '#e3e8ef', accent: '#6c63ff', text: '#3d4658', font: '"Segoe UI", sans-serif' } },
  { id: 'glass', name: 'Cyber-Glass', vibe: 'Paneles de cristal esmerilado sobre un fondo que cambia con la portada.', category: 'Esenciales', ink: false, preview: { bg: 'linear-gradient(135deg, #3a1c71, #d76d77, #ffaf7b)', surface: 'rgba(255,255,255,0.18)', accent: '#ffffff', text: '#ffffff', font: 'Inter, "Segoe UI", sans-serif' } },
  { id: 'retro', name: 'Retro Hi-Fi', vibe: 'Vinilos que giran, madera cálida y metal cepillado.', category: 'Esenciales', ink: false, preview: { bg: '#2b1d14', surface: '#4a3222', accent: '#e8a33d', text: '#f3e3c7', font: 'Georgia, "Times New Roman", serif' } },
  { id: 'terminal', name: 'Terminal hacker', vibe: 'Consola oscura, letra monoespaciada y verde de monitor antiguo.', category: 'Esenciales', ink: true, preview: { bg: '#030a04', surface: '#06140a', accent: '#39ff6a', text: '#39ff6a', font: '"VT323", Consolas, monospace' } },
  { id: 'brutal', name: 'Brutalismo', vibe: 'Letras gigantes, bordes negros gruesos y colores primarios.', category: 'Esenciales', ink: true, preview: { bg: '#fffdf2', surface: '#ffe14d', accent: '#ff2e2e', text: '#000000', font: '"Archivo Black", Impact, sans-serif' } },
  { id: 'amoled', name: 'Liquid Neon', vibe: 'Negro absoluto con degradados líquidos que laten con la música.', category: 'Esenciales', ink: false, preview: { bg: '#000000', surface: '#07070a', accent: '#ff3cac', text: '#ffffff', font: 'Inter, "Segoe UI", sans-serif' } },
  { id: 'funky', name: 'Flow tropical', vibe: 'Psicodelia tropical: tonos tierra, pastel, formas orgánicas y collage.', category: 'Esenciales', ink: true, preview: { bg: '#f6e7cf', surface: '#ffd6c2', accent: '#e2583e', text: '#3b2417', font: 'Righteous, "Segoe UI", sans-serif' } },
  { id: 'militech', name: 'Neón industrial', vibe: 'Industrial y militar: esquinas a 45°, amarillo de advertencia y glitch.', category: 'Cyberpunk', ink: false, preview: { bg: '#0b0b0d', surface: '#15151a', accent: '#fcee0a', text: '#f2f2f2', font: 'Rajdhani, "Segoe UI", sans-serif' } },
  { id: 'arasaka', name: 'Corporación roja', vibe: 'Corporativo y frío: negro, blanco y rojo, con una línea de escaneo que recorre la pantalla.', category: 'Cyberpunk', ink: false, scene: true, preview: { bg: '#08080a', surface: '#141416', accent: '#e3182d', text: '#f4f4f4', font: 'Rajdhani, "Segoe UI", sans-serif' } },
  { id: 'netrunner', name: 'Corredor de red', vibe: 'Dentro de la red: cian y magenta, lluvia de datos y paneles de hackeo.', category: 'Cyberpunk', ink: false, scene: true, preview: { bg: '#040714', surface: '#0a1030', accent: '#00f0ff', text: '#e6fbff', font: '"VT323", Consolas, monospace' } },
  { id: 'nightcity', name: 'Ciudad de neón', vibe: 'Lluvia de neón sobre la ciudad: rosa, cian y carteles que parpadean.', category: 'Cyberpunk', ink: false, scene: true, preview: { bg: 'linear-gradient(180deg, #120626, #3a0d3a)', surface: 'rgba(20,10,35,0.8)', accent: '#ff2a6d', text: '#ffe9f3', font: 'Rajdhani, "Segoe UI", sans-serif' } },
  { id: 'shinobi', name: 'Aldea del remolino', vibe: 'Naranja y negro, espirales y hojas que caen con el viento.', category: 'Anime', ink: false, scene: true, preview: { bg: '#17110c', surface: '#251a12', accent: '#ff7a00', text: '#fff2e2', font: 'Righteous, "Segoe UI", sans-serif' } },
  { id: 'aincrad', name: 'Castillo flotante', vibe: 'Interfaz de realidad virtual: paneles blancos, azul de sistema y hexágonos flotando.', category: 'Anime', ink: true, scene: true, preview: { bg: 'linear-gradient(180deg, #cfe3f7, #eef4fb)', surface: 'rgba(255,255,255,0.88)', accent: '#2f8cff', text: '#1f2d3d', font: 'Rajdhani, "Segoe UI", sans-serif' } },
  { id: 'cazador', name: 'Haori de cuadros', vibe: 'Cuadros verdes y negros, olas de agua y pétalos de glicina.', category: 'Anime', ink: false, scene: true, preview: { bg: '#0b1210', surface: '#14201c', accent: '#2fbf8f', text: '#eef7f2', font: '"Yu Mincho", Georgia, serif' } },
  { id: 'blocks', name: 'Mundo cúbico', vibe: 'Mundo de bloques animado, menús biselados, letra pixelada y barra de experiencia.', category: 'Videojuegos', ink: true, scene: true, preview: { bg: 'linear-gradient(180deg, #7ab8ff, #b9dcff)', surface: '#c6c6c6', accent: '#7ec850', text: '#3f3f3f', font: '"Press Start 2P", monospace' } },
  { id: 'hyrule', name: 'Reino de las runas', vibe: 'Piedra antigua con runas que brillan en azul, detalles dorados y luces que suben.', category: 'Videojuegos', ink: false, scene: true, preview: { bg: '#0d1418', surface: '#16222a', accent: '#5fd6f5', text: '#eaf6f8', font: 'Georgia, "Times New Roman", serif' } },
  { id: 'pokedex', name: 'Entrenador de bolsillo', vibe: 'Una enciclopedia de bolsillo: carcasa roja, pantalla clara y luces de colores.', category: 'Videojuegos', ink: true, scene: true, preview: { bg: '#f1efe9', surface: '#ffffff', accent: '#e3350d', text: '#1d2228', font: '"Press Start 2P", monospace' } },
  { id: 'vaporwave', name: 'Vaporwave', vibe: 'Atardecer de los 80: sol de neón, cuadrícula infinita y colores pastel.', category: 'Ambientes', ink: false, scene: true, preview: { bg: 'linear-gradient(180deg, #2b0b4f, #ff71ce)', surface: 'rgba(34,10,60,0.8)', accent: '#01cdfe', text: '#fdf0ff', font: 'Righteous, "Segoe UI", sans-serif' } },
  { id: 'lofi', name: 'Lo-fi lluvioso', vibe: 'Noche tranquila con lluvia en la ventana y luz cálida de lámpara.', category: 'Ambientes', ink: false, scene: true, preview: { bg: '#141a24', surface: '#1d2533', accent: '#f2b880', text: '#f3ece4', font: 'Georgia, "Times New Roman", serif' } },
  { id: 'aurora', name: 'Aurora boreal', vibe: 'Cielo polar con cortinas de luz verde y violeta que ondulan despacio.', category: 'Ambientes', ink: false, scene: true, preview: { bg: 'linear-gradient(180deg, #03101c, #0b2a3a)', surface: 'rgba(8,24,38,0.78)', accent: '#4ef0b6', text: '#eafff7', font: 'Inter, "Segoe UI", sans-serif' } },
]

// Capas genéricas que cada tema con fondo animado usa a su manera desde themes.css.
type LayoutId = 'clasica' | 'espejo' | 'superior' | 'escenario' | 'minimal'

const layouts: { id: LayoutId; name: string; description: string }[] = [
  { id: 'clasica', name: 'Clásica', description: 'Menú a la izquierda y lo que suena a la derecha. En la letra, la portada a la izquierda.' },
  { id: 'espejo', name: 'Espejo', description: 'Todo al revés: menú a la derecha y lo que suena a la izquierda. En la letra, la portada a la derecha.' },
  { id: 'superior', name: 'Barra superior', description: 'Menú arriba en pestañas y más espacio para tu música. En la letra, la portada arriba y la letra centrada.' },
  { id: 'escenario', name: 'Escenario', description: 'La portada en grande como protagonista junto al contenido. En la letra, la portada gigante de fondo.' },
  { id: 'minimal', name: 'Minimal', description: 'Solo iconos, sin panel lateral y con el reproductor flotando. En la letra, solo la letra en el centro.' },
]

// Filtro que ondula la imagen despacio: la portada parece "viva", como las portadas en
// movimiento de Apple Music (Spotify no comparte sus videos de portada con otras apps).
const coverMotionFilter = (
  <svg aria-hidden="true" className="cover-motion-defs" focusable="false">
    <filter id="cover-motion" x="0" y="0" width="100%" height="100%">
      <feTurbulence baseFrequency="0.006 0.009" numOctaves="2" result="noise" seed="7" type="fractalNoise">
        <animate attributeName="baseFrequency" dur="22s" repeatCount="indefinite" values="0.006 0.009;0.010 0.006;0.006 0.009" />
      </feTurbulence>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="16" xChannelSelector="R" yChannelSelector="G" />
    </filter>
  </svg>
)

const themeScene = (
  <div aria-hidden="true" className="theme-scene"><i /><i /><i /><i /><i /><i /></div>
)

type AppSettings = {
  volume: number
  preset: string
  equalizerEnabled: boolean
  bandGains: number[]
  ambientGlow: boolean
  animations: boolean
  animatedCovers: boolean
  layout: LayoutId
  theme: ThemeId
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
  animations: true,
  animatedCovers: false,
  layout: 'clasica',
  theme: 'original',
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
  { label: 'Tu colección', icon: Library },
  { label: 'Favoritos', icon: Heart },
  { label: 'Personalización', icon: Palette },
  { label: 'Ajustes', icon: Settings2 },
]

function readRecentTracks(): Track[] {
  try {
    const stored = window.localStorage.getItem('dropmusic-recent')
    if (!stored) return []
    const value: unknown = JSON.parse(stored)
    if (!Array.isArray(value)) return []
    return value.filter((track): track is Track =>
      typeof track === 'object' && track !== null && typeof track.id === 'string' && track.source === 'Spotify')
  } catch (error) {
    console.error('No se pudo leer lo escuchado recientemente en DropMusic.', error)
    return []
  }
}

// Color estable por texto, para las portadas de las mezclas.
function hueFromText(text: string) {
  let hash = 0
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) % 360
  return hash
}

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
  'Tu colección': { title: 'Todo lo que guardas.', subtitle: 'Álbumes, playlists y momentos que vuelven contigo.' },
  Favoritos: { title: 'Lo que siempre vuelve.', subtitle: 'Tus canciones favoritas, reunidas en un solo lugar.' },
  Personalización: { title: 'Hazla tuya.', subtitle: 'Elige el estilo con el que se ve y se siente DropMusic.' },
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
      animations: typeof saved.animations === 'boolean' ? saved.animations : defaults.animations,
      animatedCovers: typeof saved.animatedCovers === 'boolean' ? saved.animatedCovers : defaults.animatedCovers,
      layout: layouts.some(({ id }) => id === saved.layout) ? saved.layout! : defaults.layout,
      theme: themes.some(({ id }) => id === saved.theme) ? saved.theme! : defaults.theme,
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
    albumId: track.albumId,
    albumType: track.albumType,
    artists: track.artists,
  }
}

function albumFromTrack(track: Track): Album {
  return {
    id: track.albumId ?? '',
    title: track.album,
    artist: track.artist,
    artists: track.artists ?? [],
    artwork: track.artwork,
    year: '',
    albumType: track.albumType ?? 'album',
    totalTracks: 0,
    url: '',
  }
}

function albumTypeLabel(album: Album) {
  if (album.albumType === 'single') return 'Sencillo'
  if (album.albumType === 'compilation') return 'Recopilación'
  return 'Álbum'
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

// Radio de Spotify al estilo de su "radio de canción": la API de recomendaciones ya no está
// disponible para apps nuevas, así que se arma con canciones del artista, de artistas
// relacionados y del mismo género. La semilla nunca es el texto del buscador, para no
// mezclar canciones que solo se llaman igual (buscar "Bad Bunny" no trae canciones tituladas así).
// `upNext` son las canciones de un álbum o artista que suenan antes de pasar a la radio.
type RadioSeed = { kind: 'artist'; id: string; name: string } | { kind: 'genre'; name: string }

type SpotifyRadio = {
  seed: RadioSeed | null
  upNext: Track[]
  queue: Track[]
  playedIds: Set<string>
  // Artistas relacionados que se van visitando para descubrir sin perder la coherencia.
  relatedSeeds: RadioSeed[]
  visitedSeeds: Set<string>
  round: number
  mainOffset: number
  pending: Promise<void> | null
}

type RadioBatch = {
  genres: string[]
  sameArtist: SpotifyTrackResult[]
  related: SpotifyTrackResult[]
  genre: SpotifyTrackResult[]
  relatedArtists: ArtistRef[]
}

function createSpotifyRadio(seed: RadioSeed | null): SpotifyRadio {
  return {
    seed,
    upNext: [],
    queue: [],
    playedIds: new Set(),
    relatedSeeds: [],
    visitedSeeds: new Set(),
    round: 0,
    mainOffset: 0,
    pending: null,
  }
}

function radioSeedKey(seed: RadioSeed) {
  return seed.kind === 'artist' ? `artist:${seed.id || seed.name.toLowerCase()}` : `genre:${seed.name.toLowerCase()}`
}

function radioSeedLabel(seed: RadioSeed) {
  return seed.kind === 'artist' ? `Radio de ${seed.name}` : `Radio: ${seed.name}`
}

function seedFromTrack(track: Track): RadioSeed {
  const artist = track.artists?.find((item) => item.id)
  return artist
    ? { kind: 'artist', id: artist.id, name: artist.name }
    : { kind: 'artist', id: '', name: track.artist.split(',')[0].trim() }
}

function mainArtistKey(track: Track) {
  return (track.artists?.[0]?.id || track.artist.split(',')[0]).toLowerCase()
}

const spotifyRadioMaxOffset = 300

// Intercala las tres fuentes (mismo artista, relacionados, género) y evita que el mismo
// artista suene dos veces seguidas.
function mixRadioBatch(groups: Track[][], lastArtist: string, randomize: boolean) {
  const pattern = [0, 1, 1, 2, 0, 1, 2, 1]
  const pools = groups.map((group) => (randomize ? shuffled(group) : [...group]))
  const ordered: Track[] = []
  for (let step = 0; pools.some((pool) => pool.length > 0); step += 1) {
    const track = pools[pattern[step % pattern.length]].shift() ?? pools.find((pool) => pool.length > 0)?.shift()
    if (track) ordered.push(track)
  }
  const result: Track[] = []
  let previous = lastArtist
  while (ordered.length > 0) {
    const index = ordered.findIndex((track) => mainArtistKey(track) !== previous)
    const [track] = ordered.splice(Math.max(0, index), 1)
    result.push(track)
    previous = mainArtistKey(track)
  }
  return result
}

function shuffled<T>(items: T[]) {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1))
    ;[copy[index], copy[swap]] = [copy[swap], copy[index]]
  }
  return copy
}

function TrackRows({
  visibleTracks,
  activeTrackId,
  favoriteIds,
  onPlay,
  onToggleFavorite,
  showIndex = false,
}: {
  visibleTracks: Track[]
  activeTrackId: string
  favoriteIds: string[]
  onPlay: (id: string) => void
  onToggleFavorite: (id: string) => void
  showIndex?: boolean
}) {
  if (visibleTracks.length === 0) {
    return <div className="empty-search"><Search size={20} /><p>No encontramos canciones con esa búsqueda.</p></div>
  }

  return (
    <div className="track-list">
      {visibleTracks.map((track, index) => {
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
              <span className={`track-art-wrap${showIndex ? ' track-index-wrap' : ''}`}>
                {showIndex
                  ? <span className="track-index">{index + 1}</span>
                  : <img alt="" className="track-art" loading="lazy" src={track.artwork} />}
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

type LyricLine = { time: number; text: string }

type LyricsState = {
  trackId: string
  status: 'loading' | 'ready' | 'missing' | 'error'
  lines: LyricLine[]
  plain: string[]
  instrumental: boolean
}

type BigPictureMode = 'carousel' | 'lyrics'

// Convierte LRC ("[01:23.45] texto") en líneas con su segundo de inicio.
function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = []
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)]
    if (stamps.length === 0) continue
    const text = raw.replace(/\[[^\]]*\]/g, '').trim()
    for (const stamp of stamps) lines.push({ time: Number(stamp[1]) * 60 + Number(stamp[2]), text })
  }
  return lines.sort((a, b) => a.time - b.time)
}

// El reproductor solo informa segundos enteros; para el karaoke se interpola entre actualizaciones.
function useSmoothElapsed(elapsed: number, isPlaying: boolean) {
  const [smooth, setSmooth] = useState(elapsed)
  const baseRef = useRef<{ elapsed: number; at: number } | null>(null)

  useEffect(() => {
    baseRef.current = { elapsed, at: performance.now() }
  }, [elapsed])

  useEffect(() => {
    if (!isPlaying) return
    let frame = 0
    const tick = () => {
      const base = baseRef.current
      if (base) setSmooth(base.elapsed + Math.min(1.2, (performance.now() - base.at) / 1000))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [isPlaying])

  return isPlaying ? Math.max(smooth, elapsed) : elapsed
}

function LyricsView({ lyrics, elapsed, isPlaying, onSeek }: {
  lyrics: LyricsState | null
  elapsed: number
  isPlaying: boolean
  onSeek: (seconds: number) => void
}) {
  const time = useSmoothElapsed(elapsed, isPlaying)
  const listRef = useRef<HTMLDivElement>(null)
  const lines = lyrics?.lines ?? []
  // Se adelanta un poco para que la línea se ilumine justo cuando empieza a cantarse.
  const currentIndex = lines.findLastIndex((line) => line.time <= time + 0.2)
  const current = lines[currentIndex]
  const next = lines[currentIndex + 1]
  const lineProgress = current
    ? Math.min(1, Math.max(0, (time - current.time) / Math.max(0.5, (next?.time ?? current.time + 4) - current.time)))
    : 0

  useEffect(() => {
    const list = listRef.current
    const active = list?.querySelector<HTMLElement>('.lyric-line-current')
    if (!list || !active) return
    list.scrollTo({ top: active.offsetTop - list.clientHeight * 0.38, behavior: 'smooth' })
  }, [currentIndex])

  if (!lyrics || lyrics.status === 'loading') {
    return <div className="lyrics-message"><span className="lyrics-loader"><i /><i /><i /></span>Buscando la letra…</div>
  }
  if (lyrics.instrumental) return <div className="lyrics-message"><Music2 size={30} />Esta canción es instrumental.</div>
  if (lyrics.status === 'error') return <div className="lyrics-message">No se pudo cargar la letra. Revisa tu conexión.</div>
  if (lines.length === 0 && lyrics.plain.length === 0) {
    return <div className="lyrics-message"><Mic2 size={30} />No encontramos la letra de esta canción.</div>
  }

  if (lines.length === 0) {
    return (
      <div className="lyrics-list lyrics-plain" ref={listRef}>
        <p className="lyrics-note">Letra sin sincronizar</p>
        {lyrics.plain.map((line, index) => <p className="lyric-line" key={index}>{line || '♪'}</p>)}
      </div>
    )
  }

  return (
    <div aria-live="off" className="lyrics-list" ref={listRef}>
      {lines.map((line, index) => {
        const state = index === currentIndex ? ' lyric-line-current' : index < currentIndex ? ' lyric-line-past' : ''
        return (
          <button
            className={`lyric-line${state}`}
            key={`${line.time}-${index}`}
            onClick={() => onSeek(Math.floor(line.time))}
            style={index === currentIndex ? { '--line-progress': `${lineProgress * 100}%` } as CSSProperties : undefined}
            type="button"
          >
            <span>{line.text || '♪'}</span>
          </button>
        )
      })}
    </div>
  )
}

// Portada del modo letra: al cambiar de canción la anterior sale girando y la nueva entra.
function LyricsCover({ track }: { track: Track }) {
  const [shown, setShown] = useState(track)
  const [leaving, setLeaving] = useState<Track | null>(null)
  if (shown.id !== track.id) {
    setLeaving(shown)
    setShown(track)
  }

  useEffect(() => {
    if (!leaving) return
    const timer = window.setTimeout(() => setLeaving(null), 750)
    return () => window.clearTimeout(timer)
  }, [leaving])

  const cover = (item: Track, className: string) => item.artwork
    ? <img alt={`Portada de ${item.album}`} className={className} key={`${className}-${item.id}`} src={item.artwork} />
    : <span className={`${className} lyrics-cover-placeholder`} key={`${className}-${item.id}`}><Music2 size={64} /></span>

  return (
    <div className="lyrics-cover-panel">
      <div className="lyrics-cover-stack">
        {leaving && cover(leaving, 'lyrics-cover lyrics-cover-leaving')}
        {cover(track, 'lyrics-cover lyrics-cover-entering')}
        <span aria-hidden="true" className="lyrics-cover-shine" key={`shine-${track.id}`} />
      </div>
      <div className="lyrics-track-meta" key={track.id}>
        <strong>{track.title}</strong>
        <small>{track.artist}{track.album ? ` · ${track.album}` : ''}</small>
      </div>
    </div>
  )
}

function BigPicturePlayer({
  track,
  previousTracks,
  upcomingTracks,
  isPlaying,
  elapsed,
  shuffle,
  repeat,
  volume,
  mode,
  lyrics,
  onModeChange,
  onClose,
  onTogglePlayback,
  onSkip,
  onSeek,
  onPlay,
  onToggleShuffle,
  onToggleRepeat,
  onVolume,
}: {
  track: Track
  previousTracks: Track[]
  upcomingTracks: Track[]
  isPlaying: boolean
  elapsed: number
  shuffle: boolean
  repeat: boolean
  volume: number
  mode: BigPictureMode
  lyrics: LyricsState | null
  onModeChange: (mode: BigPictureMode) => void
  onClose: () => void
  onTogglePlayback: () => void
  onSkip: (direction: 1 | -1) => void
  onSeek: (seconds: number) => void
  onPlay: (id: string) => void
  onToggleShuffle: () => void
  onToggleRepeat: () => void
  onVolume: (volume: number) => void
}) {
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement) return
      if (event.key === 'Escape') onClose()
      else if (event.key === ' ') {
        event.preventDefault()
        onTogglePlayback()
      } else if (event.key === 'ArrowRight') onSkip(1)
      else if (event.key === 'ArrowLeft') onSkip(-1)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose, onSkip, onTogglePlayback])

  // Carrusel: dos canciones anteriores, la actual y dos siguientes.
  const cards = [
    ...previousTracks.slice(-2).map((item, index, list) => ({ track: item, offset: index - list.length })),
    { track, offset: 0 },
    ...upcomingTracks.slice(0, 2).map((item, index) => ({ track: item, offset: index + 1 })),
  ].filter((card, index, list) => list.findIndex((item) => item.track.id === card.track.id) === index)
  const progress = track.duration ? Math.min(100, (elapsed / track.duration) * 100) : 0

  return (
    <div aria-label="Reproductor Big Picture" aria-modal="true" className={`big-picture big-picture-mode-${mode}${isPlaying ? ' big-picture-playing' : ''}`} role="dialog">
      <div aria-hidden="true" className="big-picture-backdrop">
        {/* Cuatro copias difuminadas que giran: el fondo "líquido" de colores de la portada. */}
        {track.artwork && (
          <div className="artwork-flow" key={track.artwork}>
            {[0, 1, 2, 3].map((layer) => <img alt="" className={`artwork-flow-${layer}`} key={layer} src={track.artwork} />)}
          </div>
        )}
      </div>
      {themeScene}
      <div aria-label="Formato de pantalla completa" className="big-picture-modes" role="group">
        <button aria-pressed={mode === 'carousel'} data-mode="carousel" onClick={() => onModeChange('carousel')} type="button"><Disc3 size={15} /> Carrusel</button>
        <button aria-pressed={mode === 'lyrics'} data-mode="lyrics" onClick={() => onModeChange('lyrics')} type="button"><Mic2 size={15} /> Letra</button>
      </div>
      <button aria-label="Salir de Big Picture" className="big-picture-close" onClick={onClose} type="button"><Minimize2 size={18} /></button>

      {mode === 'lyrics' ? (
        <div className="lyrics-layout">
          <LyricsCover track={track} />
          <div className="lyrics-panel" key={track.id}>
            <LyricsView elapsed={elapsed} isPlaying={isPlaying} lyrics={lyrics?.trackId === track.id ? lyrics : null} onSeek={onSeek} />
          </div>
        </div>
      ) : (
      <div className="big-picture-stage">
        {track.artwork && <img alt="" aria-hidden="true" className="big-picture-glow" key={`glow-${track.artwork}`} src={track.artwork} />}
        {cards.map(({ track: item, offset }) => (
          <button
            aria-label={offset === 0 ? `${item.title} de ${item.artist}, sonando ahora` : `Reproducir ${item.title} de ${item.artist}`}
            className={`big-picture-card${offset === 0 ? ' big-picture-card-current' : ''}`}
            key={item.id}
            onClick={() => {
              if (offset === 0) onTogglePlayback()
              else if (offset === -1 && previousTracks.length > 0) onSkip(-1)
              else if (offset > 0) onPlay(item.id)
            }}
            style={{ '--card-offset': offset, '--card-distance': Math.abs(offset) } as CSSProperties}
            tabIndex={offset === 0 || offset === 1 ? 0 : -1}
            type="button"
          >
            <span className="big-picture-card-art">
              {item.artwork
                ? <img alt="" src={item.artwork} />
                : <span className="big-picture-card-placeholder"><Music2 size={48} /></span>}
            </span>
            <strong>{item.title}</strong>
            <small>{item.artist}</small>
          </button>
        ))}
      </div>
      )}

      <div className="big-picture-controls">
        <div className="big-picture-buttons">
          <button aria-label="Pista anterior" onClick={() => onSkip(-1)} type="button"><SkipBack fill="currentColor" size={20} /></button>
          <button aria-label={isPlaying ? 'Pausar' : 'Reproducir'} className="big-picture-play" onClick={onTogglePlayback} type="button">
            {isPlaying ? <Pause fill="currentColor" size={22} /> : <Play fill="currentColor" size={22} />}
          </button>
          <button aria-label="Siguiente pista" onClick={() => onSkip(1)} type="button"><SkipForward fill="currentColor" size={20} /></button>
        </div>

        <div className="big-picture-now">
          {track.artwork ? <img alt="" key={track.artwork} src={track.artwork} /> : <span className="big-picture-now-art"><Music2 size={16} /></span>}
          <span className="big-picture-now-meta" key={track.id}><strong>{track.title}</strong><small>{track.artist}</small></span>
          <span aria-hidden="true" className="big-picture-eq"><i /><i /><i /><i /></span>
          <span className="big-picture-time">{formatTime(elapsed)} / {formatTime(track.duration)}</span>
          <input
            aria-label="Progreso de la canción"
            className="big-picture-progress"
            disabled={!track.duration}
            max={Math.max(1, track.duration)}
            min="0"
            onChange={(event) => onSeek(Number(event.target.value))}
            style={{ '--range-progress': `${progress}%` } as CSSProperties}
            type="range"
            value={Math.min(track.duration, elapsed)}
          />
        </div>

        <div className="big-picture-extras">
          <button aria-label={shuffle ? 'Desactivar aleatorio' : 'Activar aleatorio'} aria-pressed={shuffle} className={shuffle ? 'big-picture-active' : ''} onClick={onToggleShuffle} type="button"><Shuffle size={18} /></button>
          <button aria-label={repeat ? 'Desactivar repetición' : 'Repetir canción'} aria-pressed={repeat} className={repeat ? 'big-picture-active' : ''} onClick={onToggleRepeat} type="button"><Repeat2 size={18} /></button>
          <label className="big-picture-volume">
            <Volume2 size={18} />
            <input aria-label="Volumen" max="100" min="0" onChange={(event) => onVolume(Number(event.target.value))} style={{ '--range-progress': `${volume}%` } as CSSProperties} type="range" value={volume} />
          </label>
        </div>
      </div>
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
  const [shuffle, setShuffle] = useState(true)
  const [repeat, setRepeat] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null)
  const [connectedAccounts, setConnectedAccounts] = useState<Partial<Record<Provider, ConnectedAccount>>>({})
  const [spotifySuggestedTracks, setSpotifySuggestedTracks] = useState<Track[]>([])
  const [spotifySuggestionsLoaded, setSpotifySuggestionsLoaded] = useState(false)
  const [spotifySuggestionsError, setSpotifySuggestionsError] = useState('')
  const [spotifyTracks, setSpotifyTracks] = useState<Track[]>([])
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
  const spotifyRadioRef = useRef<SpotifyRadio>(createSpotifyRadio(null))
  const spotifyHistoryRef = useRef<Track[]>([])
  const [radioSeed, setRadioSeed] = useState('')
  const [radioQueue, setRadioQueue] = useState<Track[]>([])
  const [recentTracks, setRecentTracks] = useState<Track[]>([])
  const [spotifyAlbums, setSpotifyAlbums] = useState<Album[]>([])
  const [spotifyArtists, setSpotifyArtists] = useState<Artist[]>([])
  const [detailStack, setDetailStack] = useState<Detail[]>([])
  const [artistPage, setArtistPage] = useState<ArtistPage | null>(null)
  const [albumPage, setAlbumPage] = useState<AlbumPage | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [discographyFilter, setDiscographyFilter] = useState<'all' | 'album' | 'single'>('all')
  const [bigPictureMode, setBigPictureMode] = useState<BigPictureMode | null>(null)
  const [lyrics, setLyrics] = useState<LyricsState | null>(null)
  const [themeFilter, setThemeFilter] = useState<ThemeCategory | 'Todos'>('Todos')
  const lyricsCacheRef = useRef(new Map<string, LyricsState>())
  const [topArtists, setTopArtists] = useState<Artist[]>([])
  const [newReleases, setNewReleases] = useState<Album[]>([])
  const [listeningHistory, setListeningHistory] = useState(readRecentTracks)
  const detailRequestRef = useRef(0)
  const mainContentRef = useRef<HTMLElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const currentDetail = detailStack.at(-1) ?? null

  const activeTrack = activeCatalogTrack ?? tracks.find((track) => track.id === activeTrackId) ?? emptyTrack
  const query = search.trim().toLowerCase()
  const isSearching = query.length >= 2
  const allTracks = useMemo(
    () => [...tracks, ...spotifySuggestedTracks, ...spotifyTracks, ...jamendoTracks]
      .filter((track, index, list) => list.findIndex((item) => item.id === track.id) === index),
    [spotifySuggestedTracks, spotifyTracks, jamendoTracks],
  )
  const configuredJamendoClientId = settings.jamendoClientId.trim() || defaultJamendoClientId
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
    // Son extras de la portada: si Spotify no los da, la sección simplemente no aparece.
    void invoke<Artist[]>('spotify_get_top_artists', { clientId: spotifyClientId })
      .then((artists) => { if (active) setTopArtists(artists) })
      .catch((error: unknown) => console.error('No se pudieron cargar tus artistas de Spotify.', error))
    void invoke<Album[]>('spotify_get_new_releases', { clientId: spotifyClientId })
      .then((albums) => { if (active) setNewReleases(albums) })
      .catch((error: unknown) => console.error('No se pudieron cargar los lanzamientos de Spotify.', error))
    return () => { active = false }
  }, [connectedAccounts.Spotify])

  useEffect(() => {
    try {
      window.localStorage.setItem('dropmusic-recent', JSON.stringify(listeningHistory))
    } catch (error) {
      console.error('No se pudo guardar lo escuchado recientemente en DropMusic.', error)
    }
  }, [listeningHistory])

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
          albumId: track.album.uri.replace(/^spotify:album:/, ''),
          albumType: '',
          artists: track.artists.map((artist) => ({ id: artist.uri.replace(/^spotify:artist:/, ''), name: artist.name })),
          duration: Math.floor(track.duration_ms / 1000),
          artwork: track.album.images[0]?.url ?? '',
          url: `https://open.spotify.com/track/${track.id}`,
        })
        setActiveTrackId(selectedTrack.id)
        // Si es la misma canción que ya pusimos, se conserva la versión con todos sus datos.
        setActiveCatalogTrack((current) => current?.id === selectedTrack.id ? current : selectedTrack)
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
      setSpotifyAlbums([])
      setSpotifyArtists([])
      setSpotifyNextOffset(null)
      void invoke<SpotifyCatalogResults>('spotify_search_catalog', {
        clientId: spotifyClientId,
        query: search.trim(),
      }).then((results) => {
        if (requestId !== spotifySearchRequestRef.current) return
        setSpotifyTracks(results.tracks.map(toSpotifyTrack))
        setSpotifyAlbums(results.albums)
        setSpotifyArtists(results.artists)
        // La búsqueda combinada trae una página; "Cargar más" sigue solo con canciones.
        setSpotifyNextOffset(results.tracks.length > 0 ? results.tracks.length : null)
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
    const requestId = ++detailRequestRef.current
    if (!currentDetail || !spotifyClientId) return
    setDetailLoading(true)
    setDetailError('')
    const request = currentDetail.kind === 'artist'
      ? invoke<{ artist: Artist; topTracks: SpotifyTrackResult[]; albums: Album[] }>('spotify_get_artist', {
        clientId: spotifyClientId,
        artistId: currentDetail.id,
      }).then((page) => {
        if (requestId !== detailRequestRef.current) return
        setArtistPage({ ...page, topTracks: page.topTracks.map(toSpotifyTrack) })
      })
      : invoke<{ album: Album; tracks: SpotifyTrackResult[] }>('spotify_get_album', {
        clientId: spotifyClientId,
        albumId: currentDetail.id,
      }).then((page) => {
        if (requestId !== detailRequestRef.current) return
        setAlbumPage({ album: page.album, tracks: page.tracks.map(toSpotifyTrack) })
      })
    void request.catch((error: unknown) => {
      if (requestId !== detailRequestRef.current) return
      console.error(`No se pudo cargar ${currentDetail.kind === 'artist' ? 'el artista' : 'el álbum'}.`, error)
      setDetailError(error instanceof Error ? error.message : String(error))
    }).finally(() => {
      if (requestId === detailRequestRef.current) setDetailLoading(false)
    })
  }, [currentDetail])

  useEffect(() => {
    if (bigPictureMode !== 'lyrics' || !activeTrack.id || !isTauri()) return
    const trackId = activeTrack.id
    const cached = lyricsCacheRef.current.get(trackId)
    if (cached) {
      setLyrics(cached)
      return
    }
    let active = true
    setLyrics({ trackId, status: 'loading', lines: [], plain: [], instrumental: false })
    void invoke<{ synced: string | null; plain: string | null; instrumental: boolean } | null>('lyrics_get', {
      artist: activeTrack.artists?.[0]?.name ?? activeTrack.artist.split(',')[0],
      title: activeTrack.title,
      album: activeTrack.album,
      duration: activeTrack.duration,
    }).then((result) => {
      const loaded: LyricsState = {
        trackId,
        status: result ? 'ready' : 'missing',
        lines: result?.synced ? parseLrc(result.synced) : [],
        plain: result?.plain ? result.plain.split(/\r?\n/) : [],
        instrumental: result?.instrumental ?? false,
      }
      lyricsCacheRef.current.set(trackId, loaded)
      if (active) setLyrics(loaded)
    }).catch((error: unknown) => {
      console.error('No se pudo cargar la letra.', error)
      if (active) setLyrics({ trackId, status: 'error', lines: [], plain: [], instrumental: false })
    })
    return () => { active = false }
  }, [bigPictureMode, activeTrack.id, activeTrack.title, activeTrack.artist, activeTrack.artists, activeTrack.album, activeTrack.duration])

  useEffect(() => {
    mainContentRef.current?.scrollTo({ top: 0 })
  }, [currentDetail, activeSection, isSearching])

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

  function startSpotifyTrack(spotifyTrack: Track, addToHistory = true) {
    if (!spotifyPlayerRef.current || !spotifyDeviceId || !spotifyClientId) {
      setSpotifyPlayerError('El reproductor de Spotify todavía está conectando. Inténtalo de nuevo en unos segundos.')
      return
    }
    if (addToHistory) spotifyHistoryRef.current = [...spotifyHistoryRef.current, spotifyTrack].slice(-50)
    setRecentTracks(spotifyHistoryRef.current.slice(0, -1).slice(-2))
    setListeningHistory((current) => [spotifyTrack, ...current.filter((track) => track.id !== spotifyTrack.id)].slice(0, 12))
    spotifyRadioRef.current.playedIds.add(spotifyTrack.id)
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
      setSpotifyPlaybackOption('repeat', repeat)
    }).catch((error: unknown) => {
      console.error(`No se pudo reproducir ${spotifyTrack.title} en DropMusic.`, error)
      setIsPlaying(false)
      setSpotifyPlayerError(error instanceof Error ? error.message : String(error))
    })
  }

  function startSpotifyRadio(seed: RadioSeed) {
    const current = spotifyRadioRef.current.seed
    if (current && radioSeedKey(current) === radioSeedKey(seed)) return
    spotifyRadioRef.current = createSpotifyRadio(seed)
    setRadioSeed(radioSeedLabel(seed))
    setRadioQueue([])
    void fillSpotifyRadio()
  }

  function syncRadioQueue() {
    const radio = spotifyRadioRef.current
    setRadioQueue([...radio.upNext, ...radio.queue])
  }

  // Reproduce una canción de una lista (álbum, artista) y deja el resto de la lista como "a continuación".
  function playFromList(list: Track[], id: string, seed: RadioSeed) {
    const index = list.findIndex((track) => track.id === id)
    const track = list[index]
    if (!track) return
    if (track.source !== 'Spotify') {
      playTrack(id)
      return
    }
    const radio = createSpotifyRadio(seed)
    const rest = list.slice(index + 1).filter((item) => item.source === 'Spotify')
    radio.upNext = shuffle ? shuffled(rest) : rest
    spotifyRadioRef.current = radio
    setRadioSeed(radioSeedLabel(seed))
    syncRadioQueue()
    startSpotifyTrack(track)
    void fillSpotifyRadio()
  }

  function fillSpotifyRadio() {
    const radio = spotifyRadioRef.current
    if (!radio.seed || !spotifyClientId) return Promise.resolve()
    if (radio.pending) return radio.pending
    // Tus canciones más escuchadas no entran en la radio: la idea es descubrir música parecida.
    const excludedIds = new Set(spotifySuggestedTracks.map((track) => track.id))
    radio.pending = (async () => {
      for (let attempt = 0; attempt < 4 && radio.queue.length < 8 && spotifyRadioRef.current === radio; attempt += 1) {
        // Una ronda con el artista principal, otra con un relacionado: descubre sin perder el estilo.
        const useRelated = radio.round % 2 === 1 && radio.relatedSeeds.length > 0
        const seed = useRelated ? radio.relatedSeeds.shift()! : radio.seed!
        const offset = useRelated ? 0 : radio.mainOffset
        if (!useRelated) radio.mainOffset += 10
        radio.round += 1
        radio.visitedSeeds.add(radioSeedKey(seed))

        const batch = await invoke<RadioBatch>('spotify_build_radio', {
          clientId: spotifyClientId,
          artistId: seed.kind === 'artist' && seed.id ? seed.id : null,
          artistName: seed.kind === 'artist' ? seed.name : null,
          genre: seed.kind === 'genre' ? seed.name : null,
          offset,
        })
        for (const artist of batch.relatedArtists) {
          const related: RadioSeed = { kind: 'artist', id: artist.id, name: artist.name }
          const key = radioSeedKey(related)
          if (!radio.visitedSeeds.has(key) && !radio.relatedSeeds.some((item) => radioSeedKey(item) === key)) {
            radio.relatedSeeds.push(related)
          }
        }

        const seen = new Set([...radio.upNext, ...radio.queue].map((track) => track.id))
        const fresh = (list: SpotifyTrackResult[]) => {
          const tracks: Track[] = []
          for (const track of list.map(toSpotifyTrack)) {
            if (excludedIds.has(track.id) || radio.playedIds.has(track.id) || seen.has(track.id)) continue
            seen.add(track.id)
            tracks.push(track)
          }
          return tracks
        }
        const last = radio.queue.at(-1) ?? spotifyHistoryRef.current.at(-1)
        radio.queue.push(...mixRadioBatch(
          [fresh(batch.sameArtist), fresh(batch.related), fresh(batch.genre)],
          last ? mainArtistKey(last) : '',
          shuffle,
        ))

        if (radio.mainOffset > spotifyRadioMaxOffset) {
          // Se acabó el catálogo del artista: vuelve a empezar sin repetir lo último que sonó.
          radio.mainOffset = 0
          radio.playedIds = new Set(spotifyHistoryRef.current.slice(-10).map((track) => track.id))
        }
      }
    })().catch((error: unknown) => {
      console.error('No se pudieron cargar canciones parecidas en Spotify.', error)
      setSpotifyPlayerError(error instanceof Error ? error.message : String(error))
    }).finally(() => {
      radio.pending = null
      if (spotifyRadioRef.current === radio) syncRadioQueue()
    })
    return radio.pending
  }

  async function playNextSpotifyRadio() {
    if (!spotifyRadioRef.current.seed) startSpotifyRadio(seedFromTrack(activeTrack))
    const radio = spotifyRadioRef.current
    if (radio.upNext.length === 0 && radio.queue.length === 0) await fillSpotifyRadio()
    if (spotifyRadioRef.current !== radio) return
    const next = radio.upNext.shift() ?? radio.queue.shift()
    syncRadioQueue()
    if (!next) {
      setIsPlaying(false)
      setSpotifyPlayerError('No encontramos más canciones parecidas. Busca otra canción para empezar una radio nueva.')
      return
    }
    startSpotifyTrack(next)
    void fillSpotifyRadio()
  }

  function playPreviousSpotifyTrack() {
    const history = spotifyHistoryRef.current
    if (history.length < 2) {
      void spotifyPlayerRef.current?.seek(0).catch((error: unknown) => {
        console.error('No se pudo volver al inicio de la canción.', error)
      })
      return
    }
    const current = history[history.length - 1]
    const previous = history[history.length - 2]
    spotifyHistoryRef.current = history.slice(0, -1)
    // La canción que se deja vuelve al frente de la cola para no perderla.
    spotifyRadioRef.current.upNext.unshift(current)
    syncRadioQueue()
    startSpotifyTrack(previous, false)
  }

  function playTrack(id: string) {
    const spotifyTrack = [...allTracks, ...radioQueue].find((track) => track.id === id && track.source === 'Spotify')
    if (spotifyTrack) {
      const radio = spotifyRadioRef.current
      const upNextIndex = radio.upNext.findIndex((track) => track.id === id)
      const queueIndex = radio.queue.findIndex((track) => track.id === id)
      if (upNextIndex >= 0 || queueIndex >= 0) {
        // Saltar a una canción de la cola descarta las que estaban antes que ella.
        if (upNextIndex >= 0) radio.upNext.splice(0, upNextIndex + 1)
        else {
          radio.upNext = []
          radio.queue.splice(0, queueIndex + 1)
        }
        syncRadioQueue()
      } else {
        // La radio sigue al artista de la canción, no al texto que se buscó.
        startSpotifyRadio(seedFromTrack(spotifyTrack))
      }
      startSpotifyTrack(spotifyTrack)
      void fillSpotifyRadio()
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
    // El aleatorio lo maneja DropMusic: al activarlo se mezcla lo que queda en la cola.
    const enabled = !shuffle
    setShuffle(enabled)
    if (enabled) {
      const radio = spotifyRadioRef.current
      radio.upNext = shuffled(radio.upNext)
      radio.queue = shuffled(radio.queue)
      syncRadioQueue()
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
      if (direction < 0) {
        playPreviousSpotifyTrack()
      } else {
        void playNextSpotifyRadio()
      }
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
    setDetailStack([])
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
      setSpotifyNextOffset(null)
      setSpotifyError('')
      setSpotifySuggestionsError('')
      setSpotifyPlayerError('')
      setSpotifyPlayerReady(false)
      setSpotifyDeviceId('')
      setSpotifyPlayerStatus('')
      spotifyRadioRef.current = createSpotifyRadio(null)
      spotifyHistoryRef.current = []
      setRadioSeed('')
      setRadioQueue([])
      setTopArtists([])
      setNewReleases([])
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

  function renderTracks(visibleTracks: Track[], options: { seed?: RadioSeed; showIndex?: boolean } = {}) {
    const { seed, showIndex } = options
    return (
      <TrackRows
        activeTrackId={activeTrackId}
        favoriteIds={favoriteIds}
        onPlay={seed === undefined ? playTrack : (id) => playFromList(visibleTracks, id, seed)}
        onToggleFavorite={toggleFavorite}
        showIndex={showIndex}
        visibleTracks={visibleTracks}
      />
    )
  }

  function openDetail(detail: Detail) {
    if (!detail.id) return
    if (currentDetail?.kind === detail.kind && currentDetail.id === detail.id) return
    if (detail.kind === 'artist') {
      setArtistPage(null)
      setDiscographyFilter('all')
    } else {
      setAlbumPage(null)
    }
    setDetailStack((current) => [...current, detail])
  }

  function goBack() {
    setDetailStack((current) => current.slice(0, -1))
  }

  function seekTo(time: number) {
    setElapsedSeconds(time)
    if (activeTrack.source === 'Spotify') {
      void spotifyPlayerRef.current?.seek(time * 1000).catch((error: unknown) => {
        console.error('No se pudo cambiar la posición de reproducción de Spotify.', error)
        setSpotifyPlayerError(error instanceof Error ? error.message : String(error))
      })
    } else if (audioRef.current) {
      audioRef.current.currentTime = time
    }
  }

  function renderAlbumGrid(list: Album[]) {
    return (
      <div className="album-grid">
        {list.map((album) => (
          <button className="album-card" key={album.id} onClick={() => openDetail({ kind: 'album', id: album.id })} type="button">
            <span className="album-card-art">
              {album.artwork ? <img alt={`Portada de ${album.title}`} loading="lazy" src={album.artwork} /> : <span className="album-card-placeholder"><Disc3 size={30} /></span>}
              <span><Play fill="currentColor" size={17} /></span>
            </span>
            <strong>{album.title}</strong>
            <small>{[album.year, albumTypeLabel(album), album.artist].filter(Boolean).join(' · ')}</small>
          </button>
        ))}
      </div>
    )
  }

  function renderArtistLinks(track: Track) {
    if (!track.artists?.length) return track.artist
    return track.artists.map((artist, index) => (
      <span key={`${artist.id}-${index}`}>
        {index > 0 && ', '}
        <button className="inline-link" onClick={() => openDetail({ kind: 'artist', id: artist.id })} type="button">{artist.name}</button>
      </span>
    ))
  }

  function renderSearch() {
    if (!connectedAccounts.Spotify) {
      return (
        <section className="search-view">
          <div className="search-view-heading"><p className="eyebrow">BUSCAR</p><h1>“{search.trim()}”</h1></div>
          <div className="spotify-suggestions-empty">
            <p>Conecta Spotify para buscar canciones, álbumes y artistas.</p>
            <button className="secondary-button" onClick={() => connectProvider('Spotify')} type="button">Conectar Spotify <ArrowUpRight size={14} /></button>
          </div>
        </section>
      )
    }

    // Si la búsqueda coincide con un artista, aparece primero; si no, la primera canción.
    const topArtist = spotifyArtists.find((artist) => artist.name.toLowerCase() === query) ?? null
    const topTrack = topArtist ? null : spotifyTracks[0] ?? null
    // Los álbumes de las canciones encontradas van primero (si son álbumes de verdad, no sencillos).
    const searchAlbums = [
      ...spotifyTracks.filter((track) => track.albumId && track.albumType === 'album').map(albumFromTrack),
      ...spotifyAlbums,
    ].filter((album, index, list) => album.id && list.findIndex((item) => item.id === album.id) === index)
    const noResults = !spotifyLoading && spotifyTracks.length === 0 && spotifyArtists.length === 0 && searchAlbums.length === 0

    return (
      <section aria-label="Resultados de búsqueda" className="search-view">
        <div className="search-view-heading"><p className="eyebrow">RESULTADOS DE BÚSQUEDA</p><h1>“{search.trim()}”</h1></div>
        {spotifyError ? (
          <p className="spotify-catalog-error" role="status">{spotifyError}</p>
        ) : spotifyLoading && spotifyTracks.length === 0 ? (
          <p className="spotify-catalog-hint" role="status">Buscando en Spotify…</p>
        ) : noResults ? (
          <div className="empty-search"><Search size={20} /><p>No encontramos nada con esa búsqueda. Prueba con otro nombre.</p></div>
        ) : (
          <>
            <div className="search-top-grid">
              {(topArtist || topTrack) && (
                <section aria-labelledby="top-result-heading">
                  <div className="section-heading"><div><p className="eyebrow">MEJOR RESULTADO</p><h2 id="top-result-heading">{topArtist ? 'Artista' : 'Canción'}</h2></div></div>
                  {topArtist ? (
                    <button className="top-result-card" onClick={() => openDetail({ kind: 'artist', id: topArtist.id })} type="button">
                      {topArtist.image ? <img alt="" className="top-result-image top-result-round" src={topArtist.image} /> : <span className="top-result-image top-result-round top-result-placeholder"><Mic2 size={34} /></span>}
                      <strong>{topArtist.name}</strong>
                      <small>Artista{topArtist.genres[0] ? ` · ${topArtist.genres[0]}` : ''}</small>
                    </button>
                  ) : topTrack && (
                    <button className="top-result-card" onClick={() => playTrack(topTrack.id)} type="button">
                      <img alt="" className="top-result-image" src={topTrack.artwork} />
                      <strong>{topTrack.title}</strong>
                      <small>Canción · {topTrack.artist}</small>
                      <span className="top-result-play"><Play fill="currentColor" size={18} /></span>
                    </button>
                  )}
                </section>
              )}
              <section aria-labelledby="search-songs-heading" className="search-songs">
                <div className="section-heading"><div><p className="eyebrow">SPOTIFY</p><h2 id="search-songs-heading">Canciones</h2></div></div>
                {renderTracks(spotifyTracks.slice(0, 5))}
              </section>
            </div>

            {spotifyArtists.length > 0 && (
              <section aria-labelledby="search-artists-heading" className="search-block">
                <div className="section-heading"><div><p className="eyebrow">PERFILES</p><h2 id="search-artists-heading">Artistas</h2></div></div>
                <div className="artist-row">
                  {spotifyArtists.map((artist) => (
                    <button className="artist-card" key={artist.id} onClick={() => openDetail({ kind: 'artist', id: artist.id })} type="button">
                      {artist.image ? <img alt="" loading="lazy" src={artist.image} /> : <span className="artist-card-placeholder"><Mic2 size={26} /></span>}
                      <strong>{artist.name}</strong>
                      <small>Artista</small>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {searchAlbums.length > 0 && (
              <section aria-labelledby="search-albums-heading" className="search-block">
                <div className="section-heading"><div><p className="eyebrow">DISCOS</p><h2 id="search-albums-heading">Álbumes</h2></div></div>
                {renderAlbumGrid(searchAlbums.slice(0, 8))}
              </section>
            )}

            {spotifyTracks.length > 5 && (
              <section aria-labelledby="search-more-heading" className="search-block">
                <div className="section-heading"><div><p className="eyebrow">SPOTIFY</p><h2 id="search-more-heading">Más canciones</h2></div></div>
                {renderTracks(spotifyTracks.slice(5))}
                {spotifyNextOffset !== null && (
                  <button className="spotify-load-more" disabled={spotifyLoading} onClick={() => { void loadMoreSpotify() }} type="button">
                    {spotifyLoading ? 'Cargando…' : 'Cargar más canciones'}
                  </button>
                )}
              </section>
            )}

            {configuredJamendoClientId && (jamendoTracks.length > 0 || jamendoLoading || jamendoError) && (
              <section aria-labelledby="search-jamendo-heading" className="search-block">
                <div className="section-heading"><div><p className="eyebrow">CATÁLOGO LIBRE</p><h2 id="search-jamendo-heading">Jamendo</h2></div></div>
                {jamendoError
                  ? <p className="spotify-catalog-error" role="status">{jamendoError}</p>
                  : jamendoTracks.length > 0 ? renderTracks(jamendoTracks) : <p className="spotify-catalog-hint" role="status">Buscando en Jamendo…</p>}
              </section>
            )}
          </>
        )}
      </section>
    )
  }

  function renderDetailStatus(kind: string) {
    if (detailError) return <p className="spotify-catalog-error" role="status">{detailError}</p>
    return <p className="spotify-catalog-hint" role="status">{detailLoading ? `Cargando ${kind}…` : ''}</p>
  }

  function renderArtist() {
    if (!artistPage || artistPage.artist.id !== currentDetail?.id) return renderDetailStatus('el artista')
    const { artist, topTracks, albums: discography } = artistPage
    const filteredDiscography = discography.filter((album) =>
      discographyFilter === 'all' || (discographyFilter === 'single' ? album.albumType === 'single' : album.albumType !== 'single'))
    return (
      <>
        <section className="detail-hero artist-hero">
          {artist.image && <img alt="" aria-hidden="true" className="detail-hero-backdrop" src={artist.image} />}
          {artist.image ? <img alt={`Foto de ${artist.name}`} className="detail-hero-image detail-hero-round" src={artist.image} /> : <span className="detail-hero-image detail-hero-round top-result-placeholder"><Mic2 size={48} /></span>}
          <div className="detail-hero-copy">
            <p className="eyebrow">ARTISTA</p>
            <h1>{artist.name}</h1>
            <p>{[
              artist.followers !== null ? `${artist.followers.toLocaleString('es')} seguidores` : '',
              artist.genres.slice(0, 3).join(' · '),
            ].filter(Boolean).join(' · ')}</p>
            <div className="detail-actions">
              <button className="detail-play" disabled={topTracks.length === 0} onClick={() => topTracks[0] && playFromList(topTracks, topTracks[0].id, { kind: 'artist', id: artist.id, name: artist.name })} type="button"><Play fill="currentColor" size={16} /> Reproducir</button>
              <a className="secondary-button" href={artist.url} rel="noreferrer" target="_blank">Abrir en Spotify <ArrowUpRight size={14} /></a>
            </div>
          </div>
        </section>

        <section aria-labelledby="artist-top-heading" className="search-block">
          <div className="section-heading"><div><p className="eyebrow">LO MÁS ESCUCHADO</p><h2 id="artist-top-heading">Canciones populares</h2></div></div>
          {topTracks.length > 0
            ? renderTracks(topTracks, { seed: { kind: 'artist', id: artist.id, name: artist.name } })
            : <p className="spotify-catalog-hint">Spotify no tiene canciones populares para este artista.</p>}
        </section>

        <section aria-labelledby="artist-discography-heading" className="search-block">
          <div className="section-heading">
            <div><p className="eyebrow">DISCOGRAFÍA</p><h2 id="artist-discography-heading">Álbumes y sencillos</h2></div>
            <div aria-label="Filtrar discografía" className="chip-row" role="group">
              {([['all', 'Todo'], ['album', 'Álbumes'], ['single', 'Sencillos']] as const).map(([value, label]) => (
                <button aria-pressed={discographyFilter === value} className={`chip${discographyFilter === value ? ' chip-active' : ''}`} key={value} onClick={() => setDiscographyFilter(value)} type="button">{label}</button>
              ))}
            </div>
          </div>
          {filteredDiscography.length > 0
            ? renderAlbumGrid(filteredDiscography)
            : <p className="spotify-catalog-hint">No hay lanzamientos en esta categoría.</p>}
        </section>
      </>
    )
  }

  function renderAlbum() {
    if (!albumPage || albumPage.album.id !== currentDetail?.id) return renderDetailStatus('el álbum')
    const { album, tracks: albumTracks } = albumPage
    const totalSeconds = albumTracks.reduce((sum, track) => sum + track.duration, 0)
    return (
      <>
        <section className="detail-hero">
          {album.artwork && <img alt="" aria-hidden="true" className="detail-hero-backdrop" src={album.artwork} />}
          {album.artwork ? <img alt={`Portada de ${album.title}`} className="detail-hero-image" src={album.artwork} /> : <span className="detail-hero-image top-result-placeholder"><Disc3 size={48} /></span>}
          <div className="detail-hero-copy">
            <p className="eyebrow">{albumTypeLabel(album).toUpperCase()}</p>
            <h1>{album.title}</h1>
            <p>
              {album.artists.map((artist, index) => (
                <span key={`${artist.id}-${index}`}>{index > 0 && ', '}<button className="inline-link" onClick={() => openDetail({ kind: 'artist', id: artist.id })} type="button">{artist.name}</button></span>
              ))}
              {album.year && ` · ${album.year}`} · {albumTracks.length} canciones · {Math.round(totalSeconds / 60)} min
            </p>
            <div className="detail-actions">
              <button className="detail-play" disabled={albumTracks.length === 0} onClick={() => albumTracks[0] && playFromList(albumTracks, albumTracks[0].id, seedFromTrack(albumTracks[0]))} type="button"><Play fill="currentColor" size={16} /> Reproducir</button>
              <a className="secondary-button" href={album.url} rel="noreferrer" target="_blank">Abrir en Spotify <ArrowUpRight size={14} /></a>
            </div>
          </div>
        </section>
        <section aria-label="Canciones del álbum" className="search-block">
          {renderTracks(albumTracks, { seed: albumTracks[0] ? seedFromTrack(albumTracks[0]) : undefined, showIndex: true })}
        </section>
      </>
    )
  }

  function renderDetail() {
    return (
      <div className="detail-view">
        <button className="text-button back-button" onClick={goBack} type="button"><ArrowLeft size={15} /> Volver</button>
        {currentDetail?.kind === 'artist' ? renderArtist() : renderAlbum()}
      </div>
    )
  }

  // Una mezcla es una radio que empieza con canciones de un artista o un género.
  async function startMix(seed: RadioSeed) {
    if (!spotifyClientId) return
    setSpotifyPlayerError('')
    spotifyRadioRef.current = createSpotifyRadio(seed)
    setRadioSeed(radioSeedLabel(seed))
    setRadioQueue([])
    await fillSpotifyRadio()
    await playNextSpotifyRadio()
  }

  function renderShelf(id: string, eyebrow: string, title: string, children: ReactNode) {
    return (
      <section aria-labelledby={id} className="home-shelf">
        <div className="section-heading"><div><p className="eyebrow">{eyebrow}</p><h2 id={id}>{title}</h2></div></div>
        <div className="shelf">{children}</div>
      </section>
    )
  }

  function renderHomeShelves() {
    if (!connectedAccounts.Spotify) return null
    const suggestedIds = new Set(spotifySuggestedTracks.slice(0, 5).map((track) => track.id))
    const moreSuggestions = spotifySuggestedTracks.filter((track) => !suggestedIds.has(track.id))
    const likedAlbums = [...listeningHistory, ...spotifySuggestedTracks]
      .filter((track) => track.albumId && track.albumType === 'album')
      .map(albumFromTrack)
      .filter((album, index, list) => list.findIndex((item) => item.id === album.id) === index)
    const genres = topArtists.flatMap((artist) => artist.genres)
      .filter((genre, index, list) => list.indexOf(genre) === index)
    const mixes = [
      ...topArtists.slice(0, 4).map((artist) => ({ seed: { kind: 'artist', id: artist.id, name: artist.name } as RadioSeed, label: `Mezcla de ${artist.name}`, image: artist.image })),
      ...genres.slice(0, 4).map((genre) => ({ seed: { kind: 'genre', name: genre } as RadioSeed, label: genre, image: '' })),
    ]
    const trackCard = (track: Track) => (
      <button className={`shelf-card${track.id === activeTrackId ? ' shelf-card-active' : ''}`} key={track.id} onClick={() => playTrack(track.id)} type="button">
        <span className="shelf-art"><img alt="" loading="lazy" src={track.artwork} /><span className="shelf-play"><Play fill="currentColor" size={16} /></span></span>
        <strong>{track.title}</strong><small>{track.artist}</small>
      </button>
    )
    const albumCard = (album: Album) => (
      <button className="shelf-card" key={album.id} onClick={() => openDetail({ kind: 'album', id: album.id })} type="button">
        <span className="shelf-art"><img alt="" loading="lazy" src={album.artwork} /><span className="shelf-play"><Disc3 size={16} /></span></span>
        <strong>{album.title}</strong><small>{[album.year, album.artist].filter(Boolean).join(' · ')}</small>
      </button>
    )

    return (
      <>
        {listeningHistory.length > 0 && renderShelf('home-recent', 'VUELVE A ESCUCHAR', 'Escuchado hace poco', listeningHistory.map((track) => (
          <button className={`shelf-card${track.id === activeTrackId ? ' shelf-card-active' : ''}`} key={track.id} onClick={() => playFromList(listeningHistory, track.id, seedFromTrack(track))} type="button">
            <span className="shelf-art"><img alt="" loading="lazy" src={track.artwork} /><span className="shelf-play"><Play fill="currentColor" size={16} /></span></span>
            <strong>{track.title}</strong><small>{track.artist}</small>
          </button>
        )))}
        {topArtists.length > 0 && renderShelf('home-artists', 'LOS QUE MÁS ESCUCHAS', 'Tus artistas', topArtists.map((artist) => (
          <button className="shelf-card shelf-artist" key={artist.id} onClick={() => openDetail({ kind: 'artist', id: artist.id })} type="button">
            <span className="shelf-art">{artist.image ? <img alt="" loading="lazy" src={artist.image} /> : <Mic2 size={28} />}</span>
            <strong>{artist.name}</strong><small>Artista</small>
          </button>
        )))}
        {mixes.length > 0 && renderShelf('home-mixes', 'HECHAS PARA TI', 'Mezclas para ti', mixes.map((mix) => (
          <button className="shelf-card shelf-mix" key={radioSeedKey(mix.seed)} onClick={() => { void startMix(mix.seed) }} style={{ '--mix-hue': hueFromText(mix.label) } as CSSProperties} type="button">
            <span className="shelf-art">
              {mix.image && <img alt="" loading="lazy" src={mix.image} />}
              <span className="shelf-mix-label">{mix.label}</span>
              <span className="shelf-play"><Play fill="currentColor" size={16} /></span>
            </span>
            <strong>{mix.label}</strong><small>Radio sin fin de canciones parecidas</small>
          </button>
        )))}
        {moreSuggestions.length > 0 && renderShelf('home-more', 'PARA TI', 'Más canciones que te pueden gustar', moreSuggestions.map(trackCard))}
        {likedAlbums.length > 0 && renderShelf('home-albums', 'DISCOS', 'Álbumes que te gustan', likedAlbums.map(albumCard))}
        {newReleases.length > 0 && renderShelf('home-new', 'RECIÉN SALIDOS', 'Nuevos lanzamientos', newReleases.map(albumCard))}
      </>
    )
  }

  function renderPersonalization() {
    const current = themes.find(({ id }) => id === settings.theme) ?? themes[0]
    return (
      <section aria-labelledby="personalization-heading" className="personalization-page">
        <div className="personalization-hero">
          <span className="personalization-orb" aria-hidden="true" />
          <span className="personalization-icon"><Palette size={26} /></span>
          <p className="eyebrow">TEMA ACTIVO</p>
          <h2 id="personalization-heading">{current.name}</h2>
          <p>{current.vibe}</p>
        </div>
        <div className="section-heading layout-heading"><div><p className="eyebrow">DISPOSICIÓN</p><h2>Cómo se acomoda todo</h2></div></div>
        <div aria-label="Disposición de DropMusic" className="layout-grid" role="radiogroup">
          {layouts.map((layout) => {
            const selected = layout.id === settings.layout
            return (
              <button
                aria-checked={selected}
                className={`layout-card${selected ? ' theme-card-active' : ''}`}
                key={layout.id}
                onClick={() => updateSetting('layout', layout.id)}
                role="radio"
                type="button"
              >
                <span aria-hidden="true" className="layout-preview" data-layout-preview={layout.id}>
                  <i className="layout-preview-nav" /><i className="layout-preview-main" /><i className="layout-preview-now" /><i className="layout-preview-bar" />
                </span>
                <span className="theme-card-copy"><strong>{layout.name}</strong><small>{layout.description}</small></span>
                <span className="theme-card-state">{selected ? 'Activa' : 'Usar'}</span>
              </button>
            )
          })}
        </div>
        <div className="section-heading layout-heading"><div><p className="eyebrow">ESTILO</p><h2>Temas</h2></div></div>
        <div className="personalization-options">
          <div className="setting-toggle-row">
            <span>
              <strong>Portadas animadas</strong>
              <small>Las portadas se mueven despacio y tienen un brillo que las recorre. Spotify no comparte sus videos de portada con otras apps, así que el movimiento lo crea DropMusic.</small>
            </span>
            <label className="toggle-switch"><input aria-label="Portadas animadas" checked={settings.animatedCovers} onChange={(event) => updateSetting('animatedCovers', event.target.checked)} type="checkbox" /><span /></label>
          </div>
        </div>
        <div aria-label="Filtrar temas" className="chip-row theme-filters" role="group">
          {(['Todos', ...themeCategories] as const).map((category) => (
            <button aria-pressed={themeFilter === category} className={`chip${themeFilter === category ? ' chip-active' : ''}`} key={category} onClick={() => setThemeFilter(category)} type="button">{category}</button>
          ))}
        </div>
        <div aria-label="Temas de DropMusic" className="theme-grid" key={themeFilter} role="radiogroup">
          {themes.filter((theme) => themeFilter === 'Todos' || theme.category === themeFilter).map((theme) => {
            const selected = theme.id === settings.theme
            return (
              <button
                aria-checked={selected}
                className={`theme-card${selected ? ' theme-card-active' : ''}`}
                key={theme.id}
                onClick={() => updateSetting('theme', theme.id)}
                role="radio"
                type="button"
              >
                <span
                  aria-hidden="true"
                  className="theme-preview"
                  data-preview={theme.id}
                  style={{
                    '--p-bg': theme.preview.bg,
                    '--p-surface': theme.preview.surface,
                    '--p-accent': theme.preview.accent,
                    '--p-text': theme.preview.text,
                    '--p-font': theme.preview.font,
                  } as CSSProperties}
                >
                  <span className="theme-preview-side"><i /><i /><i /></span>
                  <span className="theme-preview-main">
                    <span className="theme-preview-title">Aa</span>
                    <span className="theme-preview-card"><span className="theme-preview-art" /><span className="theme-preview-lines"><i /><i /></span></span>
                    <span className="theme-preview-bar"><span className="theme-preview-play" /><span className="theme-preview-progress"><i /></span></span>
                  </span>
                </span>
                <span className="theme-card-copy">
                  <strong>{theme.name}</strong>
                  <small>{theme.vibe}</small>
                </span>
                <span className="theme-card-state">{selected ? 'Activo' : 'Aplicar'}</span>
              </button>
            )
          })}
        </div>
      </section>
    )
  }

  const activeTheme = themes.find(({ id }) => id === settings.theme) ?? themes[0]
  const playerNotice = playbackError || spotifyPlayerError
  const upcomingTracks = activeTrack.source === 'Spotify'
    ? radioQueue
    : jamendoTracks.slice(jamendoTracks.findIndex((track) => track.id === activeTrackId) + 1)
  const favoriteTracks = allTracks.filter((track) =>
    favoriteIds.includes(track.id) && `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(query),
  )

  return (
    <div
      className={`app-shell min-h-screen${settings.ambientGlow ? '' : ' no-ambient'}${settings.animations ? '' : ' reduce-motion'}${activeTheme.ink ? ' theme-ink' : ''}${isPlaying ? ' is-playing' : ''}${settings.animatedCovers ? ' animated-covers' : ''}`}
      data-layout={settings.layout}
      data-theme={settings.theme}
      style={{ '--ambient-color': activeTrack.color } as CSSProperties}
    >
      <div aria-hidden="true" className="ambient-glow" />
      <div aria-hidden="true" className="theme-art-backdrop">
        {activeTrack.artwork && <img alt="" key={activeTrack.artwork} src={activeTrack.artwork} />}
      </div>
      {activeTheme.scene && themeScene}
      {settings.animatedCovers && coverMotionFilter}
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
            <button aria-label="Buscar música" className="tip-arrow" onClick={() => searchInputRef.current?.focus()} type="button"><ArrowUpRight size={15} /></button>
          </div>
          <button className="profile-button" onClick={() => selectSection('Ajustes')} type="button">
            <span className="avatar">D</span><span className="profile-copy"><strong>DropMusic</strong><small>Preferencias de escucha</small></span><ChevronDown className="profile-chevron" size={16} />
          </button>
        </div>
      </aside>

      <main className="main-content" id="inicio" ref={mainContentRef}>
        <header className="topbar">
          <div className="breadcrumbs"><span>DROP MUSIC</span><span className="breadcrumb-slash">/</span><span>{currentDetail ? (currentDetail.kind === 'artist' ? 'ARTISTA' : 'ÁLBUM') : isSearching ? 'BUSCAR' : activeSection.toUpperCase()}</span></div>
          <div className="topbar-actions">
            <label className="search-box">
              <Search size={16} />
              <input
                aria-label="Buscar en tu música y Spotify"
                onChange={(event) => {
                  setSearch(event.target.value)
                  setSpotifyTracks([])
                  setSpotifyAlbums([])
                  setSpotifyArtists([])
                  setSpotifyNextOffset(null)
                  setDetailStack([])
                  setSpotifyLoading(false)
                  setSpotifyError('')
                  setJamendoTracks([])
                  setJamendoLoading(false)
                  setJamendoError('')
                }}
                placeholder={connectedAccounts.Spotify ? 'Buscar canciones, artistas o álbumes...' : 'Buscar canciones...'}
                ref={searchInputRef}
                value={search}
              />
              <kbd>⌘ K</kbd>
            </label>
            <button aria-label="Abrir ajustes" className="icon-button notification-button" onClick={() => selectSection('Ajustes')} type="button"><Settings2 size={18} /></button>
            <button className="top-connect-button" onClick={() => selectSection('Ajustes')} type="button"><Plus size={16} /> Conectar servicio</button>
          </div>
        </header>

        <div className={`content-grid${activeSection === 'Ajustes' ? ' settings-grid' : ''}`}>
          <section aria-label={activeSection} className="feed-column view-enter" key={currentDetail ? `${currentDetail.kind}:${currentDetail.id}` : isSearching ? 'search' : activeSection}>
            {currentDetail ? renderDetail() : isSearching ? renderSearch() : (
            <>
            <div className="greeting">
              <p className="eyebrow">TU ESPACIO MUSICAL</p><h1>{page.title}</h1><p className="greeting-subtitle">{page.subtitle}</p>
            </div>

            {activeSection === 'Tu colección' ? (
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
                      <button className="album-card" key={`${album.source ?? 'apple'}:${album.album}`} onClick={() => album.albumId ? openDetail({ kind: 'album', id: album.albumId }) : playTrack(album.id)} type="button">
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
                    <button className="primary-button" onClick={() => searchInputRef.current?.focus()} type="button"><Search size={15} /> Buscar música</button>
                  </div>
                )}
              </section>
            ) : activeSection === 'Personalización' ? (
              renderPersonalization()
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
                  <div className="setting-toggle-row">
                    <span><strong>Animaciones</strong><small>Movimiento en tarjetas, transiciones y el reproductor Big Picture.</small></span>
                    <label className="toggle-switch"><input aria-label="Animaciones" checked={settings.animations} onChange={(event) => updateSetting('animations', event.target.checked)} type="checkbox" /><span /></label>
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
                      : 'Buscar música'}
                    className="featured-media-button"
                    onClick={() => {
                      if (!featuredTrack) {
                        searchInputRef.current?.focus()
                        return
                      }
                      selectSection('Escuchar')
                      playTrack(featuredTrack.id)
                    }}
                    type="button"
                  >
                    {featuredTrack && <img alt="" className="featured-image" key={featuredTrack.id} src={featuredTrack.artwork} />}
                    <span className={`featured-scrim${featuredTrack ? '' : ' featured-empty-scrim'}`} />
                  </button>
                  <div className="featured-content">
                    <span className="featured-tag"><Sparkles size={13} /> UN POCO DE CALMA, UN POCO DE TODO</span>
                    <h2 id="featured-heading" key={featuredTrack?.id ?? 'empty'}>{featuredTrack ? featuredTrack.title : 'Un poco de calma, un poco de todo.'}</h2>
                    <p>{featuredTrack
                      ? `${featuredTrack.artist} · ${featuredTrack.album}`
                      : 'Conecta Spotify o busca música en Jamendo para descubrir canciones aquí.'}</p>
                    <span className="featured-play">
                      {featuredTrack ? <><Play fill="currentColor" size={16} /> Escuchar ahora</> : 'Buscar música'}
                    </span>
                  </div>
                  {featuredTrack && <span aria-live="polite" className="featured-index">{featuredTrack.title} <span>· {featuredTrack.artist}</span></span>}
                </section>
                <section aria-labelledby="recent-heading" className="recent-section">
                  <div className="section-heading"><div><p className="eyebrow">DESCUBRE TU PRÓXIMA CANCIÓN</p><h2 id="recent-heading">Una selección para escuchar</h2></div></div>
                  {searchResults.length > 0
                    ? renderTracks(searchResults.slice(0, 5))
                    : <div className="spotify-suggestions-empty"><p>{!connectedAccounts.Spotify ? 'Conecta Spotify para escuchar música completa en DropMusic.' : spotifySuggestionsError || (spotifySuggestionsLoaded ? 'Busca una canción, un artista o un álbum para empezar.' : 'Cargando tus canciones de Spotify…')}</p>{!connectedAccounts.Spotify && <button className="secondary-button" onClick={() => connectProvider('Spotify')} type="button">Conectar Spotify <ArrowUpRight size={14} /></button>}</div>}
                </section>
                {renderHomeShelves()}
              </>
            )}
            </>
            )}
            {playerNotice && <p className="playback-error" role="status">{playerNotice} {activeTrack.collectionUrl && <a href={activeTrack.collectionUrl} rel="noreferrer" target="_blank">Abrir en {activeTrack.source ?? 'servicio'} <ArrowUpRight size={11} /></a>}</p>}
          </section>

          <aside aria-label="En reproducción" className="now-playing-column">
            <div className="now-playing-heading">
              <div><p className="eyebrow">AHORA MISMO</p><h2>Tu espacio sonoro</h2></div>
              {activeTrack.collectionUrl && <a aria-label={`Abrir ${activeTrack.title} en ${activeTrack.source ?? 'servicio'}`} className="icon-button subtle-icon-button" href={activeTrack.collectionUrl} rel="noreferrer" target="_blank"><ArrowUpRight size={16} /></a>}
            </div>
            <div className="now-playing-card">
              <button aria-label="Abrir reproductor Big Picture" className="album-art-large" disabled={!activeTrack.source} onClick={() => setBigPictureMode('carousel')} type="button">
                {activeTrack.artwork
                  ? <img alt={`Portada de ${activeTrack.album}`} key={activeTrack.id} src={activeTrack.artwork} />
                  : <div aria-hidden="true" className="album-art-placeholder"><Music2 size={54} /></div>}
                <div className="album-art-overlay" />
                <span className="album-art-label"><AudioLines size={13} /> {activeTrack.source === 'Spotify' ? 'SPOTIFY · EN DROP MUSIC' : activeTrack.source === 'Jamendo' ? 'JAMENDO · STREAMING' : 'EN ESPERA'}</span><span className="album-art-orbit orbit-one" /><span className="album-art-orbit orbit-two" />
                {activeTrack.source && <span className="album-art-expand"><Maximize2 size={15} /></span>}
              </button>
              <div className="now-track-details">
                <div><h3>{activeTrack.title}</h3><p>{renderArtistLinks(activeTrack)} <span>·</span> {activeTrack.albumId
                  ? <button className="inline-link" onClick={() => openDetail({ kind: 'album', id: activeTrack.albumId ?? '' })} type="button">{activeTrack.album}</button>
                  : activeTrack.album}</p></div>
                <button aria-label={favoriteIds.includes(activeTrack.id) ? 'Quitar de favoritos' : 'Añadir a favoritos'} aria-pressed={favoriteIds.includes(activeTrack.id)} className={`icon-button like-button${favoriteIds.includes(activeTrack.id) ? ' liked' : ''}`} disabled={!activeTrack.id} onClick={() => toggleFavorite(activeTrack.id)} type="button"><Heart fill={favoriteIds.includes(activeTrack.id) ? 'currentColor' : 'none'} size={19} /></button>
              </div>
              <div className="soundscape-label"><span className="soundscape-dot" /> {activeTrack.source === 'Spotify' ? 'REPRODUCCIÓN COMPLETA' : activeTrack.source === 'Jamendo' ? 'STREAMING DE JAMENDO' : 'LISTO PARA REPRODUCIR'} <span className="soundscape-spacer" /><span>{activeTrack.genre.toUpperCase()}</span></div>
              <div aria-hidden="true" className={`visualizer${isPlaying ? ' visualizer-playing' : ''}`}>{Array.from({ length: 31 }, (_, index) => <span key={index} style={{ '--bar-index': index } as CSSProperties} />)}</div>
            </div>
            {connectedAccounts.Spotify && (
              <p className="spotify-player-status" role="status">
                <span className={spotifyPlayerReady ? 'spotify-player-dot spotify-player-dot-ready' : 'spotify-player-dot'} />
                {spotifyPlayerStatus || 'Conectando el reproductor de Spotify…'}
              </p>
            )}
            <section aria-labelledby="up-next-heading" className="up-next-section">
              <div className="up-next-heading"><div><p className="eyebrow">SIGUIENTE</p><h3 id="up-next-heading">{activeTrack.source === 'Spotify' && radioSeed ? radioSeed : 'Para seguir el mood'}</h3></div><Clock3 size={16} /></div>
              {upcomingTracks.slice(0, 3).map((track) => (
                <button className="up-next-row" key={track.id} onClick={() => playTrack(track.id)} type="button"><img alt="" loading="lazy" src={track.artwork} /><span><strong>{track.title}</strong><small>{track.artist}</small></span><span className="up-next-duration">{formatTime(track.duration)}</span></button>
              ))}
              {activeTrack.source && upcomingTracks.length === 0 && <p className="spotify-catalog-hint">Buscando canciones para seguir…</p>}
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
            <input aria-label="Progreso de la canción" className="range-input progress-input" disabled={!progressDuration} max={Math.max(1, progressDuration)} min="0" onChange={(event) => seekTo(Number(event.target.value))} style={{ '--range-progress': `${progressDuration ? (elapsedSeconds / progressDuration) * 100 : 0}%` } as CSSProperties} type="range" value={Math.min(progressDuration, elapsedSeconds)} />
            <span>{formatTime(progressDuration)}</span>
          </div>
        </div>
        <div className="player-volume">
          <Volume2 size={17} /><input aria-label="Volumen" className="range-input volume-input" max="100" min="0" onChange={(event) => updateSetting('volume', Number(event.target.value))} style={{ '--range-progress': `${settings.volume}%` } as CSSProperties} type="range" value={settings.volume} />
          <button aria-label="Ver la letra en pantalla completa" className="icon-button" disabled={!activeTrack.source} onClick={() => setBigPictureMode('lyrics')} title="Letra" type="button"><Mic2 size={16} /></button>
          <button aria-label="Abrir reproductor Big Picture" className="icon-button" disabled={!activeTrack.source} onClick={() => setBigPictureMode('carousel')} title="Big Picture" type="button"><Maximize2 size={16} /></button>
        </div>
      </footer>

      {bigPictureMode && activeTrack.source && (
        <BigPicturePlayer
          elapsed={elapsedSeconds}
          isPlaying={isPlaying}
          lyrics={lyrics}
          mode={bigPictureMode}
          onClose={() => setBigPictureMode(null)}
          onModeChange={setBigPictureMode}
          onPlay={playTrack}
          onSeek={seekTo}
          onSkip={skipTrack}
          onToggleShuffle={toggleShuffle}
          onTogglePlayback={togglePlayback}
          onToggleRepeat={toggleRepeat}
          onVolume={(volume) => updateSetting('volume', volume)}
          previousTracks={activeTrack.source === 'Spotify' ? recentTracks : []}
          repeat={repeat}
          shuffle={shuffle}
          track={activeTrack}
          upcomingTracks={upcomingTracks}
          volume={settings.volume}
        />
      )}

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
