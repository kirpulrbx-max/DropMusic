import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Effect, getCurrentWindow } from '@tauri-apps/api/window'
import { getVersion } from '@tauri-apps/api/app'
import { relaunch } from '@tauri-apps/plugin-process'
import { check, type Update } from '@tauri-apps/plugin-updater'
import {
  deleteLocalTrack,
  formatBytes,
  importLocalFile,
  isLocalAudioFile,
  listLocalTracks,
  localAudioExtensions,
  localAudioUrl,
  localCoverUrl,
  type LocalTrackRecord,
} from './localLibrary'
import type { Session } from '@supabase/supabase-js'
import {
  accountsEnabled,
  adminListProfiles,
  adminSetPlan,
  checkoutUrl,
  fetchProfile,
  getSession,
  hasPro,
  onSessionChange,
  proPrice,
  readCachedProfile,
  sendPasswordReset,
  signIn,
  signOut,
  signUp,
  writeCachedProfile,
  type Plan,
  type Profile,
} from './account'
import { openUrl } from '@tauri-apps/plugin-opener'
import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  AudioLines,
  Cast,
  Check,
  ChevronDown,
  Clock3,
  Crown,
  Disc3,
  Download,
  FolderOpen,
  Headphones,
  Heart,
  Laptop,
  LayoutDashboard,
  Library,
  ListMusic,
  Lock,
  LogOut,
  Mail,
  Maximize2,
  Mic2,
  Minimize2,
  Music2,
  Palette,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Repeat2,
  Search,
  Settings2,
  ShieldCheck,
  Shuffle,
  SkipBack,
  SkipForward,
  Smartphone,
  Speaker,
  Trash2,
  Tv,
  Upload,
  SlidersHorizontal,
  Menu,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react'

type Provider = 'Spotify' | 'Apple Music' | 'YouTube Music'
type Section = 'Escuchar' | 'Tu colección' | 'Favoritos' | 'Personalización' | 'Cuenta' | 'Ajustes'

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
  source?: 'Spotify' | 'Jamendo' | 'Local'
  size?: number
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
  getCurrentState(): Promise<SpotifyPlaybackState | null>
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
  | 'nordico' | 'papel' | 'medianoche' | 'cafe' | 'contraste' | 'oceano' | 'sakura' | 'desierto' | 'galaxia' | 'bosque' | 'nieve'
  | 'volcan' | 'urbano' | 'jazz' | 'fiesta' | 'metal' | 'disco' | 'pastel' | 'setentas' | 'arcade'
  | 'y2k' | 'frutiger' | 'siete' | 'ios' | 'vibras2017' | 'tresd' | 'transparente' | 'jdm' | 'granpremio' | 'hatchback'
  | 'venezolano' | 'chino' | 'ladrillos' | 'bloques08' | 'nuclear'
  | 'grafito' | 'lavanda' | 'esmeralda' | 'sepia' | 'tormenta' | 'atardecer' | 'eclipse' | 'otono' | 'medusas'
  | 'reggae' | 'kpop' | 'techno' | 'country' | 'cottagecore' | 'glitch' | 'memphis' | 'acuarela' | 'muertos' | 'egipto'
  | 'portatil' | 'rally'

type ThemeCategory = 'Esenciales' | 'Cyberpunk' | 'Anime' | 'Videojuegos' | 'Ambientes' | 'Géneros' | 'Estéticas' | 'Motor' | 'Culturas'

const themeCategories: ThemeCategory[] = ['Esenciales', 'Estéticas', 'Ambientes', 'Géneros', 'Motor', 'Culturas', 'Cyberpunk', 'Anime', 'Videojuegos']

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
  { id: 'nordico', name: 'Nórdico', vibe: 'Claro y sereno: grises fríos, azul pizarra y tipografía ligera.', category: 'Esenciales', ink: true, preview: { bg: '#eef1f4', surface: '#ffffff', accent: '#4c6e8c', text: '#22303c', font: '"Segoe UI", sans-serif' } },
  { id: 'papel', name: 'Papel y tinta', vibe: 'Como un periódico: papel crema, letra serif en cursiva y detalles en rojo.', category: 'Esenciales', ink: true, preview: { bg: '#f4efe4', surface: '#fbf8f1', accent: '#b01e1e', text: '#161310', font: 'Georgia, "Times New Roman", serif' } },
  { id: 'medianoche', name: 'Azul medianoche', vibe: 'Azul marino profundo con detalles dorados, elegante y tranquilo.', category: 'Esenciales', ink: false, preview: { bg: '#0b1426', surface: '#13203a', accent: '#e8c16a', text: '#f4f3f6', font: 'Georgia, "Times New Roman", serif' } },
  { id: 'cafe', name: 'Café con leche', vibe: 'Tonos cálidos de cafetería: crema, caramelo y marrón tostado.', category: 'Esenciales', ink: true, preview: { bg: '#efe4d6', surface: '#f8f1e7', accent: '#6f4528', text: '#3a2618', font: 'Georgia, "Times New Roman", serif' } },
  { id: 'contraste', name: 'Alto contraste', vibe: 'Negro, blanco y amarillo con bordes marcados: lo más fácil de leer.', category: 'Esenciales', ink: false, preview: { bg: '#000000', surface: '#000000', accent: '#ffe600', text: '#ffffff', font: '"Segoe UI", sans-serif' } },
  { id: 'oceano', name: 'Fondo marino', vibe: 'Bajo el mar: rayos de luz desde la superficie y burbujas que suben.', category: 'Ambientes', ink: false, scene: true, preview: { bg: 'linear-gradient(180deg, #0a4a6e, #020f1c)', surface: 'rgba(6,40,64,0.85)', accent: '#4ae0e0', text: '#e8fbff', font: 'Inter, "Segoe UI", sans-serif' } },
  { id: 'sakura', name: 'Primavera de cerezos', vibe: 'Rosa claro con ramas en flor y pétalos que caen girando.', category: 'Ambientes', ink: true, scene: true, preview: { bg: 'linear-gradient(180deg, #fff5f8, #fbe6ec)', surface: '#ffffff', accent: '#e2678f', text: '#3d2530', font: '"Yu Mincho", Georgia, serif' } },
  { id: 'desierto', name: 'Dunas al atardecer', vibe: 'Sol que se pone sobre las dunas, cielo de fuego y calor que ondula.', category: 'Ambientes', ink: false, scene: true, preview: { bg: 'linear-gradient(180deg, #3b1238, #f08a3c 70%, #4a2014 71%)', surface: 'rgba(60,29,20,0.88)', accent: '#ff9a3d', text: '#fff1e2', font: 'Righteous, "Segoe UI", sans-serif' } },
  { id: 'galaxia', name: 'Galaxia', vibe: 'Espacio profundo: estrellas, una nebulosa que gira y estrellas fugaces.', category: 'Ambientes', ink: false, scene: true, preview: { bg: 'radial-gradient(circle at 60% 50%, #3a2470, #05030f 70%)', surface: 'rgba(18,12,44,0.85)', accent: '#a78bfa', text: '#f3efff', font: 'Inter, "Segoe UI", sans-serif' } },
  { id: 'bosque', name: 'Bosque de luciérnagas', vibe: 'Pinos de noche y luciérnagas que flotan y parpadean.', category: 'Ambientes', ink: false, scene: true, preview: { bg: 'linear-gradient(180deg, #030a07, #163a24)', surface: 'rgba(14,34,22,0.88)', accent: '#b5e655', text: '#f1fde4', font: 'Georgia, "Times New Roman", serif' } },
  { id: 'nieve', name: 'Noche nevada', vibe: 'Azul de invierno con copos de nieve cayendo sobre las colinas.', category: 'Ambientes', ink: false, scene: true, preview: { bg: 'linear-gradient(180deg, #0a1220, #2a3d5a)', surface: 'rgba(24,37,58,0.88)', accent: '#9fd3ff', text: '#f3f8ff', font: 'Inter, "Segoe UI", sans-serif' } },
  { id: 'volcan', name: 'Lava', vibe: 'Negro volcánico con un río de lava que late y brasas que suben.', category: 'Ambientes', ink: false, scene: true, preview: { bg: 'linear-gradient(180deg, #0b0303, #3a0d05 70%, #ff5a28)', surface: 'rgba(34,12,10,0.9)', accent: '#ff5a28', text: '#fff0e6', font: 'Rajdhani, "Segoe UI", sans-serif' } },
  { id: 'urbano', name: 'Calle urbana', vibe: 'Negro, verde lima y rosa: grafiti, letras grandes y barras que rebotan con la música.', category: 'Géneros', ink: false, scene: true, preview: { bg: '#0d0d0d', surface: '#181818', accent: '#c6ff00', text: '#ffffff', font: '"Archivo Black", Impact, sans-serif' } },
  { id: 'jazz', name: 'Club de jazz', vibe: 'Terciopelo vino y dorado, un foco de escenario y humo flotando.', category: 'Géneros', ink: false, scene: true, preview: { bg: 'linear-gradient(180deg, #250e16, #120609)', surface: 'rgba(40,17,24,0.9)', accent: '#d6aa5c', text: '#fbefdc', font: 'Georgia, "Times New Roman", serif' } },
  { id: 'fiesta', name: 'Fiesta latina', vibe: 'Colores de verbena: papel picado, confeti y rojo de salsa.', category: 'Géneros', ink: true, scene: true, preview: { bg: 'linear-gradient(180deg, #fff1d6, #ffe7c2)', surface: '#ffffff', accent: '#e63946', text: '#2b1a12', font: 'Righteous, "Segoe UI", sans-serif' } },
  { id: 'metal', name: 'Metal pesado', vibe: 'Negro y rojo, esquinas rectas, relámpagos y llamas en la base.', category: 'Géneros', ink: false, scene: true, preview: { bg: 'linear-gradient(180deg, #050505, #2a0a0e)', surface: '#161616', accent: '#c8102e', text: '#f2f2f2', font: '"Archivo Black", Impact, sans-serif' } },
  { id: 'disco', name: 'Bola disco', vibe: 'Morado y dorado con una bola de espejos y destellos que recorren la pista.', category: 'Géneros', ink: false, scene: true, preview: { bg: 'radial-gradient(circle at 50% 0%, #3d1766, #0e0518 75%)', surface: 'rgba(40,18,68,0.88)', accent: '#ffd23f', text: '#fff5d6', font: 'Righteous, "Segoe UI", sans-serif' } },
  { id: 'pastel', name: 'Pop pastel', vibe: 'Degradados de algodón de azúcar, esquinas redondas y corazones flotando.', category: 'Géneros', ink: true, scene: true, preview: { bg: 'linear-gradient(135deg, #fde2f3, #e4ecff, #d8fbef)', surface: '#ffffff', accent: '#8b5cf6', text: '#2f2346', font: 'Righteous, "Segoe UI", sans-serif' } },
  { id: 'setentas', name: 'Años 70', vibe: 'Mostaza, naranja y marrón con franjas groovy y esquinas muy redondas.', category: 'Géneros', ink: true, preview: { bg: 'linear-gradient(180deg, #f3e3c3 70%, #e8a33d 70% 78%, #d9622b 78% 86%, #5c3a1e 86%)', surface: '#fbf1dc', accent: '#d9622b', text: '#3d2614', font: 'Righteous, "Segoe UI", sans-serif' } },
  { id: 'arcade', name: 'Sala arcade', vibe: 'Pantalla de máquina recreativa: líneas de CRT, píxeles y naves marchando.', category: 'Videojuegos', ink: false, scene: true, preview: { bg: 'radial-gradient(circle, #1a0836, #07020f 75%)', surface: 'rgba(18,8,36,0.9)', accent: '#ffe600', text: '#fffbe0', font: '"Press Start 2P", monospace' } },
  { id: 'y2k', name: 'Y2K', vibe: 'Cromo holográfico, rosa y celeste, títulos en degradado y destellos brillando.', category: 'Estéticas', ink: true, scene: true, preview: { bg: 'linear-gradient(120deg, #e7ecf5, #f3d9f0, #d3f1ff)', surface: '#ffffff', accent: '#ff4fc1', text: '#1d2240', font: '"Trebuchet MS", sans-serif' } },
  { id: 'frutiger', name: 'Frutiger Aero', vibe: 'Cielo azul, pasto verde, burbujas de cristal y botones brillantes como gel.', category: 'Estéticas', ink: true, scene: true, preview: { bg: 'linear-gradient(180deg, #3fb5f0, #e8f8ff 62%, #8fd36a 63%)', surface: 'rgba(255,255,255,0.85)', accent: '#1ea7e8', text: '#0d3550', font: '"Segoe UI", sans-serif' } },
  { id: 'siete', name: 'Escritorio de cristal', vibe: 'El escritorio azul de 2009: ventanas de cristal con brillo y barridos de luz.', category: 'Estéticas', ink: true, scene: true, preview: { bg: 'radial-gradient(circle at 60% 40%, #2f8fd8, #082b52)', surface: 'rgba(40,90,145,0.75)', accent: '#4cc2ff', text: '#ffffff', font: '"Segoe UI", sans-serif' } },
  { id: 'ios', name: 'Teléfono clásico', vibe: 'Los teléfonos de antes: fondo de rayas finas, barras azul metálico y botones con relieve.', category: 'Estéticas', ink: true, preview: { bg: 'repeating-linear-gradient(90deg, #c5ccd4 0 6px, #cbd2d9 6px 8px)', surface: '#ffffff', accent: '#2f6fd1', text: '#1f2a37', font: '"Helvetica Neue", Helvetica, Arial, sans-serif' } },
  { id: 'vibras2017', name: 'Vibras 2017', vibe: 'Rosa pastel, todo redondeado, títulos en minúscula y manchas de color flotando.', category: 'Estéticas', ink: true, scene: true, preview: { bg: 'linear-gradient(160deg, #f7cac9, #c8d7f5)', surface: '#ffffff', accent: '#e87085', text: '#2e2433', font: '"Segoe UI", sans-serif' } },
  { id: 'tresd', name: 'Profundidad 3D', vibe: 'Botones con volumen, letras en relieve, suelo de cuadrícula y figuras girando.', category: 'Estéticas', ink: true, scene: true, preview: { bg: 'radial-gradient(circle at 50% 35%, #1d2246, #0d0f1a 70%)', surface: '#1a1e33', accent: '#5eead4', text: '#f1fffc', font: '"Archivo Black", Impact, sans-serif' } },
  { id: 'transparente', name: 'Mega transparente', vibe: 'La ventana es transparente: se ve tu escritorio detrás y DropMusic flota encima como un panel.', category: 'Estéticas', ink: false, preview: { bg: 'repeating-conic-gradient(#d8d8d8 0 25%, #f4f4f4 0 50%) 0 0 / 14px 14px', surface: 'rgba(20,20,26,0.45)', accent: '#ffffff', text: '#ffffff', font: '"Segoe UI", sans-serif' } },
  { id: 'jdm', name: 'Leyenda JDM', vibe: 'Deportivos japoneses de noche: naranja, autopista, luces que pasan y ciudad de neón.', category: 'Motor', ink: false, scene: true, preview: { bg: 'linear-gradient(180deg, #2a0f2e 40%, #0b0b0e 41%)', surface: '#18181e', accent: '#ff7a00', text: '#fff4ea', font: 'Rajdhani, "Segoe UI", sans-serif' } },
  { id: 'granpremio', name: 'Gran Premio', vibe: 'Carreras de monoplazas: rojo y negro, pianos de la pista, bandera a cuadros y velocidad.', category: 'Motor', ink: false, scene: true, preview: { bg: '#0e0e10', surface: '#1b1b1f', accent: '#e10600', text: '#ffffff', font: 'Rajdhani, "Segoe UI", sans-serif' } },
  { id: 'hatchback', name: 'Hatchback 2000', vibe: 'Tablero de un compacto de los 2000: plástico gris, pantalla naranja y agujas que suben con la música.', category: 'Motor', ink: false, scene: true, preview: { bg: 'radial-gradient(circle at 50% 120%, #2a2e35, #121417 70%)', surface: '#23272d', accent: '#ff8c1a', text: '#fff3e4', font: 'Rajdhani, "Segoe UI", sans-serif' } },
  { id: 'venezolano', name: 'Venezolano', vibe: 'Amarillo, azul y rojo, las ocho estrellas en arco y tepuyes al fondo.', category: 'Culturas', ink: false, scene: true, preview: { bg: 'linear-gradient(180deg, #ffcc00 0 14%, #0a2366 14% 86%, #cf142b 86%)', surface: 'rgba(12,36,104,0.9)', accent: '#ffcc00', text: '#ffffff', font: 'Righteous, "Segoe UI", sans-serif' } },
  { id: 'chino', name: 'Chino tradicional', vibe: 'Rojo laca y dorado, marcos de celosía, nubes doradas y faroles que se mecen.', category: 'Culturas', ink: false, scene: true, preview: { bg: 'linear-gradient(180deg, #5c0f0d, #300605)', surface: 'rgba(88,16,14,0.9)', accent: '#f0c05a', text: '#fff1d8', font: 'KaiTi, STKaiti, Georgia, serif' } },
  { id: 'ladrillos', name: 'Ladrillos de juguete', vibe: 'Piezas de colores primarios con sus tetones, sobre una base gris para construir.', category: 'Videojuegos', ink: true, preview: { bg: 'radial-gradient(circle at 6px 6px, #f2f2f2 0 4px, transparent 5px) 0 0 / 12px 12px, #e4e4e4', surface: '#ffffff', accent: '#0055bf', text: '#1a1a1a', font: '"Archivo Black", Impact, sans-serif' } },
  { id: 'bloques08', name: 'Bloques clásicos', vibe: 'Los juegos de bloques online de 2008: superficies grises con tetones, cielo azul y nubes cuadradas.', category: 'Videojuegos', ink: true, scene: true, preview: { bg: 'linear-gradient(180deg, #4aa3e0, #a8dcff 70%, #59a63a 70.5%)', surface: '#f4f4f4', accent: '#0066cc', text: '#191919', font: '"Arial Black", Arial, sans-serif' } },
  { id: 'grafito', name: 'Grafito', vibe: 'Gris carbón mate con puntitos de lápiz y un acento menta. Sobrio para concentrarse.', category: 'Esenciales', ink: false, preview: { bg: '#1b1d1f', surface: '#25282b', accent: '#6ee7b7', text: '#f1f3f4', font: 'Inter, "Segoe UI", sans-serif' } },
  { id: 'lavanda', name: 'Lavanda', vibe: 'Claro y suave: lila, rosa empolvado y violeta, con esquinas muy redondas.', category: 'Esenciales', ink: true, preview: { bg: 'linear-gradient(135deg, #e9e1fb, #f8e3ef)', surface: '#ffffff', accent: '#7c5cd6', text: '#2a2140', font: 'Righteous, "Segoe UI", sans-serif' } },
  { id: 'esmeralda', name: 'Esmeralda y oro', vibe: 'Verde profundo de terciopelo con filetes dorados, como un club privado.', category: 'Esenciales', ink: false, preview: { bg: 'linear-gradient(180deg, #06221a, #031510)', surface: '#0b3127', accent: '#d4af37', text: '#fbf1d0', font: 'Georgia, "Times New Roman", serif' } },
  { id: 'sepia', name: 'Fotografía sepia', vibe: 'Como un álbum de fotos viejo: papel tostado, viñeta y portadas en sepia.', category: 'Esenciales', ink: true, preview: { bg: 'radial-gradient(circle, #f1e6cf, #d8c29a)', surface: '#f5ecd9', accent: '#7a4f22', text: '#3b2a17', font: 'Georgia, "Times New Roman", serif' } },
  { id: 'tormenta', name: 'Tormenta eléctrica', vibe: 'Nubes oscuras que pasan, lluvia en diagonal y relámpagos que iluminan todo.', category: 'Ambientes', ink: false, scene: true, preview: { bg: 'radial-gradient(ellipse at 50% 0%, #2b3550, #0b0f18 70%)', surface: 'rgba(22,28,44,0.86)', accent: '#9cc2ff', text: '#eef4ff', font: 'Inter, "Segoe UI", sans-serif' } },
  { id: 'atardecer', name: 'Atardecer en la playa', vibe: 'El sol se hunde en el mar, su reflejo brilla en el agua y las olas van y vienen.', category: 'Ambientes', ink: false, scene: true, preview: { bg: 'linear-gradient(180deg, #3b1450, #b8436a 40%, #ff9a5a 60%, #10213f 61%)', surface: 'rgba(62,28,54,0.85)', accent: '#ff8f6b', text: '#fff2e8', font: 'Righteous, "Segoe UI", sans-serif' } },
  { id: 'eclipse', name: 'Eclipse', vibe: 'Una corona de luz detrás de la luna, polvo de estrellas y botones como píldoras.', category: 'Ambientes', ink: false, scene: true, preview: { bg: 'radial-gradient(circle at 75% 35%, #000 0 14%, #ffc878 15%, #12102a 22%, #04040a 60%)', surface: 'rgba(18,16,30,0.86)', accent: '#ffc878', text: '#fff6e6', font: 'Inter, "Segoe UI", sans-serif' } },
  { id: 'otono', name: 'Otoño', vibe: 'Crema cálida con hojas naranjas, rojas y doradas que caen girando.', category: 'Ambientes', ink: true, scene: true, preview: { bg: 'linear-gradient(180deg, #fbe9cf, #f3d3a8)', surface: '#fffbf4', accent: '#c4551e', text: '#3b2214', font: 'Georgia, "Times New Roman", serif' } },
  { id: 'medusas', name: 'Medusas', vibe: 'Aguas profundas con medusas de neón que suben flotando y mueven sus tentáculos.', category: 'Ambientes', ink: false, scene: true, preview: { bg: 'radial-gradient(ellipse at 50% 0%, #142a66, #050b1f 70%)', surface: 'rgba(14,22,56,0.84)', accent: '#f39bff', text: '#fdf0ff', font: 'Inter, "Segoe UI", sans-serif' } },
  { id: 'reggae', name: 'Reggae roots', vibe: 'Rojo, amarillo y verde en franjas que ondulan con el ritmo, y humo que sube.', category: 'Géneros', ink: false, scene: true, preview: { bg: 'linear-gradient(180deg, #12160d 70%, #e1261c 70% 80%, #ffd200 80% 90%, #2fb24c 90%)', surface: 'rgba(30,36,20,0.88)', accent: '#2fb24c', text: '#fffbe2', font: 'Righteous, "Segoe UI", sans-serif' } },
  { id: 'kpop', name: 'Escenario K-pop', vibe: 'Focos que barren el escenario, títulos en degradado y lightsticks que se agitan.', category: 'Géneros', ink: false, scene: true, preview: { bg: 'radial-gradient(ellipse at 50% 120%, #4a1460, #120818 65%)', surface: 'rgba(34,14,46,0.86)', accent: '#ff5fbe', text: '#fff0fa', font: '"Archivo Black", Impact, sans-serif' } },
  { id: 'techno', name: 'Rave techno', vibe: 'Negro total, láseres verdes que barren la pista y un estrobo al compás.', category: 'Géneros', ink: false, scene: true, preview: { bg: 'conic-gradient(from 180deg at 50% 100%, #050505 0 40%, #39ff88 41%, #050505 42% 58%, #3ce9ff 59%, #050505 60%)', surface: 'rgba(16,16,16,0.9)', accent: '#39ff88', text: '#eafff2', font: 'Rajdhani, "Segoe UI", sans-serif' } },
  { id: 'country', name: 'Rancho country', vibe: 'Tablas de madera, cuero con costuras y letras de cartel del oeste.', category: 'Géneros', ink: false, preview: { bg: 'repeating-linear-gradient(90deg, #2c1c12 0 30px, #24170e 30px 32px)', surface: '#3d2818', accent: '#e8b05c', text: '#fff1dc', font: 'Rajdhani, "Segoe UI", sans-serif' } },
  { id: 'cottagecore', name: 'Cottagecore', vibe: 'Una casita de campo: verde salvia, crema, letra en cursiva y florecitas flotando.', category: 'Estéticas', ink: true, scene: true, preview: { bg: 'linear-gradient(180deg, #f8f3e6, #ece5cf)', surface: '#fffcf4', accent: '#6e8c64', text: '#33402d', font: 'Georgia, "Times New Roman", serif' } },
  { id: 'glitch', name: 'Glitch', vibe: 'Señal rota: títulos que tiemblan en rojo y cian, bandas que saltan y líneas de escaneo.', category: 'Estéticas', ink: false, scene: true, preview: { bg: 'linear-gradient(180deg, #0a0a0d 40%, #ff0050 40% 43%, #0a0a0d 43% 60%, #00f0ff 60% 62%, #0a0a0d 62%)', surface: 'rgba(20,20,26,0.9)', accent: '#ff0050', text: '#ffffff', font: '"Archivo Black", Impact, sans-serif' } },
  { id: 'memphis', name: 'Memphis', vibe: 'Diseño de los 80: figuras geométricas de colores, bordes negros y sombras duras.', category: 'Estéticas', ink: true, scene: true, preview: { bg: 'radial-gradient(circle at 20% 25%, #ffe066 0 12%, transparent 13%), linear-gradient(135deg, transparent 70%, #4fd1c5 70%), #fffaf0', surface: '#ffffff', accent: '#ff4f8b', text: '#1a1a2e', font: '"Archivo Black", Impact, sans-serif' } },
  { id: 'acuarela', name: 'Acuarela', vibe: 'Manchas de pintura que se expanden y se mezclan sobre papel blanco.', category: 'Estéticas', ink: true, scene: true, preview: { bg: 'radial-gradient(circle at 20% 20%, #9cc3f0aa, transparent 45%), radial-gradient(circle at 80% 40%, #f3a6c0aa, transparent 45%), radial-gradient(circle at 50% 90%, #f7d58aaa, transparent 45%), #fbf8f3', surface: '#ffffff', accent: '#4f78bf', text: '#26303f', font: 'Georgia, "Times New Roman", serif' } },
  { id: 'muertos', name: 'Día de Muertos', vibe: 'Papel picado de colores, pétalos de cempasúchil cayendo y velas encendidas.', category: 'Culturas', ink: false, scene: true, preview: { bg: 'linear-gradient(180deg, #e91e63 0 8%, #ff9800 8% 14%, #2a0f3d 14%, #1a0b26)', surface: 'rgba(44,18,60,0.88)', accent: '#ff9800', text: '#fff3e0', font: 'Righteous, "Segoe UI", sans-serif' } },
  { id: 'egipto', name: 'Antiguo Egipto', vibe: 'Oro y lapislázuli, pirámides bajo la luna y arena que sopla por el desierto.', category: 'Culturas', ink: false, scene: true, preview: { bg: 'linear-gradient(180deg, #0e1a3a 0 60%, #c99a48 60% 64%, #3a2b14 64%)', surface: 'rgba(22,36,76,0.88)', accent: '#e6be5a', text: '#fff5d8', font: 'Georgia, "Times New Roman", serif' } },
  { id: 'portatil', name: 'Portátil verde', vibe: 'La pantalla verde de las consolas de bolsillo de los 90: cuatro tonos, píxeles y portadas en verde.', category: 'Videojuegos', ink: true, preview: { bg: '#9bbc0f', surface: '#a7c41a', accent: '#306230', text: '#0f380f', font: '"Press Start 2P", monospace' } },
  { id: 'rally', name: 'Rally en la tierra', vibe: 'Camino de tierra, polvo que levantan las ruedas y árboles que pasan volando.', category: 'Motor', ink: false, scene: true, preview: { bg: 'linear-gradient(180deg, #5a7fa0 0 34%, #b8956a 34% 38%, #7a5a36 38%, #3a2a18)', surface: 'rgba(40,32,24,0.9)', accent: '#00a0e6', text: '#fff6e2', font: 'Rajdhani, "Segoe UI", sans-serif' } },
  { id: 'nuclear', name: 'Planta nuclear', vibe: 'Amarillo de peligro y verde radiactivo, el símbolo girando y partículas que brillan.', category: 'Videojuegos', ink: false, scene: true, preview: { bg: 'radial-gradient(circle, #1f2a12, #0a0d07 70%)', surface: '#181c10', accent: '#7cff3a', text: '#f3ffe8', font: 'Rajdhani, "Segoe UI", sans-serif' } },
]

// Capas genéricas que cada tema con fondo animado usa a su manera desde themes.css.
type LayoutId =
  | 'clasica' | 'espejo' | 'superior' | 'escenario' | 'minimal'
  | 'cabecera' | 'dock' | 'panorama' | 'cabina' | 'dividida' | 'ventanas' | 'cine'

type PulseAuraId = 'anillo' | 'halo' | 'llamas' | 'neon' | 'particulas' | 'liquido'

// Cómo se ve el movimiento alrededor de la portada en Big Picture > Pulso.
const pulseAuras: { id: PulseAuraId; name: string; description: string }[] = [
  { id: 'anillo', name: 'Anillo', description: 'Barras de ecualizador en círculo alrededor de la portada.' },
  { id: 'halo', name: 'Halo', description: 'Un resplandor con los colores de la portada que se infla con los bajos.' },
  { id: 'llamas', name: 'Llamas', description: 'Lenguas de fuego que suben con cada frecuencia.' },
  { id: 'neon', name: 'Neón', description: 'Anillos de luz que vibran y se expanden con la música.' },
  { id: 'particulas', name: 'Partículas', description: 'Puntos de luz que salen disparados con el ritmo.' },
  { id: 'liquido', name: 'Líquido', description: 'Una mancha de color que se deforma al ritmo de la canción.' },
]

// Televisores inteligentes y cajas de TV: activan el modo TV solos.
// La variante de Android TV se compila con VITE_DEVICE=tv. Dentro de una app Android el navegador no
// siempre dice "TV", así que también cuenta un Android sin pantalla táctil ni mouse.
// En Android las versiones nuevas se instalan con la APK; el actualizador automático es solo de escritorio.
const isAndroidApp = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)

const isTvDevice = import.meta.env.VITE_DEVICE === 'tv' || (typeof navigator !== 'undefined' && (
  /Android TV|GoogleTV|SmartTV|SMART-TV|Tizen|Web0S|webOS|BRAVIA|AFT[A-Z]|CrKey/i.test(navigator.userAgent)
  || (/Android/i.test(navigator.userAgent) && window.matchMedia('(pointer: none)').matches)
))

// Navegación con las flechas del control remoto: enfoca el elemento más cercano en esa dirección.
function moveFocusSpatially(direction: [number, number]) {
  const scope = document.querySelector<HTMLElement>('.big-picture, [role="dialog"][aria-modal="true"]') ?? document.querySelector<HTMLElement>('.app-shell')
  if (!scope) return false
  const candidates = [...scope.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled)')]
    .filter((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden')
  const active = document.activeElement instanceof HTMLElement && scope.contains(document.activeElement) ? document.activeElement : null
  if (!active) {
    candidates[0]?.focus()
    return candidates.length > 0
  }
  const from = active.getBoundingClientRect()
  const fromX = from.left + from.width / 2
  const fromY = from.top + from.height / 2
  let best: HTMLElement | null = null
  let bestScore = Infinity
  for (const element of candidates) {
    if (element === active) continue
    const rect = element.getBoundingClientRect()
    const dx = rect.left + rect.width / 2 - fromX
    const dy = rect.top + rect.height / 2 - fromY
    const along = dx * direction[0] + dy * direction[1]
    if (along <= 2) continue
    // Prefiere lo que está alineado en esa dirección antes que lo que está cerca pero de lado.
    const score = along + Math.abs(dx * direction[1] + dy * direction[0]) * 2.5
    if (score < bestScore) {
      best = element
      bestScore = score
    }
  }
  if (!best) return false
  best.focus()
  best.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  return true
}

type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'installing' | 'none' | 'error'
type UpdateState = { status: UpdateStatus; version?: string; notes?: string; progress?: number; error?: string }

type VisualizerLevels = { bands: number[]; level: number; bass: number; beat: boolean }

const layouts: { id: LayoutId; name: string; description: string }[] = [
  { id: 'clasica', name: 'Clásica', description: 'Menú a la izquierda y lo que suena a la derecha. En la letra, la portada a la izquierda.' },
  { id: 'espejo', name: 'Espejo', description: 'Todo al revés: menú a la derecha y lo que suena a la izquierda. En la letra, la portada a la derecha.' },
  { id: 'superior', name: 'Barra superior', description: 'Menú arriba en pestañas y más espacio para tu música. En la letra, la portada arriba y la letra centrada.' },
  { id: 'escenario', name: 'Escenario', description: 'La portada en grande como protagonista junto al contenido. En la letra, la portada gigante de fondo.' },
  { id: 'minimal', name: 'Minimal', description: 'Solo iconos, sin panel lateral y con el reproductor flotando. En la letra, solo la letra en el centro.' },
  { id: 'cabecera', name: 'Reproductor arriba', description: 'Los controles pasan a la parte de arriba, como una cabecera. En Big Picture también quedan arriba.' },
  { id: 'dock', name: 'Dock flotante', description: 'Sin barra lateral: el menú es un dock de iconos flotando abajo. En la letra, la portada como foto instantánea.' },
  { id: 'panorama', name: 'Panorama', description: 'Lo que suena es una franja ancha arriba y tu música debajo. En la letra, la portada en formato de cine.' },
  { id: 'cabina', name: 'Cabina', description: 'El reproductor es un panel vertical a la derecha con la portada grande. En la letra, la portada gira como un disco.' },
  { id: 'dividida', name: 'Pantalla dividida', description: 'Menú arriba y la pantalla partida a la mitad. En la letra, la portada llena media pantalla.' },
  { id: 'ventanas', name: 'Ventanas flotantes', description: 'Cada parte flota como una ventana con esquinas redondas. En la letra, la portada inclinada en 3D.' },
  { id: 'cine', name: 'Cine', description: 'Contenido centrado y el menú a la derecha. En la letra, subtítulos con franjas negras de película.' },
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
  pulseAura: PulseAuraId
  tvMode: boolean
  preferredService: Provider
  jamendoClientId: string
  spotifyClientId: string
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

// Client ID con el que se compiló la app. Cada usuario puede usar el suyo (Ajustes > Spotify),
// porque Spotify limita cuántas cuentas pueden entrar con una misma app de desarrollador.
const builtInSpotifyClientId: string = import.meta.env.VITE_SPOTIFY_CLIENT_ID ?? ''
const spotifyRedirectUri = 'http://127.0.0.1/callback'
const isSpotifyClientId = (value: string) => /^[a-z0-9]{32}$/i.test(value)
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
  pulseAura: 'anillo',
  tvMode: false,
  theme: 'original',
  preferredService: 'Spotify',
  jamendoClientId: defaultJamendoClientId,
  spotifyClientId: '',
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
  { label: 'Cuenta', icon: Crown },
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

// Apple Music y YouTube Music todavía no se pueden vincular: se muestran como "Próximamente".
const providers: { name: Provider; description: string; url: string; guide: string; available: boolean }[] = [
  {
    name: 'Spotify',
    description: 'Busca música y reprodúcela aquí mismo con el reproductor oficial de Spotify. La reproducción integrada requiere Spotify Premium.',
    url: 'https://developer.spotify.com/dashboard',
    guide: 'Spotify Web Playback SDK · requiere Premium',
    available: true,
  },
  {
    name: 'Apple Music',
    description: 'Próximamente. Estamos preparando la conexión con Apple Music.',
    url: 'https://developer.apple.com/musickit/',
    guide: 'Documentación de Apple MusicKit',
    available: false,
  },
  {
    name: 'YouTube Music',
    description: 'Próximamente. Estamos preparando la conexión con YouTube Music.',
    url: 'https://console.cloud.google.com/apis/credentials',
    guide: 'Google Cloud OAuth',
    available: false,
  },
]

const pages: Record<Section, { title: string; subtitle: string }> = {
  Escuchar: { title: 'Tu música, a tu manera.', subtitle: 'Un solo lugar para todo lo que te hace sentir.' },
  'Tu colección': { title: 'Todo lo que guardas.', subtitle: 'Álbumes, playlists y momentos que vuelven contigo.' },
  Favoritos: { title: 'Lo que siempre vuelve.', subtitle: 'Tus canciones favoritas, reunidas en un solo lugar.' },
  Personalización: { title: 'Hazla tuya.', subtitle: 'Elige el estilo con el que se ve y se siente DropMusic.' },
  Cuenta: { title: 'Tu cuenta y tu plan.', subtitle: 'Inicia sesión, mira tu plan y desbloquea DropMusic Pro.' },
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
      pulseAura: pulseAuras.some(({ id }) => id === saved.pulseAura) ? saved.pulseAura! : defaults.pulseAura,
      tvMode: typeof saved.tvMode === 'boolean' ? saved.tvMode : defaults.tvMode,
      theme: themes.some(({ id }) => id === saved.theme) ? saved.theme! : defaults.theme,
      bandGains: Array.isArray(saved.bandGains) && saved.bandGains.length === bandFrequencies.length
        ? saved.bandGains.map((gain) => Math.min(12, Math.max(-12, Number(gain) || 0)))
        : defaults.bandGains,
      preferredService: providers.some(({ name, available }) => available && name === saved.preferredService)
        ? saved.preferredService!
        : defaults.preferredService,
      jamendoClientId: typeof saved.jamendoClientId === 'string'
        ? saved.jamendoClientId.trim()
        : defaults.jamendoClientId,
      spotifyClientId: typeof saved.spotifyClientId === 'string' && isSpotifyClientId(saved.spotifyClientId.trim())
        ? saved.spotifyClientId.trim()
        : defaults.spotifyClientId,
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

function localPlaceholderCover(seed: string) {
  const hue = hueFromText(seed)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 65% 52%)"/><stop offset="1" stop-color="hsl(${(hue + 50) % 360} 60% 22%)"/></linearGradient></defs><rect width="300" height="300" fill="url(#g)"/><path d="M128 92v92a26 26 0 1 1-14-23V112l76-16v66a26 26 0 1 1-14-23V78z" fill="rgba(255,255,255,0.85)"/></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

function toLocalTrack(record: LocalTrackRecord, cover: string): Track {
  return {
    id: record.id,
    title: record.title,
    artist: record.artist,
    album: record.album,
    duration: record.duration,
    artwork: cover || localPlaceholderCover(record.title + record.artist),
    collectionUrl: '',
    color: `hsl(${hueFromText(record.album)} 45% 45%)`,
    mood: 'Local',
    genre: record.genre,
    source: 'Local',
    size: record.size,
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
  onRemove,
  showIndex = false,
}: {
  visibleTracks: Track[]
  activeTrackId: string
  favoriteIds: string[]
  onPlay: (id: string) => void
  onToggleFavorite: (id: string) => void
  onRemove?: (id: string) => void
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
              aria-label={track.source === 'Spotify' || track.source === 'Local'
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
            {track.source === 'Local'
              ? <span className="track-source track-source-local">{track.size ? formatBytes(track.size) : 'LOCAL'}</span>
              : (
                <a className="track-source" href={track.collectionUrl} rel="noreferrer" target="_blank">
                  {(track.source ?? 'MÚSICA').toUpperCase()} <ArrowUpRight size={10} />
                </a>
              )}
            <span className="track-duration">{formatTime(track.duration)}</span>
            <button
              aria-label={isFavorite ? `Quitar ${track.title} de favoritos` : `Añadir ${track.title} a favoritos`}
              aria-pressed={isFavorite}
              className={`track-favorite icon-button${isFavorite ? ' liked' : ''}`}
              onClick={() => onToggleFavorite(track.id)}
              type="button"
            ><Heart fill={isFavorite ? 'currentColor' : 'none'} size={15} /></button>
            {onRemove && (
              <button aria-label={`Quitar ${track.title} de tu música local`} className="track-remove icon-button" onClick={() => onRemove(track.id)} title="Quitar de la biblioteca" type="button"><Trash2 size={15} /></button>
            )}
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

type BigPictureMode = 'carousel' | 'lyrics' | 'vinilo' | 'pulso'

// Un segundo de silencio (WAV de 8 kHz) en bucle; el volumen casi nulo evita que el navegador
// lo trate como audio silenciado, que no cuenta para el panel multimedia del sistema.
function createSilentAudio() {
  const samples = 8000
  const buffer = new ArrayBuffer(44 + samples)
  const view = new DataView(buffer)
  const text = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)))
  text(0, 'RIFF'); view.setUint32(4, 36 + samples, true); text(8, 'WAVE')
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, samples, true); view.setUint32(28, samples, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true)
  text(36, 'data'); view.setUint32(40, samples, true)
  new Uint8Array(buffer, 44).fill(128)
  const audio = new Audio(URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' })))
  audio.loop = true
  audio.volume = 0.01
  return audio
}

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
  pulseAura,
  immersiveLocked,
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
  pulseAura: PulseAuraId
  immersiveLocked: boolean
}) {
  const orbRef = useRef<HTMLDivElement>(null)
  const [liveAudio, setLiveAudio] = useState(false)

  // Pulso escucha lo que suena en la PC (Rust lo analiza) y mueve cada barra con su banda.
  useEffect(() => {
    if (mode !== 'pulso' || !isTauri()) return
    let active = true
    let receivedSound = false
    let stopListening: (() => void) | undefined
    void listen<VisualizerLevels>('visualizer-levels', ({ payload }) => {
      const orb = orbRef.current
      if (!active || !orb) return
      // Un solo cambio de estilo por cuadro: las barras leen su banda con var(--bN).
      let vars = `--bass:${payload.bass.toFixed(3)};--level:${payload.level.toFixed(3)}`
      payload.bands.forEach((value, band) => { vars += `;--b${band}:${value.toFixed(3)}` })
      orb.style.cssText = vars
      if (payload.beat) {
        orb.classList.remove('pulse-beat')
        void orb.offsetWidth
        orb.classList.add('pulse-beat')
      }
      if (!receivedSound && payload.level > 0.02) {
        receivedSound = true
        setLiveAudio(true)
      }
    }).then((unlisten) => {
      if (active) stopListening = unlisten
      else unlisten()
    })
    void invoke('visualizer_start').catch((error: unknown) => console.error('No se pudo iniciar el visualizador.', error))
    return () => {
      active = false
      stopListening?.()
      void invoke('visualizer_stop').catch(() => {})
    }
  }, [mode])

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
        <button aria-pressed={mode === 'vinilo'} data-mode="vinilo" onClick={() => onModeChange('vinilo')} type="button"><Radio size={15} /> Vinilo{immersiveLocked && <Lock aria-label="Pro" size={11} />}</button>
        <button aria-pressed={mode === 'pulso'} data-mode="pulso" onClick={() => onModeChange('pulso')} type="button"><Activity size={15} /> Pulso{immersiveLocked && <Lock aria-label="Pro" size={11} />}</button>
      </div>
      <button aria-label="Salir de Big Picture" className="big-picture-close" onClick={onClose} type="button"><Minimize2 size={18} /></button>

      {mode === 'pulso' ? (
        <div className="pulse-layout">
          <div className={`pulse-orb${liveAudio ? ' pulse-live' : ''}`} data-aura={pulseAura} ref={orbRef}>
            {track.artwork && <span aria-hidden="true" className="pulse-glow"><img alt="" src={track.artwork} /></span>}
            <span aria-hidden="true" className="pulse-ripples"><i /><i /><i /></span>
            <span aria-hidden="true" className="pulse-ring">
              {/* 64 barras con las 32 bandas en espejo: graves arriba, agudos abajo */}
              {Array.from({ length: 64 }, (_, index) => <i key={index} style={{ '--bar': index, '--lv': `var(--b${index < 32 ? index : 63 - index}, 0)` } as CSSProperties} />)}
            </span>
            <button aria-label={isPlaying ? 'Pausar' : 'Reproducir'} className="pulse-cover" key={track.id} onClick={onTogglePlayback} type="button">
              {track.artwork ? <img alt={`Portada de ${track.album}`} src={track.artwork} /> : <Music2 size={64} />}
            </button>
          </div>
          <div className="pulse-meta" key={`meta-${track.id}`}>
            <strong>{track.title}</strong>
            <span>{track.artist}</span>
          </div>
          {upcomingTracks[0] && (
            <button className="pulse-next" key={`next-${upcomingTracks[0].id}`} onClick={() => onPlay(upcomingTracks[0].id)} type="button">
              <small>Sigue</small>
              {upcomingTracks[0].artwork ? <img alt="" src={upcomingTracks[0].artwork} /> : <Music2 size={16} />}
              <span><strong>{upcomingTracks[0].title}</strong><small>{upcomingTracks[0].artist}</small></span>
            </button>
          )}
        </div>
      ) : mode === 'vinilo' ? (
        <div className="vinyl-layout">
          <div className="vinyl-deck">
            <span className="vinyl-sleeve" key={`sleeve-${track.id}`}>
              {track.artwork ? <img alt={`Portada de ${track.album}`} src={track.artwork} /> : <Music2 size={64} />}
            </span>
            <button aria-label={isPlaying ? 'Pausar' : 'Reproducir'} className="vinyl-record" key={`record-${track.id}`} onClick={onTogglePlayback} type="button">
              <span className="vinyl-label">{track.artwork ? <img alt="" src={track.artwork} /> : <Music2 size={28} />}</span>
            </button>
            <span aria-hidden="true" className="vinyl-arm"><i /></span>
          </div>
          <div className="vinyl-info">
            <div className="vinyl-meta" key={track.id}>
              <small>Sonando ahora</small>
              <strong>{track.title}</strong>
              <span>{track.artist}</span>
              {track.album && <em>{track.album}</em>}
            </div>
            {upcomingTracks.length > 0 && (
              <ol className="vinyl-queue">
                <li className="vinyl-queue-title">Cara B · a continuación</li>
                {upcomingTracks.slice(0, 5).map((item, index) => (
                  <li key={item.id} style={{ '--i': index } as CSSProperties}>
                    <button onClick={() => onPlay(item.id)} type="button">
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      {item.artwork ? <img alt="" src={item.artwork} /> : <span className="vinyl-queue-art"><Music2 size={14} /></span>}
                      <span className="vinyl-queue-meta"><strong>{item.title}</strong><small>{item.artist}</small></span>
                      <span>{formatTime(item.duration)}</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      ) : mode === 'lyrics' ? (
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
  spotifyClientId,
  personalSpotifyClientId,
  onSpotifyClientIdChange,
}: {
  provider: Provider
  account?: ConnectedAccount
  onClose: () => void
  onConnected: (provider: Provider, account: ConnectedAccount) => void
  onDisconnected: (provider: Provider) => void
  spotifyClientId: string
  personalSpotifyClientId: string
  onSpotifyClientIdChange: (clientId: string) => void
}) {
  const [clientIdDraft, setClientIdDraft] = useState(personalSpotifyClientId)
  const [redirectCopied, setRedirectCopied] = useState(false)
  const details = providers.find(({ name }) => name === provider)
  const [linkError, setLinkError] = useState('')
  const [connecting, setConnecting] = useState(false)
  const oauthUnlistenRef = useRef<(() => void) | null>(null)
  const clientId = provider === 'Spotify'
    ? spotifyClientId
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
        {provider === 'Spotify' && (
          <details className="client-id-setup" open={!spotifyClientId}>
            <summary>{personalSpotifyClientId ? 'Usando tu propio Client ID' : spotifyClientId ? 'Usar mi propio Client ID (recomendado)' : 'Configura tu Client ID de Spotify'}</summary>
            <p>Spotify limita cuántas cuentas pueden entrar con una misma app. Con tu propio Client ID, gratis, DropMusic funciona sin ese límite y tu conexión es solo tuya.</p>
            <ol>
              <li>Entra gratis a <a href="https://developer.spotify.com/dashboard" onClick={openProviderGuide} rel="noreferrer" target="_blank">Spotify for Developers</a> con tu cuenta.</li>
              <li>Crea una app. En «Redirect URI» pega <code>{spotifyRedirectUri}</code> <button className="client-id-copy" onClick={() => { void navigator.clipboard.writeText(spotifyRedirectUri).then(() => setRedirectCopied(true)) }} type="button">{redirectCopied ? 'Copiado' : 'Copiar'}</button> y marca «Web API» y «Web Playback SDK».</li>
              <li>Copia el Client ID de tu app y pégalo aquí:</li>
            </ol>
            <form className="client-id-form" onSubmit={(event) => {
              event.preventDefault()
              const value = clientIdDraft.trim()
              if (value && !isSpotifyClientId(value)) {
                setLinkError('El Client ID de Spotify tiene 32 letras y números. Revisa que lo copiaste completo.')
                return
              }
              setLinkError('')
              onSpotifyClientIdChange(value)
            }}>
              <input aria-label="Client ID de Spotify" autoComplete="off" onChange={(event) => setClientIdDraft(event.target.value)} placeholder="Pega tu Client ID" spellCheck={false} value={clientIdDraft} />
              <button className="secondary-button" type="submit">{clientIdDraft.trim() ? 'Guardar' : 'Quitar'}</button>
            </form>
            {account && clientIdDraft.trim() !== personalSpotifyClientId && <small>Al cambiar el Client ID tendrás que volver a conectar Spotify.</small>}
          </details>
        )}
        {supportsOAuth && <a className="provider-guide-link" href={details.url} onClick={openProviderGuide} rel="noreferrer" target="_blank">Abrir guía oficial</a>}
        <p className="dialog-footnote">{details.guide}</p>
      </section>
    </div>
  )
}

type SpotifyDevice = { id: string; name: string; kind: string; isActive: boolean; volume: number | null; supportsVolume: boolean }
type SpotifyRemoteState = { deviceId: string; deviceName: string; isPlaying: boolean; progressMs: number; volume: number | null; track: SpotifyTrackResult | null }

function deviceIcon(kind: string): LucideIcon {
  const type = kind.toLowerCase()
  if (type === 'tv' || type === 'castvideo' || type === 'stb') return Tv
  if (type === 'smartphone' || type === 'tablet') return Smartphone
  if (type === 'computer') return Laptop
  return Speaker
}

const deviceKinds: Record<string, string> = {
  tv: 'Televisor', castvideo: 'Chromecast', castaudio: 'Chromecast de audio', stb: 'Decodificador de TV',
  smartphone: 'Celular', tablet: 'Tableta', computer: 'Computadora', speaker: 'Parlante',
  avr: 'Receptor de audio', gameconsole: 'Consola', automobile: 'Auto', smartwatch: 'Reloj',
}

const proFeatures: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Palette, title: 'Personalización total', text: `${themes.length} temas, ${layouts.length} disposiciones, auras de Pulso y portadas animadas.` },
  { icon: Upload, title: 'Tus canciones locales', text: 'Sube y organiza tu propia música para escucharla sin internet.' },
  { icon: Disc3, title: 'Modo inmersivo', text: 'El vinilo girando y el Pulso de la música a pantalla completa.' },
]

const freeFeatures = ['La interfaz estándar de DropMusic', 'Reproducción completa con Spotify', 'Búsqueda, mezclas, letras y Conectar']
const freeLimits = ['Sin personalización visual', 'Sin canciones locales', 'Vinilo y Pulso bloqueados']

function AuthForm({ onDone, onSkip }: { onDone: () => void; onSkip?: () => void }) {
  const [mode, setMode] = useState<'entrar' | 'crear' | 'recuperar'>('entrar')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  async function submit() {
    setBusy(true)
    setError('')
    setInfo('')
    try {
      if (mode === 'entrar') {
        await signIn(email, password)
        onDone()
      } else if (mode === 'crear') {
        if (await signUp(email, password)) onDone()
        else {
          setInfo('Te enviamos un correo para confirmar tu cuenta. Ábrelo y después inicia sesión aquí.')
          setMode('entrar')
        }
      } else {
        await sendPasswordReset(email)
        setInfo('Te enviamos un enlace para crear una contraseña nueva.')
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="auth-form" onSubmit={(event) => { event.preventDefault(); void submit() }}>
      {mode !== 'recuperar' && (
        <div aria-label="Entrar o crear cuenta" className="auth-tabs" role="tablist">
          <button aria-selected={mode === 'entrar'} onClick={() => { setMode('entrar'); setError('') }} role="tab" type="button">Iniciar sesión</button>
          <button aria-selected={mode === 'crear'} onClick={() => { setMode('crear'); setError('') }} role="tab" type="button">Crear cuenta</button>
        </div>
      )}
      <label className="auth-field">
        <span><Mail size={13} /> Correo</span>
        <input autoComplete="email" onChange={(event) => setEmail(event.target.value)} placeholder="tu@correo.com" required type="email" value={email} />
      </label>
      {mode !== 'recuperar' && (
        <label className="auth-field">
          <span><Lock size={13} /> Contraseña</span>
          <input autoComplete={mode === 'crear' ? 'new-password' : 'current-password'} minLength={6} onChange={(event) => setPassword(event.target.value)} placeholder={mode === 'crear' ? 'Mínimo 6 caracteres' : 'Tu contraseña'} required type="password" value={password} />
        </label>
      )}
      {error && <p className="auth-error" role="alert">{error}</p>}
      {info && <p className="auth-info" role="status">{info}</p>}
      <button className="primary-button auth-submit" disabled={busy} type="submit">
        {busy ? 'Un momento…' : mode === 'entrar' ? 'Iniciar sesión' : mode === 'crear' ? 'Crear mi cuenta' : 'Enviarme el enlace'}
      </button>
      <div className="auth-links">
        {mode === 'recuperar'
          ? <button onClick={() => setMode('entrar')} type="button">Volver a iniciar sesión</button>
          : <button onClick={() => { setMode('recuperar'); setError('') }} type="button">¿Olvidaste tu contraseña?</button>}
        {onSkip && <button onClick={onSkip} type="button">Seguir sin cuenta</button>}
      </div>
    </form>
  )
}

function AuthDialog({ reason, onClose, onSkip }: { reason: string; onClose: () => void; onSkip?: () => void }) {
  return (
    <div className="dialog-backdrop account-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) (onSkip ?? onClose)() }} role="presentation">
      <section aria-labelledby="auth-title" aria-modal="true" className="provider-dialog auth-dialog" role="dialog">
        <button aria-label="Cerrar" className="icon-button dialog-close" onClick={onSkip ?? onClose} type="button"><X size={18} /></button>
        <div className="dialog-mark auth-mark"><img alt="" src="/favicon.svg" /></div>
        <p className="eyebrow">TU CUENTA DROPMUSIC</p>
        <h2 id="auth-title">Bienvenido a DropMusic</h2>
        <p className="dialog-copy">{reason || 'Con tu cuenta guardas tu plan y lo usas en la PC, el celular y el TV. También puedes seguir sin cuenta con el plan gratuito.'}</p>
        <AuthForm onDone={onClose} onSkip={onSkip} />
      </section>
    </div>
  )
}

function UpgradeDialog({ feature, signedIn, onBuy, onClose }: { feature: string; signedIn: boolean; onBuy: () => void; onClose: () => void }) {
  return (
    <div className="dialog-backdrop account-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }} role="presentation">
      <section aria-labelledby="upgrade-title" aria-modal="true" className="provider-dialog upgrade-dialog" role="dialog">
        <button aria-label="Cerrar" className="icon-button dialog-close" onClick={onClose} type="button"><X size={18} /></button>
        <div className="dialog-mark pro-mark"><Crown size={22} /></div>
        <p className="eyebrow">DROPMUSIC PRO</p>
        <h2 id="upgrade-title">{feature} es parte de Pro</h2>
        <p className="dialog-copy">Desbloquea todo DropMusic por ${proPrice} al mes.</p>
        <ul className="pro-feature-list">
          {proFeatures.map(({ icon: Icon, title, text }) => (
            <li key={title}><span><Icon size={16} /></span><div><strong>{title}</strong><small>{text}</small></div></li>
          ))}
        </ul>
        <button className="primary-button dialog-action" onClick={onBuy} type="button">
          <Crown size={15} /> {!accountsEnabled ? 'Disponible muy pronto' : signedIn ? `Obtener Pro · ${proPrice}/mes` : 'Inicia sesión para obtener Pro'}
        </button>
        <p className="dialog-footnote">Pago seguro con PayPal o tarjeta. Cada pago suma un mes, sin renovaciones automáticas.</p>
      </section>
    </div>
  )
}

function ConnectPanel({
  spotifyLinked,
  devices,
  loading,
  error,
  localDeviceId,
  remoteDeviceId,
  onRefresh,
  onSelect,
  onLinkSpotify,
  onClose,
}: {
  spotifyLinked: boolean
  devices: SpotifyDevice[]
  loading: boolean
  error: string
  localDeviceId: string
  remoteDeviceId: string
  onRefresh: () => void
  onSelect: (device: { id: string; name: string }) => void
  onLinkSpotify: () => void
  onClose: () => void
}) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])
  const others = devices.filter((device) => device.id !== localDeviceId)

  return (
    <section aria-labelledby="connect-title" className="connect-panel" role="dialog">
      <header className="connect-header">
        <div><p className="eyebrow">CONECTAR</p><h3 id="connect-title">Escuchar en otro dispositivo</h3></div>
        {spotifyLinked && <button aria-label="Buscar dispositivos otra vez" className="icon-button" disabled={loading} onClick={onRefresh} type="button"><RefreshCw className={loading ? 'spin' : ''} size={15} /></button>}
        <button aria-label="Cerrar" className="icon-button" onClick={onClose} type="button"><X size={16} /></button>
      </header>
      {!spotifyLinked ? (
        <div className="connect-empty">
          <span><Cast size={22} /></span>
          <p>Vincula Spotify para pasar la música a tu TV, tus parlantes u otro equipo y controlarla desde aquí.</p>
          <button className="primary-button" onClick={onLinkSpotify} type="button">Conectar Spotify</button>
        </div>
      ) : (
        <>
          <ul className="connect-list">
            <li>
              <button aria-pressed={!remoteDeviceId} className="connect-device" disabled={!localDeviceId} onClick={() => onSelect({ id: localDeviceId, name: 'Este equipo' })} type="button">
                <Laptop size={20} />
                <span><strong>Este equipo</strong><small>{!localDeviceId ? 'Conectando el reproductor…' : !remoteDeviceId ? 'Sonando aquí' : 'DropMusic'}</small></span>
                {!remoteDeviceId && localDeviceId && <Check className="connect-check" size={16} />}
              </button>
            </li>
            {others.map((device) => {
              const Icon = deviceIcon(device.kind)
              const active = device.id === remoteDeviceId
              return (
                <li key={device.id}>
                  <button aria-pressed={active} className="connect-device" onClick={() => onSelect(device)} type="button">
                    <Icon size={20} />
                    <span><strong>{device.name}</strong><small>{active ? 'Sonando aquí · lo controlas desde DropMusic' : deviceKinds[device.kind.toLowerCase()] ?? 'Dispositivo'}</small></span>
                    {active && <AudioLines className="connect-check" size={16} />}
                  </button>
                </li>
              )
            })}
          </ul>
          {loading && others.length === 0 && <p className="connect-hint">Buscando dispositivos…</p>}
          {!loading && others.length === 0 && <p className="connect-hint">No vemos otros dispositivos. Abre Spotify en tu TV, celular o parlante con la misma cuenta y pulsa actualizar.</p>}
          {error && <p className="connect-error" role="status">{error}</p>}
          <p className="connect-footnote">Funciona con Spotify Premium, como el botón Conectar de Spotify. Las canciones locales y de Jamendo siguen sonando en este equipo.</p>
        </>
      )}
    </section>
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
  // Evita avanzar dos veces cuando el fin de la canción se detecta por dos caminos a la vez.
  const spotifyEndedIdRef = useRef('')
  const spotifyStartedAtRef = useRef(0)
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
  const [personalizationTab, setPersonalizationTab] = useState<'temas' | 'disposiciones'>('temas')
  const [appVersion, setAppVersion] = useState('')
  const [localTracks, setLocalTracks] = useState<Track[]>([])
  const [localImport, setLocalImport] = useState<{ done: number; total: number } | null>(null)
  const [localMessage, setLocalMessage] = useState('')
  const [localDragging, setLocalDragging] = useState(false)
  const localFileInputRef = useRef<HTMLInputElement>(null)
  const localFolderInputRef = useRef<HTMLInputElement>(null)
  const [updateState, setUpdateState] = useState<UpdateState>({ status: 'idle' })
  const [updateDismissed, setUpdateDismissed] = useState(false)
  const pendingUpdateRef = useRef<Update | null>(null)
  const lyricsCacheRef = useRef(new Map<string, LyricsState>())
  const [topArtists, setTopArtists] = useState<Artist[]>([])
  const [newReleases, setNewReleases] = useState<Album[]>([])
  const [listeningHistory, setListeningHistory] = useState(readRecentTracks)
  const detailRequestRef = useRef(0)
  const mainContentRef = useRef<HTMLElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const currentDetail = detailStack.at(-1) ?? null
  const [accountUser, setAccountUser] = useState<{ id: string; email: string } | null>(null)
  const [profile, setProfile] = useState<Profile | null>(() => accountsEnabled ? readCachedProfile() : null)
  const [authDialog, setAuthDialog] = useState<{ reason: string; skippable: boolean } | null>(null)
  const [upgradeFeature, setUpgradeFeature] = useState('')
  const [accountMessage, setAccountMessage] = useState('')
  const [adminSearch, setAdminSearch] = useState('')
  const [adminProfiles, setAdminProfiles] = useState<Profile[]>([])
  const [adminMessage, setAdminMessage] = useState('')
  const [libraryTab, setLibraryTab] = useState<'local' | 'spotify'>('local')
  const [connectOpen, setConnectOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [devices, setDevices] = useState<SpotifyDevice[]>([])
  const [devicesLoading, setDevicesLoading] = useState(false)
  const [devicesError, setDevicesError] = useState('')
  const [remoteDevice, setRemoteDevice] = useState<{ id: string; name: string } | null>(null)
  // Dispositivo de Spotify Connect donde suena la música (el TV, por ejemplo). Null: suena aquí.
  const remoteDeviceRef = useRef<{ id: string; name: string } | null>(null)
  const remoteSyncRef = useRef<(state: SpotifyRemoteState) => void>(() => {})
  // Sin servidor de cuentas (versiones de prueba) todo queda desbloqueado.
  const isPro = !accountsEnabled || hasPro(profile)
  const isAdmin = profile?.role === 'admin'
  const effectiveTheme: ThemeId = isPro ? settings.theme : 'original'
  const effectiveLayout: LayoutId = isPro ? settings.layout : 'clasica'
  const effectiveAnimatedCovers = isPro && settings.animatedCovers

  const activeTrack = activeCatalogTrack ?? tracks.find((track) => track.id === activeTrackId) ?? emptyTrack
  const query = search.trim().toLowerCase()
  const isSearching = query.length >= 2
  const allTracks = useMemo(
    () => [...tracks, ...localTracks, ...spotifySuggestedTracks, ...spotifyTracks, ...jamendoTracks]
      .filter((track, index, list) => list.findIndex((item) => item.id === track.id) === index),
    [localTracks, spotifySuggestedTracks, spotifyTracks, jamendoTracks],
  )
  const configuredJamendoClientId = settings.jamendoClientId.trim() || defaultJamendoClientId
  const spotifyClientId = settings.spotifyClientId || builtInSpotifyClientId
  const progressDuration = activeTrack.duration
  const searchResults = useMemo(
    () => allTracks.filter((track) => `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(query)),
    [allTracks, query],
  )
  // La biblioteca de Spotify va aparte de los archivos locales para no mezclarlas.
  const spotifyLibraryTracks = useMemo(() => allTracks.filter((track) => track.source === 'Spotify'), [allTracks])
  const albums = useMemo(
    () => spotifyLibraryTracks.filter((track, index, list) => list.findIndex((item) => item.album === track.album) === index),
    [spotifyLibraryTracks],
  )
  const featuredTracks = useMemo(
    () => [...spotifySuggestedTracks, ...spotifyTracks, ...jamendoTracks, ...localTracks]
      .filter((track, index, list) => list.findIndex((item) => item.id === track.id) === index),
    [spotifySuggestedTracks, spotifyTracks, jamendoTracks, localTracks],
  )
  const [featuredTrackIndex, setFeaturedTrackIndex] = useState(0)
  const featuredTrack = featuredTracks.length > 0
    ? featuredTracks[featuredTrackIndex % featuredTracks.length]
    : null
  const page = pages[activeSection]
  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }))
  }

  // Cuenta: restaura la sesión guardada y sigue los cambios (entrar, salir, renovar el token).
  useEffect(() => {
    if (!accountsEnabled) return
    let active = true
    const apply = (session: Session | null) => {
      if (!active) return
      const user = session?.user
      setAccountUser(user ? { id: user.id, email: user.email ?? '' } : null)
      if (!user) {
        setProfile(null)
        writeCachedProfile(null)
        return
      }
      void fetchProfile(user.id).then((next) => {
        if (!active) return
        setProfile(next)
        writeCachedProfile(next)
      }).catch((error: unknown) => console.error('No se pudo cargar tu cuenta de DropMusic.', error))
    }
    void getSession().then((session) => {
      apply(session)
      let skipped = false
      try { skipped = window.localStorage.getItem('dropmusic-auth-skipped') === '1' } catch { skipped = false }
      if (active && !session && !skipped) setAuthDialog({ reason: '', skippable: true })
    }).catch((error: unknown) => console.error('No se pudo restaurar tu sesión de DropMusic.', error))
    const stop = onSessionChange(apply)
    return () => {
      active = false
      stop()
    }
  }, [])

  const refreshProfile = useCallback(async () => {
    if (!accountUser) return
    const next = await fetchProfile(accountUser.id)
    setProfile(next)
    writeCachedProfile(next)
  }, [accountUser])

  // Al volver a la app (por ejemplo, después de pagar en la web) se revisa el plan.
  useEffect(() => {
    if (!accountUser) return
    const handleFocus = () => { void refreshProfile().catch(() => {}) }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [accountUser, refreshProfile])

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
  }, [spotifyClientId])

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
  }, [connectedAccounts.Spotify, spotifyClientId])

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
  }, [connectedAccounts.Spotify, spotifyClientId])

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
        if (!state || remoteDeviceRef.current) return
        const track = state.track_window.current_track
        // Spotify no avisa cuando termina una canción: pasa de sonando a pausado en la posición 0.
        // Casi nunca manda estados a mitad de canción, así que el último suele tener posición 0;
        // por eso basta con que la canción lleve unos segundos sonando.
        const previous = spotifyLastStateRef.current
        spotifyLastStateRef.current = { id: track.id, paused: state.paused, position: state.position }
        if (previous && !previous.paused && previous.id === track.id && state.paused && state.position === 0
          && (previous.position > 0 || Date.now() - spotifyStartedAtRef.current > 5000)
          && spotifyEndedIdRef.current !== track.id) {
          spotifyEndedIdRef.current = track.id ?? ''
          trackEndRef.current()
          // Este estado es de la canción que terminó: no debe pisar la que acaba de empezar.
          return
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
  }, [connectedAccounts.Spotify, spotifyClientId])

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
  }, [connectedAccounts.Spotify, query, search, spotifyClientId])

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
  }, [currentDetail, spotifyClientId])

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
    const seeThrough = effectiveTheme === 'transparente'
    document.documentElement.classList.toggle('see-through', seeThrough)
    if (!isTauri()) return
    // Cristal acrílico de Windows: difumina el escritorio detrás de la ventana transparente.
    try {
      const appWindow = getCurrentWindow()
      const change = seeThrough
        ? appWindow.setEffects({ effects: [Effect.Acrylic], color: [16, 16, 24, 70] })
        : appWindow.clearEffects()
      void change.catch((error: unknown) => console.error('No se pudo cambiar el efecto de cristal de la ventana.', error))
    } catch (error) {
      console.error('No se pudo acceder a la ventana.', error)
    }
  }, [effectiveTheme])

  useEffect(() => {
    let active = true
    void listLocalTracks()
      .then((records) => Promise.all(records.map(async (record) => toLocalTrack(record, record.hasCover ? await localCoverUrl(record.id) : ''))))
      .then((loaded) => { if (active) setLocalTracks(loaded) })
      .catch((error: unknown) => console.error('No se pudo abrir la biblioteca local.', error))
    return () => { active = false }
  }, [])

  async function importLocalFiles(fileList: FileList | File[]) {
    const files = [...fileList].filter(isLocalAudioFile)
    const skipped = fileList.length - files.length
    if (files.length === 0) {
      setLocalMessage('No encontramos archivos de audio. Formatos admitidos: ' + localAudioExtensions.join(', ').replace(/\./g, '').toUpperCase() + '.')
      return
    }
    setLocalMessage('')
    setLocalImport({ done: 0, total: files.length })
    const added: Track[] = []
    let failed = 0
    for (const [index, item] of files.entries()) {
      try {
        const record = await importLocalFile(item)
        added.push(toLocalTrack(record, record.hasCover ? await localCoverUrl(record.id) : ''))
      } catch (error) {
        failed += 1
        console.error(`No se pudo agregar ${item.name}.`, error)
      }
      setLocalImport({ done: index + 1, total: files.length })
    }
    setLocalTracks((current) => [...added, ...current])
    setLocalImport(null)
    const notes = [`${added.length} ${added.length === 1 ? 'canción agregada' : 'canciones agregadas'}`]
    if (failed) notes.push(`${failed} no se pudieron leer`)
    if (skipped) notes.push(skipped === 1 ? '1 archivo no era de audio' : `${skipped} archivos no eran de audio`)
    setLocalMessage(notes.join(' · ') + '.')
  }

  async function removeLocalTrack(id: string) {
    try {
      await deleteLocalTrack(id)
      setLocalTracks((current) => current.filter((track) => track.id !== id))
      setFavoriteIds((current) => current.filter((item) => item !== id))
      if (activeTrack.id === id) {
        setIsPlaying(false)
        setActiveCatalogTrack(null)
        setActiveTrackId('')
      }
    } catch (error) {
      console.error('No se pudo quitar la canción.', error)
      setLocalMessage('No se pudo quitar la canción. Inténtalo de nuevo.')
    }
  }

  async function checkForUpdates(manual: boolean) {
    if (!isTauri() || isAndroidApp) return
    setUpdateState({ status: 'checking' })
    try {
      const update = await check()
      pendingUpdateRef.current = update
      if (update) {
        setUpdateState({ status: 'available', version: update.version, notes: update.body })
        setUpdateDismissed(false)
      } else {
        setUpdateState({ status: manual ? 'none' : 'idle' })
      }
    } catch (error) {
      console.error('No se pudo buscar actualizaciones.', error)
      setUpdateState({ status: manual ? 'error' : 'idle', error: error instanceof Error ? error.message : String(error) })
    }
  }

  async function installUpdate() {
    const update = pendingUpdateRef.current
    if (!update) return
    let total = 0
    let received = 0
    setUpdateState((current) => ({ ...current, status: 'downloading', progress: 0 }))
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') total = event.data.contentLength ?? 0
        else if (event.event === 'Progress') {
          received += event.data.chunkLength
          setUpdateState((current) => ({ ...current, progress: total ? received / total : 0 }))
        } else setUpdateState((current) => ({ ...current, status: 'installing', progress: 1 }))
      })
      // En Windows el instalador cierra la app; en otros sistemas hay que reabrirla.
      await relaunch()
    } catch (error) {
      console.error('No se pudo instalar la actualización.', error)
      setUpdateState((current) => ({ ...current, status: 'error', error: error instanceof Error ? error.message : String(error) }))
    }
  }

  const checkForUpdatesRef = useRef(checkForUpdates)
  useEffect(() => {
    checkForUpdatesRef.current = checkForUpdates
  })

  useEffect(() => {
    if (!isTauri()) return
    void getVersion().then(setAppVersion).catch(() => {})
    const first = window.setTimeout(() => void checkForUpdatesRef.current(false), 4000)
    const timer = window.setInterval(() => void checkForUpdatesRef.current(false), 6 * 60 * 60 * 1000)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(timer)
    }
  }, [])

  const tvMode = settings.tvMode || isTvDevice
  const shellLayout: LayoutId = tvMode ? 'clasica' : effectiveLayout

  // El menú del modo TV recibe el foco al abrirse para moverse en él con las flechas.
  useEffect(() => {
    if (menuOpen) document.querySelector<HTMLElement>('.sidebar .nav-item.active, .sidebar .nav-item')?.focus()
  }, [menuOpen])

  useEffect(() => {
    if (!tvMode) return
    const directions: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }
    function handleRemote(event: KeyboardEvent) {
      const target = event.target instanceof HTMLElement ? event.target : null
      const typing = target?.matches('input:not([type="range"]), textarea, select') ?? false
      // Botón "Atrás" del control: cierra la pantalla completa o vuelve de un artista/álbum.
      if (['GoBack', 'BrowserBack', 'XF86Back'].includes(event.key) || (event.key === 'Backspace' && !typing)) {
        event.preventDefault()
        if (document.querySelector('.big-picture')) setBigPictureMode(null)
        else if (document.querySelector('.menu-open')) setMenuOpen(false)
        else setDetailStack((current) => current.slice(0, -1))
        return
      }
      const direction = directions[event.key]
      if (!direction || typing) return
      // En las barras de progreso y volumen, izquierda y derecha cambian el valor.
      if (target?.matches('input[type="range"]') && direction[0] !== 0) return
      if (moveFocusSpatially(direction)) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }
    window.addEventListener('keydown', handleRemote, true)
    return () => window.removeEventListener('keydown', handleRemote, true)
  }, [tvMode])

  // Reproductores externos (el panel multimedia de Windows, widgets, teclas multimedia):
  // sin estos datos mostraban el título de la ventana y ninguna portada.
  const mediaHandlersRef = useRef({ togglePlayback: () => {}, skipTrack: (_direction: 1 | -1) => {}, seekTo: (_time: number) => {} })
  useEffect(() => {
    document.title = activeTrack.source ? `${activeTrack.title} · ${activeTrack.artist}` : 'DropMusic — Tu música, a tu manera'
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.metadata = activeTrack.source
      ? new MediaMetadata({
          title: activeTrack.title,
          artist: activeTrack.artist,
          album: activeTrack.album,
          artwork: activeTrack.artwork ? [{ src: activeTrack.artwork, sizes: '640x640' }] : [],
        })
      : null
  }, [activeTrack.source, activeTrack.title, activeTrack.artist, activeTrack.album, activeTrack.artwork])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.playbackState = activeTrack.source ? (isPlaying ? 'playing' : 'paused') : 'none'
  }, [activeTrack.source, isPlaying])

  // Spotify suena dentro de su propio iframe y Windows tomaba los datos de ese marco (vacíos).
  // Un audio silencioso en la ventana principal hace que Windows lea nuestros datos.
  const silentAudioRef = useRef<HTMLAudioElement | null>(null)
  useEffect(() => {
    if (activeTrack.source !== 'Spotify') {
      silentAudioRef.current?.pause()
      return
    }
    silentAudioRef.current ??= createSilentAudio()
    const silent = silentAudioRef.current
    if (isPlaying) void silent.play().catch(() => {})
    else silent.pause()
  }, [activeTrack.source, isPlaying])

  useEffect(() => {
    if (!('mediaSession' in navigator) || !activeTrack.duration) return
    try {
      navigator.mediaSession.setPositionState({ duration: activeTrack.duration, position: Math.min(activeTrack.duration, elapsedSeconds), playbackRate: 1 })
    } catch {
      // Algunos motores rechazan posiciones fuera de rango durante el cambio de canción.
    }
  }, [activeTrack.duration, elapsedSeconds])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const session = navigator.mediaSession
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => mediaHandlersRef.current.togglePlayback()],
      ['pause', () => mediaHandlersRef.current.togglePlayback()],
      ['nexttrack', () => mediaHandlersRef.current.skipTrack(1)],
      ['previoustrack', () => mediaHandlersRef.current.skipTrack(-1)],
      ['seekto', (details) => { if (details.seekTime !== undefined) mediaHandlersRef.current.seekTo(Math.floor(details.seekTime)) }],
    ]
    for (const [action, handler] of handlers) {
      try { session.setActionHandler(action, handler) } catch { /* acción no soportada */ }
    }
    return () => {
      for (const [action] of handlers) {
        try { session.setActionHandler(action, null) } catch { /* acción no soportada */ }
      }
    }
  }, [])

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
    if (remoteDeviceRef.current) {
      // En otro dispositivo el volumen se manda por la API; se espera a que sueltes la barra.
      const timer = window.setTimeout(() => remoteControl('volume', settings.volume), 400)
      return () => window.clearTimeout(timer)
    }
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

  useEffect(() => {
    if (remoteDevice || activeTrack.source !== 'Spotify' || !isPlaying || !activeTrack.duration || elapsedSeconds < activeTrack.duration) return
    const trackId = activeTrack.id
    const timer = window.setInterval(() => {
      void spotifyPlayerRef.current?.getCurrentState().then((state) => {
        if (spotifyEndedIdRef.current === trackId) return
        const current = state?.track_window.current_track.id
        if (state && current !== trackId) return
        if (!state || (state.paused && state.position === 0) || state.position >= state.duration - 1000) {
          spotifyEndedIdRef.current = trackId
          trackEndRef.current()
        }
      }).catch((error: unknown) => console.error('No se pudo consultar el estado de Spotify.', error))
    }, 2000)
    return () => window.clearInterval(timer)
  }, [remoteDevice, activeTrack.source, activeTrack.id, activeTrack.duration, isPlaying, elapsedSeconds])

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
    const remote = remoteDeviceRef.current
    if (!spotifyClientId || (!remote && (!spotifyPlayerRef.current || !spotifyDeviceId))) {
      setSpotifyPlayerError('El reproductor de Spotify todavía está conectando. Inténtalo de nuevo en unos segundos.')
      return
    }
    if (addToHistory) spotifyHistoryRef.current = [...spotifyHistoryRef.current, spotifyTrack].slice(-50)
    spotifyEndedIdRef.current = ''
    spotifyStartedAtRef.current = Date.now()
    setRecentTracks(spotifyHistoryRef.current.slice(0, -1).slice(-2))
    setListeningHistory((current) => [spotifyTrack, ...current.filter((track) => track.id !== spotifyTrack.id)].slice(0, 12))
    spotifyRadioRef.current.playedIds.add(spotifyTrack.id)
    setSpotifyPlayerError('')
    setPlaybackError('')
    setActiveCatalogTrack(spotifyTrack)
    setActiveTrackId(spotifyTrack.id)
    setElapsedSeconds(0)
    setIsPlaying(true)
    const deviceId = remote?.id ?? spotifyDeviceId
    if (!remote) {
      void spotifyPlayerRef.current?.activateElement().catch((error: unknown) => {
        console.error('No se pudo activar el reproductor integrado de Spotify.', error)
      })
    }
    void invoke('spotify_start_playback', {
      clientId: spotifyClientId,
      deviceId,
      trackId: spotifyTrack.id.replace(/^spotify:/, ''),
    }).then(() => {
      setSpotifyPlayerError('')
      // La repetición la maneja DropMusic; si Spotify tuviera la suya activa, la canción nunca terminaría.
      void invoke('spotify_set_playback_option', { clientId: spotifyClientId, deviceId, option: 'repeat', enabled: false })
        .catch((error: unknown) => console.error('No se pudo quitar la repetición de Spotify.', error))
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
    // En aleatorio la siguiente sale de cualquier punto de la cola, no de la primera posición.
    const pool = radio.upNext.length > 0 ? radio.upNext : radio.queue
    const next = pool.splice(shuffle ? Math.floor(Math.random() * pool.length) : 0, 1)[0]
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
      if (remoteDeviceRef.current) {
        remoteControl('seek', 0)
        return
      }
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
    const localTrack = localTracks.find((track) => track.id === id)
    if (localTrack) {
      if (!prepareAudio()) return
      setPlaybackError('')
      void localAudioUrl(id).then((audioUrl) => {
        setElapsedSeconds(0)
        setActiveCatalogTrack({ ...localTrack, audioUrl })
        setActiveTrackId(id)
        setIsPlaying(true)
      }).catch((error: unknown) => {
        console.error('No se pudo abrir la canción local.', error)
        setPlaybackError(error instanceof Error ? error.message : String(error))
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

  // Repetir la canción lo maneja DropMusic: al terminar vuelve a empezar la misma.
  function toggleRepeat() {
    setRepeat((current) => !current)
  }

  function togglePlayback() {
    if (!activeTrack.source) {
      setPlaybackError('Busca una canción en Spotify o Jamendo para empezar a escuchar.')
      return
    }
    if (activeTrack.source === 'Spotify') {
      if (remoteDeviceRef.current) {
        remoteControl(isPlaying ? 'pause' : 'play')
        setIsPlaying(!isPlaying)
        return
      }
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

    const queue = activeTrack.source === 'Local'
      ? localTracks
      : activeTrack.source === 'Jamendo'
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
      if (repeat) startSpotifyTrack(activeTrack, false)
      else skipTrack(1)
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

  function changeRemoteDevice(device: { id: string; name: string } | null) {
    remoteDeviceRef.current = device
    setRemoteDevice(device)
  }

  function remoteControl(action: 'play' | 'pause' | 'next' | 'previous' | 'volume' | 'seek', value?: number) {
    const device = remoteDeviceRef.current
    if (!device || !spotifyClientId) return
    void invoke('spotify_remote_control', { clientId: spotifyClientId, deviceId: device.id, action, value: value ?? null })
      .catch((error: unknown) => {
        console.error('No se pudo controlar el otro dispositivo.', error)
        setSpotifyPlayerError(error instanceof Error ? error.message : String(error))
      })
  }

  async function loadDevices() {
    if (!connectedAccounts.Spotify || !spotifyClientId || !isTauri()) return
    setDevicesLoading(true)
    setDevicesError('')
    try {
      setDevices(await invoke<SpotifyDevice[]>('spotify_list_devices', { clientId: spotifyClientId }))
    } catch (error) {
      setDevicesError(error instanceof Error ? error.message : String(error))
    } finally {
      setDevicesLoading(false)
    }
  }

  function toggleConnect() {
    if (!connectOpen) void loadDevices()
    setConnectOpen(!connectOpen)
  }

  // Pasa lo que suena a otro dispositivo (o lo trae de vuelta a este equipo).
  async function selectDevice(device: { id: string; name: string }) {
    if (!spotifyClientId) return
    const toLocal = device.id === spotifyDeviceId
    if (toLocal ? !remoteDeviceRef.current : device.id === remoteDeviceRef.current?.id) return
    const spotifyPlaying = activeTrack.source === 'Spotify' && isPlaying
    setDevicesError('')
    try {
      await invoke('spotify_transfer_playback', { clientId: spotifyClientId, deviceId: device.id, play: spotifyPlaying })
      if (!toLocal && activeTrack.source && activeTrack.source !== 'Spotify') setIsPlaying(false)
      spotifyStartedAtRef.current = Date.now()
      changeRemoteDevice(toLocal ? null : { id: device.id, name: device.name })
      setDevices((current) => current.map((item) => ({ ...item, isActive: item.id === device.id })))
    } catch (error) {
      setDevicesError(error instanceof Error ? error.message : String(error))
    }
  }

  // Sigue lo que pasa en el otro dispositivo: posición, pausa, fin de la canción o si alguien la cambió allá.
  function syncRemoteState(state: SpotifyRemoteState) {
    if (state.deviceId && state.deviceId === spotifyDeviceId) {
      changeRemoteDevice(null)
      return
    }
    if (state.deviceId && state.deviceId !== remoteDeviceRef.current?.id) changeRemoteDevice({ id: state.deviceId, name: state.deviceName })
    if (Date.now() - spotifyStartedAtRef.current < 4000) return
    if (activeTrack.source && activeTrack.source !== 'Spotify') return
    const track = state.track
    if (!track) return
    const nearEnd = activeTrack.duration > 0 && elapsedSeconds >= activeTrack.duration - 4
    if (track.id === activeTrack.id) {
      if (!state.isPlaying && state.progressMs === 0 && nearEnd && spotifyEndedIdRef.current !== track.id) {
        spotifyEndedIdRef.current = track.id
        handleTrackEnd()
        return
      }
      setElapsedSeconds(Math.floor(state.progressMs / 1000))
      setIsPlaying(state.isPlaying)
      return
    }
    if (nearEnd && activeTrack.id && spotifyEndedIdRef.current !== activeTrack.id) {
      spotifyEndedIdRef.current = activeTrack.id
      handleTrackEnd()
      return
    }
    const next = toSpotifyTrack(track)
    setActiveCatalogTrack(next)
    setActiveTrackId(next.id)
    setElapsedSeconds(Math.floor(state.progressMs / 1000))
    setIsPlaying(state.isPlaying)
  }

  useEffect(() => {
    remoteSyncRef.current = syncRemoteState
  })

  useEffect(() => {
    if (!remoteDevice || !spotifyClientId) return
    let active = true
    const poll = () => {
      void invoke<SpotifyRemoteState | null>('spotify_get_remote_state', { clientId: spotifyClientId })
        .then((state) => { if (active && state) remoteSyncRef.current(state) })
        .catch((error: unknown) => console.error('No se pudo leer el otro dispositivo.', error))
    }
    poll()
    const timer = window.setInterval(poll, 3000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [remoteDevice, spotifyClientId])

  // Devuelve true si se puede usar; si no, ofrece el plan Pro.
  function requirePro(feature: string) {
    if (isPro) return true
    setUpgradeFeature(feature)
    return false
  }

  function buyPro() {
    if (!accountsEnabled) return
    setUpgradeFeature('')
    if (!accountUser) {
      setAuthDialog({ reason: 'Inicia sesión o crea tu cuenta para obtener DropMusic Pro. Tu plan queda guardado en ella.', skippable: false })
      return
    }
    setAccountMessage('Termina el pago en la página que se abrió. Al volver, DropMusic revisa tu plan solo.')
    if (isTauri()) void openUrl(checkoutUrl).catch((error: unknown) => console.error('No se pudo abrir la página de compra.', error))
    else window.open(checkoutUrl, '_blank', 'noopener')
  }

  async function loadAdminProfiles() {
    setAdminMessage('')
    try {
      const list = await adminListProfiles(adminSearch)
      setAdminProfiles(list)
      if (list.length === 0) setAdminMessage('No hay cuentas con ese correo.')
    } catch (error) {
      setAdminMessage(error instanceof Error ? error.message : String(error))
    }
  }

  async function changeUserPlan(item: Profile, plan: Plan) {
    try {
      await adminSetPlan(item.id, plan)
      setAdminProfiles((current) => current.map((entry) => entry.id === item.id ? { ...entry, plan, proUntil: null } : entry))
      setAdminMessage(`${item.email} ahora tiene el plan ${plan === 'pro' ? 'Pro' : 'Gratis'}.`)
    } catch (error) {
      setAdminMessage(error instanceof Error ? error.message : String(error))
    }
  }

  useEffect(() => {
    if (activeSection === 'Cuenta' && isAdmin) void loadAdminProfiles()
    // Solo al entrar a la sección.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection, isAdmin])

  function toggleFavorite(id: string) {
    setFavoriteIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  function selectPreset(name: string) {
    if (!presets[name]) return
    setSettings((current) => ({ ...current, preset: name, bandGains: [...presets[name]] }))
  }

  function selectSection(section: Section) {
    setMenuOpen(false)
    setActiveSection(section)
    setDetailStack([])
    setSearch('')
    setSpotifyLoading(false)
    setSpotifyError('')
    setJamendoError('')
  }

  function connectProvider(provider: Provider) {
    if (!providers.find(({ name }) => name === provider)?.available) return
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

  async function disconnectSpotify(closeDialog = true) {
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
      changeRemoteDevice(null)
      setDevices([])
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
      if (closeDialog) setSelectedProvider(null)
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
    if (activeTrack.source === 'Spotify' && remoteDeviceRef.current) {
      remoteControl('seek', Math.round(time * 1000))
    } else if (activeTrack.source === 'Spotify') {
      void spotifyPlayerRef.current?.seek(time * 1000).catch((error: unknown) => {
        console.error('No se pudo cambiar la posición de reproducción de Spotify.', error)
        setSpotifyPlayerError(error instanceof Error ? error.message : String(error))
      })
    } else if (audioRef.current) {
      audioRef.current.currentTime = time
    }
  }

  useEffect(() => {
    mediaHandlersRef.current = { togglePlayback, skipTrack, seekTo }
  })

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

  function renderAccount() {
    const formatDate = (value: string) => new Date(value).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })
    return (
      <div className="account-page">
        <section aria-labelledby="account-heading" className="settings-panel account-panel">
          {!accountsEnabled ? (
            <div className="account-status">
              <span className="account-avatar"><Sparkles size={20} /></span>
              <div><h2 id="account-heading">Las cuentas llegan muy pronto</h2><p>Mientras tanto, en esta versión todas las funciones Pro están abiertas para ti.</p></div>
            </div>
          ) : accountUser ? (
            <>
              <div className="account-status">
                <span className="account-avatar">{(accountUser.email[0] ?? 'D').toUpperCase()}</span>
                <div>
                  <h2 id="account-heading">{accountUser.email}</h2>
                  <p>{isAdmin ? 'Administrador de DropMusic · Pro sin vencimiento' : isPro ? profile?.proUntil ? `Pro activo hasta el ${formatDate(profile.proUntil)}` : 'Pro activo' : 'Plan gratuito'}</p>
                </div>
                <span className={`plan-badge${isPro ? ' plan-badge-pro' : ''}`}>{isAdmin ? <><ShieldCheck size={12} /> ADMIN</> : isPro ? <><Crown size={12} /> PRO</> : 'GRATIS'}</span>
              </div>
              <div className="account-actions">
                <button className="secondary-button" onClick={() => { void refreshProfile().then(() => setAccountMessage('Tu plan está al día.')).catch((error: unknown) => setAccountMessage(error instanceof Error ? error.message : String(error))) }} type="button"><RefreshCw size={14} /> Comprobar mi plan</button>
                <button className="secondary-button" onClick={() => { void signOut(); setAccountMessage('') }} type="button"><LogOut size={14} /> Cerrar sesión</button>
              </div>
              {accountMessage && <p className="local-message" role="status">{accountMessage}</p>}
            </>
          ) : (
            <div className="account-login">
              <div>
                <p className="eyebrow">TU CUENTA</p>
                <h2 id="account-heading">Inicia sesión en DropMusic</h2>
                <p>Tu plan queda guardado en tu cuenta y lo usas en la PC, el celular y el TV.</p>
              </div>
              <AuthForm onDone={() => setAccountMessage('')} />
            </div>
          )}
        </section>

        <section aria-labelledby="plans-heading" className="plans-section">
          <div className="section-heading"><div><p className="eyebrow">PLANES</p><h2 id="plans-heading">Elige cómo escuchar</h2></div></div>
          <div className="plan-grid">
            <article className={`plan-card${!isPro ? ' plan-card-current' : ''}`}>
              <header><h3>Gratis</h3><p className="plan-price"><strong>$0</strong><span>/mes</span></p></header>
              <ul>{freeFeatures.map((feature) => <li key={feature}><Check size={14} /> {feature}</li>)}</ul>
              <ul className="plan-limits">{freeLimits.map((limit) => <li key={limit}><Lock size={13} /> {limit}</li>)}</ul>
              <span className="plan-current">{!isPro ? 'Tu plan actual' : 'Incluido en Pro'}</span>
            </article>
            <article className={`plan-card plan-card-pro${isPro && accountsEnabled ? ' plan-card-current' : ''}`}>
              <span className="plan-ribbon"><Crown size={12} /> RECOMENDADO</span>
              <header><h3>Pro</h3><p className="plan-price"><strong>${proPrice}</strong><span>/mes</span></p></header>
              <ul>
                <li><Check size={14} /> Todo lo del plan Gratis</li>
                {proFeatures.map(({ title, text }) => <li key={title}><Check size={14} /> <span><strong>{title}</strong><small>{text}</small></span></li>)}
              </ul>
              {!accountsEnabled
                ? <span className="plan-current">Disponible muy pronto</span>
                : isAdmin
                  ? <span className="plan-current">Incluido por ser admin</span>
                  : <button className="primary-button" onClick={buyPro} type="button"><Crown size={15} /> {isPro ? 'Sumar otro mes' : 'Obtener Pro'}</button>}
            </article>
          </div>
          <p className="settings-disclaimer">Pagas con PayPal o tarjeta en la web de DropMusic. Cada pago suma un mes de Pro, sin renovaciones automáticas. El precio puede cambiar con el tiempo; lo que ya pagaste se respeta.</p>
        </section>

        {isAdmin && (
          <section aria-labelledby="admin-heading" className="settings-panel admin-panel">
            <div className="settings-panel-heading">
              <span className="settings-icon"><ShieldCheck size={17} /></span>
              <div><h2 id="admin-heading">Administración</h2><p>Busca una cuenta por su correo y cambia su plan. Un Pro dado desde aquí no vence.</p></div>
            </div>
            <form className="admin-search" onSubmit={(event) => { event.preventDefault(); void loadAdminProfiles() }}>
              <input aria-label="Buscar cuentas por correo" onChange={(event) => setAdminSearch(event.target.value)} placeholder="Buscar por correo" value={adminSearch} />
              <button className="secondary-button" type="submit"><Search size={14} /> Buscar</button>
            </form>
            {adminMessage && <p className="local-message" role="status">{adminMessage}</p>}
            <ul className="admin-list">
              {adminProfiles.map((item) => (
                <li key={item.id}>
                  <span><strong>{item.email}</strong><small>{item.role === 'admin' ? 'Admin' : hasPro(item) ? `Pro${item.proUntil ? ` hasta el ${formatDate(item.proUntil)}` : ''}` : 'Gratis'}</small></span>
                  {item.role !== 'admin' && (
                    <button className="secondary-button" onClick={() => { void changeUserPlan(item, hasPro(item) ? 'free' : 'pro') }} type="button">{hasPro(item) ? 'Quitar Pro' : 'Dar Pro'}</button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    )
  }

  function renderPersonalization() {
    const current = themes.find(({ id }) => id === effectiveTheme) ?? themes[0]
    const currentLayout = layouts.find(({ id }) => id === effectiveLayout) ?? layouts[0]
    const showThemes = personalizationTab === 'temas'
    return (
      <section aria-labelledby="personalization-heading" className="personalization-page">
        <div className="personalization-hero" key={personalizationTab}>
          <span className="personalization-orb" aria-hidden="true" />
          <span className="personalization-icon">{showThemes ? <Palette size={26} /> : <LayoutDashboard size={26} />}</span>
          <p className="eyebrow">{showThemes ? 'TEMA ACTIVO' : 'DISPOSICIÓN ACTIVA'}</p>
          <h2 id="personalization-heading">{showThemes ? current.name : currentLayout.name}</h2>
          <p>{showThemes ? current.vibe : currentLayout.description}</p>
        </div>
        {!isPro && (
          <div className="pro-banner">
            <span className="pro-banner-icon"><Crown size={18} /></span>
            <span><strong>La personalización es parte de DropMusic Pro</strong><small>Mira todos los estilos. Para aplicarlos, obtén Pro por ${proPrice} al mes.</small></span>
            <button className="primary-button" onClick={() => setUpgradeFeature('La personalización')} type="button">Obtener Pro</button>
          </div>
        )}
        <div aria-label="Qué personalizar" className="personalization-tabs" role="tablist">
          <button aria-selected={showThemes} onClick={() => setPersonalizationTab('temas')} role="tab" type="button">
            <Palette size={18} /><span><strong>Temas</strong><small>{themes.length} estilos de color y fondo</small></span>
          </button>
          <button aria-selected={!showThemes} onClick={() => setPersonalizationTab('disposiciones')} role="tab" type="button">
            <LayoutDashboard size={18} /><span><strong>Disposiciones</strong><small>{layouts.length} formas de acomodar la app</small></span>
          </button>
        </div>
        {!showThemes && (
        <div aria-label="Disposición de DropMusic" className="layout-grid" role="radiogroup">
          {layouts.map((layout) => {
            const selected = layout.id === effectiveLayout
            return (
              <button
                aria-checked={selected}
                className={`layout-card${selected ? ' theme-card-active' : ''}`}
                key={layout.id}
                onClick={() => { if (requirePro('La personalización')) updateSetting('layout', layout.id) }}
                role="radio"
                type="button"
              >
                <span aria-hidden="true" className="layout-preview" data-layout-preview={layout.id}>
                  <i className="layout-preview-nav" /><i className="layout-preview-main" /><i className="layout-preview-now" /><i className="layout-preview-bar" />
                </span>
                <span className="theme-card-copy"><strong>{layout.name}</strong><small>{layout.description}</small></span>
                <span className="theme-card-state">{selected ? 'Activa' : isPro ? 'Usar' : <Lock size={12} />}</span>
              </button>
            )
          })}
        </div>
        )}
        {showThemes && (
        <>
        <div className="personalization-options">
          <div className="setting-toggle-row">
            <span>
              <strong>Portadas animadas</strong>
              <small>Las portadas se mueven despacio y tienen un brillo que las recorre. Spotify no comparte sus videos de portada con otras apps, así que el movimiento lo crea DropMusic.</small>
            </span>
            <label className="toggle-switch"><input aria-label="Portadas animadas" checked={effectiveAnimatedCovers} onChange={(event) => { if (requirePro('La personalización')) updateSetting('animatedCovers', event.target.checked) }} type="checkbox" /><span /></label>
          </div>
        </div>
        <div aria-label="Filtrar temas" className="chip-row theme-filters" role="group">
          {(['Todos', ...themeCategories] as const).map((category) => (
            <button aria-pressed={themeFilter === category} className={`chip${themeFilter === category ? ' chip-active' : ''}`} key={category} onClick={() => setThemeFilter(category)} type="button">{category}</button>
          ))}
        </div>
        <div aria-label="Temas de DropMusic" className="theme-grid" key={themeFilter} role="radiogroup">
          {themes.filter((theme) => themeFilter === 'Todos' || theme.category === themeFilter).map((theme) => {
            const selected = theme.id === effectiveTheme
            return (
              <button
                aria-checked={selected}
                className={`theme-card${selected ? ' theme-card-active' : ''}`}
                key={theme.id}
                onClick={() => { if (requirePro('La personalización')) updateSetting('theme', theme.id) }}
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
                <span className="theme-card-state">{selected ? 'Activo' : isPro ? 'Aplicar' : <Lock size={12} />}</span>
              </button>
            )
          })}
        </div>
        </>
        )}
      </section>
    )
  }

  const activeTheme = themes.find(({ id }) => id === effectiveTheme) ?? themes[0]
  const playerNotice = playbackError || spotifyPlayerError
  const upcomingTracks = activeTrack.source === 'Spotify'
    ? radioQueue
    : jamendoTracks.slice(jamendoTracks.findIndex((track) => track.id === activeTrackId) + 1)
  const favoriteTracks = allTracks.filter((track) =>
    favoriteIds.includes(track.id) && `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(query),
  )

  return (
    <div
      className={`app-shell min-h-screen${settings.ambientGlow ? '' : ' no-ambient'}${settings.animations ? '' : ' reduce-motion'}${activeTheme.ink ? ' theme-ink' : ''}${activeTheme.scene ? ' has-scene' : ''}${isPlaying ? ' is-playing' : ''}${effectiveAnimatedCovers ? ' animated-covers' : ''}${tvMode ? ' tv-mode' : ''}${menuOpen ? ' menu-open' : ''}`}
      data-layout={shellLayout}
      data-theme={effectiveTheme}
      style={{ '--ambient-color': activeTrack.color } as CSSProperties}
    >
      <div aria-hidden="true" className="ambient-glow" />
      <div aria-hidden="true" className="theme-art-backdrop">
        {activeTrack.artwork && <img alt="" key={activeTrack.artwork} src={activeTrack.artwork} />}
      </div>
      {activeTheme.scene && themeScene}
      {effectiveAnimatedCovers && coverMotionFilter}
      <audio
        crossOrigin="anonymous"
        onEnded={handleTrackEnd}
        onError={handleAudioError}
        onTimeUpdate={() => setElapsedSeconds(Math.floor(audioRef.current?.currentTime ?? 0))}
        preload="none"
        ref={audioRef}
        src={activeTrack.audioUrl}
      />

      {['available', 'downloading', 'installing'].includes(updateState.status) && !updateDismissed && (
        <div className="update-bar" role="status">
          <span className="update-bar-icon"><Download size={16} /></span>
          <span className="update-bar-copy">
            <strong>DropMusic {updateState.version} ya está disponible</strong>
            <small>
              {updateState.status === 'downloading'
                ? `Descargando… ${Math.round((updateState.progress ?? 0) * 100)}%`
                : updateState.status === 'installing'
                  ? 'Instalando: DropMusic se cerrará y volverá a abrirse.'
                  : updateState.notes?.split('\n')[0] || 'Se instala en segundos y la app se vuelve a abrir sola.'}
            </small>
          </span>
          {updateState.status !== 'available' && (
            <span aria-hidden="true" className="update-progress"><i style={{ width: `${Math.round((updateState.progress ?? 0) * 100)}%` }} /></span>
          )}
          {updateState.status === 'available' && (
            <>
              <button className="update-install" onClick={() => void installUpdate()} type="button">Actualizar ahora</button>
              <button aria-label="Recordármelo más tarde" className="update-later" onClick={() => setUpdateDismissed(true)} type="button"><X size={15} /></button>
            </>
          )}
        </div>
      )}

      {menuOpen && <button aria-label="Cerrar menú" className="menu-scrim" onClick={() => setMenuOpen(false)} tabIndex={-1} type="button" />}
      <aside aria-label={tvMode ? 'Menú' : undefined} aria-modal={menuOpen || undefined} className="sidebar" onKeyDown={(event) => { if (event.key === 'Escape') setMenuOpen(false) }} role={menuOpen ? 'dialog' : undefined}>
        <a aria-label="DropMusic, inicio" className="brand" href="#inicio">
          <span className="brand-mark brand-logo"><img alt="" src="/favicon.svg" /></span>
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
          <button className="profile-button" onClick={() => selectSection('Cuenta')} type="button">
            <span className={`avatar${isPro && accountsEnabled ? ' avatar-pro' : ''}`}>{(accountUser?.email[0] ?? 'D').toUpperCase()}</span>
            <span className="profile-copy">
              <strong>{accountUser?.email ?? (accountsEnabled ? 'Inicia sesión' : 'DropMusic')}</strong>
              <small>{!accountsEnabled ? 'Todo desbloqueado' : isAdmin ? 'Administrador · Pro' : isPro ? 'Plan Pro' : 'Plan gratuito'}</small>
            </span>
            <ChevronDown className="profile-chevron" size={16} />
          </button>
        </div>
      </aside>

      <main className="main-content" id="inicio" ref={mainContentRef}>
        <header className="topbar">
          <button aria-expanded={menuOpen} aria-label="Abrir menú" className="icon-button menu-toggle" onClick={() => setMenuOpen(true)} type="button"><Menu size={22} /></button>
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
                {connectedAccounts.Spotify && (
                  <div aria-label="Qué parte de tu colección ver" className="library-tabs" role="tablist">
                    <button aria-selected={libraryTab === 'local'} onClick={() => setLibraryTab('local')} role="tab" type="button">
                      <FolderOpen size={18} /><span><strong>Archivos locales</strong><small>{localTracks.length} {localTracks.length === 1 ? 'canción' : 'canciones'} en este equipo</small></span>
                    </button>
                    <button aria-selected={libraryTab === 'spotify'} onClick={() => setLibraryTab('spotify')} role="tab" type="button">
                      <Music2 size={18} /><span><strong>Tu biblioteca de Spotify</strong><small>{connectedAccounts.Spotify.name}</small></span>
                    </button>
                  </div>
                )}
                {(!connectedAccounts.Spotify || libraryTab === 'local') ? (
                <section
                  aria-labelledby="local-heading"
                  className={`local-library${localDragging ? ' local-dragging' : ''}`}
                  onDragLeave={(event) => { if (event.currentTarget === event.target) setLocalDragging(false) }}
                  onDragOver={(event) => {
                    if (!event.dataTransfer.types.includes('Files')) return
                    event.preventDefault()
                    setLocalDragging(true)
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    setLocalDragging(false)
                    if (requirePro('La importación de canciones locales')) void importLocalFiles(event.dataTransfer.files)
                  }}
                >
                  <div className="section-heading">
                    <div><p className="eyebrow">ARCHIVOS LOCALES {!isPro && <span className="pro-chip"><Crown size={10} /> PRO</span>}</p><h2 id="local-heading">Tu música en este equipo</h2></div>
                    <span className="track-count">{localTracks.length} {localTracks.length === 1 ? 'canción' : 'canciones'}</span>
                  </div>
                  <div className="local-drop">
                    <span className="local-drop-icon"><Upload size={22} /></span>
                    <div>
                      <strong>{localImport ? `Agregando ${localImport.done} de ${localImport.total}…` : 'Sube tus propias canciones'}</strong>
                      <small>Arrástralas aquí o elígelas. MP3, FLAC, M4A, WAV, OGG y OPUS. Se guardan dentro de DropMusic y suenan sin cuenta ni internet.</small>
                      {localImport && <span aria-hidden="true" className="local-progress"><i style={{ width: `${(localImport.done / localImport.total) * 100}%` }} /></span>}
                    </div>
                    <div className="local-actions">
                      <button className="primary-button" disabled={Boolean(localImport)} onClick={() => { if (requirePro('La importación de canciones locales')) localFileInputRef.current?.click() }} type="button">{isPro ? <Upload size={15} /> : <Lock size={14} />} Subir canciones</button>
                      <button className="secondary-button" disabled={Boolean(localImport)} onClick={() => { if (requirePro('La importación de canciones locales')) localFolderInputRef.current?.click() }} type="button">{isPro ? <FolderOpen size={15} /> : <Lock size={14} />} Subir carpeta</button>
                    </div>
                    <input accept={['audio/*', ...localAudioExtensions].join(',')} hidden multiple onChange={(event) => { if (event.target.files) void importLocalFiles(event.target.files); event.target.value = '' }} ref={localFileInputRef} type="file" />
                    <input hidden multiple onChange={(event) => { if (event.target.files) void importLocalFiles(event.target.files); event.target.value = '' }} ref={(input) => { localFolderInputRef.current = input; input?.setAttribute('webkitdirectory', '') }} type="file" />
                  </div>
                  {localMessage && <p className="local-message" role="status">{localMessage}</p>}
                  {localTracks.length > 0 && (
                    <TrackRows
                      activeTrackId={activeTrackId}
                      favoriteIds={favoriteIds}
                      onPlay={playTrack}
                      onRemove={(id) => { void removeLocalTrack(id) }}
                      onToggleFavorite={toggleFavorite}
                      visibleTracks={localTracks.filter((track) => `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(query))}
                    />
                  )}
                </section>
                ) : (
                <>
                <section aria-label="Resumen de tu biblioteca de Spotify" className="collection-summary">
                  <span className="collection-stat"><Disc3 size={18} /><strong>{albums.length}</strong><small>álbumes y EPs</small></span>
                  <span className="collection-stat"><Music2 size={18} /><strong>{spotifyLibraryTracks.length}</strong><small>canciones de Spotify</small></span>
                  <span className="collection-stat"><Heart size={18} /><strong>{favoriteIds.length}</strong><small>favoritos</small></span>
                </section>
                <section aria-labelledby="collection-heading" className="recent-section">
                  <div className="section-heading"><div><p className="eyebrow">TU BIBLIOTECA DE SPOTIFY</p><h2 id="collection-heading">{search ? 'Resultados' : 'Álbumes y sencillos'}</h2></div><span className="track-count">{albums.length} lanzamientos</span></div>
                  <div className="album-grid">
                    {albums.filter((album) => `${album.album} ${album.artist}`.toLowerCase().includes(query)).map((album) => (
                      <button className="album-card" key={`${album.source ?? 'apple'}:${album.album}`} onClick={() => album.albumId ? openDetail({ kind: 'album', id: album.albumId }) : playTrack(album.id)} type="button">
                        <span className="album-card-art"><img alt={`Portada de ${album.album}`} loading="lazy" src={album.artwork} /><span><Play fill="currentColor" size={17} /></span></span><strong>{album.album}</strong><small>{album.artist}</small>
                      </button>
                    ))}
                  </div>
                </section>
                <section aria-labelledby="songs-heading" className="collection-songs">
                  <div className="section-heading"><div><p className="eyebrow">DE SPOTIFY</p><h2 id="songs-heading">Canciones</h2></div><span className="track-count">{spotifyLibraryTracks.length} canciones</span></div>
                  {spotifyLibraryTracks.length > 0
                    ? renderTracks(spotifyLibraryTracks.filter((track) => `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(query)))
                    : <div className="empty-search"><Library size={20} /><p>Tus canciones de Spotify aparecen aquí cuando terminen de cargar.</p></div>}
                </section>
                </>
                )}
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
            ) : activeSection === 'Cuenta' ? (
              renderAccount()
            ) : activeSection === 'Personalización' ? (
              renderPersonalization()
            ) : activeSection === 'Ajustes' ? (
              <div className="settings-page">
                <section aria-labelledby="connections-heading" className="settings-panel">
                  <div className="settings-panel-heading">
                    <span className="settings-icon"><Headphones size={17} /></span><div><h2 id="connections-heading">Servicios de música</h2><p>Vincula tus cuentas sin compartir contraseñas con DropMusic.</p></div>
                  </div>
                  <div className="provider-card-list">
                    {providers.map(({ name, description, available }) => (
                      <article className={`provider-card${available ? '' : ' provider-card-soon'}`} key={name}>
                        <div className={`provider-card-logo provider-logo-${name === 'Apple Music' ? 'apple' : name === 'YouTube Music' ? 'youtube' : 'spotify'}`}><Music2 size={18} /></div>
                        <div className="provider-card-copy"><h3>{name}</h3><p>{description}</p><span><span className={`connection-status-dot${connectedAccounts[name] ? ' connection-status-dot-connected' : ''}`} /> {available ? connectedAccounts[name]?.name ?? 'Sin vincular' : 'Próximamente'}</span></div>
                        {available
                          ? <button className="secondary-button" onClick={() => connectProvider(name)} type="button">{connectedAccounts[name] ? 'Gestionar' : 'Conectar'} <ArrowUpRight size={14} /></button>
                          : <span className="soon-badge">Próximamente</span>}
                      </article>
                    ))}
                  </div>
                  <p className="settings-disclaimer">Spotify Web Playback SDK reproduce las canciones aquí mismo con una cuenta Premium y los permisos autorizados. Apple Music y YouTube Music llegarán en una próxima versión.</p>
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

                <section aria-labelledby="device-settings-heading" className="settings-panel">
                  <div className="settings-panel-heading"><span className="settings-icon"><Tv size={17} /></span><div><h2 id="device-settings-heading">Pantalla</h2><p>DropMusic se adapta solo a celulares y tabletas.</p></div></div>
                  <div className="setting-toggle-row">
                    <span><strong>Modo TV</strong><small>{isTvDevice ? 'Activado porque estás en un televisor.' : 'Letra y botones grandes para verlos de lejos, y navegación con las flechas del control remoto o el teclado.'}</small></span>
                    <label className="toggle-switch"><input aria-label="Modo TV" checked={tvMode} disabled={isTvDevice} onChange={(event) => updateSetting('tvMode', event.target.checked)} type="checkbox" /><span /></label>
                  </div>
                </section>

                <section aria-labelledby="update-settings-heading" className="settings-panel">
                  <div className="settings-panel-heading"><span className="settings-icon"><RefreshCw size={17} /></span><div><h2 id="update-settings-heading">Actualizaciones</h2><p>{isAndroidApp ? 'Las versiones nuevas para Android se descargan desde la web de DropMusic.' : 'DropMusic busca versiones nuevas al abrirse y cada 6 horas.'}</p></div></div>
                  <div className="setting-toggle-row">
                    <span>
                      <strong>Versión {appVersion || 'de desarrollo'}</strong>
                      <small>
                        {updateState.status === 'checking' ? 'Buscando actualizaciones…'
                          : updateState.status === 'none' ? 'Tienes la versión más reciente.'
                          : updateState.status === 'available' ? `Hay una versión nueva: ${updateState.version}.`
                          : updateState.status === 'downloading' ? `Descargando la versión ${updateState.version}…`
                          : updateState.status === 'installing' ? 'Instalando la actualización…'
                          : updateState.status === 'error' ? `No se pudo comprobar: ${updateState.error ?? 'sin conexión'}`
                          : isAndroidApp ? 'Descarga la APK nueva e instálala encima: tus canciones y ajustes se quedan.'
                          : 'Las actualizaciones se instalan solas cuando aceptas.'}
                      </small>
                    </span>
                    {updateState.status === 'available'
                      ? <button className="primary-button" onClick={() => void installUpdate()} type="button"><Download size={15} /> Actualizar</button>
                      : !isAndroidApp && <button className="secondary-button" disabled={!isTauri() || updateState.status === 'checking' || updateState.status === 'downloading'} onClick={() => void checkForUpdates(true)} type="button"><RefreshCw size={15} /> Buscar</button>}
                  </div>
                </section>

                <section aria-labelledby="aura-settings-heading" className="settings-panel">
                  <div className="settings-panel-heading"><span className="settings-icon"><Activity size={17} /></span><div><h2 id="aura-settings-heading">Aura de Pulso</h2><p>Cómo se mueve la luz alrededor de la portada en Big Picture &gt; Pulso. Sigue lo que suena en tu PC.</p></div></div>
                  <div aria-label="Aura de Pulso" className="aura-grid" role="radiogroup">
                    {pulseAuras.map((aura) => (
                      <button aria-checked={settings.pulseAura === aura.id} className={`aura-card${settings.pulseAura === aura.id ? ' aura-card-active' : ''}`} key={aura.id} onClick={() => { if (requirePro('Las auras de Pulso')) updateSetting('pulseAura', aura.id) }} role="radio" type="button">
                        <span aria-hidden="true" className="aura-preview" data-aura-preview={aura.id}><i /><i /><i /><i /><i /><i /><b /></span>
                        <span><strong>{aura.name}</strong><small>{aura.description}</small></span>
                      </button>
                    ))}
                  </div>
                </section>

                <section aria-labelledby="playback-settings-heading" className="settings-panel">
                  <div className="settings-panel-heading"><span className="settings-icon"><ListMusic size={17} /></span><div><h2 id="playback-settings-heading">Reproducción</h2><p>Tus preferencias del reproductor.</p></div></div>
                  <label className="setting-select-row">
                    <span><strong>Servicio preferido</strong><small>Fuente sugerida cuando vincules tu cuenta.</small></span>
                    <select onChange={(event) => updateSetting('preferredService', event.target.value as Provider)} value={settings.preferredService}>
                      {providers.map(({ name, available }) => <option disabled={!available} key={name} value={name}>{available ? name : `${name} (próximamente)`}</option>)}
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

      <footer aria-label="Controles del reproductor" className={`player-bar${remoteDevice ? ' player-bar-remote' : ''}`}>
        {remoteDevice && <span className="remote-banner" role="status"><Cast size={12} /> Sonando en {remoteDevice.name}</span>}
        <div className="player-track">
          <button aria-label={activeTrack.source ? `Abrir ${activeTrack.title} en pantalla completa` : 'Nada sonando'} className="player-track-open" disabled={!activeTrack.source} onClick={() => setBigPictureMode('carousel')} type="button">
            {activeTrack.artwork
              ? <img alt="" src={activeTrack.artwork} />
              : <span aria-hidden="true" className="player-art-placeholder"><Music2 size={17} /></span>}
            <div className="player-track-meta"><strong>{activeTrack.title}</strong><span>{activeTrack.artist}</span></div>
          </button>
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
          <button aria-expanded={connectOpen} aria-label="Conectar a un dispositivo" className={`icon-button connect-button${remoteDevice ? ' control-active' : ''}`} onClick={toggleConnect} title="Conectar a un dispositivo" type="button"><Cast size={16} /></button>
          <button aria-label="Ver la letra en pantalla completa" className="icon-button" disabled={!activeTrack.source} onClick={() => setBigPictureMode('lyrics')} title="Letra" type="button"><Mic2 size={16} /></button>
          <button aria-label="Abrir reproductor Big Picture" className="icon-button" disabled={!activeTrack.source} onClick={() => setBigPictureMode('carousel')} title="Big Picture" type="button"><Maximize2 size={16} /></button>
        </div>
      </footer>

      {connectOpen && (
        <ConnectPanel
          devices={devices}
          error={devicesError}
          loading={devicesLoading}
          localDeviceId={spotifyDeviceId}
          onClose={() => setConnectOpen(false)}
          onLinkSpotify={() => { setConnectOpen(false); connectProvider('Spotify') }}
          onRefresh={() => { void loadDevices() }}
          onSelect={(device) => { void selectDevice(device) }}
          remoteDeviceId={remoteDevice?.id ?? ''}
          spotifyLinked={Boolean(connectedAccounts.Spotify)}
        />
      )}

      {bigPictureMode && activeTrack.source && (
        <BigPicturePlayer
          elapsed={elapsedSeconds}
          isPlaying={isPlaying}
          lyrics={lyrics}
          immersiveLocked={!isPro}
          mode={isPro || bigPictureMode === 'carousel' || bigPictureMode === 'lyrics' ? bigPictureMode : 'carousel'}
          onClose={() => setBigPictureMode(null)}
          onModeChange={(mode) => {
            if ((mode === 'vinilo' || mode === 'pulso') && !requirePro('El modo inmersivo')) return
            setBigPictureMode(mode)
          }}
          onPlay={playTrack}
          onSeek={seekTo}
          onSkip={skipTrack}
          onToggleShuffle={toggleShuffle}
          onTogglePlayback={togglePlayback}
          onToggleRepeat={toggleRepeat}
          onVolume={(volume) => updateSetting('volume', volume)}
          pulseAura={settings.pulseAura}
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
          onSpotifyClientIdChange={(clientId) => {
            // La sesión guardada es de otra app de Spotify: hay que volver a conectar.
            if (clientId !== settings.spotifyClientId && connectedAccounts.Spotify) void disconnectSpotify(false)
            updateSetting('spotifyClientId', clientId)
          }}
          personalSpotifyClientId={settings.spotifyClientId}
          provider={selectedProvider}
          spotifyClientId={spotifyClientId}
        />
      )}

      {upgradeFeature && (
        <UpgradeDialog feature={upgradeFeature} onBuy={buyPro} onClose={() => setUpgradeFeature('')} signedIn={Boolean(accountUser)} />
      )}

      {authDialog && (
        <AuthDialog
          onClose={() => setAuthDialog(null)}
          onSkip={authDialog.skippable ? () => {
            try { window.localStorage.setItem('dropmusic-auth-skipped', '1') } catch { /* sin almacenamiento: se volverá a preguntar */ }
            setAuthDialog(null)
          } : undefined}
          reason={authDialog.reason}
        />
      )}
    </div>
  )
}

export default App
